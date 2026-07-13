import { createHmac, createHash } from "node:crypto";
import type { OwnedGame, Recommendation } from "@/lib/types";

/**
 * Stage 1 instrumentation 이벤트 계약 (docs/STAGE1_INSTRUMENTATION.md).
 *
 * 이 모듈은 순수 데이터 변환만 한다 — 저장은 sink.ts. "선호"·"만족"·"추천 효과"를 만들지
 * 않고 관측 로그만 구성한다. 스키마 변경은 SCHEMA_VERSION을 올리고 기존 로그를 불변으로 둔다.
 */

export const SCHEMA_VERSION = "s1/v1";

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

export interface RecommendationImpression {
  schemaVersion: string;
  impressionId: string;
  subject: string;
  shownAt: string;
  modelVersion: string;
  section: RecSection;
  candidateUniverseSize: number;
  candidateUniverseHash: string;
  /** 결정적 랭킹이면 true — propensity가 없음을 "1"로 오해하지 않게 명시. */
  deterministic: boolean;
  items: ImpressionItem[];
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

function impressionId(subject: string, section: RecSection, shownAt: string): string {
  return createHash("sha256")
    .update(`${subject}|${section}|${shownAt}|${MODEL_VERSION}`)
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
  shownAt: string;
  recommendations: readonly Recommendation[];
  candidateUniverse: Iterable<number>;
  deterministic?: boolean;
}): RecommendationImpression {
  const { subject, section, shownAt, recommendations, candidateUniverse } = params;
  const universe = [...candidateUniverse];
  return {
    schemaVersion: SCHEMA_VERSION,
    impressionId: impressionId(subject, section, shownAt),
    subject,
    shownAt,
    modelVersion: MODEL_VERSION,
    section,
    candidateUniverseSize: new Set(universe).size,
    candidateUniverseHash: candidateUniverseHash(universe),
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
