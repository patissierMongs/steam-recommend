import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCallback } from "./openid";

const BASE = "https://app.example.com";
const RETURN_TO = `${BASE}/api/auth/steam/return`;
const STEAMID = "76561197960434622";

let nonceSeq = 0;
function freshNonce(): string {
  nonceSeq += 1;
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z") + `salt${nonceSeq}`;
}

function baseParams(over: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    "openid.mode": "id_res",
    "openid.return_to": RETURN_TO,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAMID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAMID}`,
    "openid.response_nonce": freshNonce(),
    "openid.sig": "validsig",
    ...over,
  });
}

function mockSteam(valid: boolean) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`, { status: 200 }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("verifyCallback", () => {
  it("정상 assertion을 통과시킨다", async () => {
    mockSteam(true);
    expect(await verifyCallback(baseParams(), BASE)).toBe(STEAMID);
  });

  it("같은 assertion을 두 번 쓰면 두 번째는 거부한다 (nonce 재사용 방지)", async () => {
    const spy = mockSteam(true);
    const params = baseParams();
    expect(await verifyCallback(new URLSearchParams(params), BASE)).toBe(STEAMID);
    expect(await verifyCallback(new URLSearchParams(params), BASE)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("검증에 실패한 nonce는 다시 시도할 수 있다", async () => {
    const params = baseParams();
    mockSteam(false);
    expect(await verifyCallback(new URLSearchParams(params), BASE)).toBeNull();
    vi.restoreAllMocks();
    mockSteam(true);
    expect(await verifyCallback(new URLSearchParams(params), BASE)).toBe(STEAMID);
  });

  it("Steam이 is_valid:false면 거부", async () => {
    mockSteam(false);
    expect(await verifyCallback(baseParams(), BASE)).toBeNull();
  });

  it("중복 openid.claimed_id 스머글링을 거부한다 (Steam 호출 없이)", async () => {
    const spy = mockSteam(true);
    const params = baseParams();
    params.append("openid.claimed_id", "https://steamcommunity.com/openid/id/76561197960000000");
    expect(await verifyCallback(params, BASE)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("return_to가 우리 콜백이 아니면 거부 (다른 사이트 assertion 재사용 차단)", async () => {
    mockSteam(true);
    const params = baseParams({ "openid.return_to": "https://evil.example.com/api/auth/steam/return" });
    expect(await verifyCallback(params, BASE)).toBeNull();
  });

  it("오래된 nonce를 거부한다 (재사용 방지)", async () => {
    mockSteam(true);
    const stale = "2020-01-01T00:00:00Zabcdef";
    expect(await verifyCallback(baseParams({ "openid.response_nonce": stale }), BASE)).toBeNull();
  });

  it("mode가 id_res가 아니면 거부", async () => {
    mockSteam(true);
    expect(await verifyCallback(baseParams({ "openid.mode": "cancel" }), BASE)).toBeNull();
  });

  it("claimed_id 형식이 틀리면 거부", async () => {
    mockSteam(true);
    expect(
      await verifyCallback(baseParams({ "openid.claimed_id": "https://evil.com/id/123" }), BASE),
    ).toBeNull();
  });
});
