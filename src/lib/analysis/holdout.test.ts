import { describe, expect, it } from "vitest";
import type { GameFacts, OwnedGame } from "@/lib/types";
import { holdoutRecovery, leaveOneOutRecovery, topKPerTagByPlaytime } from "./holdout";

const NOW = Date.UTC(2026, 6, 1);
const RECENT = NOW / 1000 - 7 * 86400;

function facts(appid: number, name: string, over: Partial<GameFacts> = {}): GameFacts {
  return {
    appid, name, tags: {}, genres: [], positive: 1000, negative: 100,
    ownersEstimate: 500_000, medianPlaytime: 600, headerImage: "", shortDescription: "",
    releaseDate: "", comingSoon: false, isFree: false, priceFormatted: null,
    discountPercent: 0, developers: [], appType: "game", ...over,
  };
}
function owned(appid: number, name: string, minutes: number): OwnedGame {
  return { appid, name, playtime_forever: minutes, rtime_last_played: RECENT };
}

describe("topKPerTagByPlaytime", () => {
  it("각 태그에서 플레이타임 상위 2개를 뽑는다", () => {
    const lib = [owned(1, "A", 5000), owned(2, "B", 3000), owned(3, "C", 1000)];
    const fm = new Map<number, GameFacts>([
      [1, facts(1, "A", { tags: { Roguelike: 500 } })],
      [2, facts(2, "B", { tags: { Roguelike: 500 } })],
      [3, facts(3, "C", { tags: { Roguelike: 500 } })],
    ]);
    const held = topKPerTagByPlaytime(lib, fm, 2);
    expect(held.has(1)).toBe(true); // 5000
    expect(held.has(2)).toBe(true); // 3000
    expect(held.has(3)).toBe(false); // 1000 (3위)
  });
});

describe("holdoutRecovery — 복원 타당도", () => {
  // 로그라이크 4개(니치·저인기) + 농장 4개(대중·고인기). 태그별 top-2 홀드아웃 후,
  // 남은 게임으로 만든 모델이 숨긴 게임을 취향으로 복원하는가 (인기도보다 잘?).
  const lib: OwnedGame[] = [
    owned(1, "Rogue Hi1", 6000), owned(2, "Rogue Hi2", 5000),
    owned(3, "Rogue Lo1", 1200), owned(4, "Rogue Lo2", 900),
    owned(5, "Farm Hi1", 6000), owned(6, "Farm Hi2", 5000),
    owned(7, "Farm Lo1", 1200), owned(8, "Farm Lo2", 900),
  ];
  const fm = new Map<number, GameFacts>([
    // 로그라이크는 니치(저 owners)
    [1, facts(1, "Rogue Hi1", { tags: { Roguelike: 900, Difficult: 400 }, ownersEstimate: 60_000 })],
    [2, facts(2, "Rogue Hi2", { tags: { Roguelike: 800, Deckbuilder: 400 }, ownersEstimate: 80_000 })],
    [3, facts(3, "Rogue Lo1", { tags: { Roguelike: 700, Action: 300 }, ownersEstimate: 90_000 })],
    [4, facts(4, "Rogue Lo2", { tags: { Roguelike: 600, Indie: 300 }, ownersEstimate: 70_000 })],
    // 농장은 대중(고 owners)
    [5, facts(5, "Farm Hi1", { tags: { "Farming Sim": 900, Relaxing: 400 }, ownersEstimate: 8_000_000 })],
    [6, facts(6, "Farm Hi2", { tags: { "Farming Sim": 800, Cozy: 400 }, ownersEstimate: 9_000_000 })],
    [7, facts(7, "Farm Lo1", { tags: { "Farming Sim": 700, Crafting: 300 }, ownersEstimate: 7_000_000 })],
    [8, facts(8, "Farm Lo2", { tags: { "Farming Sim": 600, Building: 300 }, ownersEstimate: 6_000_000 })],
  ]);

  it("숨긴 게임을 남은 신호로 복원한다 (백분위 중앙값이 높음)", () => {
    const r = holdoutRecovery(lib, fm, [], NOW, 2);
    expect(r.heldOutCount).toBeGreaterThan(0);
    // 숨긴 게임(태그별 top-2)이 취향 순위에서 상위권에 복원됨
    expect(r.medianPercentile.taste).toBeGreaterThan(0.4);
  });

  it("취향이 인기도 베이스라인보다 니치 게임을 잘 복원한다", () => {
    const r = holdoutRecovery(lib, fm, [], NOW, 2);
    // 숨긴 니치 로그라이크는 인기도로는 하위(농장이 훨씬 인기)지만 취향으로는 복원됨
    const rogueHeld = r.perHeldOut.filter((h) => h.name.startsWith("Rogue"));
    for (const h of rogueHeld) {
      expect(h.tastePercentile).toBeGreaterThan(h.popularityPercentile);
    }
  });

  it("off-taste negative는 숨긴 게임보다 아래로 간다", () => {
    const negatives = [
      facts(100, "Racing Neg", { tags: { Racing: 900, Cars: 400 }, ownersEstimate: 500_000 }),
      facts(101, "Horror Neg", { tags: { Horror: 900, Gore: 400 }, ownersEstimate: 500_000 }),
    ];
    const r = holdoutRecovery(lib, fm, negatives, NOW, 2);
    // 숨긴 게임 백분위 중앙값이 여전히 상위 (negative가 풀에 섞여도)
    expect(r.medianPercentile.taste).toBeGreaterThan(0.4);
    expect(r.poolSize).toBe(8 + 2);
  });
});

