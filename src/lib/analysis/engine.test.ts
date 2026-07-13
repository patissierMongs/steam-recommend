import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { buildTasteModel, preferenceWeight, summarizeTaste } from "./taste";
import { rankBacklog, rankHiddenGems, rankNewReleases } from "./recommend";

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

/** 로그라이크 헤비 유저: 로그라이크 2개를 오래, 스포츠 1개를 짧게 */
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

describe("preferenceWeight", () => {
  it("30분 미만은 취향 증거가 아니다", () => {
    expect(preferenceWeight(owned(9, "x", 20), facts(9, "x"), NOW)).toBe(0);
  });

  it("플레이타임이 길수록 커진다 (log 감쇠)", () => {
    const short = preferenceWeight(owned(9, "x", 120), facts(9, "x"), NOW);
    const long = preferenceWeight(owned(9, "x", 6000), facts(9, "x"), NOW);
    expect(long).toBeGreaterThan(short);
    expect(long / short).toBeLessThan(6000 / 120); // 선형보다 완만
  });

  it("오래 안 한 게임은 감쇠된다", () => {
    const recent = preferenceWeight(owned(9, "x", 600, RECENT), facts(9, "x"), NOW);
    const stale = preferenceWeight(owned(9, "x", 600, NOW / 1000 - 5 * 365 * 86400), facts(9, "x"), NOW);
    expect(stale).toBeLessThan(recent);
  });
});

describe("buildTasteModel + rankBacklog", () => {
  const model = buildTasteModel(library, factsMap, NOW);

  it("최다 플레이 태그가 프로필 상위에 온다", () => {
    expect(model.topTags[0]?.tag).toBe("Roguelike");
  });

  it("백로그 추천이 취향(로그라이크)을 스포츠보다 위에 둔다", () => {
    const recs = rankBacklog(model, library, factsMap);
    const names = recs.map((r) => r.name);
    expect(names.indexOf("Backlog Roguelike")).toBeLessThan(names.indexOf("Backlog Sports"));
    // 플레이 중인 게임은 백로그에 없다
    expect(names).not.toContain("Rogue A");
  });

  it("근거 배지용 매칭 태그를 제공한다", () => {
    const recs = rankBacklog(model, library, factsMap);
    const top = recs.find((r) => r.name === "Backlog Roguelike");
    expect(top?.breakdown.matchedTags).toContain("Roguelike");
  });
});

describe("태그 없는 팩트 → 취향 벡터 비어있음 (장애 판정 근거)", () => {
  it("팩트는 있지만 태그가 없으면 profile은 비고 preferenceWeights만 채워진다", () => {
    const lib: OwnedGame[] = [owned(1, "Tagless", 600)];
    const tagless = new Map<number, GameFacts>([[1, facts(1, "Tagless", { tags: {} })]]);
    const model = buildTasteModel(lib, tagless, NOW);
    // 이 불일치가 degraded 판정을 preferenceWeights가 아닌 profile 기준으로 해야 하는 이유
    expect(model.preferenceWeights.size).toBe(1);
    expect(model.profile.size).toBe(0);
  });
});

describe("rankNewReleases 리뷰 없는 후보는 확인된 품질 후보를 이기지 못한다", () => {
  const model = buildTasteModel(library, factsMap, NOW);
  // 리뷰 있는 후보가 2개 이상이어도(저품질 z < -0.5여도) 리뷰 없음은 최저여야 한다
  it("동일 취향에서 고품질 > 저품질 > 리뷰없음 순 (WLB 0 정책)", () => {
    const highQ = facts(200, "High Q", { tags: { Roguelike: 500 }, positive: 4000, negative: 100 });
    const lowQ = facts(201, "Low Q", { tags: { Roguelike: 500 }, positive: 60, negative: 240 }); // 20% 긍정
    const noRev = facts(202, "No Reviews", { tags: { Roguelike: 500 }, positive: 0, negative: 0 });
    const recs = rankNewReleases(model, [highQ, lowQ, noRev], new Set());
    const names = recs.map((r) => r.name);
    expect(names).toEqual(["High Q", "Low Q", "No Reviews"]);
    // 리뷰 없는 후보의 품질은 null로 표기(가짜 퍼센트 없음)
    expect(recs.find((r) => r.name === "No Reviews")?.breakdown.quality).toBeNull();
    // 확인된 저품질(WLB>0)은 리뷰 없음보다 위 — 이것이 -0.5 센티넬이 못 주던 보장
    expect(names.indexOf("Low Q")).toBeLessThan(names.indexOf("No Reviews"));
  });
});

describe("summarizeTaste", () => {
  it("기본 통계가 맞는다", () => {
    const model = buildTasteModel(library, factsMap, NOW);
    const s = summarizeTaste(library, factsMap, model);
    expect(s.totalGames).toBe(6);
    expect(s.neverPlayed).toBe(2); // playtime 0인 게임
    expect(s.playedGames).toBe(3); // 30분 이상 (10분짜리 Backlog Puzzle 제외)
    expect(s.totalHours).toBe(Math.round((6000 + 3000 + 90 + 10) / 60));
  });
});

describe("rankHiddenGems", () => {
  const model = buildTasteModel(library, factsMap, NOW);
  const ownedIds = new Set(library.map((g) => g.appid));

  it("보유 게임과 대형 히트작을 제외하고, 취향 맞는 소품을 고른다", () => {
    const candidates = [
      facts(100, "Popular Hit", { tags: { Roguelike: 900 }, ownersEstimate: 20_000_000, positive: 90000, negative: 3000 }),
      facts(101, "Hidden Gem", { tags: { Roguelike: 500, Deckbuilder: 200 }, ownersEstimate: 80_000, positive: 900, negative: 40 }),
      facts(102, "Off Taste", { tags: { Farming: 700 }, ownersEstimate: 80_000, positive: 900, negative: 40 }),
      facts(10, "Owned", { tags: { Roguelike: 600 }, ownersEstimate: 80_000 }),
      facts(103, "Too Few Reviews", { tags: { Roguelike: 400 }, ownersEstimate: 50_000, positive: 5, negative: 1 }),
    ];
    const gems = rankHiddenGems(model, candidates, ownedIds);
    const names = gems.map((g) => g.name);
    expect(names).toContain("Hidden Gem");
    expect(names).not.toContain("Popular Hit"); // 소유자 200만 초과
    expect(names).not.toContain("Owned");
    expect(names).not.toContain("Too Few Reviews"); // 리뷰 30개 미만
    if (names.includes("Off Taste")) {
      expect(names.indexOf("Hidden Gem")).toBeLessThan(names.indexOf("Off Taste"));
    }
  });
});
