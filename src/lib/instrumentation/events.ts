import { createHmac, createHash } from "node:crypto";
import type { GameFacts, OwnedGame, Recommendation } from "@/lib/types";

/**
 * Stage 1 instrumentation 이벤트 계약 (docs/STAGE1_INSTRUMENTATION.md).
 *
 * 이 모듈은 순수 데이터 변환만 한다 — 저장은 sink.ts. "선호"·"만족"·"추천 효과"를 만들지
 * 않고 관측 로그만 구성한다. 스키마 변경은 SCHEMA_VERSION을 올리고 기존 로그를 불변으로 둔다.
 */

export const SCHEMA_VERSION = "s1/v2";

/** 노출을 만든 제품 랭커 버전 (검증된 가중치가 아닌 휴리스틱: 0.40·z(taste)+0.35·z(review)). */
export const MODEL_VERSION = "rank-tag-review/z-heuristic-v1";

export type RecSection = "backlog" | "lapsed" | "coplay" | "newReleases" | "hiddenGems";
export type SnapshotSource = "login" | "auto" | "manual";

export interface SnapshotGame {
  appid: number;
  playtimeForever: number;
  playtime2Weeks?: number;
  rtimeLastPlayed?: number;
}

export interface LibrarySnapshot {
  schemaVersion: string;
  subject: string;
  capturedAt: string;
  source: SnapshotSource;
  games: SnapshotGame[];
}

export interface ImpressionItem {
  appid: number;
  position: number;
  score: number;
  tasteMatch: number | null;
  reviewLowerBound: number | null;
  /** 무작위/탐색 노출 시의 노출 확률. 결정적 랭킹이면 생략. */
  propensity?: number;
}

/**
 * 서버가 랭킹을 만들어 응답에 실은 목록. 사용자가 실제로 봤다는 뜻이 아니다 —
 * 노출은 클라이언트가 화면 진입을 확인한 뒤 보내는 RecommendationExposure로만 기록한다.
 * items가 비어 있어도 기록한다(평가했지만 후보가 없던 경우와 평가하지 않은 경우를 구분).
 */
export interface RecommendationImpression {
  schemaVersion: string;
  impressionId: string;
  subject: string;
  /** 랭킹이 끝난 직후의 서버 시각. 스냅샷 capturedAt과 분리한다. */
  generatedAt: string;
  modelVersion: string;
  section: RecSection;
  candidateUniverseSize: number;
  candidateUniverseHash: string;
  /** 정렬·중복 제거한 후보 appid 전체. Stage 2 risk set 재구성용. */
  candidateUniverse: number[];
  /**
   * 랭킹 시점에 쓰인 공개 메타데이터 (후보 ∪ 프로필 입력 게임, appid 오름차순).
   * 나중에 SteamSpy·상점 데이터가 바뀌어도 미래 정보 없이 baseline을 다시 랭킹할 수 있게 한다.
   * 목록에 없는 appid는 그 시점에 메타데이터를 확보하지 못한 것이다.
   */
  appMetadata: AppMetadata[];
  /** 결정적 랭킹이면 true — propensity가 없음을 "1"로 오해하지 않게 명시. */
  deterministic: boolean;
  items: ImpressionItem[];
}

export interface AppMetadata {
  appid: number;
  tags: Record<string, number>;
  genres: string[];
  positive: number;
  negative: number;
  ownersEstimate: number;
  medianPlaytime: number;
  appType: string | null;
}

export function toAppMetadata(facts: GameFacts): AppMetadata {
  return {
    appid: facts.appid,
    tags: { ...facts.tags },
    genres: [...facts.genres],
    positive: facts.positive,
    negative: facts.negative,
    ownersEstimate: facts.ownersEstimate,
    medianPlaytime: facts.medianPlaytime,
    appType: facts.appType,
  };
}

/** 클라이언트가 카드의 화면 진입을 확인한 뒤 보낸 노출 확인. positions는 1부터 시작하는 순위. */
export interface RecommendationExposure {
  schemaVersion: string;
  impressionId: string;
  subject: string;
  section: RecSection;
  exposedAt: string;
  positions: number[];
}

export interface RecommendationInteraction {
  schemaVersion: string;
  impressionId: string;
  appid: number;
  action: "click" | "outbound_store";
  at: string;
}

