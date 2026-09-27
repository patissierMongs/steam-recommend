import { type NextRequest, NextResponse } from "next/server";
import { resolveSteamId, SteamApiError } from "@/lib/steam/webapi";

/** 랜딩 폼(GET)의 프로필 입력을 SteamID64로 해석해 대시보드로 보낸다 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.redirect(new URL("/?error=empty", request.url));
  }
  try {
    const steamid = await resolveSteamId(q);
    if (!steamid) {
      return NextResponse.redirect(new URL(`/?error=notfound&q=${encodeURIComponent(q)}`, request.url));
    }
    return NextResponse.redirect(new URL(`/u/${steamid}`, request.url));
  } catch (err) {
    const code = err instanceof SteamApiError && err.kind === "no-key" ? "nokey" : "notfound";
    return NextResponse.redirect(new URL(`/?error=${code}`, request.url));
  }
}
