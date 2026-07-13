import type { GameFacts, OwnedGame } from "@/lib/types";
import { MIN_EVIDENCE_MINUTES } from "@/lib/analysis/taste";
import { wilsonLowerBound } from "@/lib/analysis/stats";

/**
 * 태그 외 피벗: 게임-상대 몰입 깊이 (docs/VALIDATION.md H-014~H-016).
 *
 * 피벗은 "그 게임의 기준점 플레이타임 대비 이 플레이어의 플레이타임" log2 비율이다.
 * 절대 시간(라이브러리 크기·장르 길이에 지배됨)도 태그(콘텐츠 메타데이터)도 아닌,
 * 게임별 기준점 대비 관측된 행동의 위치를 요약한다.
 *
 * 기준점 provenance: SteamSpy median_forever는 현재 전 게임 0으로 사장돼(실측 확인),
 * 최근 리뷰 작성자 표본의 플레이타임 중앙값을 호출자가 넘긴다(appdata
 * getReviewAuthorMedianPlaytime). 리뷰어 자기선택 편향이 있는 표본이며 전체 유저
 * 중앙값이 아니다 — 표시 시 그대로 공개한다.
 *
 * 전부 관측/행동요약 층이다 — 선호·만족·재미를 측정하지 않고, 예측력을 주장하지 않는다.
 * 분할 기준은 임의 상수가 아니라 (a) 게임 자신의 기준점(=logRatio 0), (b) 이 라이브러리의
 * 소유자 추정 중앙값만 사용하고 화면에 그대로 공개한다.
 */

export interface DepthPoint {
  appid: number;
  name: string;
  playtimeMinutes: number;
  /** 기준점(분) — 최근 리뷰 작성자 표본의 플레이타임 중앙값 */
  medianMinutes: number;
  /** log2(내 플레이타임 / 기준점). 0 = 그 게임의 리뷰어 표본 중앙값과 같음 */
  logRatio: number;
  ownersEstimate: number; // 0 = 미상
  reviewLowerBound: number | null;
  headerImage: string;
}

export interface DeveloperShare {
  developer: string;
  minutes: number;
  share: number; // 플레이된(≥근거) 확인 게임 총 시간 대비
  games: number;
}

export interface DepthProfile {
  /** 깊이 계산 가능 항목: 확인된 게임 + 플레이 근거 + 리뷰어 표본 기준점 확보 */
  points: DepthPoint[];
  /** 깊이 분포 요약 */
  medianLogRatio: number;
  /** logRatio > 0 (그 게임의 보통 유저보다 깊이 플레이) 비율 */
  shareAboveNorm: number;
  /** 소유자 추정 중앙값 (이 라이브러리의 분석 가능 항목 기준) — 화면 공개용 */
  ownersSplit: number;
  /** 저인지(소유자 ≤ 라이브러리 중앙값)인데 깊이 플레이한 항목, logRatio 내림차순 */
  deepNiche: DepthPoint[];
  /** 고인지(소유자 > 중앙값)인데 보통 유저보다 얕게 끝난 항목, logRatio 오름차순 */
  shallowMainstream: DepthPoint[];
  /** 플레이 깊이 ↔ 리뷰 하한 순위 상관 (기술 통계, 단일 계정 — p-value 없음) */
  reviewDepthCorr: { spearman: number; n: number } | null;
  /** 플레이 여부와 리뷰 품질: 실행한 것과 안 한 것의 리뷰 하한 중앙값 비교 */
  launchReviewGap: {
    playedMedianWlb: number;
    unplayedMedianWlb: number;
    nPlayed: number;
    nUnplayed: number;
  } | null;
  /** 플레이타임 개발사 집중 (genreShares와 같은 균등 분할 방식) */
  developerShares: DeveloperShare[];
  developerTotalMinutes: number;
}

