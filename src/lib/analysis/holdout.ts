import type { GameFacts, OwnedGame } from "@/lib/types";
import { buildTasteModel, MIN_EVIDENCE_MINUTES, tfidfVector } from "@/lib/analysis/taste";
import { clusterMatch } from "@/lib/analysis/clusters";
import { cosineSimilarity } from "@/lib/analysis/stats";

/**
 * 홀드아웃 복원 평가 (leave-out offline evaluation).
 *
 * 가설(원장 C15): "태그별 플레이타임 상위 K개 게임을 제외하고 만든 취향 모델이
 * 그 제외한 게임을 후보들 사이에서 상위로 복원하면, 취향 모델에 예측 타당도가 있다."
 *
 * 방법: 각 태그의 최고 몰입 증거(top-K)를 숨기고, 남은 이력으로 모델을 만든 뒤,
 * 숨긴 게임을 후보 풀에 다시 넣어 순위를 매긴다. 숨긴 게임이 상위로 오면(Recall@K↑),
 * 남은 신호만으로 취향이 복원된 것이다.
 *
 * 정직한 한계:
 * - 이건 **내부 복원(recall) 타당도**이지 실사용 만족도가 아니다(피드백 로그 없음).
 * - top-K 게임은 인기와 상관될 수 있으므로, **인기도 베이스라인 대비 우위**를 함께 본다.
 *   취향이 인기도보다 잘 복원해야 "취향 신호가 인기 이상"이라 말할 수 있다.
 */

export interface HoldoutResult {
  playedCount: number;
  heldOutCount: number;
  reducedModelGames: number;
  poolSize: number;
  /** Recall@K: 숨긴 게임 중 순위 상위 K 안에 든 비율 (taste vs 인기도) */
  recall: { k: number; taste: number; popularity: number }[];
  /** 숨긴 게임 순위 백분위 중앙값 (1=최상위). taste가 popularity보다 높아야 유의미 */
  medianPercentile: { taste: number; popularity: number };
  perHeldOut: {
    appid: number;
    name: string;
    tastePercentile: number;
    popularityPercentile: number;
    topTags: string[];
  }[];
}

export interface LooResult {
  playedCount: number;
  /** LOO로 평가한 홀드아웃 후보 수 (태그별 top-K 선정) */
  testedCount: number;
  poolSize: number;
  /** Recall@K: 홀드아웃 게임이 순위 상위 K 안에 복원된 비율 (taste vs 인기도) */
  recall: { k: number; taste: number; popularity: number }[];
  /** 평균 역순위 (1=1위). 주의: 풀에 미보유 부정 후보가 적으면 인기도가 유리(라이브러리 편향) */
  mrr: { taste: number; popularity: number };
  medianPercentile: { taste: number; popularity: number };
  /** 홀드아웃 게임 중 taste 백분위 > 인기도 백분위인 비율 (취향이 인기 이상 기여한 비율) */
  tasteBeatsPopularity: number;
  /**
   * **핵심 지표**: 저인기(popularity 백분위 < 0.4) 홀드아웃 게임의 taste 백분위 중앙값.
   * 인기도가 못 띄우는 니치 게임을 취향이 얼마나 복원하는가 — 추천기가 인기 베이스라인 대비
   * 가치를 내는 지점. (집계 MRR은 인기 게임이 트리비얼하게 상위라 인기도가 유리해 오도.)
   */
  nicheRecoveryPercentile: number;
  perTested: {
    appid: number;
    name: string;
    tasteRank: number;
    tastePercentile: number;
    popularityPercentile: number;
    topTags: string[];
  }[];
}

