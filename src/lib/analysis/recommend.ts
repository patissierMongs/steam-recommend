import type { GameFacts, OwnedGame, Recommendation, ScoreBreakdown } from "@/lib/types";
import { cosineSimilarity, wilsonLowerBound, zScores } from "@/lib/analysis/stats";
import { tfidfVector, type TasteModel } from "@/lib/analysis/taste";

/** 섹션별 랭킹 로직 (docs/DESIGN.md §5). 전부 순수 함수 — I/O 없음. */

const LOW_PLAYTIME_MAX_MIN = 120; // "백로그" = 2시간 미만
const LAPSED_MIN_MIN = 120;
const LAPSED_MAX_MIN = 40 * 60;
const LAPSED_IDLE_DAYS = 180;

function quality(facts: GameFacts): number | null {
  const total = facts.positive + facts.negative;
  if (total === 0) return null;
  return wilsonLowerBound(facts.positive, total);
}

/** 사용자 상위 태그와 후보 태그의 교집합 (근거 배지용) */
function matchedTags(model: TasteModel, facts: GameFacts, limit = 3): string[] {
  const candidateTags = new Set(Object.keys(facts.tags));
  return model.topTags.filter((t) => candidateTags.has(t.tag)).slice(0, limit).map((t) => t.tag);
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
  taste: number;
  wlb: number | null;
  extra?: Partial<Recommendation>;
}

/**
 * null(리뷰 없음)을 제외한 값들로만 z-분포를 만든다 — null을 0으로 섞으면
 * 분포의 평균/분산이 왜곡돼 리뷰 있는 후보들의 z-점수까지 오염된다.
 * null 항은 z=0(중립)으로 둔다.
 */
function zScoresWithNulls(values: readonly (number | null)[]): number[] {
  const present = values.filter((v): v is number => v !== null);
  const z = zScores(present);
  let j = 0;
  return values.map((v) => (v === null ? 0 : z[j++]));
}

