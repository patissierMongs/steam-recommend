import "server-only";
import type { OwnedGame, PlayerSummary } from "@/lib/types";
import { getPlayerSummaryKeyless, resolveVanityKeyless } from "@/lib/steam/community";
import { readJson } from "@/lib/steam/ratelimit";

/**
 * Steam Web API (api.steampowered.com) — 전부 개인화 데이터라 캐시하지 않는다.
 * API 키는 서버 전용. 이 모듈은 'server-only'로 클라이언트 번들 유입을 차단.
 *
 * 키가 없으면 프로필 요약·vanity 해석은 커뮤니티 XML로 폴백하지만,
 * 라이브러리(GetOwnedGames)는 키가 반드시 필요하다(커뮤니티 games 엔드포인트는 로그인 게이트).
 */

const BASE = "https://api.steampowered.com";

export function hasApiKey(): boolean {
  return Boolean(process.env.STEAM_API_KEY);
}

export class SteamApiError extends Error {
  constructor(
    message: string,
    readonly kind: "no-key" | "http" | "private" | "not-found",
  ) {
    super(message);
    this.name = "SteamApiError";
  }
}

function apiKey(): string {
  const key = process.env.STEAM_API_KEY;
  if (!key) {
    throw new SteamApiError(
      "STEAM_API_KEY가 설정되지 않았습니다. .env.local에 https://steamcommunity.com/dev/apikey 에서 발급한 키를 넣어주세요.",
      "no-key",
    );
  }
  return key;
}

async function webApi<T>(path: string, params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams({ key: apiKey(), ...params });
  const res = await fetch(`${BASE}${path}?${search}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new SteamApiError(`Steam Web API ${path} 응답 오류: HTTP ${res.status}`, "http");
  }
  try {
    return await readJson<T>(res, `Steam Web API ${path}`);
  } catch {
    throw new SteamApiError(`Steam Web API ${path} 비-JSON 응답`, "http");
  }
}

export async function getPlayerSummary(steamid: string): Promise<PlayerSummary | null> {
  if (!hasApiKey()) return getPlayerSummaryKeyless(steamid); // 키 없이도 헤더는 표시
  const data = await webApi<{ response: { players: PlayerSummary[] } }>(
    "/ISteamUser/GetPlayerSummaries/v2/",
    { steamids: steamid },
  );
  return data.response.players[0] ?? null;
}

/**
 * 보유 게임 + 플레이타임. 대상 프로필의 "게임 상세" 공개 설정이 꺼져 있으면
 * Steam이 빈 response를 반환한다 — null로 구분해 돌려준다.
 */
export async function getOwnedGames(steamid: string): Promise<OwnedGame[] | null> {
  const data = await webApi<{ response: { game_count?: number; games?: OwnedGame[] } }>(
    "/IPlayerService/GetOwnedGames/v1/",
    {
      steamid,
      include_appinfo: "1",
      include_played_free_games: "1",
    },
  );
  if (data.response.games === undefined) return null; // 비공개 프로필
  return data.response.games;
}

const STEAMID64_RE = /^\d{17}$/;

/**
 * 사용자 입력(SteamID64 / 커스텀 URL 이름 / 프로필 URL)을 SteamID64로 해석.
 * 실패 시 null.
 */
export async function resolveSteamId(input: string): Promise<string | null> {
  const raw = input.trim();
  if (STEAMID64_RE.test(raw)) return raw;

  // URL 형태: /profiles/<id64> 또는 /id/<vanity>
  const profileMatch = raw.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (profileMatch) return profileMatch[1];
  const vanityMatch = raw.match(/steamcommunity\.com\/id\/([\w-]+)/i);
  const vanity = vanityMatch ? vanityMatch[1] : raw;

  if (!/^[\w-]{2,32}$/.test(vanity)) return null;
  if (!hasApiKey()) return resolveVanityKeyless(vanity); // 키 없이도 커스텀 URL 해석
  const data = await webApi<{ response: { success: number; steamid?: string } }>(
    "/ISteamUser/ResolveVanityURL/v1/",
    { vanityurl: vanity },
  );
  return data.response.success === 1 && data.response.steamid ? data.response.steamid : null;
}