function isConfirmedGame(facts: GameFacts): boolean {
  return facts.appType?.toLowerCase() === "game";
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** 평균 순위(동점은 평균) — Spearman용. exported for testing. */
export function averageRanks(values: readonly number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Spearman 순위 상관 — 기술 통계로만 사용한다. exported for testing. */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const rx = averageRanks(x.slice(0, n));
  const ry = averageRanks(y.slice(0, n));
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null; // 한쪽이 전부 동점이면 정의 불가
  return num / Math.sqrt(dx * dy);
}

function reviewLb(facts: GameFacts): number | null {
  const total = facts.positive + facts.negative;
  return total > 0 ? wilsonLowerBound(facts.positive, total) : null;
}

export function buildDepthProfile(
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  /** appid → 리뷰 작성자 표본 플레이타임 중앙값(분), 0/부재 = 기준점 없음 */
  medianByAppid: Map<number, number>,
  quadrantLimit = 6,
): DepthProfile {
  const points: DepthPoint[] = [];
  const playedWlb: number[] = [];
  const unplayedWlb: number[] = [];
  const devMinutes = new Map<string, { minutes: number; games: number }>();
  let devTotal = 0;

  for (const g of owned) {
    const facts = factsByAppid.get(g.appid);
    if (!facts || !isConfirmedGame(facts)) continue;

    const wlb = reviewLb(facts);
    const played = g.playtime_forever >= MIN_EVIDENCE_MINUTES;
    if (wlb !== null) (played ? playedWlb : unplayedWlb).push(wlb);

    if (!played) continue;

    // 개발사 집중 — genreShares와 동일하게 복수 개발사는 균등 분할
    if (facts.developers.length > 0) {
      const per = g.playtime_forever / facts.developers.length;
      for (const dev of facts.developers) {
        const cur = devMinutes.get(dev) ?? { minutes: 0, games: 0 };
        cur.minutes += per;
        cur.games += 1;
        devMinutes.set(dev, cur);
      }
      devTotal += g.playtime_forever;
    }

    const refMedian = medianByAppid.get(g.appid) ?? 0;
    if (refMedian <= 0) continue; // 기준점 표본 없음 → 깊이 정의 불가
    points.push({
      appid: g.appid,
      name: facts.name,
      playtimeMinutes: g.playtime_forever,
      medianMinutes: refMedian,
      logRatio: Math.log2(g.playtime_forever / refMedian),
      ownersEstimate: facts.ownersEstimate,
      reviewLowerBound: wlb,
      headerImage: facts.headerImage,
    });
  }

  const ratios = points.map((p) => p.logRatio).sort((a, b) => a - b);
  const medianLogRatio = median(ratios);
  const shareAboveNorm = points.length
    ? points.filter((p) => p.logRatio > 0).length / points.length
    : 0;

  // 인기도 축은 소유자 추정이 있는 항목만, 분할점은 이 라이브러리의 중앙값 (임의 상수 금지)
  const withOwners = points.filter((p) => p.ownersEstimate > 0);
  const ownersSplit = median(withOwners.map((p) => p.ownersEstimate).sort((a, b) => a - b));
  const deepNiche = withOwners
    .filter((p) => p.ownersEstimate <= ownersSplit && p.logRatio > 0)
    .sort((a, b) => b.logRatio - a.logRatio)
    .slice(0, quadrantLimit);
  const shallowMainstream = withOwners
    .filter((p) => p.ownersEstimate > ownersSplit && p.logRatio < 0)
    .sort((a, b) => a.logRatio - b.logRatio)
    .slice(0, quadrantLimit);

  const withReview = points.filter((p) => p.reviewLowerBound !== null);
  const corr = spearman(
    withReview.map((p) => p.logRatio),
    withReview.map((p) => p.reviewLowerBound as number),
  );

  const developerShares = [...devMinutes.entries()]
    .map(([developer, v]) => ({
      developer,
      minutes: v.minutes,
      share: devTotal > 0 ? v.minutes / devTotal : 0,
      games: v.games,
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);

  return {
    points,
    medianLogRatio,
    shareAboveNorm,
    ownersSplit,
    deepNiche,
    shallowMainstream,
    reviewDepthCorr: corr === null ? null : { spearman: corr, n: withReview.length },
    launchReviewGap:
      playedWlb.length && unplayedWlb.length
        ? {
            playedMedianWlb: median([...playedWlb].sort((a, b) => a - b)),
            unplayedMedianWlb: median([...unplayedWlb].sort((a, b) => a - b)),
            nPlayed: playedWlb.length,
            nUnplayed: unplayedWlb.length,
          }
        : null,
    developerShares,
    developerTotalMinutes: devTotal,
  };
}
