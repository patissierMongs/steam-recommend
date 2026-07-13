import { cosineSimilarity } from "@/lib/analysis/stats";

/**
 * 취향 클러스터 (Spotify "taste clusters"의 스팀 버전).
 *
 * 단일 평균 취향 벡터는 서로 다른 취향(로그라이크 + 시티빌더 + 호러)을 뭉개서
 * "광범위한 태그 매칭"이 되는 원인이다. 플레이한 게임의 태그 벡터를 가중 구형
 * k-means로 K개 클러스터로 나누고, 후보는 **가장 잘 맞는 클러스터 하나**와의
 * 유사도로 평가한다(max-over-clusters). 평균이 아닌 최근접 취향 매칭.
 *
 * 결정적(deterministic) 구현: 난수 없이 최대 가중치 게임에서 시작하는
 * farthest-first 초기화 + 고정 반복 횟수.
 */

export interface TasteCluster {
  /** L2 정규화된 중심 벡터 */
  centroid: Map<string, number>;
  /** 클러스터에 속한 게임들의 선호 가중치 합 */
  weight: number;
  /** 전체 대비 비중 (0..1) */
  share: number;
  /** 대표 태그 (중심 벡터 상위) */
  topTags: string[];
  /** 소속 게임 이름 (가중치 상위) */
  games: string[];
}

interface Item {
  appid: number;
  name: string;
  vec: Map<string, number>; // 단위 벡터
  weight: number;
}

function normalize(v: ReadonlyMap<string, number>): Map<string, number> {
  let s = 0;
  for (const x of v.values()) s += x * x;
  const n = Math.sqrt(s) || 1;
  const out = new Map<string, number>();
  for (const [k, x] of v) out.set(k, x / n);
  return out;
}

function weightedMean(items: Item[]): Map<string, number> {
  const acc = new Map<string, number>();
  for (const it of items) {
    for (const [k, x] of it.vec) acc.set(k, (acc.get(k) ?? 0) + x * it.weight);
  }
  return normalize(acc);
}

function clusterCountFor(n: number): number {
  if (n < 6) return 1;
  if (n < 14) return 2;
  if (n < 28) return 3;
  return 4;
}

/**
 * 가중 구형 k-means. games: (벡터, 선호 가중치) 목록.
 * 반환: 가중치 내림차순 클러스터 목록.
 */
export function buildTasteClusters(
  games: { appid: number; name: string; vec: ReadonlyMap<string, number>; weight: number }[],
): TasteCluster[] {
  const items: Item[] = games
    .filter((g) => g.vec.size > 0 && g.weight > 0)
    .map((g) => ({ appid: g.appid, name: g.name, vec: normalize(g.vec), weight: g.weight }));
  if (items.length === 0) return [];

  const k = clusterCountFor(items.length);
  // farthest-first 초기화: 최대 가중치 게임 → 기존 중심들과 가장 안 닮은 게임 순
  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const centroids: Map<string, number>[] = [sorted[0].vec];
  while (centroids.length < k) {
    let best: Item | null = null;
    let bestDist = -1;
    for (const it of items) {
      const nearest = Math.max(...centroids.map((c) => cosineSimilarity(c, it.vec)));
      const dist = 1 - nearest;
      if (dist > bestDist) {
        bestDist = dist;
        best = it;
      }
    }
    if (!best || bestDist <= 1e-9) break; // 전부 동일 방향이면 더 나눌 수 없음
    centroids.push(best.vec);
  }

  let assignment = new Array<number>(items.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    // 할당
    const next = items.map((it) => {
      let bestC = 0;
      let bestSim = -Infinity;
      centroids.forEach((c, ci) => {
        const sim = cosineSimilarity(c, it.vec);
        if (sim > bestSim) {
          bestSim = sim;
          bestC = ci;
        }
      });
      return bestC;
    });
    const changed = next.some((c, i) => c !== assignment[i]);
    assignment = next;
    // 중심 갱신
    for (let ci = 0; ci < centroids.length; ci++) {
      const members = items.filter((_, i) => assignment[i] === ci);
      if (members.length > 0) centroids[ci] = weightedMean(members);
    }
    if (!changed && iter > 0) break;
  }

  const totalWeight = items.reduce((a, b) => a + b.weight, 0) || 1;
  return centroids
    .map((centroid, ci) => {
      const members = items
        .filter((_, i) => assignment[i] === ci)
        .sort((a, b) => b.weight - a.weight);
      const weight = members.reduce((a, b) => a + b.weight, 0);
      return {
        centroid,
        weight,
        share: weight / totalWeight,
        topTags: [...centroid.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([t]) => t),
        games: members.slice(0, 4).map((m) => m.name),
      };
    })
    .filter((c) => c.games.length > 0)
    .sort((a, b) => b.weight - a.weight);
}

/** 클러스터를 무시해도 되는 최소 비중 — 잡음성 원소 하나짜리 클러스터 배제 */
const MIN_CLUSTER_SHARE = 0.08;

/**
 * 후보의 취향 점수: 가장 잘 맞는 클러스터와의 코사인 (max-over-clusters).
 * 클러스터가 없으면 null (호출부가 flat 프로필로 폴백).
 */
export function clusterMatch(
  clusters: readonly TasteCluster[],
  candidateVec: ReadonlyMap<string, number>,
): { score: number; cluster: TasteCluster } | null {
  let best: { score: number; cluster: TasteCluster } | null = null;
  for (const c of clusters) {
    if (c.share < MIN_CLUSTER_SHARE && clusters.length > 1) continue;
    const score = cosineSimilarity(c.centroid, candidateVec);
    if (!best || score > best.score) best = { score, cluster: c };
  }
  return best;
}
