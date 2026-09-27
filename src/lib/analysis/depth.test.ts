import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { averageRanks, buildDepthProfile, spearman } from "./depth";

function facts(partial: Partial<GameFacts> & { appid: number }): GameFacts {
  return {
    name: `g${partial.appid}`,
    tags: {},
    genres: [],
    positive: 0,
    negative: 0,
    ownersEstimate: 0,
    medianPlaytime: 0,
    headerImage: "",
    shortDescription: "",
    releaseDate: "",
    comingSoon: false,
    isFree: false,
    priceFormatted: null,
    discountPercent: 0,
    developers: [],
    appType: "game",
    ...partial,
  };
}

function owned(appid: number, minutes: number): OwnedGame {
  return { appid, name: `g${appid}`, playtime_forever: minutes };
}

describe("averageRanks", () => {
  it("동점은 평균 순위를 받는다", () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe("spearman", () => {
  it("단조 증가 = 1, 단조 감소 = -1", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
  });

  it("표본 3 미만 또는 한쪽 전부 동점이면 null (정의 불가)", () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
  });
});

describe("buildDepthProfile", () => {
  const factsMap = new Map<number, GameFacts>([
    // 깊이 플레이한 저인지 게임: 기준점 100분 vs 800분, 소유자 1만
    [1, facts({ appid: 1, ownersEstimate: 10_000, positive: 90, negative: 10, developers: ["IndieDev"] })],
    // 얕게 끝난 고인지 게임: 기준점 400분 vs 50분, 소유자 500만
    [2, facts({ appid: 2, ownersEstimate: 5_000_000, positive: 900, negative: 100, developers: ["BigDev"] })],
    // 기준점 미상 → 깊이 제외, 개발사/리뷰 집계에는 포함
    [3, facts({ appid: 3, ownersEstimate: 20_000, positive: 50, negative: 50, developers: ["IndieDev", "BigDev"] })],
    // 비게임 → 전부 제외
    [4, facts({ appid: 4, appType: "software", positive: 10, negative: 0 })],
    // 미실행 백로그 (리뷰 있음) → launchReviewGap의 unplayed 쪽
    [5, facts({ appid: 5, ownersEstimate: 30_000, positive: 400, negative: 100 })],
  ]);
  // 리뷰 작성자 표본 중앙값 — 3번은 표본 부족(0), 4번은 있어도 비게임이라 무시돼야 함
  const medians = new Map<number, number>([
    [1, 100],
    [2, 400],
    [3, 0],
    [4, 100],
    [5, 100],
  ]);
  const library: OwnedGame[] = [
    owned(1, 800),
    owned(2, 50),
    owned(3, 60),
    owned(4, 999),
    owned(5, 0),
  ];
  const profile = buildDepthProfile(library, factsMap, medians);

  it("깊이 점은 확인된 게임 + 근거 + 기준점 확보 항목만", () => {
    expect(profile.points.map((p) => p.appid).sort()).toEqual([1, 2]);
  });

  it("logRatio = log2(내 시간 / 기준점)", () => {
    const p1 = profile.points.find((p) => p.appid === 1)!;
    expect(p1.logRatio).toBeCloseTo(3); // 800/100 = 8 = 2^3
    const p2 = profile.points.find((p) => p.appid === 2)!;
    expect(p2.logRatio).toBeCloseTo(-3); // 50/400 = 1/8
  });

  it("사분면: 저인지·깊이 vs 고인지·얕음, 분할점은 라이브러리 소유자 중앙값", () => {
    expect(profile.ownersSplit).toBeCloseTo((10_000 + 5_000_000) / 2);
    expect(profile.deepNiche.map((p) => p.appid)).toEqual([1]);
    expect(profile.shallowMainstream.map((p) => p.appid)).toEqual([2]);
  });

  it("shareAboveNorm과 medianLogRatio는 깊이 점 기준", () => {
    expect(profile.shareAboveNorm).toBeCloseTo(0.5);
    expect(profile.medianLogRatio).toBeCloseTo(0);
  });

  it("launchReviewGap: 실행(1,2,3) vs 미실행(5) 리뷰 하한 중앙값", () => {
    const gap = profile.launchReviewGap!;
    expect(gap.nPlayed).toBe(3);
    expect(gap.nUnplayed).toBe(1);
    expect(gap.unplayedMedianWlb).toBeGreaterThan(0.7); // 400/500 긍정
  });

  it("개발사 집중: 복수 개발사는 균등 분할, 비게임 제외", () => {
    const indie = profile.developerShares.find((d) => d.developer === "IndieDev")!;
    const big = profile.developerShares.find((d) => d.developer === "BigDev")!;
    expect(indie.minutes).toBeCloseTo(800 + 30); // g1 전체 + g3 절반
    expect(big.minutes).toBeCloseTo(50 + 30);
    expect(profile.developerTotalMinutes).toBe(800 + 50 + 60);
    expect(indie.games).toBe(2);
  });

  it("리뷰-깊이 상관은 표본 3 미만이면 null", () => {
    expect(profile.reviewDepthCorr).toBeNull(); // 깊이 점 2개뿐
  });
});
