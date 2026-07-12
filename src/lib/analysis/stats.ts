/**
 * 통계 유틸리티 — 추천 엔진의 수학적 기반.
 * 근거는 docs/DESIGN.md 참고.
 */

const Z_95 = 1.959963984540054;

/**
 * Wilson score interval의 신뢰하한 (기본 95%).
 * 긍정 비율을 표본 크기로 보정한, 순위 매기기에 안전한 품질 점수.
 * 리뷰 10개 100% 긍정(≈0.72)보다 5,000개 93% 긍정(≈0.92)이 위로 온다.
 */
export function wilsonLowerBound(positive: number, total: number, z = Z_95): number {
  if (total <= 0) return 0;
  const p = positive / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return Math.max(0, (center - margin) / denom);
}

/** 코사인 유사도. 희소 벡터를 Map<string, number>로 표현한다. */
export function cosineSimilarity(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  // 작은 쪽을 순회
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w !== undefined) dot += v * w;
  }
  if (dot === 0) return 0;
  return dot / (l2Norm(a) * l2Norm(b));
}

export function l2Norm(v: ReadonlyMap<string, number>): number {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s) || 1;
}

/**
 * z-점수 정규화. 서로 스케일이 다른 점수(코사인, WLB, lift)를
 * 후보 집합 내에서 표준화해 가중합할 수 있게 한다.
 * 표준편차가 0이면 모두 0을 반환(정보 없음).
 */
export function zScores(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd < 1e-12) return values.map(() => 0);
  return values.map((v) => (v - mean) / sd);
}

/**
 * Herfindahl–Hirschman 지수: 플레이타임이 소수 게임에 얼마나 집중돼 있는지.
 * 1에 가까울수록 한 게임에 몰빵, 1/n에 가까울수록 고르게 즐김.
 */
export function herfindahlIndex(shares: readonly number[]): number {
  const total = shares.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return shares.reduce((a, b) => a + (b / total) ** 2, 0);
}

/**
 * 지수 시간 감쇠. halfLifeDays마다 절반으로, floor 밑으로는 내려가지 않는다.
 * 오래된 플레이 기록의 취향 기여를 줄이되 완전히 지우진 않는다.
 */
export function recencyDecay(lastPlayedUnixSec: number, nowMs: number, halfLifeDays = 730, floor = 0.35): number {
  if (!lastPlayedUnixSec || lastPlayedUnixSec <= 0) return floor; // 기록 없음 → 보수적으로 하한
  const ageDays = Math.max(0, (nowMs / 1000 - lastPlayedUnixSec) / 86400);
  return Math.max(floor, 2 ** (-ageDays / halfLifeDays));
}

/**
 * 평활화된 lift(PMI) — 동시보유 연관 통계량.
 *   lift = P(Y | anchor 표본) / P(Y | 전체)
 * add-s 평활화로 작은 표본의 분산 폭주를 억제한다. 양수면 기대치 초과.
 */
export function smoothedLogLift(coCount: number, sampleSize: number, baseRate: number, s = 1): number {
  if (sampleSize <= 0) return 0;
  const expected = sampleSize * Math.min(1, Math.max(baseRate, 1e-7));
  return Math.log((coCount + s) / (expected + s));
}

/** SteamSpy "20,000 .. 50,000" 형식의 소유자 구간 → 기하평균 추정치 */
export function parseOwnersMidpoint(owners: string): number {
  const nums = owners.match(/[\d,]+/g)?.map((x) => parseInt(x.replace(/,/g, ""), 10)).filter((x) => x > 0) ?? [];
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0];
  return Math.round(Math.sqrt(nums[0] * nums[1])); // 구간의 기하평균 (로그 스케일 중앙)
}
