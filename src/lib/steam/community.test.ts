import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlayerSummaryKeyless, resolveVanityKeyless } from "./community";

const SUMMARY_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<profile>
  <steamID64>76561197960287930</steamID64>
  <steamID><![CDATA[Rabscuttle]]></steamID>
  <onlineState>offline</onlineState>
  <privacyState>public</privacyState>
  <avatarIcon><![CDATA[https://avatars.fastly.steamstatic.com/abc.jpg]]></avatarIcon>
  <avatarMedium><![CDATA[https://avatars.fastly.steamstatic.com/abc_medium.jpg]]></avatarMedium>
  <avatarFull><![CDATA[https://avatars.fastly.steamstatic.com/abc_full.jpg]]></avatarFull>
  <customURL><![CDATA[gabelogannewell]]></customURL>
</profile>`;

const VANITY_XML = `<?xml version="1.0"?><profile><steamID64>76561197960287930</steamID64></profile>`;

function mockFetch(status: number, body: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }));
}

afterEach(() => vi.restoreAllMocks());

describe("getPlayerSummaryKeyless", () => {
  it("커뮤니티 XML을 PlayerSummary로 파싱한다", async () => {
    mockFetch(200, SUMMARY_XML);
    const s = await getPlayerSummaryKeyless("76561197960287930");
    expect(s).not.toBeNull();
    expect(s!.personaname).toBe("Rabscuttle");
    expect(s!.avatarfull).toBe("https://avatars.fastly.steamstatic.com/abc_full.jpg");
    expect(s!.communityvisibilitystate).toBe(3); // public
    expect(s!.personastate).toBe(0); // offline
    expect(s!.profileurl).toBe("https://steamcommunity.com/id/gabelogannewell/");
  });

  it("로그인 리다이렉트(302 등 비200)는 null", async () => {
    mockFetch(302, "Found. Redirecting to /login");
    expect(await getPlayerSummaryKeyless("76561197960287930")).toBeNull();
  });

  it("steamID64 없는 응답은 null (미존재 프로필)", async () => {
    mockFetch(200, "<?xml version='1.0'?><response><error>No match</error></response>");
    expect(await getPlayerSummaryKeyless("76561197960287930")).toBeNull();
  });
});

describe("resolveVanityKeyless", () => {
  it("커스텀 URL → SteamID64", async () => {
    mockFetch(200, VANITY_XML);
    expect(await resolveVanityKeyless("gabelogannewell")).toBe("76561197960287930");
  });

  it("잘못된 vanity 형식은 요청 없이 null", async () => {
    const spy = mockFetch(200, VANITY_XML);
    expect(await resolveVanityKeyless("a")).toBeNull(); // 2자 미만
    expect(spy).not.toHaveBeenCalled();
  });
});
