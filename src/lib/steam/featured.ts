import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { FeaturedItem } from "@/lib/types";
import { readJson } from "@/lib/steam/ratelimit";

/** 신작/인기/할인 후보 풀 — 사용자 무관, 1시간 캐시 */

export interface FeaturedPool {
  newReleases: { appid: number; name: string }[];
  topSellers: { appid: number; name: string }[];
  specials: { appid: number; name: string }[];
  comingSoon: { appid: number; name: string }[];
}

interface FeaturedCategoriesResponse {
  new_releases?: { items?: FeaturedItem[] };
  top_sellers?: { items?: FeaturedItem[] };
  specials?: { items?: FeaturedItem[] };
  coming_soon?: { items?: FeaturedItem[] };
}

function pick(items: FeaturedItem[] | undefined): { appid: number; name: string }[] {
  const seen = new Set<number>();
  const out: { appid: number; name: string }[] = [];
  for (const item of items ?? []) {
    if (!item?.id || seen.has(item.id)) continue;
    if (item.type !== 0) continue; // 패키지/번들 id는 appdetails/SteamSpy appid가 아니다
    seen.add(item.id);
    out.push({ appid: item.id, name: item.name });
  }
  return out;
}

export async function getFeaturedPool(): Promise<FeaturedPool> {
  "use cache";
  cacheLife("hours");
  cacheTag("featured-pool");
  const res = await fetch("https://store.steampowered.com/api/featuredcategories?cc=KR&l=korean", {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`featuredcategories HTTP ${res.status}`);
  const data = await readJson<FeaturedCategoriesResponse>(res, "featuredcategories");
  return {
    newReleases: pick(data.new_releases?.items),
    topSellers: pick(data.top_sellers?.items),
    specials: pick(data.specials?.items),
    comingSoon: pick(data.coming_soon?.items),
  };
}
