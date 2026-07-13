import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogStore } from "./store";

function tempStore(): CatalogStore {
  return new CatalogStore(join(mkdtempSync(join(tmpdir(), "catalog-")), "t.db"));
}

describe("CatalogStore", () => {
  it("apps upsert는 idempotent하고 갱신된다", () => {
    const s = tempStore();
    s.upsertApps([{ appid: 10, name: "CS", lastModified: 1 }]);
    s.upsertApps([{ appid: 10, name: "Counter-Strike", lastModified: 2 }]);
    expect(s.counts().apps).toBe(1);
    s.close();
  });

  it("태그 크롤 대기열은 소유자 내림차순, 신선한 항목은 제외", () => {
    const s = tempStore();
    const now = 1_000_000;
    s.upsertSpyBulk([
      { appid: 1, name: "a", positive: 0, negative: 0, ownersMid: 100, ccu: 0, priceCents: 0, fetchedAt: now },
      { appid: 2, name: "b", positive: 0, negative: 0, ownersMid: 9000, ccu: 0, priceCents: 0, fetchedAt: now },
      { appid: 3, name: "c", positive: 0, negative: 0, ownersMid: 500, ccu: 0, priceCents: 0, fetchedAt: now },
    ]);
    // 2번은 방금 수집됨 → 제외, 나머지는 소유자 내림차순
    s.upsertSpyTags(2, { RPG: 10 }, now);
    expect(s.tagCrawlQueue(10, 86_400_000, now)).toEqual([3, 1]);
    // 만료되면 다시 대기열에 등장
    expect(s.tagCrawlQueue(10, 0, now + 1)).toEqual([2, 3, 1]);
    s.close();
  });

  it("meta는 재개 커서를 보존한다", () => {
    const s = tempStore();
    expect(s.getMeta("spy_next_page")).toBeNull();
    s.setMeta("spy_next_page", "7");
    expect(s.getMeta("spy_next_page")).toBe("7");
    s.close();
  });
});
