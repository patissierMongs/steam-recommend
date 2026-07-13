import type { GameFacts, OwnedGame } from "@/lib/types";
import { rankGeneralCandidates } from "@/lib/analysis/recommend";
import { cosineSimilarity, wilsonLowerBound } from "@/lib/analysis/stats";
import {
  buildTasteModel,
  MIN_EVIDENCE_MINUTES,
  tfidfVector,
  type TasteModel,
} from "@/lib/analysis/taste";
import { buildPairModel, scorePairOnly } from "@/lib/analysis/pair-model";

/** 실험 가능 조건일 뿐 제품 임계값이 아니다. 두 개를 숨긴 뒤 두 개 이상 근거를 남긴다. */
export const TAG_HOLDOUT_MIN_SUPPORT = 4;
export const TAG_HOLDOUT_COUNT = 2;
export const TAG_HOLDOUT_PRIMARY_K = 12;
export const TAG_HOLDOUT_KS = [5, 10, TAG_HOLDOUT_PRIMARY_K, 20] as const;
/** v3: H-017 태그-쌍 표현 arm(pairOnly) 추가. legacy 4개 arm과 complete-case 풀 정의는 불변. */
export const TAG_HOLDOUT_DIAGNOSTIC_VERSION = "H-013/v3+H-017-pair/v1";
export const TAG_HOLDOUT_MODEL_VERSION = "legacy-tag-review/complete-case-v1";

export type DiagnosticRanker =
  | "combined"
  | "tagOnly"
  | "reviewOnly"
  | "popularityOnly"
  | "pairOnly";
export type HoldoutArm = "topPlay" | "lowerPlayControl";
export type MissingDiagnosticSignal = "tag" | "review" | "popularity" | "pair";

export interface RankAtK {
  /** 사용자가 요청한 K. */
  k: number;
  /** 후보군이 K보다 작을 때 실제로 검사한 깊이. */
  effectiveK: number;
  /** N <= K이면 모든 순위화 가능 표적을 훑으므로 주 지표 판정을 보류한다. */
  saturated: boolean;
  hits: number;
  recall: number;
  precision: number;
  ndcg: number;
  anyHit: boolean;
}

export interface RankerDiagnostic {
  rankedCandidates: number;
  relevantCount: number;
  rankedRelevant: number;
  meanObservedRank: number | null;
  /** 결측 표적은 0으로 두며, 분모는 실제 공통 후보 순위 길이다. */
  meanRankPercentile: number;
  reciprocalRank: number;
  atK: RankAtK[];
}

export interface RandomExpectation {
  k: number;
  effectiveK: number;
  saturated: boolean;
  expectedHits: number;
  expectedRecall: number;
  expectedPrecision: number;
  anyHitProbability: number;
}

export interface HeldoutGameDiagnostic {
  appid: number;
  name: string;
  playtimeMinutes: number;
  /** raw featured feed에 ID가 있었는지만 뜻하며 retrieval 성공이 아니다. */
  listedInCurrentFeaturedFeed: boolean;
  /** 원래 보유 게임이라 평가 후보에는 항상 강제로 다시 넣는다. */
  forcedIntoOraclePool: true;
  completeCase: boolean;
  missingSignals: MissingDiagnosticSignal[];
  ranks: Record<DiagnosticRanker, number | null>;
}

export interface CandidateSignalCoverage {
  tag: number;
  review: number;
  popularity: number;
  /** H-017 쌍 점수(≥2개 비광역 태그) 확보 후보 수 — complete-case 정의에는 불포함 */
  pair: number;
  completeCase: number;
}

export interface TagHoldoutFold {
  arm: HoldoutArm;
  tag: string;
  originalSupport: number;
  retainedSupport: number;
  /** Store-confirmed base 후보 + 강제 삽입 표적. */
  oracleCandidateCount: number;
  /** legacy 3신호 complete-case 후보 수 (pairOnly는 이 풀에서 쌍 점수 보유분만 순위화). */
  candidateCount: number;
  completeCaseTargets: number;
  targetCoverage: number;
  signalCoverage: CandidateSignalCoverage;
  residualProfileTags: number;
  heldout: HeldoutGameDiagnostic[];
  rankers: Record<DiagnosticRanker, RankerDiagnostic>;
  random: RandomExpectation[];
}

