import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { buildTasteModel } from "./taste";
import { backlogEligible, lapsedEligible, rankBacklog, rankLapsed } from "./recommend";

const NOW = Date.UTC(2026, 6, 13);

function owned(appid: number, minutes: number, lastPlayed?: number): OwnedGame {
  return { appid, name: `g${appid}`, playtime_forever: minutes, rtime_last_played: lastPlayed };
}

function facts(appid: number, over: Partial<GameFacts> = {}): GameFacts {
  return {
    appid,
    name: `g${appid}`,
    tags: { RPG: 100, Roguelike: 50 },
    genres: [],
    positive: 500,
    negative: 50,
    ownersEstimate: 10_000,
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
    ...over,
  };
}

/**
 * Stage 1 impression의 candidate universe는 랭커와 같은 술어를 써야 한다 —
 * 랭커 출력이 universe의 부분집합임을 고정한다 (risk set 오염 방지).
 */
describe("ranker/universe consistency", () => {
  const oldPlay = NOW / 1000 - 400 * 86400;
  const library: OwnedGame[] = [
    owned(1, 0), // 백로그
    owned(2, 60, oldPlay), // 백로그 (2시간 미만)
    owned(3, 600, oldPlay), // lapsed (오래됨)
    owned(4, 600, NOW / 1000 - 86400), // 최근 플레이 → lapsed 아님
    owned(5, 5000, oldPlay), // 40시간 초과 → lapsed 아님
    owned(6, 90), // facts 없음 → 둘 다 제외
  ];
  const factsMap = new Map<number, GameFacts>([
    [1, facts(1)],
    [2, facts(2)],
    [3, facts(3)],
    [4, facts(4)],
    [5, facts(5)],
    // 6은 의도적으로 누락
  ]);
  const model = buildTasteModel(library, factsMap, NOW);

  it("rankBacklog 출력 ⊆ backlogEligible universe", () => {
    const universe = new Set(
      library.filter((g) => backlogEligible(g, factsMap.get(g.appid))).map((g) => g.appid),
    );
    expect(universe).toEqual(new Set([1, 2]));
    for (const rec of rankBacklog(model, library, factsMap)) {
      expect(universe.has(rec.appid)).toBe(true);
    }
  });

  it("rankLapsed 출력 ⊆ lapsedEligible universe", () => {
    const universe = new Set(
      library.filter((g) => lapsedEligible(g, factsMap.get(g.appid), NOW)).map((g) => g.appid),
    );
    expect(universe).toEqual(new Set([3]));
    for (const rec of rankLapsed(model, library, factsMap, NOW)) {
      expect(universe.has(rec.appid)).toBe(true);
    }
  });

  it("적격성: facts 없음·비게임은 제외", () => {
    expect(backlogEligible(owned(6, 90), undefined)).toBe(false);
    expect(backlogEligible(owned(7, 90), facts(7, { appType: "dlc" }))).toBe(false);
    expect(lapsedEligible(owned(8, 600, oldPlay), facts(8, { appType: "music" }), NOW)).toBe(false);
    // 마지막 실행 기록 없음(0/undefined) → lapsed 판정 불가
    expect(lapsedEligible(owned(9, 600, 0), facts(9), NOW)).toBe(false);
    expect(lapsedEligible(owned(10, 600), facts(10), NOW)).toBe(false);
  });
});
