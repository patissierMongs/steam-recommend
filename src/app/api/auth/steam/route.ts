import { connection, type NextRequest, NextResponse } from "next/server";
import {
  appBaseUrl,
  buildLoginUrl,
  createLoginState,
  LOGIN_STATE_COOKIE,
  loginStateCookieOptions,
} from "@/lib/openid";

/** Steam OpenID 로그인 시작 — Steam 로그인 페이지로 보낸다 */
export async function GET(request: NextRequest) {
  // 요청 시점 실행 강제: 빌드 시 정적화되면 리다이렉트 URL이 빌드 환경에 고정된다
  await connection();
  const base = appBaseUrl(request.nextUrl.origin);
  const state = createLoginState();
  const response = NextResponse.redirect(buildLoginUrl(base, state));
  response.cookies.set({ name: LOGIN_STATE_COOKIE, value: state, ...loginStateCookieOptions });
  return response;
}
