import { describe, expect, it } from "vitest";
import { buildDemoLibrary, isDemoId, isProfileParam } from "./demo";

describe("demo", () => {
  it("demo 식별자와 SteamID64만 프로필 경로로 허용한다", () => {
    expect(isDemoId("demo")).toBe(true);
    expect(isProfileParam("demo")).toBe(true);
    expect(isProfileParam("76561197960434622")).toBe(true);
    expect(isProfileParam("Demo")).toBe(false);
    expect(isProfileParam("1234")).toBe(false);
  });

  it("가상 라이브러리는 기준 시각에 대해 결정적이고 백로그·휴면·고플레이 구간을 모두 포함한다", () => {
    const now = Date.UTC(2026, 0, 1);
    const lib = buildDemoLibrary(now);
    expect(buildDemoLibrary(now)).toEqual(lib);
    expect(new Set(lib.map((g) => g.appid)).size).toBe(lib.length);
    expect(lib.some((g) => g.playtime_forever < 120)).toBe(true);
    const lapsedCutoff = now / 1000 - 180 * 86400;
    expect(
      lib.some(
        (g) =>
          g.playtime_forever >= 120 &&
          g.playtime_forever <= 2400 &&
          (g.rtime_last_played ?? 0) > 0 &&
          (g.rtime_last_played ?? 0) < lapsedCutoff,
      ),
    ).toBe(true);
    expect(lib.filter((g) => g.playtime_forever >= 30).length).toBeGreaterThanOrEqual(12);
    expect(lib.every((g) => (g.rtime_last_played ?? 0) <= now / 1000)).toBe(true);
  });
});
