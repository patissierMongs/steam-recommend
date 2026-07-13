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

/**
 * OpenID realm/return_to의 베이스 URL 결정.
 * APP_BASE_URL이 설정돼 있으면 그 값(신뢰), 아니면 요청 origin으로 폴백한다.
 * 리버스 프록시 뒤에서 Host 스푸핑이 우려되면 APP_BASE_URL을 반드시 설정할 것.
 * (로그인 후 리다이렉트는 항상 상대 경로 `/u/{steamid}`라 open redirect는 발생하지 않는다.)
 */
export function appBaseUrl(requestOrigin: string): string {
  return process.env.APP_BASE_URL || requestOrigin;
}

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
  // 파라미터 중복 스머글링 차단: get()은 첫 값을 읽지만 재전송 body는 set()으로
  // 마지막 값이 이긴다 — 값이 갈리면 "검증된 값 ≠ 파싱한 값"이 되어 계정 위조가 가능.
  // openid.* 키가 두 번 이상 등장하면 무조건 거부한다.
  const keys = [...new Set([...searchParams.keys()])];
  for (const key of keys) {
    if (key.startsWith("openid.") && searchParams.getAll(key).length !== 1) return null;
  }

  if (searchParams.get("openid.mode") !== "id_res") return null;
  const returnTo = searchParams.get("openid.return_to");
  if (returnTo !== `${expectedBaseUrl}/api/auth/steam/return`) return null;
  const claimedId = searchParams.get("openid.claimed_id");
  const steamid = claimedId?.match(CLAIMED_ID_RE)?.[1];
  if (!steamid) return null;

  // 오래된 assertion 재사용 방지(심층 방어): response_nonce 선두는 UTC 타임스탬프다
  // (예: "2026-07-12T16:14:16Z" + 고유 솔트). 1차 방어는 Steam의 nonce 1회 검증(§11.3),
  // 여기선 발급 15분 초과만 컷한다.
  const nonce = searchParams.get("openid.response_nonce");
  const isoMatch = nonce?.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
  const issuedAt = isoMatch ? Date.parse(isoMatch[0]) : NaN;
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 15 * 60 * 1000) return null;

  // 받은 파라미터 전체를 mode만 바꿔 그대로 되돌려 보낸다 (OpenID 2.0 §11.4.2)
  const body = new URLSearchParams();
  for (const [k, v] of searchParams) body.set(k, v);
  body.set("openid.mode", "check_authentication");

  const res = await fetch(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000), // Steam 장애 시 로그인 요청 무한 대기 방지
  });
  if (!res.ok) return null;
  const text = await res.text();
  return /is_valid\s*:\s*true/.test(text) ? steamid : null;
}
