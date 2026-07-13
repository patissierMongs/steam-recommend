import type { GameFacts, OwnedGame, TasteProfileSummary, TasteTag } from "@/lib/types";
import { herfindahlIndex, recencyDecay } from "@/lib/analysis/stats";

/** 플레이 기록 태그 프로필: 사용자 벡터 + 게임별 TF-IDF 벡터 + 관측 가중치 */
export interface TasteModel {
  /** 플레이 기록 태그 벡터 (태그 → 가중치, L2 정규화 전 원시값) */
  profile: Map<string, number>;
  /** 프로필 상위 태그 (표시용, 가중치 내림차순) */
  topTags: TasteTag[];
  /** appid → 게임 TF-IDF 벡터 (프로필과 동일한 IDF 공간) */
  gameVectors: Map<number, Map<string, number>>;
  /** appid → 누적 플레이 관측 가중치 w(g) (플레이한 게임만) */
  engagementWeights: Map<number, number>;
  /** 플레이 근거 집합 IDF (후보 게임 벡터화에 재사용) */
  idf: Map<string, number>;
  /** 프로필 corpus에서 관측되지 않은 후보 태그의 smoothed IDF */
  unseenIdf: number;
}

/** 플레이 기록을 태그 프로필 입력으로 쓰는 검증 전 최소 플레이타임(분) */
export const MIN_EVIDENCE_MINUTES = 30;

/** 플레이어 프로필 입력은 Store가 game으로 확인한 항목만 사용한다. */
function isConfirmedGame(facts: GameFacts): boolean {
  return facts.appType?.toLowerCase() === "game";
}

/** 태그 투표수 → TF (sqrt 감쇠 후 L1 정규화). 만능 태그 지배 억제는 IDF 몫. */
function tagTf(tags: Record<string, number>): Map<string, number> {
  const damped = Object.entries(tags)
    .filter(([, votes]) => votes > 0)
    .map(([tag, votes]) => [tag, Math.sqrt(votes)] as const);
  const sum = damped.reduce((a, [, v]) => a + v, 0);
  if (sum === 0) return new Map();
  return new Map(damped.map(([tag, v]) => [tag, v / sum]));
}

