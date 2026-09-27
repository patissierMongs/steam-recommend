import { beforeAll, describe, expect, it } from "vitest";
import { createSessionValue } from "@/lib/session";
import { createConsentValue, verifyConsentValue } from "./consent";

const STEAMID = "76561198000000001";
const OTHER = "76561198000000002";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-key-with-enough-length";
});

describe("consent cookie", () => {
  it("본인 steamid에만 유효하다", () => {
    const value = createConsentValue(STEAMID);
    expect(verifyConsentValue(value, STEAMID)).toBe(true);
    expect(verifyConsentValue(value, OTHER)).toBe(false); // 다른 계정으로 재사용 불가
  });

  it("변조·형식 오류·부재는 전부 거부", () => {
    const value = createConsentValue(STEAMID);
    expect(verifyConsentValue(value.slice(0, -2) + "xx", STEAMID)).toBe(false);
    const [, expires, mac] = value.split(".");
    expect(verifyConsentValue(`${OTHER}.${expires}.${mac}`, OTHER)).toBe(false);
    expect(verifyConsentValue(undefined, STEAMID)).toBe(false);
    expect(verifyConsentValue("a.b", STEAMID)).toBe(false);
  });

  it("만료되면 무효", () => {
    const past = Date.now() - 400 * 86400 * 1000;
    const value = createConsentValue(STEAMID, past);
    expect(verifyConsentValue(value, STEAMID)).toBe(false);
    expect(verifyConsentValue(value, STEAMID, past + 1000)).toBe(true);
  });

  it("세션 쿠키 값은 동의로 인정되지 않는다 (서명 도메인 분리)", () => {
    // 같은 비밀·같은 payload 구조라도 "consent:" 접두사로 MAC이 달라 쿠키 혼용이 안 된다
    expect(verifyConsentValue(createSessionValue(STEAMID), STEAMID)).toBe(false);
  });
});
