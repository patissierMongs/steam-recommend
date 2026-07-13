import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { TAG_HOLDOUT_PRIMARY_K, runTagHoldoutDiagnostic } from "./tag-holdout";

const NOW = Date.UTC(2026, 6, 13);

function owned(appid: number, minutes: number): OwnedGame {
  return {
    appid,
    name: `Game ${appid}`,
    playtime_forever: minutes,
    rtime_last_played: NOW / 1000 - 86400,
  };
}

function facts(
  appid: number,
  tags: Record<string, number>,
  over: Partial<GameFacts> = {},
): GameFacts {
  return {
    appid,
    name: `Game ${appid}`,
    tags,
    genres: [],
    positive: 1000,
    negative: 50,
    ownersEstimate: 100_000,
    medianPlaytime: 600,
    headerImage: "",
    shortDescription: "",
    releaseDate: "",
    comingSoon: false,
    isFree: false,
    priceFormatted: null,
    discountPercent: 0,
    developers: [],
    appType: "game",
    ...over,
  };
}

function fixture() {
  const library = [
    owned(1, 1000),
    owned(2, 900),
    owned(3, 800),
    owned(4, 700),
    owned(5, 600),
    owned(6, 500),
    owned(7, 400),
  ];
  const profileFacts = new Map<number, GameFacts>([
    [1, facts(1, { RPG: 500, Action: 400, HeldoutOnly: 300, Sparse: 100 })],
    [2, facts(2, { RPG: 500, HeldoutOnly: 300 })],
    [3, facts(3, { RPG: 500 })],
    [4, facts(4, { RPG: 500 })],
    [5, facts(5, { Action: 500 })],
    [6, facts(6, { Action: 500 })],
    [7, facts(7, { Action: 500 })],
  ]);
  const candidates = [
    facts(100, { RPG: 300 }),
    facts(101, { Puzzle: 300 }),
    facts(102, { RPG: 300 }, { appType: "dlc" }),
    facts(103, { RPG: 300 }, { appType: null }),
  ];
  return { library, profileFacts, candidates };
}

function run(
  library: OwnedGame[],
  profileFacts: Map<number, GameFacts>,
  candidates: GameFacts[],
  featured = new Set<number>(),
) {
  return runTagHoldoutDiagnostic(library, profileFacts, candidates, featured, NOW, 40);
}

