import Image from "next/image";
import { cookies } from "next/headers";
import { getLibrary, getProfile } from "@/lib/analysis/pipeline";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { SteamApiError } from "@/lib/steam/webapi";
import { isDemoId } from "@/lib/demo";

const PERSONA_STATE = ["오프라인", "온라인", "바쁨", "자리 비움", "수면", "거래 희망", "플레이 희망"];

export async function ProfileHeader({ steamid }: { steamid: string }) {
  // 프로필 요약은 키 없이도 커뮤니티 XML로 동작한다 — 라이브러리 실패와 독립적으로 표시.
  const profile = await getProfile(steamid).catch(() => null);
  if (!profile) return null;

  // 게임 수는 라이브러리(키 필요)가 있으면 곁들이고, 없으면 생략.
  let gameCount: number | null = null;
  try {
    gameCount = (await getLibrary(steamid))?.length ?? null;
  } catch (err) {
    if (!(err instanceof SteamApiError)) throw err; // 키 없음/비공개 등은 헤더에서 무시
  }
  const cookieStore = await cookies();
  const isSelf = verifySessionValue(cookieStore.get(SESSION_COOKIE)?.value) === steamid;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-edge bg-surface p-5">
      <Image
        src={profile.avatarfull}
        alt={`${profile.personaname} 아바타`}
        width={72}
        height={72}
        className="rounded-lg border border-edge"
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold">{profile.personaname}</h1>
        <p className="mt-0.5 text-xs text-muted">
          {PERSONA_STATE[profile.personastate] ?? "오프라인"}
          {gameCount !== null ? ` · 라이브러리 항목 ${gameCount.toLocaleString()}개` : ""}
          {isDemoId(steamid) ? null : (
            <>
              {" · "}
              <a
                href={profile.profileurl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Steam 프로필 ↗
              </a>
            </>
          )}
        </p>
        {isDemoId(steamid) ? (
          <p className="mt-2 inline-block rounded-md border border-accent/40 bg-background px-2 py-1 text-[11px] text-accent">
            데모 모드 · 가상 라이브러리입니다. 게임 메타데이터·리뷰만 Steam 공개 데이터를 사용합니다.
          </p>
        ) : null}
      </div>
      {isSelf ? (
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="rounded-lg border border-edge px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-foreground"
          >
            로그아웃
          </button>
        </form>
      ) : null}
    </div>
  );
}
