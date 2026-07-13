import type { GameFacts, OwnedGame, Recommendation, ScoreBreakdown } from "@/lib/types";
import { cosineSimilarity, wilsonLowerBound, zScores } from "@/lib/analysis/stats";
import { tfidfVector, type TasteModel } from "@/lib/analysis/taste";
import { isPotentialGameType } from "@/lib/steam/apptype";

/**
 * 섹션별 랭킹 로직 (docs/DESIGN.md §5). 전부 순수 함수 — I/O 없음.
 *
 * 신호 구성:
 * - tag similarity: 플레이 기록 태그 프로필과 후보의 코사인 유사도
 * - review summary: 리뷰 긍정 비율의 Wilson 신뢰하한
 * 다중 관심사, persona 일치도, 강제 novelty 슬롯은 검증 전 제품 경로에서 비활성화했다.
 * 현재 가중치는 검증 전 휴리스틱 기준선이며 docs/VALIDATION.md의 승격 게이트 대상이다.
 */

const LOW_PLAYTIME_MAX_MIN = 120; // "백로그" = 2시간 미만
const LAPSED_MIN_MIN = 120;
const LAPSED_MAX_MIN = 40 * 60;
const LAPSED_IDLE_DAYS = 180;

const W_TASTE = 0.4;
const W_REVIEW = 0.35;

function reviewLowerBound(facts: GameFacts): number | null {
  const total = facts.positive + facts.negative;
  if (total === 0) return null;
  return wilsonLowerBound(facts.positive, total);
}

/** 사용자 상위 태그와 후보 태그의 교집합 (근거 배지용) */
function matchedTags(model: TasteModel, facts: GameFacts, limit = 3): string[] {
  const candidateTags = new Set(Object.keys(facts.tags));
  return model.topTags.filter((t) => candidateTags.has(t.tag)).slice(0, limit).map((t) => t.tag);
}

/**
 * 플레이 기록 태그 프로필과 후보 태그의 코사인 유사도.
 * 후보 또는 프로필 태그가 없으면 불일치(0)가 아니라 결측(null)이다.
 */
function tasteOf(model: TasteModel, facts: GameFacts): number | null {
  const vec = model.gameVectors.get(facts.appid) ?? tfidfVector(facts, model.idf, model.unseenIdf);
  if (model.profile.size === 0 || vec.size === 0) return null;
  return cosineSimilarity(model.profile, vec);
}

function toRecommendation(
  facts: GameFacts,
  score: number,
  breakdown: ScoreBreakdown,
  extra?: Partial<Recommendation>,
): Recommendation {
  return {
    appid: facts.appid,
    name: facts.name,
    headerImage: facts.headerImage,
    shortDescription: facts.shortDescription,
    releaseDate: facts.releaseDate,
    priceFormatted: facts.priceFormatted,
    discountPercent: facts.discountPercent,
    isFree: facts.isFree,
    score,
    breakdown,
    ownersEstimate: facts.ownersEstimate,
    medianPlaytime: facts.medianPlaytime,
    ...extra,
  };
}

interface Scored {
  facts: GameFacts;
  /** 카드에 표시하는 원시 태그 코사인 */
  taste: number | null;
  /** surface별 변환을 적용한 랭킹 입력; 원시 코사인과 섞어 표시하지 않음 */
  rankTaste: number | null;
  wlb: number | null;
  extra?: Partial<Recommendation>;
}

/**
 * 알려진 값끼리만 z-정규화하고 결측은 평균 기여(0)로 둔다. 결측 자체가
 * 좋아함/싫어함의 근거가 되지 않게 하는 claim-level abstention 정책이다.
 */
function optionalZScores(values: readonly (number | null)[]): number[] {
  const known = values.filter((value): value is number => value !== null);
  const normalized = zScores(known);
  let knownIndex = 0;
  return values.map((value) => (value === null ? 0 : normalized[knownIndex++]));
}

function byScoreThenAppid(a: Recommendation, b: Recommendation): number {
  return b.score - a.score || a.appid - b.appid;
}

