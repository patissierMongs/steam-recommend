/**
 * Steam OpenID 2.0 로그인.
 * Steam은 OAuth를 제공하지 않고 OpenID 2.0(https://steamcommunity.com/openid)만 지원한다.
 * 흐름: 로그인 → Steam 로그인 페이지로 리다이렉트 → 콜백 파라미터를 Steam에
 * check_authentication으로 되물어 서명 검증 → claimed_id에서 SteamID64 추출.
 */

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function buildLoginUrl(baseUrl: string): string {
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.claimed_id": IDENTIFIER_SELECT,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.return_to": `${baseUrl}/api/auth/steam/return`,
    "openid.realm": baseUrl,
  });
  return `${STEAM_OPENID_ENDPOINT}?${params}`;
}

/**
 * 콜백 쿼리 파라미터를 검증하고 SteamID64를 반환. 실패 시 null.
 * 서명 검증은 Steam 서버에 위임(check_authentication 왕복)하므로
 * 로컬에서 서명 알고리즘을 다룰 필요가 없다.
 *
 * expectedBaseUrl: 다른 RP(사이트)에 발급된 assertion 재사용을 막기 위해
 * openid.return_to가 우리 콜백인지 확인한다 (OpenID 2.0 §11.1).
 */
export async function verifyCallback(
  searchParams: URLSearchParams,
  expectedBaseUrl: string,
): Promise<string | null> {
  if (searchParams.get("openid.mode") !== "id_res") return null;
  const returnTo = searchParams.get("openid.return_to");
  if (returnTo !== `${expectedBaseUrl}/api/auth/steam/return`) return null;
  const claimedId = searchParams.get("openid.claimed_id");
  const steamid = claimedId?.match(CLAIMED_ID_RE)?.[1];
  if (!steamid) return null;

  // 받은 파라미터 전체를 mode만 바꿔 그대로 되돌려 보낸다 (OpenID 2.0 §11.4.2)
  const body = new URLSearchParams();
  for (const [k, v] of searchParams) body.set(k, v);
  body.set("openid.mode", "check_authentication");

  const res = await fetch(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const text = await res.text();
  return /is_valid\s*:\s*true/.test(text) ? steamid : null;
}
