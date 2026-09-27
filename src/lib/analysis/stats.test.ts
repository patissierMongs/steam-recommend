import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  herfindahlIndex,
  parseOwnersMidpoint,
  recencyDecay,
  smoothedLogLift,
  wilsonLowerBound,
  zScores,
} from "./stats";

describe("wilsonLowerBound", () => {
  it("표본이 없으면 0", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("소표본 100% 긍정보다 대표본 93% 긍정이 위 (표본 크기 보정)", () => {
    const small = wilsonLowerBound(10, 10); // 100%, n=10
    const large = wilsonLowerBound(4650, 5000); // 93%, n=5000
    expect(small).toBeCloseTo(0.722, 2);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeCloseTo(0.9226, 3);
  });

  it("같은 비율이면 표본이 클수록 하한이 올라간다", () => {
    expect(wilsonLowerBound(90, 100)).toBeLessThan(wilsonLowerBound(900, 1000));
  });

  it("0..1 범위를 벗어나지 않는다", () => {
    expect(wilsonLowerBound(0, 50)).toBeGreaterThanOrEqual(0);
    expect(wilsonLowerBound(50, 50)).toBeLessThan(1);
  });
});

describe("cosineSimilarity", () => {
  const v = (o: Record<string, number>) => new Map(Object.entries(o));

  it("동일 벡터는 1", () => {
    expect(cosineSimilarity(v({ a: 2, b: 3 }), v({ a: 2, b: 3 }))).toBeCloseTo(1, 10);
  });

  it("직교 벡터는 0", () => {
    expect(cosineSimilarity(v({ a: 1 }), v({ b: 1 }))).toBe(0);
  });

  it("빈 벡터는 0", () => {
    expect(cosineSimilarity(v({}), v({ a: 1 }))).toBe(0);
  });

  it("스케일 불변", () => {
    const a = v({ x: 1, y: 2 });
    const b = v({ x: 10, y: 20 });
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });
});

describe("zScores", () => {
  it("평균 0, 표준편차 1로 정규화", () => {
    const z = zScores([1, 2, 3, 4, 5]);
    const mean = z.reduce((a, b) => a + b, 0) / z.length;
    expect(mean).toBeCloseTo(0, 10);
    expect(Math.max(...z)).toBeCloseTo(-Math.min(...z), 10);
  });

  it("모두 같은 값이면 전부 0 (정보 없음)", () => {
    expect(zScores([3, 3, 3])).toEqual([0, 0, 0]);
  });

  it("빈 배열은 빈 배열", () => {
    expect(zScores([])).toEqual([]);
  });
});

describe("herfindahlIndex", () => {
  it("한 게임 몰빵이면 1", () => {
    expect(herfindahlIndex([100, 0, 0])).toBe(1);
  });

  it("균등 분산이면 1/n", () => {
    expect(herfindahlIndex([10, 10, 10, 10])).toBeCloseTo(0.25, 10);
  });

  it("플레이타임이 없으면 0", () => {
    expect(herfindahlIndex([])).toBe(0);
    expect(herfindahlIndex([0, 0])).toBe(0);
  });
});

describe("recencyDecay", () => {
  const now = Date.UTC(2026, 0, 1);

  it("방금 플레이한 게임은 1", () => {
    expect(recencyDecay(now / 1000, now)).toBeCloseTo(1, 5);
  });

  it("반감기(2년) 지나면 절반", () => {
    const twoYearsAgo = now / 1000 - 730 * 86400;
    expect(recencyDecay(twoYearsAgo, now)).toBeCloseTo(0.5, 5);
  });

  it("아주 오래돼도 하한(0.35) 밑으로 안 내려간다", () => {
    const tenYearsAgo = now / 1000 - 3650 * 86400;
    expect(recencyDecay(tenYearsAgo, now)).toBe(0.35);
  });

  it("기록이 없으면 감쇠를 추론하지 않는다", () => {
    expect(recencyDecay(0, now)).toBe(1);
  });
});

describe("smoothedLogLift", () => {
  it("기대치와 같으면 ≈ 0", () => {
    // 표본 20명 중 2명, 기저율 10% → 기대 2명
    expect(smoothedLogLift(2, 20, 0.1)).toBeCloseTo(0, 5);
  });

  it("기대보다 많으면 양수, 적으면 음수", () => {
    expect(smoothedLogLift(10, 20, 0.1)).toBeGreaterThan(0);
    expect(smoothedLogLift(0, 20, 0.5)).toBeLessThan(0);
  });

  it("평활화: 기저율이 0에 가까워도 폭주하지 않는다", () => {
    const lift = smoothedLogLift(3, 20, 1e-9);
    expect(Number.isFinite(lift)).toBe(true);
    expect(lift).toBeLessThan(10); // log((3+1)/(~0+1)) ≈ 1.39
  });
});

describe("parseOwnersMidpoint", () => {
  it("구간의 기하평균", () => {
    // sqrt(20000 * 50000) ≈ 31623
    expect(parseOwnersMidpoint("20,000 .. 50,000")).toBe(31623);
  });

  it("단일 값", () => {
    expect(parseOwnersMidpoint("1,000,000")).toBe(1_000_000);
  });

  it("0에서 시작하는 최하위 구간은 산술 중앙값", () => {
    expect(parseOwnersMidpoint("0 .. 20,000")).toBe(10_000);
    expect(parseOwnersMidpoint("0 .. 0")).toBe(0);
  });

  it("파싱 불가면 0", () => {
    expect(parseOwnersMidpoint("")).toBe(0);
    expect(parseOwnersMidpoint("unknown")).toBe(0);
  });
});