export interface MacroAtK {
  k: number;
  informativeFolds: number;
  saturatedFolds: number;
  meanRecall: number | null;
  hitRate: number | null;
  meanNdcg: number | null;
}

export interface RankerMacroDiagnostic {
  ranker: DiagnosticRanker;
  folds: number;
  targetObservations: number;
  rankedTargetCoverage: number;
  meanRankedCandidates: number;
  meanCandidateCoverage: number;
  meanRankPercentile: number;
  meanReciprocalRank: number;
  atK: MacroAtK[];
}

export interface RandomMacroAtK {
  k: number;
  informativeFolds: number;
  saturatedFolds: number;
  meanExpectedRecall: number | null;
  meanHitProbability: number | null;
}

export interface HoldoutArmDiagnostic {
  folds: TagHoldoutFold[];
  macro: RankerMacroDiagnostic[];
  randomMacro: RandomMacroAtK[];
  foldTargetObservations: number;
  uniqueHeldoutGames: number;
}

export interface UnionStressDiagnostic {
  status: "ok" | "insufficient-profile" | "no-observed-tags";
  maskedTags: number;
  maskedGames: number;
  retainedEvidenceGames: number;
  oracleCandidateCount: number;
  candidateCount: number;
  completeCaseTargets: number;
  targetCoverage: number;
  signalCoverage: CandidateSignalCoverage;
  residualProfileTags: number;
  heldout: HeldoutGameDiagnostic[];
  rankers: Record<DiagnosticRanker, RankerDiagnostic> | null;
  random: RandomExpectation[];
}

export interface DiagnosticCandidateFunnel {
  /** 패키지·번들 제거 및 카테고리 합집합 중복 제거 뒤의 app ID 수. */
  filteredFeaturedAppIds: number;
  outsideOriginalLibraryIds: number;
  scoringFactsRetrieved: number;
  storeConfirmedGames: number;
}

export interface TagHoldoutReport {
  diagnosticVersion: string;
  modelVersion: string;
  runStartedAt: string;
  /** upstream source는 갱신 시각을 노출하지 않으므로 null이다. */
  metadataAsOf: string | null;
  profileEvidenceFingerprint: string;
  featuredAppIdFingerprint: string;
  candidateIdFingerprint: string;
  candidateMetadataFingerprint: string;
  candidateFunnel: DiagnosticCandidateFunnel;
  /** 실제 입력은 전체 라이브러리가 아니라 파이프라인이 확인한 프로필 cohort다. */
  profileFetchCap: number;
  libraryItemsAtLeast30m: number;
  evidenceGames: number;
  baseCandidateGames: number;
  observedTags: number;
  eligibleTags: number;
  skippedTags: { tag: string; support: number }[];
  foldTargetObservations: number;
  uniqueHeldoutGames: number;
  uniqueHeldoutListedInCurrentFeaturedFeed: number;
  folds: TagHoldoutFold[];
  macro: RankerMacroDiagnostic[];
  randomMacro: RandomMacroAtK[];
  lowerPlayControl: HoldoutArmDiagnostic;
  unionStress: UnionStressDiagnostic;
}

interface EvidenceGame {
  owned: OwnedGame;
  facts: GameFacts;
}

interface ScoredCandidate {
  facts: GameFacts;
  tag: number | null;
  review: number | null;
  popularity: number | null;
  /** H-017 태그-쌍 코사인. complete-case 풀 정의에는 참여하지 않는다. */
  pair: number | null;
}

