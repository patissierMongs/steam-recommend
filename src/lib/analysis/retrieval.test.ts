import { describe, expect, it } from "vitest";
import type { CoplaySample } from "@/lib/steam/coplay";
import { aggregateCoplayCandidates } from "./retrieval";

function sample(anchorAppid: number, counts: [number, number][]): CoplaySample {
  return { anchorAppid, sampleSize: 20, counts: counts.map(([appid, count]) => ({ appid, count })) };
}

describe("aggregateCoplayCandidates", () => {
  const samples = [
    sample(1, [[100, 9], [200, 5], [300, 2]]),
    sample(2, [[100, 3], [300, 8], [400, 4]]),
    sample(3, [[300, 2], [500, 12]]),
  ];

  it("앵커 수 → 총 동시출현 → appid 순으로 결정적 정렬", () => {
    const out = aggregateCoplayCandidates(samples, new Set(), 10);
    // 300: 앵커 3 · 100: 앵커 2 · 500: 앵커 1(count 12) · 200: 앵커 1(count 5) · 400: 앵커 1(count 4)
    expect(out.map((c) => c.appid)).toEqual([300, 100, 500, 200, 400]);
    expect(out[0]).toEqual({ appid: 300, anchors: 3, totalCount: 12 });
    expect(out[1]).toEqual({ appid: 100, anchors: 2, totalCount: 12 });
  });

  it("보유 게임은 제외한다", () => {
    const out = aggregateCoplayCandidates(samples, new Set([300, 500]), 10);
    expect(out.map((c) => c.appid)).toEqual([100, 200, 400]);
  });

  it("cap을 넘지 않는다", () => {
    expect(aggregateCoplayCandidates(samples, new Set(), 2)).toHaveLength(2);
  });

  it("빈 입력은 빈 결과", () => {
    expect(aggregateCoplayCandidates([], new Set(), 10)).toEqual([]);
  });
});
