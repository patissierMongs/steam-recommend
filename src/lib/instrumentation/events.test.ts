import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OwnedGame, Recommendation } from "@/lib/types";
import {
  buildImpression,
  buildSnapshot,
  candidateUniverseHash,
  MODEL_VERSION,
  SCHEMA_VERSION,
  subjectId,
} from "./events";
import { JsonlSink, NullSink, getSink } from "./sink";

const SALT = "salt-with-enough-length-xyz";

describe("subjectId", () => {
  it("같은 입력·salt에 안정적이고 raw steamid를 노출하지 않는다", () => {
    const a = subjectId("76561198041202350", SALT);
    expect(a).toBe(subjectId("76561198041202350", SALT));
    expect(a).not.toContain("76561198041202350");
  });

  it("steamid가 다르면 다르고, salt가 다르면 조인 불가하게 달라진다", () => {
    expect(subjectId("111", SALT)).not.toBe(subjectId("222", SALT));
    expect(subjectId("111", SALT)).not.toBe(subjectId("111", "other-salt-of-length"));
  });

  it("짧은 salt는 거부한다", () => {
    expect(() => subjectId("111", "short")).toThrow();
  });
});

describe("candidateUniverseHash", () => {
  it("순서·중복에 불변이다", () => {
    expect(candidateUniverseHash([3, 1, 2])).toBe(candidateUniverseHash([1, 2, 3]));
    expect(candidateUniverseHash([1, 1, 2])).toBe(candidateUniverseHash([1, 2]));
  });

  it("집합이 다르면 지문이 다르다", () => {
    expect(candidateUniverseHash([1, 2])).not.toBe(candidateUniverseHash([1, 3]));
  });
});

const OWNED: OwnedGame[] = [
  { appid: 10, name: "A", playtime_forever: 120, rtime_last_played: 1_700_000_000 },
  { appid: 20, name: "B", playtime_forever: 0 }, // last-played 없음 → 필드 생략
];

describe("buildSnapshot", () => {
  it("OwnedGame를 매핑하고 결측 optional은 생략한다", () => {
    const snap = buildSnapshot("subj", "2026-07-13T00:00:00Z", "auto", OWNED);
    expect(snap.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snap.games[0]).toEqual({
      appid: 10,
      playtimeForever: 120,
      rtimeLastPlayed: 1_700_000_000,
    });
    expect(snap.games[1]).toEqual({ appid: 20, playtimeForever: 0 });
    expect("rtimeLastPlayed" in snap.games[1]).toBe(false);
  });
});

const RECS: Recommendation[] = [
  {
    appid: 30,
    name: "Rec1",
    headerImage: "",
    shortDescription: "",
    releaseDate: "",
    priceFormatted: null,
    discountPercent: 0,
    isFree: false,
    score: 1.5,
    breakdown: { tasteMatch: 0.8, reviewLowerBound: 0.9, matchedTags: [] },
  },
  {
    appid: 40,
    name: "Rec2",
    headerImage: "",
    shortDescription: "",
    releaseDate: "",
    priceFormatted: null,
    discountPercent: 0,
    isFree: false,
    score: 1.0,
    breakdown: { tasteMatch: null, reviewLowerBound: 0.7, matchedTags: [] },
  },
];

describe("buildImpression", () => {
  it("1-기반 position, dedup universe 크기, 결정적 기본, breakdown 매핑", () => {
    const imp = buildImpression({
      subject: "subj",
      section: "backlog",
      shownAt: "2026-07-13T00:00:00Z",
      recommendations: RECS,
      candidateUniverse: [30, 40, 50, 50], // 중복 포함
    });
    expect(imp.modelVersion).toBe(MODEL_VERSION);
    expect(imp.candidateUniverseSize).toBe(3);
    expect(imp.deterministic).toBe(true);
    expect(imp.items).toEqual([
      { appid: 30, position: 1, score: 1.5, tasteMatch: 0.8, reviewLowerBound: 0.9 },
      { appid: 40, position: 2, score: 1.0, tasteMatch: null, reviewLowerBound: 0.7 },
    ]);
  });

  it("같은 subject·section·시각은 같은 impressionId를 낸다", () => {
    const p = {
      subject: "subj",
      section: "backlog" as const,
      shownAt: "2026-07-13T00:00:00Z",
      recommendations: RECS,
      candidateUniverse: [30, 40],
    };
    expect(buildImpression(p).impressionId).toBe(buildImpression(p).impressionId);
  });
});

describe("sink", () => {
  it("NullSink는 아무것도 하지 않고 성공한다", async () => {
    const sink = new NullSink();
    await expect(
      sink.recordSnapshot(buildSnapshot("s", "2026-07-13T00:00:00Z", "auto", OWNED)),
    ).resolves.toBeUndefined();
  });

  it("getSink는 opt-in 없이는 NullSink를 준다", () => {
    const prev = process.env.INSTRUMENTATION_ENABLED;
    delete process.env.INSTRUMENTATION_ENABLED;
    expect(getSink()).toBeInstanceOf(NullSink);
    if (prev !== undefined) process.env.INSTRUMENTATION_ENABLED = prev;
  });

  it("JsonlSink는 이벤트를 JSONL로 append한다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "instr-"));
    const sink = new JsonlSink(dir);
    const snap = buildSnapshot("s", "2026-07-13T00:00:00Z", "auto", OWNED);
    await sink.recordSnapshot(snap);
    await sink.recordSnapshot(snap);
    const lines = (await readFile(join(dir, "snapshots.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(snap);
  });
});
