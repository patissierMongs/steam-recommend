import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { AppDetails, GameFacts, SteamSpyApp } from "@/lib/types";
import { parseOwnersMidpoint } from "@/lib/analysis/stats";
import { mapWithConcurrency } from "@/lib/concurrency";
import { throttleSteamSpy, throttleStore } from "@/lib/steam/ratelimit";

/**
 * appid 단위 게임 데이터 — 사용자와 무관하므로 'use cache'로 서버 캐시.
 * 캐시 키는 함수 인자(appid)뿐이어야 한다: steamid 등 개인 값을 절대 넘기지 말 것.
 *
 * 실패 정책: 일시적 오류(HTTP/타임아웃)는 throw → 캐시에 남지 않음.
 * 확정적 "데이터 없음"(미등록 appid 등)만 null을 반환해 캐시한다.
 */

const DAY = 86_400;

/** SteamSpy: 태그(투표수), 리뷰 수, 소유자 추정, 중앙값 플레이타임 */
export async function getSpyApp(appid: number): Promise<SteamSpyApp | null> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: DAY, expire: 7 * DAY });
  cacheTag(`spy-${appid}`);
  await throttleSteamSpy();
  const res = await fetch(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`SteamSpy HTTP ${res.status} (appid ${appid})`);
  const data = (await res.json()) as SteamSpyApp & { name: string | null; tags: unknown };
  if (!data || data.name === null || data.name === undefined) return null;
  // 태그 없음은 빈 배열([])로 오므로 객체로 정규화
  const tags =
    data.tags && typeof data.tags === "object" && !Array.isArray(data.tags)
      ? (data.tags as Record<string, number>)
      : {};
  return { ...data, tags };
}

/** Steam Store appdetails: 장르, 출시일, 가격, 이미지, 설명, 타입(game/dlc) */
export async function getStoreApp(appid: number): Promise<AppDetails | null> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: DAY, expire: 7 * DAY });
  cacheTag(`store-${appid}`);
  await throttleStore();
  const params = new URLSearchParams({
    appids: String(appid),
    cc: "KR",
    l: "korean",
    // 캐시에 대용량 설명 HTML이 들어가지 않도록 필요한 필드만
    filters: "basic,developers,genres,categories,price_overview,release_date,metacritic,recommendations",
  });
  const res = await fetch(`https://store.steampowered.com/api/appdetails?${params}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`appdetails HTTP ${res.status} (appid ${appid})`);
  const body = (await res.json()) as Record<string, { success: boolean; data?: AppDetails }>;
  const entry = body?.[String(appid)];
  if (!entry?.success || !entry.data) return null; // 상점에서 내려간 앱 — 확정적 없음
  const d = entry.data;
  // 캐시 엔트리를 작게 유지: 타입에 선언된 필드만 저장 (설명 HTML 등 제외)
  return {
    steam_appid: d.steam_appid,
    name: d.name,
    type: d.type,
    is_free: d.is_free,
    short_description: d.short_description,
    header_image: d.header_image,
    developers: d.developers,
    publishers: d.publishers,
    genres: d.genres,
    categories: d.categories,
    release_date: d.release_date,
    metacritic: d.metacritic,
    price_overview: d.price_overview,
    recommendations: d.recommendations,
  };
}

/** 헤더 이미지는 appid로 결정되는 CDN 경로가 있어 상점 조회 없이도 구성 가능 */
export function headerImageUrl(appid: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
}

function factsFromSpy(appid: number, spy: SteamSpyApp): GameFacts {
  return {
    appid,
    name: spy.name,
    tags: spy.tags,
    genres: (spy.genre ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    positive: spy.positive ?? 0,
    negative: spy.negative ?? 0,
    ownersEstimate: parseOwnersMidpoint(spy.owners ?? ""),
    medianPlaytime: spy.median_forever ?? 0,
    headerImage: headerImageUrl(appid),
    shortDescription: "",
    releaseDate: "",
    comingSoon: false,
    isFree: false,
    priceFormatted: null,
    discountPercent: 0,
    developers: spy.developer ? [spy.developer] : [],
    appType: null,
  };
}

function mergeStore(facts: GameFacts, store: AppDetails): GameFacts {
  const genres = store.genres?.length ? store.genres.map((g) => g.description) : facts.genres;
  // SteamSpy 태그가 없으면 상점 장르를 균등 가중 의사-태그로 폴백
  const tags =
    Object.keys(facts.tags).length > 0
      ? facts.tags
      : Object.fromEntries(genres.map((g) => [g, 1]));
  return {
    ...facts,
    name: store.name || facts.name,
    tags,
    genres,
    headerImage: store.header_image || facts.headerImage,
    shortDescription: store.short_description ?? "",
    releaseDate: store.release_date?.date ?? "",
    comingSoon: store.release_date?.coming_soon ?? false,
    isFree: store.is_free ?? false,
    priceFormatted: store.price_overview?.final_formatted ?? null,
    discountPercent: store.price_overview?.discount_percent ?? 0,
    developers: store.developers?.length ? store.developers : facts.developers,
    appType: store.type ?? null,
  };
}

/**
 * 점수 계산용 경량 팩트: SteamSpy 우선, 실패 시 상점 폴백.
 * fallbackName: GetOwnedGames가 이미 알려준 이름 (표시가 끊기지 않도록).
 */
export async function getScoringFacts(appid: number, fallbackName?: string): Promise<GameFacts | null> {
  let spy: SteamSpyApp | null = null;
  try {
    spy = await getSpyApp(appid);
  } catch {
    // SteamSpy 다운 → 상점 폴백 시도
  }
  if (spy && Object.keys(spy.tags).length > 0) return factsFromSpy(appid, spy);

  // 태그가 없으면 취향 계산이 불가능 — 상점 장르로 폴백
  try {
    const store = await getStoreApp(appid);
    if (store) {
      const base = spy ? factsFromSpy(appid, spy) : emptyFacts(appid, fallbackName ?? "");
      return mergeStore(base, store);
    }
  } catch {
    // 상점도 실패
  }
  if (spy) return factsFromSpy(appid, spy);
  return null;
}

function emptyFacts(appid: number, name: string): GameFacts {
  return {
    appid,
    name,
    tags: {},
    genres: [],
    positive: 0,
    negative: 0,
    ownersEstimate: 0,
    medianPlaytime: 0,
    headerImage: headerImageUrl(appid),
    shortDescription: "",
    releaseDate: "",
    comingSoon: false,
    isFree: false,
    priceFormatted: null,
    discountPercent: 0,
    developers: [],
    appType: null,
  };
}

/** 표시 직전 상위 후보에만 상점 상세(가격/설명/출시일/타입)를 덧입힌다 */
export async function enrichWithStore(facts: GameFacts): Promise<GameFacts> {
  try {
    const store = await getStoreApp(facts.appid);
    return store ? mergeStore(facts, store) : facts;
  } catch {
    return facts;
  }
}

/** appid 집합에 대한 경량 팩트 fan-out (동시성 제한, 실패 격리) */
export async function getManyScoringFacts(
  apps: readonly { appid: number; name?: string }[],
  concurrency = 8,
): Promise<Map<number, GameFacts>> {
  const results = await mapWithConcurrency(apps, concurrency, (a) => getScoringFacts(a.appid, a.name));
  const map = new Map<number, GameFacts>();
  results.forEach((facts) => {
    if (facts) map.set(facts.appid, facts);
  });
  return map;
}
