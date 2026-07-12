import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { buildTasteModel, preferenceWeight, summarizeTaste } from "./taste";
import { rankBacklog, rankHiddenGems } from "./recommend";

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
