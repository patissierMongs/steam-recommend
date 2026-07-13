import type { GameFacts, OwnedGame, Recommendation, ScoreBreakdown } from "@/lib/types";
import { cosineSimilarity, wilsonLowerBound, zScores } from "@/lib/analysis/stats";
import { tfidfVector, type TasteModel } from "@/lib/analysis/taste";
import { clusterMatch } from "@/lib/analysis/clusters";
import { personaFit, type PersonaProfile } from "@/lib/analysis/persona";
import { isGameType } from "@/lib/steam/apptype";

/**
 * 섹션별 랭킹 로직 (docs/DESIGN.md §5). 전부 순수 함수 — I/O 없음.
 *
 * 신호 구성 (Spotify 공개 기법의 스팀 적용):
 * - taste: 최근접 취향 클러스터와의 코사인 (다중 관심사, max-over-clusters)
 * - quality: 리뷰 Wilson 신뢰하한 (리뷰 없음 = 0)
 * - fit: 플레이 성향(도전/소셜/니치) 적합도 — 태그 내용과 독립적인 행동 신호
 * 태그(취향) 단독 지배를 막기 위해 가중치를 0.40/0.35/0.25로 분산.
 */

const LOW_PLAYTIME_MAX_MIN = 120; // "백로그" = 2시간 미만
const LAPSED_MIN_MIN = 120;
const LAPSED_MAX_MIN = 40 * 60;
const LAPSED_IDLE_DAYS = 180;

const W_TASTE = 0.4;
const W_QUALITY = 0.35;
const W_FIT = 0.25;

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

/**
 * 취향 점수: 취향 클러스터 중 가장 잘 맞는 것과의 코사인 (max-over-clusters).
 * 평균 벡터 매칭보다 좁고 날카롭다 — "광범위한 태그 매칭" 문제의 해법.
 * 클러스터가 없으면(플레이 데이터 부족) flat 프로필 코사인으로 폴백.
 */
function tasteOf(model: TasteModel, facts: GameFacts): { score: number; clusterTags?: string[] } {
  const vec = model.gameVectors.get(facts.appid) ?? tfidfVector(facts, model.idf);
  const match = clusterMatch(model.clusters, vec);
  if (match) return { score: match.score, clusterTags: match.cluster.topTags };
  return { score: cosineSimilarity(model.profile, vec) };
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
  clusterTags?: string[];
  wlb: number | null;
  fit: number | null; // null = 성향 판정 불가 (P2: 중립 처리, 상향 금지)
  extra?: Partial<Recommendation>;
}

/**
 * 품질 z-점수. 리뷰 없음(null)은 Wilson 신뢰하한 0 — 데이터가 없을 때의 진짜
 * 보수적 하한 — 으로 취급해 분포에 포함한다. WLB는 항상 ≥0이고 리뷰가 하나라도
 * 긍정이면 >0이므로, 리뷰 없는 후보는 품질 축에서 **항상 최저**가 되어
 * 리뷰 있는 어떤 후보도 이기지 못한다(동일 취향 기준). 표시값(breakdown.quality)은
 * null로 유지해 가짜 퍼센트를 보여주지 않는다.
 */
function qualityZ(wlbs: readonly (number | null)[]): number[] {
  return zScores(wlbs.map((w) => w ?? 0));
}

/**
 * 적합도 z-점수 (P2). 품질과 달리 미상 적합도는 "나쁨"이 아니라 **판정 불가 = 중립**이다.
 * 알려진 값들로만 분포를 만들고, 미상 후보는 z=0(코호트 평균)을 준다 — 상향도 하향도 없음.
 * (예전엔 미상을 0.75로 채워 데이터 없는 후보를 평균 위로 끌어올렸다.)
 */
function fitZ(fits: readonly (number | null)[]): number[] {
  const present = fits.filter((f): f is number => f !== null);
  const z = zScores(present);
  let j = 0;
  return fits.map((f) => (f === null ? 0 : z[j++]));
}