interface MaskedRun {
  model: TasteModel;
  oracleCandidateCount: number;
  candidateCount: number;
  completeCaseTargets: number;
  signalCoverage: CandidateSignalCoverage;
  scoresByAppid: Map<number, ScoredCandidate>;
  orders: Record<DiagnosticRanker, number[]>;
  rankers: Record<DiagnosticRanker, RankerDiagnostic>;
  random: RandomExpectation[];
}

function isConfirmedTaggedGame(facts: GameFacts): boolean {
  return (
    facts.appType?.toLowerCase() === "game" &&
    Object.values(facts.tags).some((votes) => votes > 0)
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function scoreTag(model: TasteModel, facts: GameFacts): number | null {
  if (model.profile.size === 0) return null;
  const vector = tfidfVector(facts, model.idf, model.unseenIdf);
  if (vector.size === 0) return null;
  return cosineSimilarity(model.profile, vector);
}

function scoreReview(facts: GameFacts): number | null {
  const total = facts.positive + facts.negative;
  return total > 0 ? wilsonLowerBound(facts.positive, total) : null;
}

function scorePopularity(facts: GameFacts): number | null {
  return facts.ownersEstimate > 0 ? Math.log1p(facts.ownersEstimate) : null;
}

function rankScored(
  candidates: ScoredCandidate[],
  score: (candidate: ScoredCandidate) => number,
): number[] {
  return [...candidates]
    .sort((a, b) => score(b) - score(a) || a.facts.appid - b.facts.appid)
    .map(({ facts }) => facts.appid);
}

function rankMap(order: readonly number[]): Map<number, number> {
  return new Map(order.map((appid, index) => [appid, index + 1]));
}

function ndcg(ranks: readonly (number | null)[], k: number): number {
  const dcg = ranks.reduce<number>(
    (sum, rank) => sum + (rank !== null && rank <= k ? 1 / Math.log2(rank + 1) : 0),
    0,
  );
  const idealHits = Math.min(ranks.length, k);
  let ideal = 0;
  for (let rank = 1; rank <= idealHits; rank++) ideal += 1 / Math.log2(rank + 1);
  return ideal > 0 ? dcg / ideal : 0;
}

function summarizeOrder(
  order: readonly number[],
  relevantAppids: readonly number[],
): RankerDiagnostic {
  const positions = rankMap(order);
  const ranks = relevantAppids.map((appid) => positions.get(appid) ?? null);
  const observed = ranks.filter((rank): rank is number => rank !== null);
  const percentiles = ranks.map((rank) => {
    if (rank === null) return 0;
    if (order.length <= 1) return 1;
    return (order.length - rank) / (order.length - 1);
  });
  return {
    rankedCandidates: order.length,
    relevantCount: relevantAppids.length,
    rankedRelevant: observed.length,
    meanObservedRank: observed.length
      ? observed.reduce((sum, rank) => sum + rank, 0) / observed.length
      : null,
    meanRankPercentile: percentiles.length
      ? percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length
      : 0,
    reciprocalRank: observed.length ? 1 / Math.min(...observed) : 0,
    atK: TAG_HOLDOUT_KS.map((requestedK) => {
      const effectiveK = Math.min(requestedK, order.length);
      const hits = ranks.filter((rank) => rank !== null && rank <= effectiveK).length;
      return {
        k: requestedK,
        effectiveK,
        saturated: order.length <= requestedK,
        hits,
        recall: relevantAppids.length ? hits / relevantAppids.length : 0,
        precision: effectiveK > 0 ? hits / effectiveK : 0,
        ndcg: ndcg(ranks, effectiveK),
        anyHit: hits > 0,
      };
    }),
  };
}

function probabilityNoRandomHit(candidateCount: number, relevantCount: number, k: number): number {
  if (relevantCount <= 0) return 1;
  if (k > candidateCount - relevantCount) return 0;
  let probability = 1;
  for (let draw = 0; draw < k; draw++) {
    probability *= (candidateCount - relevantCount - draw) / (candidateCount - draw);
  }
  return probability;
}

function randomExpectation(
  candidateCount: number,
  requestedRelevantCount: number,
  availableRelevantCount: number,
): RandomExpectation[] {
  return TAG_HOLDOUT_KS.map((requestedK) => {
    const effectiveK = Math.min(requestedK, candidateCount);
    const expectedHits =
      candidateCount > 0 ? (effectiveK * availableRelevantCount) / candidateCount : 0;
    return {
      k: requestedK,
      effectiveK,
      saturated: candidateCount <= requestedK,
      expectedHits,
      expectedRecall:
        requestedRelevantCount > 0 ? expectedHits / requestedRelevantCount : 0,
      expectedPrecision: effectiveK > 0 ? expectedHits / effectiveK : 0,
      anyHitProbability:
        candidateCount > 0 && availableRelevantCount > 0
          ? 1 - probabilityNoRandomHit(candidateCount, availableRelevantCount, effectiveK)
          : 0,
    };
  });
}

function missingSignals(candidate: ScoredCandidate | undefined): MissingDiagnosticSignal[] {
  if (!candidate) return ["tag", "review", "popularity", "pair"];
  const missing: MissingDiagnosticSignal[] = [];
  if (candidate.tag === null) missing.push("tag");
  if (candidate.review === null) missing.push("review");
  if (candidate.popularity === null) missing.push("popularity");
  if (candidate.pair === null) missing.push("pair");
  return missing;
}

/** complete-case는 legacy 3신호 기준을 유지한다 — pair 결측은 커버리지로만 보고. */
function isCompleteCase(missing: readonly MissingDiagnosticSignal[]): boolean {
  return !missing.some((signal) => signal !== "pair");
}

function runMasked(
  owned: OwnedGame[],
  profileFactsByAppid: Map<number, GameFacts>,
  baseCandidates: GameFacts[],
  hidden: EvidenceGame[],
  nowMs: number,
): MaskedRun {
  const hiddenAppids = new Set(hidden.map(({ owned: game }) => game.appid));
  const trainingOwned = owned.filter((game) => !hiddenAppids.has(game.appid));
  const trainingFacts = new Map(
    [...profileFactsByAppid].filter(([appid]) => !hiddenAppids.has(appid)),
  );
  const model = buildTasteModel(trainingOwned, trainingFacts, nowMs);
  // H-017 arm: 같은 훈련 입력으로 표현만 쌍 벡터로 바꾼 모델 (광역 판정도 훈련 corpus 내부)
  const pairModel = buildPairModel(trainingOwned, trainingFacts, nowMs);
  const maskedOwnedAppids = new Set(trainingOwned.map((game) => game.appid));

  const candidateMap = new Map<number, GameFacts>();
  for (const facts of baseCandidates) candidateMap.set(facts.appid, facts);
  for (const game of hidden) candidateMap.set(game.facts.appid, game.facts);
  const oracleCandidates = [...candidateMap.values()]
    .filter((facts) => !maskedOwnedAppids.has(facts.appid))
    .sort((a, b) => a.appid - b.appid);
  const scored = oracleCandidates.map((facts) => ({
    facts,
    tag: scoreTag(model, facts),
    review: scoreReview(facts),
    popularity: scorePopularity(facts),
    pair: scorePairOnly(pairModel, facts),
  }));
  const comparisonCandidates = scored.filter(
    (candidate) =>
      candidate.tag !== null && candidate.review !== null && candidate.popularity !== null,
  );
  const comparisonFacts = comparisonCandidates.map(({ facts }) => facts);
  // pairOnly는 같은 complete-case 풀에서 쌍 점수가 있는 후보만 순위화한다 —
  // 풀 정의를 5신호로 좁히면 legacy arm들과의 비교 기반이 무너지기 때문.
  const pairRankable = comparisonCandidates.filter((candidate) => candidate.pair !== null);
  const orders: Record<DiagnosticRanker, number[]> = {
    combined: rankGeneralCandidates(
      model,
      comparisonFacts,
      maskedOwnedAppids,
      comparisonFacts.length,
    ).map(({ appid }) => appid),
    tagOnly: rankScored(comparisonCandidates, (candidate) => candidate.tag!),
    reviewOnly: rankScored(comparisonCandidates, (candidate) => candidate.review!),
    popularityOnly: rankScored(comparisonCandidates, (candidate) => candidate.popularity!),
    pairOnly: rankScored(pairRankable, (candidate) => candidate.pair!),
  };
  const relevantAppids = hidden.map(({ owned: game }) => game.appid);
  const comparisonAppids = new Set(comparisonCandidates.map(({ facts }) => facts.appid));
  const completeCaseTargets = relevantAppids.filter((appid) => comparisonAppids.has(appid)).length;
  const rankers = Object.fromEntries(
    (Object.keys(orders) as DiagnosticRanker[]).map((ranker) => [
      ranker,
      summarizeOrder(orders[ranker], relevantAppids),
    ]),
  ) as Record<DiagnosticRanker, RankerDiagnostic>;

  return {
    model,
    oracleCandidateCount: oracleCandidates.length,
    candidateCount: comparisonCandidates.length,
    completeCaseTargets,
    signalCoverage: {
      tag: scored.filter(({ tag }) => tag !== null).length,
      review: scored.filter(({ review }) => review !== null).length,
      popularity: scored.filter(({ popularity }) => popularity !== null).length,
      pair: scored.filter(({ pair }) => pair !== null).length,
      completeCase: comparisonCandidates.length,
    },
    scoresByAppid: new Map(scored.map((candidate) => [candidate.facts.appid, candidate])),
    orders,
    rankers,
    random: randomExpectation(
      comparisonCandidates.length,
      relevantAppids.length,
      completeCaseTargets,
    ),
  };
}

function heldoutResults(
  hidden: EvidenceGame[],
  run: MaskedRun,
  currentFeaturedAppids: Set<number>,
): HeldoutGameDiagnostic[] {
  const positions = Object.fromEntries(
    (Object.keys(run.orders) as DiagnosticRanker[]).map((ranker) => [
      ranker,
      rankMap(run.orders[ranker]),
    ]),
  ) as Record<DiagnosticRanker, Map<number, number>>;
  return hidden.map(({ owned: game }) => {
    const missing = missingSignals(run.scoresByAppid.get(game.appid));
    return {
      appid: game.appid,
      name: game.name,
      playtimeMinutes: game.playtime_forever,
      listedInCurrentFeaturedFeed: currentFeaturedAppids.has(game.appid),
      forcedIntoOraclePool: true,
      completeCase: isCompleteCase(missing),
      missingSignals: missing,
      ranks: {
        combined: positions.combined.get(game.appid) ?? null,
        tagOnly: positions.tagOnly.get(game.appid) ?? null,
        reviewOnly: positions.reviewOnly.get(game.appid) ?? null,
        popularityOnly: positions.popularityOnly.get(game.appid) ?? null,
        pairOnly: positions.pairOnly.get(game.appid) ?? null,
      },
    };
  });
}

function makeFold(
  arm: HoldoutArm,
  tag: string,
  games: EvidenceGame[],
  hidden: EvidenceGame[],
  owned: OwnedGame[],
  profileFactsByAppid: Map<number, GameFacts>,
  baseCandidates: GameFacts[],
  currentFeaturedAppids: Set<number>,
  nowMs: number,
): TagHoldoutFold {
  const run = runMasked(owned, profileFactsByAppid, baseCandidates, hidden, nowMs);
  return {
    arm,
    tag,
    originalSupport: games.length,
    retainedSupport: games.length - hidden.length,
    oracleCandidateCount: run.oracleCandidateCount,
    candidateCount: run.candidateCount,
    completeCaseTargets: run.completeCaseTargets,
    targetCoverage: hidden.length ? run.completeCaseTargets / hidden.length : 0,
    signalCoverage: run.signalCoverage,
    residualProfileTags: run.model.profile.size,
    heldout: heldoutResults(hidden, run, currentFeaturedAppids),
    rankers: run.rankers,
    random: run.random,
  };
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function macroFor(folds: TagHoldoutFold[], ranker: DiagnosticRanker): RankerMacroDiagnostic {
  const diagnostics = folds.map((fold) => fold.rankers[ranker]);
  const targets = diagnostics.reduce((sum, item) => sum + item.relevantCount, 0);
  const ranked = diagnostics.reduce((sum, item) => sum + item.rankedRelevant, 0);
  return {
    ranker,
    folds: folds.length,
    targetObservations: targets,
    rankedTargetCoverage: targets ? ranked / targets : 0,
    meanRankedCandidates: mean(diagnostics.map((item) => item.rankedCandidates)),
    meanCandidateCoverage: mean(
      folds.map((fold) =>
        fold.oracleCandidateCount > 0 ? fold.candidateCount / fold.oracleCandidateCount : 0,
      ),
    ),
    meanRankPercentile: mean(diagnostics.map((item) => item.meanRankPercentile)),
    meanReciprocalRank: mean(diagnostics.map((item) => item.reciprocalRank)),
    atK: TAG_HOLDOUT_KS.map((k) => {
      const rows = diagnostics.map((item) => item.atK.find((metric) => metric.k === k)!);
      const informative = rows.filter((metric) => !metric.saturated);
      return {
        k,
        informativeFolds: informative.length,
        saturatedFolds: rows.length - informative.length,
        meanRecall: informative.length ? mean(informative.map((metric) => metric.recall)) : null,
        hitRate: informative.length
          ? mean(informative.map((metric) => (metric.anyHit ? 1 : 0)))
          : null,
        meanNdcg: informative.length ? mean(informative.map((metric) => metric.ndcg)) : null,
      };
    }),
  };
}

function macrosFor(folds: TagHoldoutFold[]): RankerMacroDiagnostic[] {
  return (["combined", "tagOnly", "reviewOnly", "popularityOnly", "pairOnly"] as const).map(
    (ranker) => macroFor(folds, ranker),
  );
}

function randomMacroFor(folds: TagHoldoutFold[]): RandomMacroAtK[] {
  return TAG_HOLDOUT_KS.map((k) => {
    const rows = folds.map((fold) => fold.random.find((metric) => metric.k === k)!);
    const informative = rows.filter((metric) => !metric.saturated);
    return {
      k,
      informativeFolds: informative.length,
      saturatedFolds: rows.length - informative.length,
      meanExpectedRecall: informative.length
        ? mean(informative.map((metric) => metric.expectedRecall))
        : null,
      meanHitProbability: informative.length
        ? mean(informative.map((metric) => metric.anyHitProbability))
        : null,
    };
  });
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function factsFingerprint(facts: readonly GameFacts[]): string {
  return fingerprint(
    facts
      .map((game) => {
        const tags = Object.entries(game.tags)
          .filter(([, votes]) => votes > 0)
          .sort(([a], [b]) => compareText(a, b));
        return [
          game.appid,
          game.appType ?? "",
          game.positive,
          game.negative,
          game.ownersEstimate,
          JSON.stringify(tags),
        ].join("|");
      })
      .sort()
      .join("\n"),
  );
}

function evidenceFingerprint(evidence: readonly EvidenceGame[]): string {
  return fingerprint(
    evidence
      .map(({ owned, facts }) =>
        [
          owned.appid,
          owned.playtime_forever,
          owned.rtime_last_played ?? 0,
          facts.medianPlaytime,
          facts.positive,
          facts.negative,
          facts.ownersEstimate,
          JSON.stringify(
            Object.entries(facts.tags)
              .filter(([, votes]) => votes > 0)
              .sort(([a], [b]) => compareText(a, b)),
          ),
        ].join("|"),
      )
      .sort()
      .join("\n"),
  );
}

/**
 * 현재 스냅샷의 known-positive를 마스킹하는 ranker-only 재구성 진단.
 * 미래 행동, 선호, 실제 후보 생성, 추천 인과효과의 정확도 검증이 아니다.
 */
export function runTagHoldoutDiagnostic(
  owned: OwnedGame[],
  profileFactsByAppid: Map<number, GameFacts>,
  candidateFacts: GameFacts[],
  currentFeaturedAppids: Set<number>,
  nowMs: number,
  profileFetchCap: number,
  candidateFunnel?: DiagnosticCandidateFunnel,
): TagHoldoutReport {
  const ownedByAppid = new Map(owned.map((game) => [game.appid, game]));
  const evidence = [...profileFactsByAppid.values()]
    .filter(isConfirmedTaggedGame)
    .map((facts) => ({ facts, owned: ownedByAppid.get(facts.appid) }))
    .filter(
      (item): item is EvidenceGame =>
        item.owned !== undefined && item.owned.playtime_forever >= MIN_EVIDENCE_MINUTES,
    )
    .sort((a, b) => a.owned.appid - b.owned.appid);
  const originalOwnedAppids = new Set(owned.map((game) => game.appid));
  const baseCandidateMap = new Map<number, GameFacts>();
  for (const facts of candidateFacts) {
    if (facts.appType?.toLowerCase() !== "game" || originalOwnedAppids.has(facts.appid)) continue;
    baseCandidateMap.set(facts.appid, facts);
  }
  const baseCandidates = [...baseCandidateMap.values()].sort((a, b) => a.appid - b.appid);

  const byTag = new Map<string, EvidenceGame[]>();
  for (const game of evidence) {
    for (const [tag, votes] of Object.entries(game.facts.tags)) {
      if (votes <= 0) continue;
      const group = byTag.get(tag) ?? [];
      group.push(game);
      byTag.set(tag, group);
    }
  }
  const tagGroups = [...byTag]
    .map(([tag, games]) => ({
      tag,
      games: [...games].sort(
        (a, b) =>
          b.owned.playtime_forever - a.owned.playtime_forever ||
          a.owned.appid - b.owned.appid,
      ),
    }))
    .sort((a, b) => compareText(a.tag, b.tag));
  const eligible = tagGroups.filter(({ games }) => games.length >= TAG_HOLDOUT_MIN_SUPPORT);
  const skippedTags = tagGroups
    .filter(({ games }) => games.length < TAG_HOLDOUT_MIN_SUPPORT)
    .map(({ tag, games }) => ({ tag, support: games.length }));

  const folds = eligible.map(({ tag, games }) =>
    makeFold(
      "topPlay",
      tag,
      games,
      games.slice(0, TAG_HOLDOUT_COUNT),
      owned,
      profileFactsByAppid,
      baseCandidates,
      currentFeaturedAppids,
      nowMs,
    ),
  );
  const controlFolds = eligible.map(({ tag, games }) =>
    makeFold(
      "lowerPlayControl",
      tag,
      games,
      games.slice(TAG_HOLDOUT_COUNT, TAG_HOLDOUT_COUNT * 2),
      owned,
      profileFactsByAppid,
      baseCandidates,
      currentFeaturedAppids,
      nowMs,
    ),
  );

  const uniqueHeldout = new Map<number, EvidenceGame>();
  for (const { games } of eligible) {
    for (const game of games.slice(0, TAG_HOLDOUT_COUNT)) uniqueHeldout.set(game.owned.appid, game);
  }
  const uniqueControl = new Map<number, EvidenceGame>();
  for (const { games } of eligible) {
    for (const game of games.slice(TAG_HOLDOUT_COUNT, TAG_HOLDOUT_COUNT * 2)) {
      uniqueControl.set(game.owned.appid, game);
    }
  }

  // 문자 그대로의 보조 arm: support 하한과 무관하게 관측된 모든 태그의 상위 2개 합집합.
  const uniqueUnion = new Map<number, EvidenceGame>();
  for (const { games } of tagGroups) {
    for (const game of games.slice(0, TAG_HOLDOUT_COUNT)) uniqueUnion.set(game.owned.appid, game);
  }
  const unionHidden = [...uniqueUnion.values()].sort((a, b) => a.owned.appid - b.owned.appid);
  const unionRun = unionHidden.length
    ? runMasked(owned, profileFactsByAppid, baseCandidates, unionHidden, nowMs)
    : null;
  const unionStress: UnionStressDiagnostic = unionRun
    ? {
        status: unionRun.model.profile.size > 0 ? "ok" : "insufficient-profile",
        maskedTags: tagGroups.length,
        maskedGames: unionHidden.length,
        retainedEvidenceGames: evidence.length - unionHidden.length,
        oracleCandidateCount: unionRun.oracleCandidateCount,
        candidateCount: unionRun.candidateCount,
        completeCaseTargets: unionRun.completeCaseTargets,
        targetCoverage: unionHidden.length ? unionRun.completeCaseTargets / unionHidden.length : 0,
        signalCoverage: unionRun.signalCoverage,
        residualProfileTags: unionRun.model.profile.size,
        heldout: heldoutResults(unionHidden, unionRun, currentFeaturedAppids),
        rankers: unionRun.model.profile.size > 0 ? unionRun.rankers : null,
        random: unionRun.model.profile.size > 0 ? unionRun.random : [],
      }
    : {
        status: "no-observed-tags",
        maskedTags: 0,
        maskedGames: 0,
        retainedEvidenceGames: evidence.length,
        oracleCandidateCount: baseCandidates.length,
        candidateCount: 0,
        completeCaseTargets: 0,
        targetCoverage: 0,
        signalCoverage: { tag: 0, review: 0, popularity: 0, pair: 0, completeCase: 0 },
        residualProfileTags: 0,
        heldout: [],
        rankers: null,
        random: [],
      };

  const macro = macrosFor(folds);
  const controlMacro = macrosFor(controlFolds);
  const resolvedFunnel = candidateFunnel ?? {
    filteredFeaturedAppIds: currentFeaturedAppids.size,
    outsideOriginalLibraryIds: candidateFacts.length,
    scoringFactsRetrieved: candidateFacts.length,
    storeConfirmedGames: baseCandidates.length,
  };

  return {
    diagnosticVersion: TAG_HOLDOUT_DIAGNOSTIC_VERSION,
    modelVersion: TAG_HOLDOUT_MODEL_VERSION,
    runStartedAt: new Date(nowMs).toISOString(),
    metadataAsOf: null,
    profileEvidenceFingerprint: evidenceFingerprint(evidence),
    featuredAppIdFingerprint: fingerprint(
      [...currentFeaturedAppids].sort((a, b) => a - b).join(","),
    ),
    candidateIdFingerprint: fingerprint(baseCandidates.map(({ appid }) => appid).join(",")),
    candidateMetadataFingerprint: factsFingerprint(baseCandidates),
    candidateFunnel: resolvedFunnel,
    profileFetchCap,
    libraryItemsAtLeast30m: owned.filter(
      (game) => game.playtime_forever >= MIN_EVIDENCE_MINUTES,
    ).length,
    evidenceGames: evidence.length,
    baseCandidateGames: baseCandidates.length,
    observedTags: tagGroups.length,
    eligibleTags: eligible.length,
    skippedTags,
    foldTargetObservations: folds.reduce((sum, fold) => sum + fold.heldout.length, 0),
    uniqueHeldoutGames: uniqueHeldout.size,
    uniqueHeldoutListedInCurrentFeaturedFeed: [...uniqueHeldout.keys()].filter((appid) =>
      currentFeaturedAppids.has(appid),
    ).length,
    folds,
    macro,
    randomMacro: randomMacroFor(folds),
    lowerPlayControl: {
      folds: controlFolds,
      macro: controlMacro,
      randomMacro: randomMacroFor(controlFolds),
      foldTargetObservations: controlFolds.reduce((sum, fold) => sum + fold.heldout.length, 0),
      uniqueHeldoutGames: uniqueControl.size,
    },
    unionStress,
  };
}
