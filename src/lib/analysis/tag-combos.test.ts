import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { buildTagComboProfile, MIN_PAIR_SUPPORT } from "./tag-combos";

function facts(appid: number, tags: string[], appType = "game"): GameFacts {
  return {
    appid,
    name: `g${appid}`,
    tags: Object.fromEntries(tags.map((t) => [t, 100])),
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

function owned(appid: number, minutes = 600): OwnedGame {
  return { appid, name: `g${appid}`, playtime_forever: minutes };
}

describe("buildTagComboProfile", () => {
  // 8게임 corpus: "Action"은 전부(광역), "Roguelike"+"Deckbuilder"는 3게임에서 함께,
  // "Farming"은 2게임(지지도 미달 쌍), 나머지는 단독 출현.
  const lib = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => owned(i, 600 + i));
  const factsMap = new Map<number, GameFacts>([
    [1, facts(1, ["Action", "Roguelike", "Deckbuilder"])],
    [2, facts(2, ["Action", "Roguelike", "Deckbuilder"])],
    [3, facts(3, ["Action", "Roguelike", "Deckbuilder"])],
    [4, facts(4, ["Action", "Farming", "Cozy"])],
    [5, facts(5, ["Action", "Farming"])],
    [6, facts(6, ["Action", "Horror"])],
    [7, facts(7, ["Action", "Racing"])],
    [8, facts(8, ["Action", "Sports"])],
  ]);
  const profile = buildTagComboProfile(lib, factsMap);

  it("corpus 과반 태그는 광역으로 쌍에서 제외되고 공개된다", () => {
    expect(profile.broadTags).toEqual(["Action"]);
    expect(profile.combos.every((c) => c.tagA !== "Action" && c.tagB !== "Action")).toBe(true);
  });

  it("독립 기대를 초과해 함께 나타나는 쌍이 잡힌다", () => {
    const top = profile.combos[0];
    expect([top.tagA, top.tagB].sort()).toEqual(["Deckbuilder", "Roguelike"]);
    expect(top.support).toBe(3);
    expect(top.logLift).toBeGreaterThan(0);
    expect(top.games).toHaveLength(3);
  });

  it("지지도 하한 미만 쌍은 표시하지 않는다", () => {
    expect(MIN_PAIR_SUPPORT).toBe(3);
    expect(
      profile.combos.some((c) => [c.tagA, c.tagB].sort().join("+") === "Cozy+Farming"),
    ).toBe(false);
  });

  it("게임 예시는 플레이타임 내림차순", () => {
    const top = profile.combos[0];
    expect(top.games).toEqual(["g3", "g2", "g1"]);
  });

  it("미실행·비게임·태그 없음은 corpus에서 제외", () => {
    const withNoise = [...lib, owned(9, 5), owned(10, 900), owned(11, 900)];
    const noisyFacts = new Map(factsMap);
    noisyFacts.set(9, facts(9, ["Roguelike", "Deckbuilder"])); // 5분 — 근거 미달
    noisyFacts.set(10, facts(10, ["Roguelike", "Deckbuilder"], "software")); // 비게임
    noisyFacts.set(11, facts(11, [])); // 태그 없음
    const p = buildTagComboProfile(withNoise, noisyFacts);
    expect(p.corpusSize).toBe(8);
  });

  it("태그 이름의 공백이 쌍 분리를 깨지 않는다", () => {
    const lib2 = [1, 2, 3, 4, 5, 6].map((i) => owned(i));
    const f2 = new Map<number, GameFacts>([
      [1, facts(1, ["Open World", "Base Building"])],
      [2, facts(2, ["Open World", "Base Building"])],
      [3, facts(3, ["Open World", "Base Building"])],
      [4, facts(4, ["Horror"])],
      [5, facts(5, ["Racing"])],
      [6, facts(6, ["Sports"])],
    ]);
    const p = buildTagComboProfile(lib2, f2);
    const top = p.combos[0];
    expect([top.tagA, top.tagB].sort()).toEqual(["Base Building", "Open World"]);
  });
});
