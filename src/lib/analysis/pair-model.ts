import type { GameFacts, OwnedGame } from "@/lib/types";
import { engagementWeight, MIN_EVIDENCE_MINUTES } from "@/lib/analysis/taste";
import { cosineSimilarity } from "@/lib/analysis/stats";

/**
 * H-017 진단용 태그-쌍 표현 — 개별 태그 대신 "함께 나타나는 태그 쌍"을 특징으로 쓴다.
 *
 * buildTasteModel과 같은 골격(플레이 근거 corpus, engagementWeight, IDF 평활)을 유지해
 * 표현(단일 태그 → 쌍)만 바뀌도록 설계했다 — 진단에서 차이가 나면 표현 때문이지 가중치
 * 때문이 아니게 하기 위함이다.
 *
 * 광역 태그(훈련 corpus 과반 출현)는 쌍 형성에서 제외한다. 판정은 fold의 훈련 corpus
 * 내부에서만 계산하므로 마스킹된 표적 정보가 새지 않는다. 쌍 TF는 존재 기반(투표수
 * 미사용, 스팸 취약성 회피) L1 정규화다.
 *
 * 이 모듈은 H-017 진단 전용이다 — 제품 랭킹에 쓰지 않는다.
 */

export const PAIR_BROAD_DF_SHARE = 0.5;

export interface PairModel {
  /** 쌍 키 → 몰입 가중 프로필 값 */
  profile: Map<string, number>;
  pairIdf: Map<string, number>;
  unseenIdf: number;
  /** 훈련 corpus 과반 출현으로 쌍 형성에서 제외된 태그 */
  broadTags: Set<string>;
  corpusSize: number;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function presentTags(facts: GameFacts): string[] {
  return Object.entries(facts.tags)
    .filter(([, votes]) => votes > 0)
    .map(([tag]) => tag);
}

function isConfirmedTaggedGame(facts: GameFacts): boolean {
  return facts.appType?.toLowerCase() === "game" && presentTags(facts).length > 0;
}

/** 광역 제외 후 태그 쌍 목록 (정렬 키, 중복 없음) */
function gamePairs(facts: GameFacts, broad: ReadonlySet<string>): string[] {
  const tags = presentTags(facts)
    .filter((t) => !broad.has(t))
    .sort();
  const pairs: string[] = [];
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) pairs.push(pairKey(tags[i], tags[j]));
  }
  return pairs;
}

/** 존재 기반 TF (1/쌍수) × IDF. 쌍이 2개 미만 태그면 빈 벡터. */
export function pairVector(
  facts: GameFacts,
  pairIdf: Map<string, number>,
  unseenIdf: number,
  broad: ReadonlySet<string>,
): Map<string, number> {
  const pairs = gamePairs(facts, broad);
  const v = new Map<string, number>();
  if (pairs.length === 0) return v;
  const tf = 1 / pairs.length;
  for (const key of pairs) v.set(key, tf * (pairIdf.get(key) ?? unseenIdf));
  return v;
}

export function buildPairModel(
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  nowMs: number,
): PairModel {
  // buildTasteModel과 동일한 evidence 정의 — 표현 외 조건을 맞춘다.
  const evidence = owned
    .filter((game) => game.playtime_forever >= MIN_EVIDENCE_MINUTES)
    .map((game) => ({ game, facts: factsByAppid.get(game.appid) }))
    .filter((e): e is { game: OwnedGame; facts: GameFacts } =>
      e.facts !== undefined && isConfirmedTaggedGame(e.facts),
    );
  const n = evidence.length;

  const tagDf = new Map<string, number>();
  for (const { facts } of evidence) {
    for (const tag of presentTags(facts)) tagDf.set(tag, (tagDf.get(tag) ?? 0) + 1);
  }
  const broadTags = new Set(
    [...tagDf.entries()].filter(([, d]) => n > 0 && d / n > PAIR_BROAD_DF_SHARE).map(([t]) => t),
  );

  const pairDf = new Map<string, number>();
  for (const { facts } of evidence) {
    for (const key of new Set(gamePairs(facts, broadTags))) {
      pairDf.set(key, (pairDf.get(key) ?? 0) + 1);
    }
  }
  const pairIdf = new Map<string, number>();
  for (const [key, d] of pairDf) pairIdf.set(key, Math.log((n + 1) / (d + 1)) + 1);
  const unseenIdf = Math.log(n + 1) + 1;

  const profile = new Map<string, number>();
  for (const { game, facts } of evidence) {
    const w = engagementWeight(game, facts, nowMs);
    if (w <= 0) continue;
    for (const [key, x] of pairVector(facts, pairIdf, unseenIdf, broadTags)) {
      profile.set(key, (profile.get(key) ?? 0) + w * x);
    }
  }

  return { profile, pairIdf, unseenIdf, broadTags, corpusSize: n };
}

/** 프로필이 비었거나 후보에 유효 쌍이 없으면 null (0점이 아니라 판정 보류) */
export function scorePairOnly(model: PairModel, facts: GameFacts): number | null {
  if (model.profile.size === 0) return null;
  const vector = pairVector(facts, model.pairIdf, model.unseenIdf, model.broadTags);
  if (vector.size === 0) return null;
  return cosineSimilarity(model.profile, vector);
}
