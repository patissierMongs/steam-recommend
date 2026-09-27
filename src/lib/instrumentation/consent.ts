import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stage 1 수집 동의 — steamid에 바인딩된 HMAC 서명 쿠키 (docs/STAGE1_INSTRUMENTATION.md).
 *
 * 동의는 로그인한 본인 계정에만 적용되고, 값이 steamid를 포함·서명하므로 다른 계정
 * 세션으로 재사용할 수 없다. 철회는 쿠키 삭제로 즉시 반영된다(이후 수집 중단).
 * 기존 수집분 삭제는 배포용 저장소의 삭제 경로 몫이다.
 */

export const CONSENT_COOKIE = "instr_consent";
/** 동의 유효기간 — 만료 시 재동의 필요 (보존 창과 동일한 12개월) */
const CONSENT_MAX_AGE_SEC = 60 * 60 * 24 * 365;

function salt(): string {
  const s = process.env.INSTRUMENTATION_SALT || process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("INSTRUMENTATION_SALT 또는 SESSION_SECRET(16자 이상)이 필요합니다.");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", salt()).update(`consent:${payload}`).digest("base64url");
}

export function createConsentValue(steamid: string, nowMs = Date.now()): string {
  const expires = Math.floor(nowMs / 1000) + CONSENT_MAX_AGE_SEC;
  const payload = `${steamid}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

/** 해당 steamid의 유효한 동의면 true. 다른 계정·만료·변조는 전부 false. */
export function verifyConsentValue(
  value: string | undefined,
  steamid: string,
  nowMs = Date.now(),
): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [cookieSteamid, expiresStr, mac] = parts;
  if (cookieSteamid !== steamid || !/^\d{17}$/.test(cookieSteamid)) return false;
  const expires = parseInt(expiresStr, 10);
  if (!Number.isFinite(expires) || expires * 1000 < nowMs) return false;
  const expected = sign(`${cookieSteamid}.${expiresStr}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const consentCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: CONSENT_MAX_AGE_SEC,
} as const;