function scoreOne(model: TasteModel, facts: GameFacts, extra?: Partial<Recommendation>): Scored {
  const taste = tasteOf(model, facts);
  return {
    facts,
    taste,
    rankTaste: taste,
    wlb: reviewLowerBound(facts),
    extra,
  };
}

/** z-정규화 휴리스틱 기준선. 계수는 아직 제품 타당성이 검증된 가중치가 아니다. */
function rank(model: TasteModel, scored: Scored[], limit: number): Recommendation[] {
  const eligible = scored.filter((s) => s.taste !== null || s.wlb !== null);
  if (eligible.length === 0) return [];
  const zTaste = optionalZScores(eligible.map((s) => s.rankTaste));
  const zQual = optionalZScores(eligible.map((s) => s.wlb));
  return eligible
    .map((s, i) => {
      const score = W_TASTE * zTaste[i] + W_REVIEW * zQual[i];
      return toRecommendation(
        s.facts,
        score,
        {
          tasteMatch: s.taste,
          reviewLowerBound: s.wlb,
          matchedTags: matchedTags(model, s.facts),
        },
        s.extra,
      );
    })
    .sort(byScoreThenAppid)
    .slice(0, limit);
}

/** 게임(본편)만 추천 대상 — DLC/사운드트랙/데모 제외 (appType 미상은 통과) */
function isRecommendable(facts: GameFacts): boolean {
  return isPotentialGameType(facts.appType);
}

/**
 * 백로그 랭킹 적격성 — Stage 1 impression의 candidate universe 기록이 랭커와
 * 어긋나지 않도록 랭커 내부와 recorder가 같은 술어를 공유한다.
 */
export function backlogEligible(game: OwnedGame, facts: GameFacts | undefined): facts is GameFacts {
  return (
    game.playtime_forever < LOW_PLAYTIME_MAX_MIN && facts !== undefined && isRecommendable(facts)
  );
}

/** 다시 잡을 게임 랭킹 적격성 (backlogEligible과 동일한 공유 목적) */
export function lapsedEligible(
  game: OwnedGame,
  facts: GameFacts | undefined,
  nowMs: number,
): facts is GameFacts {
  const cutoff = nowMs / 1000 - LAPSED_IDLE_DAYS * 86400;
  return (
    game.playtime_forever >= LAPSED_MIN_MIN &&
    game.playtime_forever <= LAPSED_MAX_MIN &&
    game.rtime_last_played !== undefined &&
    game.rtime_last_played > 0 &&
    game.rtime_last_played <= cutoff &&
    facts !== undefined &&
    isRecommendable(facts)
  );
}

/** ① 백로그에서 추천 — 보유 & 사실상 미플레이 */
export function rankBacklog(
  model: TasteModel,
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  limit = 12,
): Recommendation[] {
  const scored: Scored[] = [];
  for (const g of owned) {
    const facts = factsByAppid.get(g.appid);
    if (!backlogEligible(g, facts)) continue;
    scored.push(scoreOne(model, facts, { playtimeMinutes: g.playtime_forever, lastPlayed: g.rtime_last_played }));
  }
  return rank(model, scored, limit);
}

/** ② 다시 잡을 게임 — 어느 정도 하다가 6개월+ 방치 */
export function rankLapsed(
  model: TasteModel,
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  nowMs: number,
  limit = 8,
): Recommendation[] {
  const scored: Scored[] = [];
  for (const g of owned) {
    const facts = factsByAppid.get(g.appid);
    if (!lapsedEligible(g, facts, nowMs)) continue;
    const s = scoreOne(model, facts, { playtimeMinutes: g.playtime_forever, lastPlayed: g.rtime_last_played });
    if (facts.medianPlaytime > 0 && s.rankTaste !== null) {
      const relativeTime = Math.min(1, g.playtime_forever / facts.medianPlaytime);
      s.rankTaste *= 1 - 0.4 * relativeTime;
    }
    scored.push(s);
  }
  return rank(model, scored, limit);
}

