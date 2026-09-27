import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { buildPairModel, pairKey, scorePairOnly } from "./pair-model";

const NOW = Date.UTC(2026, 6, 13);

function owned(appid: number, minutes: number): OwnedGame {
  return { appid, name: `g${appid}`, playtime_forever: minutes, rtime_last_played: NOW / 1000 - 86400 };
}

function facts(appid: number, tags: Record<string, number>, appType = "game"): GameFacts {
  return {
    appid,
    name: `g${appid}`,
    tags,
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
    appType,
  };
}

describe("buildPairModel", () => {
  const lib = [owned(1, 600), owned(2, 600), owned(3, 600), owned(4, 600)];
  const factsMap = new Map<number, GameFacts>([
    [1, facts(1, { Action: 100, Roguelike: 100, Deckbuilder: 100 })],
    [2, facts(2, { Action: 100, Roguelike: 100, Deckbuilder: 100 })],
    [3, facts(3, { Action: 100, Horror: 100 })],
    [4, facts(4, { Action: 100, Racing: 100 })],
  ]);
  const model = buildPairModel(lib, factsMap, NOW);

  it("과반 출현 태그는 광역으로 제외되고 쌍은 비광역 태그에서만 나온다", () => {
    expect(model.broadTags.has("Action")).toBe(true); // 4/4
    expect(model.profile.has(pairKey("Roguelike", "Deckbuilder"))).toBe(true);
    expect([...model.profile.keys()].some((k) => k.includes("Action"))).toBe(false);
  });

  it("쌍 점수: 프로필과 같은 조합 후보 > 무관 조합 후보", () => {
    const match = scorePairOnly(model, facts(100, { Roguelike: 50, Deckbuilder: 50 }));
    const unrelated = scorePairOnly(model, facts(101, { Puzzle: 50, Sports: 50 }));
    expect(match).toBeGreaterThan(0.9);
    expect(unrelated).toBe(0);
  });

  it("비광역 태그가 2개 미만이면 null (0점이 아니라 보류)", () => {
    expect(scorePairOnly(model, facts(102, { Action: 50, Horror: 50 }))).toBeNull(); // Action 광역 → 1개
    expect(scorePairOnly(model, facts(103, { Horror: 50 }))).toBeNull();
  });

  it("쌍이 전혀 없는 corpus면 프로필이 비고 모든 점수가 null", () => {
    const single = new Map<number, GameFacts>([
      [1, facts(1, { RPG: 100 })],
      [2, facts(2, { Action: 100 })],
    ]);
    const empty = buildPairModel([owned(1, 600), owned(2, 600)], single, NOW);
    expect(empty.profile.size).toBe(0);
    expect(scorePairOnly(empty, facts(100, { Roguelike: 50, Deckbuilder: 50 }))).toBeNull();
  });
});
