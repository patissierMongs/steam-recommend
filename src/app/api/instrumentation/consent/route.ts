import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import {
  CONSENT_COOKIE,
  consentCookieOptions,
  createConsentValue,
} from "@/lib/instrumentation/consent";

/**
 * Stage 1 수집 동의 부여/철회 — 로그인한 본인 계정에만 적용된다.
 * 동의 상태는 steamid에 바인딩된 서명 쿠키로만 저장한다(서버 저장 없음).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const steamid = verifySessionValue(cookieStore.get(SESSION_COOKIE)?.value);
  if (!steamid) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const form = await req.formData();
  const action = form.get("action");
  const redirectTo = new URL(`/u/${steamid}`, req.url);
  const response = NextResponse.redirect(redirectTo, 303);

  if (action === "grant") {
    response.cookies.set(CONSENT_COOKIE, createConsentValue(steamid), consentCookieOptions);
  } else if (action === "revoke") {
    response.cookies.delete(CONSENT_COOKIE);
  } else {
    return NextResponse.json({ error: "action은 grant 또는 revoke여야 합니다." }, { status: 400 });
  }
  return response;
}