function scoreOne(model: TasteModel, persona: PersonaProfile, facts: GameFacts, extra?: Partial<Recommendation>): Scored {
  const t = tasteOf(model, facts);
  return {
    facts,
    taste: t.score,
    clusterTags: t.clusterTags,
    wlb: quality(facts),
    fit: personaFit(persona, facts).value,
    extra,
  };
}

/** z-정규화 가중합으로 최종 점수화 (taste 0.40 / quality 0.35 / fit 0.25) */
function rank(model: TasteModel, scored: Scored[], limit: number): Recommendation[] {
  if (scored.length === 0) return [];
  const zTaste = zScores(scored.map((s) => s.taste));
  const zQual = qualityZ(scored.map((s) => s.wlb));
  const zFit = fitZ(scored.map((s) => s.fit));
  return scored
    .map((s, i) => {
      const score = W_TASTE * zTaste[i] + W_QUALITY * zQual[i] + W_FIT * zFit[i];
      return toRecommendation(
        s.facts,
        score,
        {
          tasteMatch: s.taste,
          quality: s.wlb,
          personaFit: s.fit ?? undefined, // 미상이면 배지 미표시
          matchedCluster: s.clusterTags,
          matchedTags: matchedTags(model, s.facts),
        },
        s.extra,
      );
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 게임(본편)만 추천 대상 — DLC/사운드트랙/데모 제외 (appType 미상은 통과) */
function isRecommendable(facts: GameFacts): boolean {
  return isGameType(facts.appType);
}

/** ① 백로그에서 추천 — 보유 & 사실상 미플레이 */
export function rankBacklog(
  model: TasteModel,
  persona: PersonaProfile,
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  limit = 12,
): Recommendation[] {
  const scored: Scored[] = [];
  for (const g of owned) {
    if (g.playtime_forever >= LOW_PLAYTIME_MAX_MIN) continue;
    const facts = factsByAppid.get(g.appid);
    if (!facts || !isRecommendable(facts)) continue;
    scored.push(scoreOne(model, persona, facts, { playtimeMinutes: g.playtime_forever, lastPlayed: g.rtime_last_played }));
  }
  return rank(model, scored, limit);
}

/** ② 다시 잡을 게임 — 어느 정도 하다가 6개월+ 방치 */
export function rankLapsed(
  model: TasteModel,
  persona: PersonaProfile,
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
    const s = scoreOne(model, persona, facts, { playtimeMinutes: g.playtime_forever, lastPlayed: g.rtime_last_played });
    s.taste *= 1 - 0.4 * progress; // 이미 다 뽑아먹은 게임은 감점
    scored.push(s);
  }
  return rank(model, scored, limit);
}

/** ③ 신작 추천 — 미보유 featured 후보 풀 (풀 자체가 최신이라 별도 신선도 항 없음) */
export function rankNewReleases(
  model: TasteModel,
  persona: PersonaProfile,
  candidates: GameFacts[],
  ownedAppids: Set<number>,
  limit = 12,
): Recommendation[] {
  const scored: Scored[] = [];
  for (const facts of candidates) {
    if (ownedAppids.has(facts.appid) || !isRecommendable(facts)) continue;
    scored.push(scoreOne(model, persona, facts));
  }
  return rank(model, scored, limit);
}

/**
 * ④ 숨은 보석 — 미보유, 인기도 역보정 (docs/DESIGN.md §5).
 * 기하 결합: taste^0.4 · WLB^0.3 · novelty^0.15 · fit^0.15 — 어느 한 축이 0이면
 * 탈락하는 AND 결합. 마지막 슬롯은 BaRT식 ε-greedy 탐험 픽: 점수 순위 밖이지만
 * 품질이 검증된 최고 novelty 후보를 하나 발탁한다(항상 exploit만 하면 필터버블).
 */
export function rankHiddenGems(
  model: TasteModel,
  persona: PersonaProfile,
  candidates: GameFacts[],
  ownedAppids: Set<number>,
  limit = 10,
): Recommendation[] {
  const MAX_OWNERS = 2_000_000; // 이보다 많이 팔린 게임은 "숨은" 게 아님
  const MIN_REVIEWS = 30; // WLB가 의미를 갖는 최소 표본
  const pool: { rec: Recommendation; novelty: number }[] = [];
  const seen = new Set<number>();
  for (const facts of candidates) {
    if (seen.has(facts.appid)) continue;
    seen.add(facts.appid);
    if (ownedAppids.has(facts.appid) || !isRecommendable(facts)) continue;
    if (facts.ownersEstimate <= 0 || facts.ownersEstimate > MAX_OWNERS) continue;
    const total = facts.positive + facts.negative;
    if (total < MIN_REVIEWS) continue;
    const t = tasteOf(model, facts);
    if (t.score <= 0) continue;
    const wlb = wilsonLowerBound(facts.positive, total);
    const fit = personaFit(persona, facts);
    // novelty ∈ (0,1]: 소유자 3만 이하 ≈ 1, 200만에서 최소
    const novelty = Math.min(
      1,
      Math.log(MAX_OWNERS / Math.max(30_000, facts.ownersEstimate)) / Math.log(MAX_OWNERS / 30_000) + 0.15,
    );
    // 적합도 미상은 기하곱에서 중립 0.5 (0을 곱해 후보를 탈락시키지 않음, 그러나 상향도 안 함)
    const fitTerm = fit.value ?? 0.5;
    const score =
      Math.pow(t.score, 0.4) * Math.pow(wlb, 0.3) * Math.pow(novelty, 0.15) * Math.pow(fitTerm, 0.15);
    pool.push({
      rec: toRecommendation(facts, score, {
        tasteMatch: t.score,
        quality: wlb,
        personaFit: fit.value ?? undefined,
        matchedCluster: t.clusterTags,
        matchedTags: matchedTags(model, facts),
      }),
      novelty,
    });
  }
  pool.sort((a, b) => b.rec.score - a.rec.score);
  const top = pool.slice(0, limit).map((p) => p.rec);

  // 탐험 픽: 순위 밖 + 품질 검증(WLB ≥ 0.75) 후보 중 novelty 최고 1개를 마지막 슬롯에
  const outside = pool.slice(limit).filter((p) => (p.rec.breakdown.quality ?? 0) >= 0.75);
  if (outside.length > 0 && top.length === limit) {
    const explorePick = outside.reduce((a, b) => (b.novelty > a.novelty ? b : a));
    top[top.length - 1] = { ...explorePick.rec, explore: true };
  }
  return top;
}

/** ⑤ co-play 후보 최종 랭킹 — lift 주도, 취향·품질·성향 보정 */
export function rankCoplay(
  model: TasteModel,
  persona: PersonaProfile,
  candidates: { facts: GameFacts; logLift: number; coCount: number }[],
  ownedAppids: Set<number>,
  limit = 8,
): Recommendation[] {
  const pool = candidates.filter((c) => !ownedAppids.has(c.facts.appid) && isRecommendable(c.facts));
  if (pool.length === 0) return [];
  const zLift = zScores(pool.map((c) => c.logLift));
  const tastes = pool.map((c) => tasteOf(model, c.facts));
  const zTaste = zScores(tastes.map((t) => t.score));
  const wlbs = pool.map((c) => quality(c.facts));
  const zQual = qualityZ(wlbs);
  const fits = pool.map((c) => personaFit(persona, c.facts).value);
  const zFit = fitZ(fits);
  return pool
    .map((c, i) =>
      toRecommendation(
        c.facts,
        0.5 * zLift[i] + 0.2 * zTaste[i] + 0.15 * zQual[i] + 0.15 * zFit[i],
        {
          tasteMatch: tastes[i].score,
          quality: wlbs[i],
          lift: Math.exp(c.logLift),
          personaFit: fits[i] ?? undefined,
          matchedCluster: tastes[i].clusterTags,
          matchedTags: matchedTags(model, c.facts),
        },
      ),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
