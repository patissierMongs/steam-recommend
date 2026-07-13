import type { GameFacts, OwnedGame, TasteProfileSummary, TasteTag } from "@/lib/types";
import { herfindahlIndex, recencyDecay } from "@/lib/analysis/stats";
import { buildTasteClusters, type TasteCluster } from "@/lib/analysis/clusters";
import { looksLikeNonGame } from "@/lib/steam/apptype";

/** 취향 프로필: 사용자 벡터 + 게임별 TF-IDF 벡터 + 선호 가중치 (docs/DESIGN.md §1–2) */
export interface TasteModel {
  /** 사용자 취향 벡터 (태그 → 가중치, L2 정규화 전 원시값) — 폴백/표시용 */
  profile: Map<string, number>;
  /** 취향 클러스터 (다중 관심사 표현) — 후보 매칭의 1차 기준 */
  clusters: TasteCluster[];
  /** 프로필 상위 태그 (표시용, 가중치 내림차순) */
  topTags: TasteTag[];
  /** appid → 게임 TF-IDF 벡터 (프로필과 동일한 IDF 공간) */
  gameVectors: Map<number, Map<string, number>>;
  /** appid → 선호 가중치 w(g) (플레이한 게임만) */
  preferenceWeights: Map<number, number>;
  /** 작업 집합 IDF (후보 게임 벡터화에 재사용) */
  idf: Map<string, number>;
}

/** 플레이 기록이 취향 증거로 인정되는 최소 플레이타임(분) */
export const MIN_EVIDENCE_MINUTES = 30;

/** 태그 투표수 → TF (sqrt 감쇠 후 L1 정규화). 만능 태그 지배 억제는 IDF 몫. */
function tagTf(tags: Record<string, number>): Map<string, number> {
  const damped = Object.entries(tags)
    .filter(([, votes]) => votes > 0)
    .map(([tag, votes]) => [tag, Math.sqrt(votes)] as const);
  const sum = damped.reduce((a, [, v]) => a + v, 0);
  if (sum === 0) return new Map();
  return new Map(damped.map(([tag, v]) => [tag, v / sum]));
}

/** 작업 집합(라이브러리 ∪ 후보) 기준 smoothed IDF */
export function buildIdf(corpus: Iterable<GameFacts>): Map<string, number> {
  const df = new Map<string, number>();
  let n = 0;
  for (const g of corpus) {
    n++;
    for (const tag of Object.keys(g.tags)) df.set(tag, (df.get(tag) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [tag, d] of df) idf.set(tag, Math.log((n + 1) / (d + 1)) + 1);
  return idf;
}

export function tfidfVector(facts: GameFacts, idf: Map<string, number>): Map<string, number> {
  const v = new Map<string, number>();
  for (const [tag, tf] of tagTf(facts.tags)) v.set(tag, tf * (idf.get(tag) ?? 1));
  return v;
}

/**
 * 선호 가중치 w(g) — 절대 플레이타임(log 감쇠) × 상대 몰입도(전체 중앙값 대비) × 시간 감쇠.
 * exported for testing.
 */
export function preferenceWeight(game: OwnedGame, facts: GameFacts | undefined, nowMs: number): number {
  const hours = game.playtime_forever / 60;
  if (game.playtime_forever < MIN_EVIDENCE_MINUTES) return 0;
  const base = Math.log2(1 + hours);
  // 전체 유저 중앙값 대비 몰입도: 0.5 + ratio, [0.5, 2]로 클램프
  let engagement = 1;
  if (facts && facts.medianPlaytime > 0) {
    engagement = Math.min(2, Math.max(0.5, 0.5 + game.playtime_forever / facts.medianPlaytime));
  }
  const decay = recencyDecay(game.rtime_last_played ?? 0, nowMs);
  return base * engagement * decay;
}

/**
 * 라이브러리 + 게임 데이터로 취향 모델을 만든다.
 * factsByAppid에 없는 게임(데이터 미확보)은 프로필에서 제외된다.
 */
export function buildTasteModel(
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  nowMs: number,
): TasteModel {
  // P8: IDF 코퍼스에서도 비-게임 제외 (소프트웨어 태그가 IDF를 왜곡하지 않게)
  const gameFacts = [...factsByAppid.values()].filter((f) => !looksLikeNonGame(f));
  const idf = buildIdf(gameFacts);

  const gameVectors = new Map<number, Map<string, number>>();
  const preferenceWeights = new Map<number, number>();
  const profile = new Map<string, number>();
  // 태그별 기여 상위 게임 추적 (표시용)
  const tagContrib = new Map<string, { name: string; amount: number }[]>();

  for (const game of owned) {
    const facts = factsByAppid.get(game.appid);
    if (!facts) continue;
    if (looksLikeNonGame(facts)) continue; // P8: Software/Utilities/DLC는 취향에서 제외
    const vec = tfidfVector(facts, idf);
    gameVectors.set(game.appid, vec);

    const w = preferenceWeight(game, facts, nowMs);
    if (w <= 0) continue;
    preferenceWeights.set(game.appid, w);
    for (const [tag, x] of vec) {
      profile.set(tag, (profile.get(tag) ?? 0) + w * x);
      let list = tagContrib.get(tag);
      if (!list) tagContrib.set(tag, (list = []));
      list.push({ name: game.name, amount: w * x });
    }
  }

  // 취향 클러스터: 플레이한 게임들의 (벡터, 가중치)로 다중 관심사 분리
  const clusterInput = owned
    .filter((g) => preferenceWeights.has(g.appid))
    .map((g) => ({
      appid: g.appid,
      name: g.name,
      vec: gameVectors.get(g.appid)!,
      weight: preferenceWeights.get(g.appid)!,
    }));
  const clusters = buildTasteClusters(clusterInput);

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

  return { profile, clusters, topTags, gameVectors, preferenceWeights, idf };
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
  for (const g of played) {
    const facts = factsByAppid.get(g.appid);
    if (!facts || facts.genres.length === 0) continue;
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
    // 실제로 태그 벡터를 기여한 게임만 카운트 — 선호 가중치가 있어도 태그가 없으면
    // profile에 기여하지 않으므로 preferenceWeights.size는 과대계상이다.
    analyzedGames: [...model.preferenceWeights.keys()].filter(
      (appid) => (model.gameVectors.get(appid)?.size ?? 0) > 0,
    ).length,
  };
}
