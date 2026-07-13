import "server-only";
import type { PlayerSummary } from "@/lib/types";

/**
 * 키 없이 접근 가능한 Steam 커뮤니티 XML 엔드포인트.
 * 프로필 요약과 커스텀 URL(vanity) 해석은 API 키 없이도 공개 프로필에서 동작한다.
 * (라이브러리/games 엔드포인트는 로그인 게이트가 걸려 키리스로는 불가 — Web API 필요.)
 */

function extract(xml: string, tag: string): string | null {
  // <tag><![CDATA[..]]></tag> 또는 <tag>..</tag> 모두 처리
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return (m[1] ?? m[2] ?? "").trim() || null;
}

async function fetchXml(url: string): Promise<string | null> {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "manual", // 로그인 리다이렉트(302)를 성공으로 오인하지 않게
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": "steam-recommend/1.0 (+profile summary)" },
  });
  if (res.status !== 200) return null;
  const text = await res.text();
  return text.includes("<?xml") || text.includes("<profile") ? text : null;
}

const STEAMID64_RE = /^\d{17}$/;

/** 커스텀 URL 이름 → SteamID64 (키 불필요). 실패 시 null */
export async function resolveVanityKeyless(vanity: string): Promise<string | null> {
  if (!/^[\w-]{2,32}$/.test(vanity)) return null;
  const xml = await fetchXml(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}?xml=1`);
  if (!xml) return null;
  const id = extract(xml, "steamID64");
  return id && STEAMID64_RE.test(id) ? id : null;
}

/** 프로필 요약 (키 불필요). 비공개/미존재면 null */
export async function getPlayerSummaryKeyless(steamid: string): Promise<PlayerSummary | null> {
  const xml = await fetchXml(`https://steamcommunity.com/profiles/${steamid}?xml=1`);
  if (!xml) return null;
  const id = extract(xml, "steamID64");
  if (!id || !STEAMID64_RE.test(id)) return null; // 존재하지 않는 프로필

  const privacy = extract(xml, "privacyState"); // "public" | "friendsonly" | "private"
  const online = extract(xml, "onlineState"); // "online" | "offline" | "in-game"
  const customUrl = extract(xml, "customURL");
  const avatarFull = extract(xml, "avatarFull") ?? "";

  return {
    steamid: id,
    personaname: extract(xml, "steamID") ?? id,
    profileurl: customUrl
      ? `https://steamcommunity.com/id/${customUrl}/`
      : `https://steamcommunity.com/profiles/${id}/`,
    avatar: extract(xml, "avatarIcon") ?? avatarFull,
    avatarmedium: extract(xml, "avatarMedium") ?? avatarFull,
    avatarfull: avatarFull,
    personastate: online === "offline" ? 0 : 1,
    communityvisibilitystate: privacy === "public" ? 3 : 1,
  };
}