/** z-정규화 가중합으로 최종 점수화. wlb가 null인 후보는 품질 항 0(중립) 처리. */
function rank(model: TasteModel, scored: Scored[], wTaste: number, wQuality: number, limit: number): Recommendation[] {
  if (scored.length === 0) return [];
  const zTaste = zScores(scored.map((s) => s.taste));
  const zQual = zScoresWithNulls(scored.map((s) => s.wlb));
  return scored
    .map((s, i) => {
      const score = wTaste * zTaste[i] + wQuality * zQual[i];
      return toRecommendation(
        s.facts,
        score,
        { tasteMatch: s.taste, quality: s.wlb, matchedTags: matchedTags(model, s.facts) },
        s.extra,
      );
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function tasteOf(model: TasteModel, facts: GameFacts): number {
  const vec = model.gameVectors.get(facts.appid) ?? tfidfVector(facts, model.idf);
  return cosineSimilarity(model.profile, vec);
}

/** 게임(본편)만 추천 대상 — DLC/사운드트랙/데모 제외 (appType 미상은 통과) */
function isRecommendable(facts: GameFacts): boolean {
  return facts.appType === null || facts.appType === "game";
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
    if (g.playtime_forever >= LOW_PLAYTIME_MAX_MIN) continue;
    const facts = factsByAppid.get(g.appid);
    if (!facts || !isRecommendable(facts)) continue;
    scored.push({
      facts,
      taste: tasteOf(model, facts),
      wlb: quality(facts),
      extra: { playtimeMinutes: g.playtime_forever, lastPlayed: g.rtime_last_played },
    });
  }
  return rank(model, scored, 0.6, 0.4, limit);
}

/** ② 다시 잡을 게임 — 어느 정도 하다가 6개월+ 방치 */
export function rankLapsed(
  model: TasteModel,
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  nowMs: number,
  limit = 8,
): Recommendation[] {
  const cutoff = nowMs / 1000 - LAPSED_IDLE_DAYS * 86400;
  const scored: Scored[] = [];
  for (const g of owned) {
    if (g.playtime_forever < LAPSED_MIN_MIN || g.playtime_forever > LAPSED_MAX_MIN) continue;
    if (!g.rtime_last_played || g.rtime_last_played > cutoff) continue;
    const facts = factsByAppid.get(g.appid);
    if (!facts || !isRecommendable(facts)) continue;
    // 진행도: 전체 유저 중앙값 대비 남은 여지 (중앙값 미상이면 중립 0.5)
    const progress =
      facts.medianPlaytime > 0 ? Math.min(1, g.playtime_forever / facts.medianPlaytime) : 0.5;
    scored.push({
      facts,
      taste: tasteOf(model, facts) * (1 - 0.4 * progress), // 이미 다 뽑아먹은 게임은 감점
      wlb: quality(facts),
      extra: { playtimeMinutes: g.playtime_forever, lastPlayed: g.rtime_last_played },
    });
  }
  return rank(model, scored, 0.65, 0.35, limit);
}

/** ③ 신작 추천 — 미보유 featured 후보 풀 (풀 자체가 최신이라 별도 신선도 항 없음) */
export function rankNewReleases(
  model: TasteModel,
  candidates: GameFacts[],
  ownedAppids: Set<number>,
  limit = 12,
): Recommendation[] {
  const scored: Scored[] = [];
  for (const facts of candidates) {
    if (ownedAppids.has(facts.appid) || !isRecommendable(facts)) continue;
    scored.push({ facts, taste: tasteOf(model, facts), wlb: quality(facts) });
  }
  return rank(model, scored, 0.6, 0.4, limit);
}

/**
 * ④ 숨은 보석 — 미보유, 인기도 역보정 (docs/DESIGN.md §5).
 * 기하 결합: cosine^0.5 · WLB^0.3 · novelty^0.2 — 어느 한 축이 0이면 탈락하는 AND 결합.
 */
export function rankHiddenGems(
  model: TasteModel,
  candidates: GameFacts[],
  ownedAppids: Set<number>,
  limit = 10,
): Recommendation[] {
  const MAX_OWNERS = 2_000_000; // 이보다 많이 팔린 게임은 "숨은" 게 아님
  const MIN_REVIEWS = 30; // WLB가 의미를 갖는 최소 표본
  const results: Recommendation[] = [];
  const seen = new Set<number>();
  for (const facts of candidates) {
    if (seen.has(facts.appid)) continue;
    seen.add(facts.appid);
    if (ownedAppids.has(facts.appid) || !isRecommendable(facts)) continue;
    if (facts.ownersEstimate <= 0 || facts.ownersEstimate > MAX_OWNERS) continue;
    const total = facts.positive + facts.negative;
    if (total < MIN_REVIEWS) continue;
    const taste = tasteOf(model, facts);
    if (taste <= 0) continue;
    const wlb = wilsonLowerBound(facts.positive, total);
    // novelty ∈ (0,1]: 소유자 3만 이하 ≈ 1, 200만에서 최소
    const novelty = Math.min(
      1,
      Math.log(MAX_OWNERS / Math.max(30_000, facts.ownersEstimate)) / Math.log(MAX_OWNERS / 30_000) + 0.15,
    );
    const score = Math.pow(taste, 0.5) * Math.pow(wlb, 0.3) * Math.pow(novelty, 0.2);
    results.push(
      toRecommendation(facts, score, {
        tasteMatch: taste,
        quality: wlb,
        matchedTags: matchedTags(model, facts),
      }),
    );
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** ⑤ co-play 후보 최종 랭킹 — lift 주도, 취향·품질 보정 */
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
  const zTaste = zScores(tastes);
  const wlbs = pool.map((c) => quality(c.facts));
  const zQual = zScoresWithNulls(wlbs);
  return pool
    .map((c, i) =>
      toRecommendation(c.facts, 0.55 * zLift[i] + 0.3 * zTaste[i] + 0.15 * zQual[i], {
        tasteMatch: tastes[i],
        quality: wlbs[i],
        lift: Math.exp(c.logLift),
        matchedTags: matchedTags(model, c.facts),
      }),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
