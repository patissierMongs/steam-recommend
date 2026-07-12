import Image from "next/image";
import { cookies } from "next/headers";
import { getLibrary, getProfile } from "@/lib/analysis/pipeline";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { SteamApiError } from "@/lib/steam/webapi";

const PERSONA_STATE = ["오프라인", "온라인", "바쁨", "자리 비움", "수면", "거래 희망", "플레이 희망"];

export async function ProfileHeader({ steamid }: { steamid: string }) {
  let profile = null;
  let gameCount: number | null = null;
  try {
    const [p, owned] = await Promise.all([getProfile(steamid), getLibrary(steamid)]);
    profile = p;
    gameCount = owned?.length ?? null;
  } catch (err) {
    if (err instanceof SteamApiError && err.kind === "no-key") return null; // 안내는 본문에서
    throw err;
  }
  const cookieStore = await cookies();
  const isSelf = verifySessionValue(cookieStore.get(SESSION_COOKIE)?.value) === steamid;

  if (!profile) return null;

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
          {gameCount !== null ? ` · 보유 게임 ${gameCount.toLocaleString()}개` : ""}
          {" · "}
          <a
            href={profile.profileurl}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Steam 프로필 ↗
          </a>
        </p>
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
