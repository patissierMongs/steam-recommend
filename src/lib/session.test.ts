import { beforeAll, describe, expect, it } from "vitest";
import { createSessionValue, verifySessionValue } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-key-with-enough-length";
});

describe("session sign/verify", () => {
  const STEAMID = "76561197960434622";

  it("생성한 세션 값을 검증할 수 있다", () => {
    const value = createSessionValue(STEAMID);
    expect(verifySessionValue(value)).toBe(STEAMID);
  });

  it("서명 변조를 거부한다", () => {
    const value = createSessionValue(STEAMID);
    expect(verifySessionValue(value.slice(0, -2) + "xx")).toBeNull();
  });

  it("steamid 변조를 거부한다", () => {
    const value = createSessionValue(STEAMID);
    const tampered = "76561197960434623" + value.slice(STEAMID.length);
    expect(verifySessionValue(tampered)).toBeNull();
  });

  it("만료된 세션을 거부한다", () => {
    const past = Date.now() - 40 * 86400 * 1000; // 40일 전 발급 (만료 30일)
    const value = createSessionValue(STEAMID, past);
    expect(verifySessionValue(value)).toBeNull();
    expect(verifySessionValue(value, past + 1000)).toBe(STEAMID);
  });

  it("형식이 다른 값을 거부한다", () => {
    expect(verifySessionValue(undefined)).toBeNull();
    expect(verifySessionValue("")).toBeNull();
    expect(verifySessionValue("abc.def")).toBeNull();
    expect(verifySessionValue("notanid.123.mac")).toBeNull();
  });
});
