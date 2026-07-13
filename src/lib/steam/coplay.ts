import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { mapWithConcurrency } from "@/lib/concurrency";
import { readJson } from "@/lib/steam/ratelimit";

/**
 * 동시보유(co-play) 표본: "앵커 게임을 긍정 리뷰한 유저들이 실제로 플레이하는 게임".
 * 앵커 appid에만 의존하는 사용자 독립 데이터라 7일 캐시로 전 사용자가 공유한다.
 *
 * 주의: 이 모듈의 fetch는 'use cache' 스코프 안에서 실행되므로 no-store를 쓰지 않는다
 * (개인화 모듈 webapi.ts와 분리된 이유).
 */

const DAY = 86_400;
/**
 * lift 기저율 p(Y)=owners/POP의 분모로 쓰는 대략적 Steam 계정 규모(프라이어).
 * 주의: add-s 평활화(smoothedLogLift) 때문에 이 상수는 순위에 영향을 준다 —
 * 표본이 작아 기대치 M·p(Y)가 s보다 작을 때 특히 그렇다. 따라서 "전체 유저 대비
 * 기대 배수"라는 절대 해석은 근사이며, co-play 표본(앵커의 최근 긍정 리뷰어 중
 * 공개 라이브러리 사용자) 자체가 전체 모집단과 다르다는 점도 감안해야 한다.
 * 순위 목적상 이 값은 "동반 플레이 빈도를 전역 인기도로 완만히 보정"하는 역할이다.
 */
export const STEAM_POPULATION = 120_000_000;

/** co-play 신호로 인정할 최소 플레이타임(분) — 단순 보유가 아니라 실제 플레이 */
const MIN_COPLAY_MINUTES = 60;
const MAX_REVIEWERS = 30;
const MIN_REVIEWER_GAMES = 5;

export interface CoplaySample {
  anchorAppid: number;
  /** 라이브러리가 공개된 리뷰어 수 (lift의 표본 크기 M) */
  sampleSize: number;
  /** appid → 표본 내 플레이어 수 (2명 이상만 저장) */
  counts: { appid: number; count: number }[];
}

interface ReviewsResponse {
  success: number;
  reviews?: { author?: { steamid?: string; num_games_owned?: number } }[];
}

async function fetchReviewerIds(appid: number): Promise<string[]> {
  const params = new URLSearchParams({
    json: "1",
    filter: "recent",
    language: "all",
    purchase_type: "all",
    review_type: "positive", // 앵커를 좋아한 유저의 라이브러리가 "이 게임을 좋아하면" 신호
    num_per_page: "100",
    cursor: "*",
  });
  const res = await fetch(`https://store.steampowered.com/appreviews/${appid}?${params}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`appreviews HTTP ${res.status} (appid ${appid})`);
  const data = await readJson<ReviewsResponse>(res, `appreviews ${appid}`);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const review of data.reviews ?? []) {
    const author = review.author;
    if (!author?.steamid || seen.has(author.steamid)) continue;
    if ((author.num_games_owned ?? 0) < MIN_REVIEWER_GAMES) continue;
    seen.add(author.steamid);
    ids.push(author.steamid);
    if (ids.length >= MAX_REVIEWERS) break;
  }
  return ids;
}

type LibraryResult =
  | { status: "ok"; games: { appid: number; playtime_forever: number }[] }
  | { status: "private" }
  | { status: "error" }; // 일시 장애 — 표본 실패와 비공개를 구분해야 캐시 오염을 막는다

async function fetchLibraryBare(steamid: string): Promise<LibraryResult> {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error("STEAM_API_KEY 미설정 — co-play 수집 불가");
  const params = new URLSearchParams({ key, steamid, include_played_free_games: "1" });
  const res = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${params}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return { status: "error" };
  let data: { response?: { games?: { appid: number; playtime_forever: number }[] } };
  try {
    data = await readJson(res, `owned ${steamid}`);
  } catch {
    return { status: "error" }; // 비-JSON = 일시 장애로 취급 (표본에서만 제외)
  }
  if (!data.response || data.response.games === undefined) return { status: "private" };
  return { status: "ok", games: data.response.games };
}

export async function getCoplaySample(anchorAppid: number): Promise<CoplaySample> {
  "use cache";
  cacheLife({ stale: DAY, revalidate: 7 * DAY, expire: 30 * DAY });
  cacheTag(`coplay-${anchorAppid}`);

  const reviewerIds = await fetchReviewerIds(anchorAppid);
  const libraries = await mapWithConcurrency(reviewerIds, 8, fetchLibraryBare);

  // 일시 장애(HTTP 오류/타임아웃)가 과반이면 결과를 캐시에 남기지 않는다 —
  // 7~30일 공유 캐시에 빈약한 표본이 고정되는 것을 방지 (throw → 캐시 안 됨)
  const errorCount = libraries.filter((r) => r === null || r.status === "error").length;
  if (reviewerIds.length > 0 && errorCount > reviewerIds.length / 2) {
    throw new Error(`co-play 표본 수집 실패: ${errorCount}/${reviewerIds.length} 오류 (appid ${anchorAppid})`);
  }

  const counts = new Map<number, number>();
  let sampleSize = 0;
  for (const lib of libraries) {
    if (!lib || lib.status !== "ok" || lib.games.length === 0) continue; // 비공개/실패/빈 라이브러리 제외
    sampleSize++;
    for (const g of lib.games) {
      if (g.appid === anchorAppid) continue;
      if (g.playtime_forever < MIN_COPLAY_MINUTES) continue;
      counts.set(g.appid, (counts.get(g.appid) ?? 0) + 1);
    }
  }

  return {
    anchorAppid,
    sampleSize,
    counts: [...counts.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 80)
      .map(([appid, count]) => ({ appid, count })),
  };
}