/** 각 태그에서 플레이타임 상위 K개 게임의 appid 합집합 */
export function topKPerTagByPlaytime(
  owned: OwnedGame[],
  facts: Map<number, GameFacts>,
  k = 2,
): Set<number> {
  const played = owned.filter((g) => g.playtime_forever >= MIN_EVIDENCE_MINUTES && facts.has(g.appid));
  const byTag = new Map<string, { appid: number; pt: number }[]>();
  for (const g of played) {
    const f = facts.get(g.appid)!;
    for (const tag of Object.keys(f.tags)) {
      let arr = byTag.get(tag);
      if (!arr) byTag.set(tag, (arr = []));
      arr.push({ appid: g.appid, pt: g.playtime_forever });
    }
  }
  const held = new Set<number>();
  for (const arr of byTag.values()) {
    arr.sort((a, b) => b.pt - a.pt);
    for (const x of arr.slice(0, k)) held.add(x.appid);
  }
  return held;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function tasteScorer(model: ReturnType<typeof buildTasteModel>) {
  return (f: GameFacts): number => {
    const vec = tfidfVector(f, model.idf);
    const m = clusterMatch(model.clusters, vec);
    return m ? m.score : cosineSimilarity(model.profile, vec);
  };
}

/**
 * Leave-one-out 복원 평가 (배치 홀드아웃이 일관된 라이브러리를 붕괴시키는 문제의 교정판).
 *
 * 태그별 top-K로 **평가 대상**을 고르고, 각 대상 게임을 **하나씩만** 숨긴 뒤 나머지
 * 전체로 모델을 재구성해 그 게임이 후보 풀에서 몇 위로 복원되는지 잰다. 한 번에 하나만
 * 빼므로 모델이 죽지 않고, 순위가 유의미하다. negatives(미보유 게임)를 풀에 넣으면
 * 추천 유사 평가가 된다. 인기도 베이스라인과 비교해 취향 신호가 인기 이상인지 본다.
 */
export function leaveOneOutRecovery(
  owned: OwnedGame[],
  facts: Map<number, GameFacts>,
  negatives: GameFacts[],
  nowMs: number,
  k = 2,
): LooResult {
  const played = owned.filter((g) => g.playtime_forever >= MIN_EVIDENCE_MINUTES && facts.has(g.appid));
  const tested = [...topKPerTagByPlaytime(owned, facts, k)];
  const playedFacts = played.map((g) => facts.get(g.appid)!);

  // 고정 풀: 모든 플레이 게임 ∪ negatives (dedup). 각 LOO 폴드에서 이 풀을 랭킹.
  const pool: GameFacts[] = [];
  const seen = new Set<number>();
  for (const f of [...playedFacts, ...negatives]) {
    if (!seen.has(f.appid)) {
      seen.add(f.appid);
      pool.push(f);
    }
  }
  const N = pool.length;
  const byPop = [...pool].sort((a, b) => b.ownersEstimate - a.ownersEstimate).map((f) => f.appid);
  const popRank = (id: number) => byPop.indexOf(id);

  const perTested = tested
    .map((id) => {
      const f = facts.get(id)!;
      // 이 게임만 제외하고 모델 재구성
      const reducedOwned = played.filter((g) => g.appid !== id);
      const reducedFacts = new Map<number, GameFacts>();
      for (const g of reducedOwned) reducedFacts.set(g.appid, facts.get(g.appid)!);
      const model = buildTasteModel(reducedOwned, reducedFacts, nowMs);
      const score = tasteScorer(model);
      const byTaste = [...pool].sort((a, b) => score(b) - score(a)).map((x) => x.appid);
      const tRank = byTaste.indexOf(id);
      return {
        appid: id,
        name: f.name,
        tasteRank: tRank,
        tastePercentile: N <= 1 ? 1 : 1 - tRank / (N - 1),
        popularityPercentile: N <= 1 ? 1 : 1 - popRank(id) / (N - 1),
        topTags: Object.entries(f.tags)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t]) => t),
      };
    })
    .sort((a, b) => b.tastePercentile - a.tastePercentile);

  const recall = [10, 20, 50].map((kk) => ({
    k: kk,
    taste: perTested.length ? perTested.filter((h) => h.tasteRank < kk).length / perTested.length : 0,
    popularity: perTested.length
      ? perTested.filter((h) => popRank(h.appid) < kk).length / perTested.length
      : 0,
  }));
  const mrr = {
    taste: perTested.length ? perTested.reduce((a, h) => a + 1 / (h.tasteRank + 1), 0) / perTested.length : 0,
    popularity: perTested.length
      ? perTested.reduce((a, h) => a + 1 / (popRank(h.appid) + 1), 0) / perTested.length
      : 0,
  };
  const niche = perTested.filter((h) => h.popularityPercentile < 0.4);
  return {
    playedCount: played.length,
    testedCount: tested.length,
    poolSize: N,
    recall,
    mrr,
    medianPercentile: {
      taste: median(perTested.map((h) => h.tastePercentile)),
      popularity: median(perTested.map((h) => h.popularityPercentile)),
    },
    tasteBeatsPopularity: perTested.length
      ? perTested.filter((h) => h.tastePercentile > h.popularityPercentile).length / perTested.length
      : 0,
    nicheRecoveryPercentile: median(niche.map((h) => h.tastePercentile)),
    perTested,
  };
}