/** ③ 신작 추천 — 현재 라이브러리 밖 featured 후보 풀 (풀 자체가 최신이라 별도 신선도 항 없음) */
export function rankGeneralCandidates(
  model: TasteModel,
  candidates: GameFacts[],
  excludedAppids: Set<number>,
  limit = 12,
): Recommendation[] {
  const scored: Scored[] = [];
  for (const facts of candidates) {
    if (excludedAppids.has(facts.appid) || !isRecommendable(facts)) continue;
    scored.push(scoreOne(model, facts));
  }
  return rank(model, scored, limit);
}

/** ③ 신작 추천 — 현재 라이브러리 밖 featured 후보 풀 (풀 자체가 최신이라 별도 신선도 항 없음) */
export function rankNewReleases(
  model: TasteModel,
  candidates: GameFacts[],
  ownedAppids: Set<number>,
  limit = 12,
): Recommendation[] {
  return rankGeneralCandidates(model, candidates, ownedAppids, limit);
}

/**
 * ④ 숨은 보석 — 현재 라이브러리 밖 후보, 인기도 역보정 (docs/DESIGN.md §5).
 * 기하 결합: taste^0.4 · WLB^0.3 · novelty^0.15.
 * 이 수식도 검증 전 hidden-gem 기준선이며 별도 가설/ablation 대상이다.
 */
export function rankHiddenGems(
  model: TasteModel,
  candidates: GameFacts[],
  ownedAppids: Set<number>,
  limit = 10,
): Recommendation[] {
  const MAX_OWNERS = 2_000_000; // 이보다 많이 팔린 게임은 "숨은" 게 아님
  const MIN_REVIEWS = 30; // WLB가 의미를 갖는 최소 표본
  const pool: Recommendation[] = [];
  const seen = new Set<number>();
  for (const facts of candidates) {
    if (seen.has(facts.appid)) continue;
    seen.add(facts.appid);
    if (ownedAppids.has(facts.appid) || !isRecommendable(facts)) continue;
    if (facts.ownersEstimate <= 0 || facts.ownersEstimate > MAX_OWNERS) continue;
    const total = facts.positive + facts.negative;
    if (total < MIN_REVIEWS) continue;
    const tagSimilarity = tasteOf(model, facts);
    if (tagSimilarity === null || tagSimilarity <= 0) continue;
    const wlb = wilsonLowerBound(facts.positive, total);
    // novelty ∈ (0,1]: 소유자 3만 이하 ≈ 1, 200만에서 최소
    const novelty = Math.min(
      1,
      Math.log(MAX_OWNERS / Math.max(30_000, facts.ownersEstimate)) / Math.log(MAX_OWNERS / 30_000) + 0.15,
    );
    const score = Math.pow(tagSimilarity, 0.4) * Math.pow(wlb, 0.3) * Math.pow(novelty, 0.15);
    pool.push(
      toRecommendation(facts, score, {
        tasteMatch: tagSimilarity,
        reviewLowerBound: wlb,
        matchedTags: matchedTags(model, facts),
      }),
    );
  }
  return pool.sort(byScoreThenAppid).slice(0, limit);
}

/** ⑤ 리뷰어 라이브러리 동시출현 후보 랭킹 — lift 주도, 태그·리뷰 보정 */
export function rankCoplay(
  model: TasteModel,
  candidates: { facts: GameFacts; logLift: number; coCount: number }[],
  ownedAppids: Set<number>,
  limit = 8,
): Recommendation[] {
  const pool = candidates.filter((c) => !ownedAppids.has(c.facts.appid) && isRecommendable(c.facts));
  if (pool.length === 0) return [];
  const zLift = zScores(pool.map((c) => c.logLift));
  const tastes = pool.map((c) => tasteOf(model, c.facts));
  const zTaste = optionalZScores(tastes);
  const wlbs = pool.map((c) => reviewLowerBound(c.facts));
  const zQual = optionalZScores(wlbs);
  return pool
    .map((c, i) =>
      toRecommendation(
        c.facts,
        0.5 * zLift[i] + 0.2 * zTaste[i] + 0.15 * zQual[i],
        {
          tasteMatch: tastes[i],
          reviewLowerBound: wlbs[i],
          lift: Math.exp(c.logLift),
          matchedTags: matchedTags(model, c.facts),
        },
      ),
    )
    .sort(byScoreThenAppid)
    .slice(0, limit);
}
