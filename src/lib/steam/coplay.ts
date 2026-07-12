import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { mapWithConcurrency } from "@/lib/concurrency";

/**
 * 동시보유(co-play) 표본: "앵커 게임을 긍정 리뷰한 유저들이 실제로 플레이하는 게임".
 * 앵커 appid에만 의존하는 사용자 독립 데이터라 7일 캐시로 전 사용자가 공유한다.
 *
 * 주의: 이 모듈의 fetch는 'use cache' 스코프 안에서 실행되므로 no-store를 쓰지 않는다
 * (개인화 모듈 webapi.ts와 분리된 이유).
 */

const DAY = 86_400;
/** 게임을 1개 이상 보유한 Steam 계정 규모(대략적 상수). lift의 기저율 분모 —
 * 후보 간 순위에는 상수라 영향이 없고, 표시되는 "기대 대비 배수"의 스케일만 정한다. */
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
  const data = (await res.json()) as ReviewsResponse;
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

async function fetchLibraryBare(
  steamid: string,
): Promise<{ appid: number; playtime_forever: number }[] | null> {
  const key = process.env.STEAM_API_KEY;
  if (!key) throw new Error("STEAM_API_KEY 미설정 — co-play 수집 불가");
  const params = new URLSearchParams({ key, steamid, include_played_free_games: "1" });
  const res = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${params}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null; // 개별 유저 조회 실패는 표본에서 제외할 뿐
  const data = (await res.json()) as {
    response: { games?: { appid: number; playtime_forever: number }[] };
  };
  return data.response.games ?? null; // undefined = 비공개
}

export async function getCoplaySample(anchorAppid: number): Promise<CoplaySample> {
  "use cache";
  cacheLife({ stale: DAY, revalidate: 7 * DAY, expire: 30 * DAY });
  cacheTag(`coplay-${anchorAppid}`);

  const reviewerIds = await fetchReviewerIds(anchorAppid);
  const libraries = await mapWithConcurrency(reviewerIds, 8, fetchLibraryBare);

  const counts = new Map<number, number>();
  let sampleSize = 0;
  for (const lib of libraries) {
    if (!lib || lib.length === 0) continue; // 비공개/실패/빈 라이브러리 제외
    sampleSize++;
    for (const g of lib) {
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