/**
 * negatives: 사용자가 보유하지 않은 "부정" 후보(있으면 추천 유사 평가). 비우면 라이브러리
 * 내부 복원(숨긴 게임이 남은 플레이 게임들 사이에서 상위로 오는지)만 측정.
 */
export function holdoutRecovery(
  owned: OwnedGame[],
  facts: Map<number, GameFacts>,
  negatives: GameFacts[],
  nowMs: number,
  k = 2,
): HoldoutResult {
  const played = owned.filter((g) => g.playtime_forever >= MIN_EVIDENCE_MINUTES && facts.has(g.appid));
  const held = topKPerTagByPlaytime(owned, facts, k);

  // 축소 모델: 숨긴 게임을 owned·facts 양쪽에서 제외
  const reducedOwned = played.filter((g) => !held.has(g.appid));
  const reducedFacts = new Map<number, GameFacts>();
  for (const g of reducedOwned) reducedFacts.set(g.appid, facts.get(g.appid)!);
  const model = buildTasteModel(reducedOwned, reducedFacts, nowMs);

  // 랭킹 풀 = 모든 플레이 게임(숨긴 것 포함) ∪ negatives, 중복 제거
  const pool: GameFacts[] = [];
  const seen = new Set<number>();
  for (const f of [...played.map((g) => facts.get(g.appid)!), ...negatives]) {
    if (!seen.has(f.appid)) {
      seen.add(f.appid);
      pool.push(f);
    }
  }

  const tasteScore = (f: GameFacts): number => {
    const vec = tfidfVector(f, model.idf);
    const m = clusterMatch(model.clusters, vec);
    return m ? m.score : cosineSimilarity(model.profile, vec);
  };

  const byTaste = [...pool].sort((a, b) => tasteScore(b) - tasteScore(a)).map((f) => f.appid);
  const byPop = [...pool].sort((a, b) => b.ownersEstimate - a.ownersEstimate).map((f) => f.appid);
  const rank = (arr: number[], id: number) => arr.indexOf(id);
  const N = pool.length;
  const percentile = (arr: number[], id: number) => (N <= 1 ? 1 : 1 - rank(arr, id) / (N - 1));

  const heldIds = [...held];
  const perHeldOut = heldIds
    .map((id) => {
      const f = facts.get(id)!;
      return {
        appid: id,
        name: f.name,
        tastePercentile: percentile(byTaste, id),
        popularityPercentile: percentile(byPop, id),
        topTags: Object.entries(f.tags)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t]) => t),
      };
    })
    .sort((a, b) => b.tastePercentile - a.tastePercentile);

  const recall = [10, 20, 50].map((kk) => ({
    k: kk,
    taste: heldIds.length ? heldIds.filter((id) => rank(byTaste, id) < kk).length / heldIds.length : 0,
    popularity: heldIds.length ? heldIds.filter((id) => rank(byPop, id) < kk).length / heldIds.length : 0,
  }));

  return {
    playedCount: played.length,
    heldOutCount: held.size,
    reducedModelGames: reducedOwned.length,
    poolSize: N,
    recall,
    medianPercentile: {
      taste: median(perHeldOut.map((h) => h.tastePercentile)),
      popularity: median(perHeldOut.map((h) => h.popularityPercentile)),
    },
    perHeldOut,
  };
}
