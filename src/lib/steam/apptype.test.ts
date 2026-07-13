import { describe, expect, it } from "vitest";
import { isGameType } from "./apptype";

describe("isGameType", () => {
  it("게임 본편은 통과", () => {
    expect(isGameType("game")).toBe(true);
  });

  it("DLC/데모/사운드트랙 등 비-게임은 제외", () => {
    expect(isGameType("dlc")).toBe(false);
    expect(isGameType("demo")).toBe(false);
    expect(isGameType("music")).toBe(false);
    expect(isGameType("video")).toBe(false);
  });

  it("대소문자 무관", () => {
    expect(isGameType("DLC")).toBe(false);
    expect(isGameType("Dlc")).toBe(false);
  });

  it("타입 미확인(null)은 통과 — best-effort (상점 장애 시 섹션이 비지 않도록)", () => {
    expect(isGameType(null)).toBe(true);
  });
});
