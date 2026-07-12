import { type NextRequest, NextResponse } from "next/server";
import { buildLoginUrl } from "@/lib/openid";

/** Steam OpenID 로그인 시작 — Steam 로그인 페이지로 보낸다 */
export function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin;
  return NextResponse.redirect(buildLoginUrl(base));
}