/**
 * raw SteamID64를 salt한 HMAC-SHA256으로 가명화한다. 같은 salt 안에서만 스냅샷↔impression
 * 조인이 가능하고, salt 폐기 시 재식별 불가. salt는 호출자가 명시(순수·테스트 가능).
 */
export function subjectId(steamid: string, salt: string): string {
  if (!salt || salt.length < 16) {
    throw new Error("instrumentation salt는 16자 이상이어야 합니다.");
  }
  return createHmac("sha256", salt).update(steamid).digest("base64url");
}

/** 후보 집합 지문 — 정렬·중복 제거 후 안정 해시. retrieval vs ranking 분리·누수 점검용. */
export function candidateUniverseHash(appids: Iterable<number>): string {
  const sorted = [...new Set(appids)].sort((a, b) => a - b);
  return createHash("sha256").update(sorted.join(",")).digest("base64url").slice(0, 16);
}

function impressionId(subject: string, section: RecSection, generatedAt: string): string {
  return createHash("sha256")
    .update(`${subject}|${section}|${generatedAt}|${MODEL_VERSION}`)
    .digest("base64url")
    .slice(0, 20);
}

export function buildSnapshot(
  subject: string,
  capturedAt: string,
  source: SnapshotSource,
  games: readonly OwnedGame[],
): LibrarySnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    subject,
    capturedAt,
    source,
    games: games.map((g) => ({
      appid: g.appid,
      playtimeForever: g.playtime_forever,
      ...(g.playtime_2weeks !== undefined ? { playtime2Weeks: g.playtime_2weeks } : {}),
      ...(g.rtime_last_played ? { rtimeLastPlayed: g.rtime_last_played } : {}),
    })),
  };
}

export function buildImpression(params: {
  subject: string;
  section: RecSection;
  generatedAt: string;
  recommendations: readonly Recommendation[];
  candidateUniverse: Iterable<number>;
  metadata?: Iterable<GameFacts>;
  deterministic?: boolean;
}): RecommendationImpression {
  const { subject, section, generatedAt, recommendations, candidateUniverse } = params;
  const universe = [...new Set(candidateUniverse)].sort((a, b) => a - b);
  return {
    schemaVersion: SCHEMA_VERSION,
    impressionId: impressionId(subject, section, generatedAt),
    subject,
    generatedAt,
    modelVersion: MODEL_VERSION,
    section,
    candidateUniverseSize: universe.length,
    candidateUniverseHash: candidateUniverseHash(universe),
    candidateUniverse: universe,
    appMetadata: [...new Map([...(params.metadata ?? [])].map((f) => [f.appid, f])).values()]
      .sort((a, b) => a.appid - b.appid)
      .map(toAppMetadata),
    deterministic: params.deterministic ?? true,
    items: recommendations.map((r, i) => ({
      appid: r.appid,
      position: i + 1,
      score: r.score,
      tasteMatch: r.breakdown.tasteMatch,
      reviewLowerBound: r.breakdown.reviewLowerBound,
    })),
  };
}

export const EXPOSURE_SECTIONS: readonly RecSection[] = ["backlog", "lapsed"];
const IMPRESSION_ID_RE = /^[A-Za-z0-9_-]{20}$/;
const MAX_POSITION = 50;

/** 클라이언트 입력을 검증해 노출 이벤트를 만든다. 형식이 틀리면 null. */
export function buildExposure(params: {
  subject: string;
  exposedAt: string;
  input: unknown;
}): RecommendationExposure | null {
  const input = params.input as { impressionId?: unknown; section?: unknown; positions?: unknown } | null;
  if (!input || typeof input !== "object") return null;
  const { impressionId: id, section, positions } = input;
  if (typeof id !== "string" || !IMPRESSION_ID_RE.test(id)) return null;
  if (typeof section !== "string" || !EXPOSURE_SECTIONS.includes(section as RecSection)) return null;
  if (!Array.isArray(positions) || positions.length === 0 || positions.length > MAX_POSITION) return null;
  if (!positions.every((p) => Number.isInteger(p) && p >= 1 && p <= MAX_POSITION)) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    impressionId: id,
    subject: params.subject,
    section: section as RecSection,
    exposedAt: params.exposedAt,
    positions: [...new Set(positions as number[])].sort((a, b) => a - b),
  };
}

export function recSectionElementId(section: RecSection): string {
  return `rec-${section}`;
}
