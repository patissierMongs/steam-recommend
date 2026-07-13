import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { buildTasteModel, engagementWeight, summarizeTaste, tfidfVector } from "./taste";
import { rankBacklog, rankHiddenGems, rankLapsed, rankNewReleases } from "./recommend";

const NOW = Date.UTC(2026, 6, 1);
const RECENT = NOW / 1000 - 7 * 86400;

function facts(appid: number, name: string, over: Partial<GameFacts> = {}): GameFacts {
  return {
    appid,
    name,
    tags: {},
    genres: [],
    positive: 1000,
    negative: 100,
    ownersEstimate: 500_000,
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

function owned(appid: number, name: string, minutes: number, lastPlayed = RECENT): OwnedGame {
  return { appid, name, playtime_forever: minutes, rtime_last_played: lastPlayed };
}

/** 로그라이크 기록 2개와 스포츠 기록 1개가 있는 합성 라이브러리 */
const library: OwnedGame[] = [
  owned(1, "Rogue A", 6000),
  owned(2, "Rogue B", 3000),
  owned(3, "Sports C", 90),
  owned(10, "Backlog Roguelike", 0),
  owned(11, "Backlog Sports", 0),
  owned(12, "Backlog Puzzle", 10),
];

const factsMap = new Map<number, GameFacts>([
  [1, facts(1, "Rogue A", { tags: { Roguelike: 900, Action: 500, Indie: 300 } })],
  [2, facts(2, "Rogue B", { tags: { Roguelike: 700, Deckbuilder: 400, Indie: 250 } })],
  [3, facts(3, "Sports C", { tags: { Sports: 800, Casual: 300 } })],
  [10, facts(10, "Backlog Roguelike", { tags: { Roguelike: 600, Deckbuilder: 300 }, positive: 5000, negative: 200 })],
  [11, facts(11, "Backlog Sports", { tags: { Sports: 700, Casual: 400 }, positive: 5000, negative: 200 })],
  [12, facts(12, "Backlog Puzzle", { tags: { Puzzle: 500, Casual: 300 }, positive: 300, negative: 200 })],
]);

function modelForRoguelike() {
  const lib = [owned(901, "Rogue", 1200)];
  const fm = new Map([[901, facts(901, "Rogue", { tags: { Roguelike: 500 } })]]);
  return buildTasteModel(lib, fm, NOW);
}

describe("engagementWeight", () => {
  it("30분 미만은 태그 프로필 근거로 쓰지 않는다", () => {
    expect(engagementWeight(owned(9, "x", 20), facts(9, "x"), NOW)).toBe(0);
  });

  it("플레이타임이 길수록 커지되 선형보다 완만하다", () => {
    const short = engagementWeight(owned(9, "x", 120), facts(9, "x"), NOW);
    const long = engagementWeight(owned(9, "x", 6000), facts(9, "x"), NOW);
    expect(long).toBeGreaterThan(short);
    expect(long / short).toBeLessThan(6000 / 120);
  });

  it("오래된 관측은 감쇠된다", () => {
    const recent = engagementWeight(owned(9, "x", 600, RECENT), facts(9, "x"), NOW);
    const stale = engagementWeight(
      owned(9, "x", 600, NOW / 1000 - 5 * 365 * 86400),
      facts(9, "x"),
      NOW,
    );
    expect(stale).toBeLessThan(recent);
  });

  it("최근 플레이 시각 결측은 오래된 기록으로 간주하지 않는다", () => {
    const missing = engagementWeight(owned(9, "x", 600, 0), facts(9, "x"), NOW);
    const observedNow = engagementWeight(owned(9, "x", 600, NOW / 1000), facts(9, "x"), NOW);
    expect(missing).toBeCloseTo(observedNow, 10);
  });
});

describe("buildTasteModel + rankBacklog", () => {
  const model = buildTasteModel(library, factsMap, NOW);

  it("최다 플레이 태그가 프로필 상위에 온다", () => {
    expect(model.topTags[0]?.tag).toBe("Roguelike");
  });

  it("태그가 가까운 백로그를 불일치 후보보다 위에 둔다", () => {
    const names = rankBacklog(model, library, factsMap).map((r) => r.name);
    expect(names.indexOf("Backlog Roguelike")).toBeLessThan(names.indexOf("Backlog Sports"));
    expect(names).not.toContain("Rogue A");
  });

  it("근거 배지용 공통 태그를 제공한다", () => {
    const top = rankBacklog(model, library, factsMap).find((r) => r.name === "Backlog Roguelike");
    expect(top?.breakdown.matchedTags).toContain("Roguelike");
  });
});

describe("태그 프로필 입력 안정성", () => {
  it("태그가 없는 플레이 기록은 profile을 채우지 않는다", () => {
    const lib = [owned(1, "Tagless", 600)];
    const model = buildTasteModel(lib, new Map([[1, facts(1, "Tagless", { tags: {} })]]), NOW);
    expect(model.engagementWeights.size).toBe(1);
    expect(model.profile.size).toBe(0);
  });

  it("태그 없는 플레이 기록은 태그 문서 수와 프로필 가중치를 바꾸지 않는다", () => {
    const tagged = owned(1, "Tagged", 600);
    const tagless = owned(2, "Tagless", 600);
    const taggedFacts = facts(1, "Tagged", { tags: { Roguelike: 500, Action: 200 } });
    const taglessFacts = facts(2, "Tagless", { tags: {} });
    const withoutTagless = buildTasteModel([tagged], new Map([[1, taggedFacts]]), NOW);
    const withTagless = buildTasteModel(
      [tagged, tagless],
      new Map([
        [1, taggedFacts],
        [2, taglessFacts],
      ]),
      NOW,
    );
    expect(Object.fromEntries(withTagless.idf)).toEqual(Object.fromEntries(withoutTagless.idf));
    expect(Object.fromEntries(withTagless.profile)).toEqual(Object.fromEntries(withoutTagless.profile));
  });

  it("0 이하 vote 태그는 IDF 문서 빈도에 포함하지 않는다", () => {
    const model = buildTasteModel(
      [owned(1, "A", 600), owned(2, "B", 600)],
      new Map([
        [1, facts(1, "A", { tags: { Roguelike: 500 } })],
        [2, facts(2, "B", { tags: { Action: 300, Ghost: 0, Negative: -1 } })],
      ]),
      NOW,
    );
    expect(model.idf.has("Ghost")).toBe(false);
    expect(model.idf.has("Negative")).toBe(false);
  });

  it("모든 vote가 0 이하인 기록은 tagless 기록처럼 IDF corpus를 바꾸지 않는다", () => {
    const tagged = owned(1, "Tagged", 600);
    const nonpositive = owned(2, "Nonpositive", 600);
    const taggedFacts = facts(1, "Tagged", { tags: { Roguelike: 500 } });
    const withoutNonpositive = buildTasteModel([tagged], new Map([[1, taggedFacts]]), NOW);
    const withNonpositive = buildTasteModel(
      [tagged, nonpositive],
      new Map([
        [1, taggedFacts],
        [2, facts(2, "Nonpositive", { tags: { Ghost: 0, Negative: -1 } })],
      ]),
      NOW,
    );
    expect(Object.fromEntries(withNonpositive.idf)).toEqual(
      Object.fromEntries(withoutNonpositive.idf),
    );
    expect(withNonpositive.unseenIdf).toBe(withoutNonpositive.unseenIdf);
    expect(Object.fromEntries(withNonpositive.profile)).toEqual(
      Object.fromEntries(withoutNonpositive.profile),
    );
  });

  it("미플레이 백로그 메타데이터가 플레이 기록 IDF와 프로필을 바꾸지 않는다", () => {
    const played = owned(1, "Played", 600);
    const backlog = owned(2, "Bundle Backlog", 0);
    const playedFacts = facts(1, "Played", { tags: { Roguelike: 500, Action: 200 } });
    const backlogFacts = facts(2, "Bundle Backlog", { tags: { Action: 900, Casual: 800 } });
    const withoutBacklog = buildTasteModel([played], new Map([[1, playedFacts]]), NOW);
    const withBacklog = buildTasteModel(
      [played, backlog],
      new Map([
        [1, playedFacts],
        [2, backlogFacts],
      ]),
      NOW,
    );
    expect(Object.fromEntries(withBacklog.idf)).toEqual(Object.fromEntries(withoutBacklog.idf));
    expect(Object.fromEntries(withBacklog.profile)).toEqual(Object.fromEntries(withoutBacklog.profile));
  });

  it("확인된 비게임과 타입 미확인 앱은 플레이 프로필에서 보류한다", () => {
    const lib = [
      owned(1, "Game", 600),
      owned(2, "Benchmark", 6000),
      owned(3, "Unknown", 6000),
    ];
    const model = buildTasteModel(
      lib,
      new Map([
        [1, facts(1, "Game", { tags: { Roguelike: 500 }, appType: "game" })],
        [2, facts(2, "Benchmark", { tags: { Utilities: 900 }, appType: "software" })],
        [3, facts(3, "Unknown", { tags: { Benchmark: 900 }, appType: null })],
      ]),
      NOW,
    );
    expect([...model.engagementWeights.keys()]).toEqual([1]);
    expect(model.profile.has("Roguelike")).toBe(true);
    expect(model.profile.has("Utilities")).toBe(false);
    expect(model.profile.has("Benchmark")).toBe(false);
  });

  it("프로필에서 못 본 후보 태그는 smoothed unseen IDF로 광범위 매칭을 감점한다", () => {
    const lib = [owned(1, "A", 600), owned(2, "B", 600)];
    const model = buildTasteModel(
      lib,
      new Map([
        [1, facts(1, "A", { tags: { Roguelike: 500 }, appType: "game" })],
        [2, facts(2, "B", { tags: { Roguelike: 500 }, appType: "game" })],
      ]),
      NOW,
    );
    const vector = tfidfVector(
      facts(3, "Broad Candidate", { tags: { Roguelike: 100, Unseen: 100 } }),
      model.idf,
      model.unseenIdf,
    );
    expect(model.unseenIdf).toBeCloseTo(Math.log(3) + 1, 10);
    expect(vector.get("Unseen")!).toBeGreaterThan(vector.get("Roguelike")!);
  });
});

describe("rankNewReleases 결측 신호 처리", () => {
  const model = buildTasteModel(library, factsMap, NOW);

  it("리뷰 결측은 중립: 높은 하한 > 리뷰없음 > 확인된 낮은 하한", () => {
    const highQ = facts(200, "High Q", { tags: { Roguelike: 500 }, positive: 4000, negative: 100 });
    const lowQ = facts(201, "Low Q", { tags: { Roguelike: 500 }, positive: 60, negative: 240 });
    const noReviews = facts(202, "No Reviews", { tags: { Roguelike: 500 }, positive: 0, negative: 0 });
    const recs = rankNewReleases(model, [highQ, lowQ, noReviews], new Set());
    expect(recs.map((r) => r.name)).toEqual(["High Q", "No Reviews", "Low Q"]);
    expect(recs.find((r) => r.name === "No Reviews")?.breakdown.reviewLowerBound).toBeNull();
  });

  it("태그 결측은 중립: 일치 > 태그없음 > 확인된 불일치", () => {
    const matching = facts(210, "Matching", { tags: { Roguelike: 500 } });
    const missing = facts(211, "Missing Tags", { tags: {} });
    const mismatch = facts(212, "Mismatch", { tags: { Farming: 500 } });
    const names = rankNewReleases(model, [matching, missing, mismatch], new Set()).map((r) => r.name);
    expect(names).toEqual(["Matching", "Missing Tags", "Mismatch"]);
  });

  it("태그와 리뷰가 모두 없으면 근거 없는 추천을 만들지 않는다", () => {
    const unknown = facts(213, "Unknown", { tags: {}, positive: 0, negative: 0 });
    expect(rankNewReleases(model, [unknown], new Set())).toEqual([]);
  });

  it("태그 프로필이 비어도 확인된 리뷰 축은 독립적으로 작동한다", () => {
    const emptyModel = buildTasteModel([], new Map(), NOW);
    const highQ = facts(214, "High Q", { tags: {}, positive: 4000, negative: 100 });
    const lowQ = facts(215, "Low Q", { tags: {}, positive: 60, negative: 240 });
    const recs = rankNewReleases(emptyModel, [lowQ, highQ], new Set());
    expect(recs.map((rec) => rec.name)).toEqual(["High Q", "Low Q"]);
    expect(recs.every((rec) => rec.breakdown.tasteMatch === null)).toBe(true);
  });

  it("소유자 수는 일반 랭킹에 영향을 주지 않는다", () => {
    const niche = facts(203, "Niche", { tags: { Roguelike: 500 }, ownersEstimate: 30_000 });
    const popular = facts(204, "Popular", { tags: { Roguelike: 500 }, ownersEstimate: 20_000_000 });
    const recs = rankNewReleases(model, [niche, popular], new Set());
    expect(recs[0].score).toBeCloseTo(recs[1].score, 10);
  });

  it("동점 순위는 후보 입력 순서가 아니라 appid로 재현된다", () => {
    const a = facts(301, "A", { tags: { Roguelike: 500 } });
    const b = facts(300, "B", { tags: { Roguelike: 500 } });
    const forward = rankNewReleases(model, [a, b], new Set()).map((rec) => rec.appid);
    const reverse = rankNewReleases(model, [b, a], new Set()).map((rec) => rec.appid);
    expect(forward).toEqual([300, 301]);
    expect(reverse).toEqual(forward);
  });
});

describe("rankLapsed 중앙값 변환", () => {
  it("중앙값 변환 여부와 무관하게 배지는 원시 태그 코사인을 표시한다", () => {
    const game = owned(300, "Lapsed", 600, NOW / 1000 - 365 * 86400);
    const unknownMedian = facts(300, "Lapsed", { tags: { Roguelike: 500 }, medianPlaytime: 0 });
    const knownMedian = facts(301, "Lapsed Known", { tags: { Roguelike: 500 }, medianPlaytime: 600 });
    const knownGame = owned(301, "Lapsed Known", 600, NOW / 1000 - 365 * 86400);
    const model = modelForRoguelike();
    const lapsed = rankLapsed(model, [game], new Map([[300, unknownMedian]]), NOW);
    const lapsedKnown = rankLapsed(model, [knownGame], new Map([[301, knownMedian]]), NOW);
    const candidate = rankNewReleases(model, [unknownMedian], new Set());
    expect(lapsed[0].breakdown.tasteMatch).toBeCloseTo(candidate[0].breakdown.tasteMatch!, 10);
    expect(lapsedKnown[0].breakdown.tasteMatch).toBeCloseTo(candidate[0].breakdown.tasteMatch!, 10);
  });
});

describe("summarizeTaste", () => {
  it("기본 기술통계가 맞는다", () => {
    const summary = summarizeTaste(library, factsMap, buildTasteModel(library, factsMap, NOW));
    expect(summary.totalGames).toBe(6);
    expect(summary.neverPlayed).toBe(2);
    expect(summary.playedGames).toBe(3);
    expect(summary.totalHours).toBe(Math.round((6000 + 3000 + 90 + 10) / 60));
    expect(summary.genreAnalyzedGames).toBe(0);
  });

  it("장르 분포와 coverage는 실제 프로필 근거 게임만 반영한다", () => {
    const played = owned(1, "Played", 600);
    const backlog = owned(2, "Backlog", 0);
    const fm = new Map([
      [1, facts(1, "Played", { tags: { Roguelike: 500 }, genres: ["RPG"] })],
      [2, facts(2, "Backlog", { tags: { Casual: 900 }, genres: ["Casual"] })],
    ]);
    const summary = summarizeTaste([played, backlog], fm, buildTasteModel([played, backlog], fm, NOW));
    expect(summary.genreAnalyzedGames).toBe(1);
    expect(summary.genreShares).toEqual([{ genre: "RPG", share: 1 }]);
  });
});

describe("rankHiddenGems", () => {
  const model = buildTasteModel(library, factsMap, NOW);
  const ownedIds = new Set(library.map((g) => g.appid));

  it("보유 게임·대형 히트작·근거 부족 후보를 제외한다", () => {
    const candidates = [
      facts(100, "Popular Hit", { tags: { Roguelike: 900 }, ownersEstimate: 20_000_000, positive: 90000, negative: 3000 }),
      facts(101, "Hidden Gem", { tags: { Roguelike: 500, Deckbuilder: 200 }, ownersEstimate: 80_000, positive: 900, negative: 40 }),
      facts(102, "Off Profile", { tags: { Farming: 700 }, ownersEstimate: 80_000, positive: 900, negative: 40 }),
      facts(10, "Owned", { tags: { Roguelike: 600 }, ownersEstimate: 80_000 }),
      facts(103, "Too Few Reviews", { tags: { Roguelike: 400 }, ownersEstimate: 50_000, positive: 5, negative: 1 }),
    ];
    const names = rankHiddenGems(model, candidates, ownedIds).map((game) => game.name);
    expect(names).toContain("Hidden Gem");
    expect(names).not.toContain("Popular Hit");
    expect(names).not.toContain("Owned");
    expect(names).not.toContain("Too Few Reviews");
    expect(names).not.toContain("Off Profile");
  });
});