describe("leaveOneOutRecovery — 모델 붕괴 없는 교정판", () => {
  // 일관 라이브러리: 로그라이크 6개(니치). 배치 홀드아웃은 태그 공유로 대부분을 제거하지만
  // LOO는 하나씩만 빼므로 모델이 유지되고, 니치 게임을 인기도보다 잘 복원해야 한다.
  const lib: OwnedGame[] = Array.from({ length: 6 }, (_, i) => owned(i + 1, `Rogue ${i + 1}`, 6000 - i * 500));
  const fm = new Map<number, GameFacts>(
    lib.map((g, i) => [
      g.appid,
      facts(g.appid, g.name, { tags: { Roguelike: 900 - i * 50, Difficult: 400 }, ownersEstimate: 50_000 + i * 5_000 }),
    ]),
  );
  // 미보유 negatives: 취향과 무관한 대중 게임
  const negatives = [
    facts(100, "Sports Neg", { tags: { Sports: 900 }, ownersEstimate: 10_000_000 }),
    facts(101, "Racing Neg", { tags: { Racing: 900 }, ownersEstimate: 9_000_000 }),
    facts(102, "Farm Neg", { tags: { "Farming Sim": 900 }, ownersEstimate: 8_000_000 }),
  ];

  it("LOO는 모델을 붕괴시키지 않고 숨긴 게임을 상위 복원한다", () => {
    const r = leaveOneOutRecovery(lib, fm, negatives, NOW, 2);
    expect(r.testedCount).toBeGreaterThan(0);
    expect(r.poolSize).toBe(6 + 3);
    // 숨긴 로그라이크가 대중 negative보다 위 → 취향 순위 상위
    expect(r.medianPercentile.taste).toBeGreaterThan(0.6);
    // 취향 MRR이 인기도 MRR보다 높다 (니치라 인기도로는 하위)
    expect(r.mrr.taste).toBeGreaterThan(r.mrr.popularity);
  });

  it("니치 복원 지표: 저인기 홀드아웃을 취향이 상위로 복원한다", () => {
    const r = leaveOneOutRecovery(lib, fm, negatives, NOW, 2);
    // 숨긴 로그라이크는 저인기(negative가 훨씬 인기)라 인기도로는 하위지만 취향으로 복원
    expect(r.nicheRecoveryPercentile).toBeGreaterThan(0.6);
    expect(r.tasteBeatsPopularity).toBeGreaterThan(0.5);
  });
});