/** 플레이 근거 게임 corpus 기준 smoothed IDF */
export function buildIdf(corpus: Iterable<GameFacts>): Map<string, number> {
  const df = new Map<string, number>();
  let n = 0;
  for (const g of corpus) {
    n++;
    for (const [tag, votes] of Object.entries(g.tags)) {
      if (votes > 0) df.set(tag, (df.get(tag) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [tag, d] of df) idf.set(tag, Math.log((n + 1) / (d + 1)) + 1);
  return idf;
}

export function tfidfVector(
  facts: GameFacts,
  idf: Map<string, number>,
  unseenIdf = 1,
): Map<string, number> {
  const v = new Map<string, number>();
  for (const [tag, tf] of tagTf(facts.tags)) v.set(tag, tf * (idf.get(tag) ?? unseenIdf));
  return v;
}

/**
 * 관측 가중치 w(g) — 절대 플레이타임(log 감쇠) × 게임별 중앙값 대비 비율 × 시간 감쇠.
 * 선호나 만족도를 측정한 값이 아니다.
 * exported for testing.
 */
export function engagementWeight(game: OwnedGame, facts: GameFacts | undefined, nowMs: number): number {
  const hours = game.playtime_forever / 60;
  if (game.playtime_forever < MIN_EVIDENCE_MINUTES) return 0;
  const base = Math.log2(1 + hours);
  // 전체 유저 중앙값 대비 시간 배율: 0.5 + ratio, [0.5, 2]로 클램프
  let relativeTimeFactor = 1;
  if (facts && facts.medianPlaytime > 0) {
    relativeTimeFactor = Math.min(
      2,
      Math.max(0.5, 0.5 + game.playtime_forever / facts.medianPlaytime),
    );
  }
  const decay = recencyDecay(game.rtime_last_played ?? 0, nowMs);
  return base * relativeTimeFactor * decay;
}

/**
 * 라이브러리 + 게임 데이터로 플레이 기록 태그 모델을 만든다.
 * factsByAppid에 없는 게임(데이터 미확보)은 프로필에서 제외된다.
 */
export function buildTasteModel(
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  nowMs: number,
): TasteModel {
  // 후보·백로그 팩트가 IDF를 바꾸면 같은 플레이 기록도 조회 예산/순서에 따라 달라진다.
  // 따라서 실제 플레이 근거가 있는 소유 게임만 IDF corpus로 사용한다.
  const evidenceFacts = owned
    .filter((game) => game.playtime_forever >= MIN_EVIDENCE_MINUTES)
    .map((game) => factsByAppid.get(game.appid))
    .filter(
      (facts): facts is GameFacts =>
        facts !== undefined &&
        isConfirmedGame(facts) &&
        Object.values(facts.tags).some((votes) => votes > 0),
    );
  const idf = buildIdf(evidenceFacts);
  const unseenIdf = Math.log(evidenceFacts.length + 1) + 1;

  const gameVectors = new Map<number, Map<string, number>>();
  const engagementWeights = new Map<number, number>();
  const profile = new Map<string, number>();
  // 태그별 기여 상위 게임 추적 (표시용)
  const tagContrib = new Map<string, { name: string; amount: number }[]>();

  for (const game of owned) {
    const facts = factsByAppid.get(game.appid);
    if (!facts || !isConfirmedGame(facts)) continue;
    const vec = tfidfVector(facts, idf, unseenIdf);
    gameVectors.set(game.appid, vec);

    const w = engagementWeight(game, facts, nowMs);
    if (w <= 0) continue;
    engagementWeights.set(game.appid, w);
    for (const [tag, x] of vec) {
      profile.set(tag, (profile.get(tag) ?? 0) + w * x);
      let list = tagContrib.get(tag);
      if (!list) tagContrib.set(tag, (list = []));
      list.push({ name: game.name, amount: w * x });
    }
  }

  const maxWeight = Math.max(1e-12, ...profile.values());
  const topTags: TasteTag[] = [...profile.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([tag, weight]) => ({
      tag,
      weight: weight / maxWeight,
      topGames: (tagContrib.get(tag) ?? [])
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3)
        .map((c) => c.name),
    }));

  return { profile, topTags, gameVectors, engagementWeights, idf, unseenIdf };
}

/** 대시보드 요약 통계 (docs/DESIGN.md §6) */
export function summarizeTaste(
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  model: TasteModel,
): TasteProfileSummary {
  const played = owned.filter((g) => g.playtime_forever >= MIN_EVIDENCE_MINUTES);
  const totalMinutes = owned.reduce((a, g) => a + g.playtime_forever, 0);

  // 장르 분포 (플레이타임 가중)
  const genreMinutes = new Map<string, number>();
  let genreTotal = 0;
  let genreAnalyzedGames = 0;
  for (const g of played) {
    if (!model.engagementWeights.has(g.appid)) continue;
    const facts = factsByAppid.get(g.appid);
    if (!facts || facts.genres.length === 0) continue;
    genreAnalyzedGames++;
    const per = g.playtime_forever / facts.genres.length;
    for (const genre of facts.genres) {
      genreMinutes.set(genre, (genreMinutes.get(genre) ?? 0) + per);
      genreTotal += per;
    }
  }
  const genreShares = [...genreMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([genre, m]) => ({ genre, share: genreTotal > 0 ? m / genreTotal : 0 }));

  const playedSorted = played.map((g) => g.playtime_forever).sort((a, b) => a - b);
  const median = playedSorted.length
    ? playedSorted.length % 2
      ? playedSorted[(playedSorted.length - 1) / 2]
      : (playedSorted[playedSorted.length / 2 - 1] + playedSorted[playedSorted.length / 2]) / 2
    : 0;

  return {
    topTags: model.topTags,
    genreShares,
    totalGames: owned.length,
    playedGames: played.length,
    neverPlayed: owned.filter((g) => g.playtime_forever === 0).length,
    totalHours: Math.round(totalMinutes / 60),
    medianHoursPerPlayed: Math.round((median / 60) * 10) / 10,
    concentrationHHI: herfindahlIndex(played.map((g) => g.playtime_forever)),
    // 실제로 태그 벡터를 기여한 게임만 카운트한다.
    analyzedGames: [...model.engagementWeights.keys()].filter(
      (appid) => (model.gameVectors.get(appid)?.size ?? 0) > 0,
    ).length,
    genreAnalyzedGames,
  };
}
