/**
 * 전체 Steam 카탈로그 수집 스크립트 (docs/STORAGE.md) — 재개 가능한 배치.
 *
 *   node --experimental-strip-types scripts/ingest-catalog.ts <phase> [옵션]
 *
 * phase:
 *   apps           IStoreService/GetAppList(게임만) 전체 페이지 → apps 테이블. 수 분.
 *   spy [pages]    SteamSpy request=all 페이지 수집(소유자 내림차순 스파인).
 *                  레이트리밋 1req/60s — pages 기본 1. meta에 다음 페이지 저장(재개).
 *   tags [seconds] SteamSpy per-app appdetails 태그 크롤. 1req/s 예의.
 *                  소유자 상위·미수집/만료 우선(tagCrawlQueue). 시간 예산으로 재개.
 *   stats          수집 현황 출력.
 *
 * 전부 idempotent·재개 가능 — cron으로 반복 실행하면 "한 번 받고 바뀐 것만 갱신"이 된다.
 * DB 파일(.catalog/steam.db)은 gitignore. 이 컨테이너는 ephemeral이라 실제 축적은
 * 볼륨 있는 배포에서 수행한다.
 */
import { readFileSync } from "node:fs";
import { CatalogStore } from "../src/lib/catalog/store.ts";

const DB_PATH = process.env.CATALOG_DB || ".catalog/steam.db";
const SPY_ALL_WAIT_MS = 60_000; // SteamSpy 문서상 request=all 은 60초당 1회
const SPY_APP_WAIT_MS = 1_000; // per-app appdetails 1초당 1회

function apiKey(): string {
  if (process.env.STEAM_API_KEY) return process.env.STEAM_API_KEY;
  try {
    const m = readFileSync(".env.local", "utf8").match(/STEAM_API_KEY=(\S+)/);
    if (m) return m[1];
  } catch {}
  throw new Error("STEAM_API_KEY가 필요합니다 (.env.local 또는 환경 변수).");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url.replace(/key=[^&]+/, "key=***")}`);
  return res.json();
}

/** SteamSpy "20,000 .. 50,000" → 기하평균 (stats.ts parseOwnersMidpoint와 동일 규칙) */
function ownersMid(owners: string): number {
  const nums = owners.match(/[\d,]+/g)?.map((x) => parseInt(x.replace(/,/g, ""), 10)).filter((x) => x > 0) ?? [];
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0];
  return Math.round(Math.sqrt(nums[0] * nums[1]));
}

async function phaseApps(store: CatalogStore): Promise<void> {
  const key = apiKey();
  let lastAppid = Number(store.getMeta("apps_last_appid") ?? 0);
  let total = 0;
  for (let page = 0; page < 40; page++) {
    const params = new URLSearchParams({
      key,
      include_games: "1",
      max_results: "50000",
      ...(lastAppid ? { last_appid: String(lastAppid) } : {}),
    });
    const data = (await fetchJson(
      `https://api.steampowered.com/IStoreService/GetAppList/v1/?${params}`,
    )) as { response: { apps?: { appid: number; name: string; last_modified?: number }[]; have_more_results?: boolean; last_appid?: number } };
    const apps = data.response.apps ?? [];
    store.upsertApps(
      apps.map((a) => ({ appid: a.appid, name: a.name ?? "", lastModified: a.last_modified ?? 0 })),
    );
    total += apps.length;
    console.log(`apps page ${page}: +${apps.length} (누적 ${total.toLocaleString()})`);
    if (!data.response.have_more_results || !data.response.last_appid) {
      store.setMeta("apps_last_appid", "0"); // 완료 — 다음 실행은 처음부터 증분 재수집
      store.setMeta("apps_completed_at", String(Date.now()));
      return;
    }
    lastAppid = data.response.last_appid;
    store.setMeta("apps_last_appid", String(lastAppid));
  }
}

async function phaseSpy(store: CatalogStore, pages: number): Promise<void> {
  let page = Number(store.getMeta("spy_next_page") ?? 0);
  for (let i = 0; i < pages; i++) {
    const data = (await fetchJson(`https://steamspy.com/api.php?request=all&page=${page}`)) as Record<
      string,
      { appid: number; name: string; positive: number; negative: number; owners: string; ccu: number; price: string }
    >;
    const rows = Object.values(data);
    if (rows.length === 0) {
      console.log(`spy page ${page}: 비어 있음 — 마지막 페이지 도달, 처음으로 리셋`);
      store.setMeta("spy_next_page", "0");
      return;
    }
    const now = Date.now();
    store.upsertSpyBulk(
      rows.map((r) => ({
        appid: r.appid,
        name: r.name ?? "",
        positive: r.positive ?? 0,
        negative: r.negative ?? 0,
        ownersMid: ownersMid(r.owners ?? ""),
        ccu: r.ccu ?? 0,
        priceCents: parseInt(r.price ?? "0", 10) || 0,
        fetchedAt: now,
      })),
    );
    console.log(`spy page ${page}: +${rows.length}`);
    page++;
    store.setMeta("spy_next_page", String(page));
    if (i < pages - 1) await sleep(SPY_ALL_WAIT_MS);
  }
}

async function phaseTags(store: CatalogStore, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  const queue = store.tagCrawlQueue(100_000, 7 * 86_400_000, Date.now());
  console.log(`tags 대기열: ${queue.length.toLocaleString()}개 (소유자 상위 우선)`);
  let done = 0;
  for (const appid of queue) {
    if (Date.now() >= deadline) break;
    try {
      const data = (await fetchJson(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`)) as {
        tags?: Record<string, number> | unknown[];
      };
      const tags = data.tags && !Array.isArray(data.tags) ? (data.tags as Record<string, number>) : {};
      store.upsertSpyTags(appid, tags, Date.now());
      done++;
    } catch (e) {
      console.log(`  appid ${appid} 실패: ${(e as Error).message} — 건너뜀`);
    }
    await sleep(SPY_APP_WAIT_MS);
  }
  console.log(`tags: ${done}개 수집 (예산 ${seconds}s)`);
}

async function main(): Promise<void> {
  const [phase, arg] = process.argv.slice(2);
  const store = new CatalogStore(DB_PATH);
  try {
    if (phase === "apps") await phaseApps(store);
    else if (phase === "spy") await phaseSpy(store, Math.max(1, Number(arg ?? 1)));
    else if (phase === "tags") await phaseTags(store, Math.max(10, Number(arg ?? 60)));
    else if (phase === "stats") {
      console.log(JSON.stringify({ db: DB_PATH, ...store.counts(), spyNextPage: store.getMeta("spy_next_page") }, null, 1));
    } else {
      console.log("사용법: node --experimental-strip-types scripts/ingest-catalog.ts <apps|spy [pages]|tags [seconds]|stats>");
      process.exitCode = 2;
    }
  } finally {
    store.close();
  }
}

await main();