describe("tag holdout diagnostic", () => {
  it("태그별 raw 플레이타임 상위 2개와 3~4위 대조군을 독립 마스킹한다", () => {
    const { library, profileFacts, candidates } = fixture();
    const report = run(library, profileFacts, candidates, new Set([1, 100]));

    expect(report.eligibleTags).toBe(2);
    expect(report.folds.find((fold) => fold.tag === "RPG")?.heldout.map((game) => game.appid)).toEqual([
      1, 2,
    ]);
    expect(
      report.lowerPlayControl.folds
        .find((fold) => fold.tag === "RPG")
        ?.heldout.map((game) => game.appid),
    ).toEqual([3, 4]);
    expect(report.folds.find((fold) => fold.tag === "Action")?.heldout.map((game) => game.appid)).toEqual([
      1, 5,
    ]);
    expect(
      report.lowerPlayControl.folds
        .find((fold) => fold.tag === "Action")
        ?.heldout.map((game) => game.appid),
    ).toEqual([6, 7]);
    expect(report.foldTargetObservations).toBe(4);
    expect(report.uniqueHeldoutGames).toBe(3);
    expect(report.lowerPlayControl.foldTargetObservations).toBe(4);
  });

  it("합집합 stress arm은 support 하한 없이 모든 관측 태그를 문자 그대로 포함한다", () => {
    const { library, profileFacts, candidates } = fixture();
    profileFacts.get(7)!.tags.RareSingle = 200;
    const report = run(library, profileFacts, candidates);

    expect(report.unionStress.maskedTags).toBe(report.observedTags);
    expect(report.unionStress.heldout.map((game) => game.appid)).toContain(7);
    expect(report.skippedTags).toContainEqual({ tag: "RareSingle", support: 1 });
  });

  it("마스킹한 게임을 owned, IDF, 프로필에서 다시 만들지 않는다", () => {
    const { library, profileFacts, candidates } = fixture();
    const report = run(library, profileFacts, candidates);
    const rpg = report.folds.find((fold) => fold.tag === "RPG")!;

    // HeldoutOnly는 숨긴 1, 2에만 있으므로 남은 profile tag 수에 포함되지 않는다.
    expect(rpg.residualProfileTags).toBe(2);
    expect(rpg.retainedSupport).toBe(2);
  });

  it("support 4 미만 태그는 primary 성공/실패로 세지 않고 보류한다", () => {
    const { library, profileFacts, candidates } = fixture();
    const report = run(library, profileFacts, candidates);

    expect(report.skippedTags).toContainEqual({ tag: "HeldoutOnly", support: 2 });
    expect(report.skippedTags).toContainEqual({ tag: "Sparse", support: 1 });
  });

  it("후보군에는 Store-confirmed game만 남기고 숨긴 표적은 평가용으로 강제 삽입한다", () => {
    const { library, profileFacts, candidates } = fixture();
    const report = run(library, profileFacts, candidates, new Set([1]));
    const rpg = report.folds.find((fold) => fold.tag === "RPG")!;

    expect(report.baseCandidateGames).toBe(2);
    expect(rpg.oracleCandidateCount).toBe(4);
    expect(rpg.candidateCount).toBe(4);
    expect(rpg.heldout[0].listedInCurrentFeaturedFeed).toBe(true);
    expect(rpg.heldout[1].listedInCurrentFeaturedFeed).toBe(false);
    expect(rpg.heldout.every((game) => game.forcedIntoOraclePool)).toBe(true);
  });

  it("네 랭커가 태그·리뷰·인기도 complete-case의 정확히 같은 후보를 순위화한다", () => {
    const { library, profileFacts, candidates } = fixture();
    candidates.push(
      facts(104, {}),
      facts(105, { RPG: 100 }, { positive: 0, negative: 0 }),
      facts(106, { RPG: 100 }, { ownersEstimate: 0 }),
    );
    const report = run(library, profileFacts, candidates);
    const rpg = report.folds.find((fold) => fold.tag === "RPG")!;

    expect(rpg.oracleCandidateCount).toBe(7);
    expect(rpg.signalCoverage).toEqual({ tag: 6, review: 6, popularity: 6, completeCase: 4 });
    expect(Object.keys(rpg.rankers).sort()).toEqual([
      "combined",
      "popularityOnly",
      "reviewOnly",
      "tagOnly",
    ]);
    expect(
      Object.values(rpg.rankers).every(
        (ranker) => ranker.rankedCandidates === rpg.candidateCount,
      ),
    ).toBe(true);
    expect(rpg.heldout.every((game) => game.ranks.popularityOnly !== null)).toBe(true);
  });

  it("complete-case에서 빠진 표적을 삭제하지 않고 coverage 실패와 random 분모에 남긴다", () => {
    const { library, profileFacts, candidates } = fixture();
    profileFacts.get(1)!.ownersEstimate = 0;
    const report = run(library, profileFacts, candidates);
    const rpg = report.folds.find((fold) => fold.tag === "RPG")!;
    const randomAt12 = rpg.random.find((metric) => metric.k === TAG_HOLDOUT_PRIMARY_K)!;

    expect(rpg.completeCaseTargets).toBe(1);
    expect(rpg.targetCoverage).toBe(0.5);
    expect(rpg.heldout[0].missingSignals).toEqual(["popularity"]);
    expect(Object.values(rpg.heldout[0].ranks).every((rank) => rank === null)).toBe(true);
    expect(rpg.rankers.combined.relevantCount).toBe(2);
    expect(rpg.rankers.combined.rankedRelevant).toBe(1);
    // K가 후보 전체를 훑어도 실제 complete-case에 남은 표적은 1/2뿐이다.
    expect(randomAt12.expectedRecall).toBe(0.5);
  });

  it("N <= K는 포화로 표시하고 macro 주 지표에서 판정을 보류한다", () => {
    const { library, profileFacts, candidates } = fixture();
    const report = run(library, profileFacts, candidates);
    const rpg = report.folds.find((fold) => fold.tag === "RPG")!;
    const foldMetric = rpg.rankers.combined.atK.find(
      (metric) => metric.k === TAG_HOLDOUT_PRIMARY_K,
    )!;
    const macroMetric = report.macro[0].atK.find(
      (metric) => metric.k === TAG_HOLDOUT_PRIMARY_K,
    )!;

    expect(foldMetric.effectiveK).toBe(4);
    expect(foldMetric.saturated).toBe(true);
    expect(macroMetric.informativeFolds).toBe(0);
    expect(macroMetric.meanRecall).toBeNull();
    expect(report.randomMacro.find((metric) => metric.k === 12)?.meanExpectedRecall).toBeNull();
  });

  it("N > K인 distractor pool에서만 K macro를 정보성 값으로 계산한다", () => {
    const { library, profileFacts, candidates } = fixture();
    for (let appid = 200; appid < 220; appid++) candidates.push(facts(appid, { Puzzle: 100 }));
    const report = run(library, profileFacts, candidates);
    const primary = report.macro[0].atK.find((metric) => metric.k === 12)!;

    expect(primary.informativeFolds).toBe(report.eligibleTags);
    expect(primary.saturatedFolds).toBe(0);
    expect(primary.meanRecall).not.toBeNull();
  });

  it("비포화 fold에서도 결측 표적을 random·Recall·NDCG 분모에서 삭제하지 않는다", () => {
    const { library, profileFacts, candidates } = fixture();
    profileFacts.get(1)!.ownersEstimate = 0;
    for (let appid = 200; appid < 220; appid++) candidates.push(facts(appid, { Puzzle: 100 }));
    const report = run(library, profileFacts, candidates);
    const rpg = report.folds.find((fold) => fold.tag === "RPG")!;
    const metric = rpg.rankers.popularityOnly.atK.find((row) => row.k === 12)!;
    const random = rpg.random.find((row) => row.k === 12)!;

    expect(rpg.candidateCount).toBe(23);
    expect(rpg.completeCaseTargets).toBe(1);
    expect(metric.saturated).toBe(false);
    expect(random.expectedRecall).toBeCloseTo(12 / (23 * 2), 10);
    expect(random.anyHitProbability).toBeCloseTo(12 / 23, 10);
    expect(metric.recall).toBe(0.5);
    expect(metric.ndcg).toBeLessThan(1);
    expect(report.macro[0].atK.find((row) => row.k === 12)?.informativeFolds).toBe(
      report.eligibleTags,
    );
  });

  it("입력 순서와 플레이타임 동률에도 appid 기준으로 두 arm과 fingerprint가 재현된다", () => {
    const { library, profileFacts, candidates } = fixture();
    library[0].playtime_forever = 900;
    const forward = run(library, profileFacts, candidates);
    const reverse = run(
      [...library].reverse(),
      new Map([...profileFacts].reverse()),
      [...candidates].reverse(),
    );

    const ids = (report: typeof forward, arm: "top" | "control") =>
      (arm === "top" ? report.folds : report.lowerPlayControl.folds)
        .find((fold) => fold.tag === "RPG")!
        .heldout.map((game) => game.appid);
    expect(ids(forward, "top")).toEqual([1, 2]);
    expect(ids(reverse, "top")).toEqual(ids(forward, "top"));
    expect(ids(reverse, "control")).toEqual(ids(forward, "control"));
    expect(reverse.macro).toEqual(forward.macro);
    expect(reverse.profileEvidenceFingerprint).toBe(forward.profileEvidenceFingerprint);
    expect(reverse.candidateMetadataFingerprint).toBe(forward.candidateMetadataFingerprint);
  });

  it("순위를 바꾸는 표적 메타데이터와 featured app ID 변화가 fingerprint에 남는다", () => {
    const { library, profileFacts, candidates } = fixture();
    const before = run(library, profileFacts, candidates, new Set([1, 100]));
    profileFacts.get(1)!.positive += 1;
    profileFacts.get(1)!.ownersEstimate += 1;
    const metadataChanged = run(library, profileFacts, candidates, new Set([1, 100]));
    const feedChanged = run(library, profileFacts, candidates, new Set([2, 100]));

    expect(metadataChanged.profileEvidenceFingerprint).not.toBe(
      before.profileEvidenceFingerprint,
    );
    expect(metadataChanged.candidateMetadataFingerprint).toBe(
      before.candidateMetadataFingerprint,
    );
    expect(feedChanged.featuredAppIdFingerprint).not.toBe(
      metadataChanged.featuredAppIdFingerprint,
    );
  });

  it("숨긴 표적의 플레이타임·recency는 fold 선택 뒤 ranker 점수에 누출되지 않는다", () => {
    const { library, profileFacts, candidates } = fixture();
    const before = run(library, profileFacts, candidates);
    library[0] = { ...library[0], playtime_forever: 1100, rtime_last_played: NOW / 1000 };
    library[1] = { ...library[1], playtime_forever: 950, rtime_last_played: 1 };
    const after = run(library, profileFacts, candidates);

    const ranks = (report: typeof before) =>
      report.folds.find((fold) => fold.tag === "RPG")!.heldout.map((game) => game.ranks);
    expect(ranks(after)).toEqual(ranks(before));
  });

  it("양수 태그 vote가 없는 항목은 evidence와 관측 태그 coverage를 부풀리지 않는다", () => {
    const { library, profileFacts, candidates } = fixture();
    library.push(owned(8, 650));
    profileFacts.set(8, facts(8, { Zero: 0, Negative: -1 }));
    const report = run(library, profileFacts, candidates);

    expect(report.evidenceGames).toBe(7);
    expect(report.skippedTags.some(({ tag }) => tag === "Zero" || tag === "Negative")).toBe(false);
  });
});
