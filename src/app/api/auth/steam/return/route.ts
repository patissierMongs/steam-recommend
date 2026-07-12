import { type NextRequest, NextResponse } from "next/server";
import { verifyCallback } from "@/lib/openid";
import { createSessionValue, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

/** Steam OpenID 콜백 — 서명 검증 후 세션 쿠키를 심고 대시보드로 보낸다 */
export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin;
  let steamid: string | null = null;
  try {
    steamid = await verifyCallback(request.nextUrl.searchParams, base);
  } catch {
    steamid = null;
  }
  if (!steamid) {
    return NextResponse.redirect(new URL("/?error=login", request.url));
  }
  const response = NextResponse.redirect(new URL(`/u/${steamid}`, request.url));
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionValue(steamid),
    ...sessionCookieOptions,
  });
  return response;
}
