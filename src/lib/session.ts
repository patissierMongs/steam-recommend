import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 최소 세션: `steamid.만료시각.HMAC` 형태의 서명 쿠키 값.
 * 저장할 상태가 SteamID 하나뿐이라 JWT/세션스토어 대신 HMAC-SHA256 서명으로 충분하다.
 */

export const SESSION_COOKIE = "steam_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30일

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET 환경 변수(16자 이상)가 필요합니다. .env.local을 확인하세요.");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionValue(steamid: string, nowMs = Date.now()): string {
  const expires = Math.floor(nowMs / 1000) + MAX_AGE_SEC;
  const payload = `${steamid}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

/** 유효하면 steamid, 아니면 null */
export function verifySessionValue(value: string | undefined, nowMs = Date.now()): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [steamid, expiresStr, mac] = parts;
  if (!/^\d{17}$/.test(steamid)) return null;
  const expires = parseInt(expiresStr, 10);
  if (!Number.isFinite(expires) || expires * 1000 < nowMs) return null;
  const expected = sign(`${steamid}.${expiresStr}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return steamid;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SEC,
} as const;
