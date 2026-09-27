import { describe, expect, it } from "vitest";
import type { AppDetails } from "@/lib/types";
import { pickAppEntry } from "./appdata";

const data = (steam_appid: number) => ({ steam_appid, name: "x", type: "game" }) as AppDetails;

describe("pickAppEntry", () => {
  it("요청 appid 키가 있으면 그 항목을 쓴다", () => {
    const body = { "620": { success: true, data: data(620) } };
    expect(pickAppEntry(body, 620)?.data?.steam_appid).toBe(620);
  });

  it("키가 달라도 단일 항목의 steam_appid가 요청과 같으면 쓴다", () => {
    const body = { "323180": { success: true, data: data(620) } };
    expect(pickAppEntry(body, 620)?.data?.steam_appid).toBe(620);
  });

  it("키와 steam_appid가 모두 다르면 다른 앱으로 보고 버린다", () => {
    const body = { "323180": { success: true, data: data(323180) } };
    expect(pickAppEntry(body, 620)).toBeUndefined();
  });

  it("빈 본문은 undefined", () => {
    expect(pickAppEntry(null, 620)).toBeUndefined();
    expect(pickAppEntry({}, 620)).toBeUndefined();
  });
});
