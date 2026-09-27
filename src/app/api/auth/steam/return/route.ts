import { type NextRequest, NextResponse } from "next/server";
import { appBaseUrl, LOGIN_STATE_COOKIE, loginStateCookieOptions, verifyCallback } from "@/lib/openid";
import { createSessionValue, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

/** Steam OpenID 콜백 — 서명 검증 후 세션 쿠키를 심고 대시보드로 보낸다 */
export async function GET(request: NextRequest) {
  const base = appBaseUrl(request.nextUrl.origin);
  let steamid: string | null = null;
  try {
    steamid = await verifyCallback(
      request.nextUrl.searchParams,
      base,
      request.cookies.get(LOGIN_STATE_COOKIE)?.value,
    );
  } catch {
    steamid = null;
  }
  const response = NextResponse.redirect(new URL(steamid ? `/u/${steamid}` : "/?error=login", request.url));
  response.cookies.set({ name: LOGIN_STATE_COOKIE, value: "", ...loginStateCookieOptions, maxAge: 0 });
  if (!steamid) return response;
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionValue(steamid),
    ...sessionCookieOptions,
  });
  return response;
}
