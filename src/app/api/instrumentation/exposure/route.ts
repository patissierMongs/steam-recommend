import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { CONSENT_COOKIE, verifyConsentValue } from "@/lib/instrumentation/consent";
import { buildExposure, subjectId } from "@/lib/instrumentation/events";
import { getSink, instrumentationEnabled, instrumentationSalt } from "@/lib/instrumentation/sink";

const MAX_BODY_BYTES = 2048;

/**
 * 추천 카드가 실제로 화면에 들어온 뒤 클라이언트가 보내는 노출 확인.
 * 서버 수집이 켜져 있고, 로그인 본인이며, 그 계정의 동의가 유효할 때만 기록한다.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!instrumentationEnabled()) return new NextResponse(null, { status: 204 });

  const cookieStore = await cookies();
  const steamid = verifySessionValue(cookieStore.get(SESSION_COOKIE)?.value);
  if (!steamid || !verifyConsentValue(cookieStore.get(CONSENT_COOKIE)?.value, steamid)) {
    return new NextResponse(null, { status: 403 });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const exposure = buildExposure({
    subject: subjectId(steamid, instrumentationSalt()),
    exposedAt: new Date().toISOString(),
    input,
  });
  if (!exposure) return new NextResponse(null, { status: 400 });

  try {
    await getSink().recordExposure(exposure);
  } catch {
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
