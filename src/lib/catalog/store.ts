import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 전체 Steam 카탈로그 영속 스토어 (docs/STORAGE.md).
 *
 * 목적: "매 요청 API 호출" 대신 카탈로그를 한 번 수집하고 바뀐 것만 갱신한다.
 * - apps: IStoreService/GetAppList(게임만) — appid·이름·last_modified(증분 갱신 키)
 * - spy_bulk: SteamSpy request=all 스파인 — 리뷰수·소유자 추정·ccu·가격
 * - spy_tags: SteamSpy per-app appdetails — 태그 투표수 (긴 크롤 대상)
 *
 * node:sqlite(실험 API)를 쓴다 — 단일 파일, 외부 의존성 없음. 파일은 VCS에 커밋하지
 * 않으며(gitignore), 이 개발 컨테이너는 ephemeral이라 실제 축적은 볼륨 있는 배포에서
 * 재개 가능한 수집 스크립트(scripts/ingest-catalog.mjs)로 수행한다.
 */

export interface CatalogApp {
  appid: number;
  name: string;
  lastModified: number;
}

export interface SpyBulkRow {
  appid: number;
  name: string;
  positive: number;
  negative: number;
  ownersMid: number;
  ccu: number;
  priceCents: number;
  fetchedAt: number;
}

export class CatalogStore {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS apps (
        appid INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        last_modified INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS spy_bulk (
        appid INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        positive INTEGER NOT NULL,
        negative INTEGER NOT NULL,
        owners_mid INTEGER NOT NULL,
        ccu INTEGER NOT NULL,
        price_cents INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS spy_tags (
        appid INTEGER PRIMARY KEY,
        tags TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_spy_bulk_owners ON spy_bulk(owners_mid DESC);
    `);
  }

  upsertApps(apps: readonly CatalogApp[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO apps (appid, name, last_modified) VALUES (?, ?, ?)
       ON CONFLICT(appid) DO UPDATE SET name = excluded.name, last_modified = excluded.last_modified`,
    );
    this.db.exec("BEGIN");
    try {
      for (const a of apps) stmt.run(a.appid, a.name, a.lastModified);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  upsertSpyBulk(rows: readonly SpyBulkRow[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO spy_bulk (appid, name, positive, negative, owners_mid, ccu, price_cents, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(appid) DO UPDATE SET name = excluded.name, positive = excluded.positive,
         negative = excluded.negative, owners_mid = excluded.owners_mid, ccu = excluded.ccu,
         price_cents = excluded.price_cents, fetched_at = excluded.fetched_at`,
    );
    this.db.exec("BEGIN");
    try {
      for (const r of rows) {
        stmt.run(r.appid, r.name, r.positive, r.negative, r.ownersMid, r.ccu, r.priceCents, r.fetchedAt);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  upsertSpyTags(appid: number, tags: Record<string, number>, fetchedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO spy_tags (appid, tags, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(appid) DO UPDATE SET tags = excluded.tags, fetched_at = excluded.fetched_at`,
      )
      .run(appid, JSON.stringify(tags), fetchedAt);
  }

  /** 태그 크롤 우선순위 대상: 소유자 추정 상위 중 태그가 없거나 만료된 appid */
  tagCrawlQueue(limit: number, maxAgeMs: number, nowMs: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT b.appid FROM spy_bulk b
         LEFT JOIN spy_tags t ON t.appid = b.appid
         WHERE t.appid IS NULL OR t.fetched_at < ?
         ORDER BY b.owners_mid DESC, b.appid ASC
         LIMIT ?`,
      )
      .all(nowMs - maxAgeMs, limit) as { appid: number }[];
    return rows.map((r) => r.appid);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  counts(): { apps: number; spyBulk: number; spyTags: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      apps: one("SELECT COUNT(*) AS n FROM apps"),
      spyBulk: one("SELECT COUNT(*) AS n FROM spy_bulk"),
      spyTags: one("SELECT COUNT(*) AS n FROM spy_tags"),
    };
  }

  close(): void {
    this.db.close();
  }
}
