import { describe, expect, it } from "vitest";
import { isGameType, isPotentialGameType } from "./apptype";

describe("isGameType", () => {
  it("게임 본편은 통과", () => {
    expect(isGameType("game")).toBe(true);
  });

  it("DLC/데모/사운드트랙 등 비-게임은 제외", () => {
    expect(isGameType("dlc")).toBe(false);
    expect(isGameType("demo")).toBe(false);
    expect(isGameType("music")).toBe(false);
    expect(isGameType("video")).toBe(false);
    expect(isGameType("software")).toBe(false);
    expect(isGameType("application")).toBe(false);
    expect(isGameType("tool")).toBe(false);
    expect(isGameType("unknown-future-type")).toBe(false);
  });

  it("대소문자 무관", () => {
    expect(isGameType("DLC")).toBe(false);
    expect(isGameType("Dlc")).toBe(false);
  });

  it("타입 미확인(null)은 표시하지 않되 확인 전 후보 단계에서만 잠정 유지", () => {
    expect(isGameType(null)).toBe(false);
    expect(isPotentialGameType(null)).toBe(true);
    expect(isPotentialGameType("software")).toBe(false);
  });
});
