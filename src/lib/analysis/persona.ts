import type { GameFacts, OwnedGame } from "@/lib/types";
import { herfindahlIndex } from "@/lib/analysis/stats";
import { MIN_EVIDENCE_MINUTES, type TasteModel } from "@/lib/analysis/taste";

/**
 * 플레이어 성향(persona) 프로파일링 — 태그 "내용"이 아니라 플레이 "행동"에서
 * 성향 차원을 추출한다. 어떤 게임을 좋아하는가(취향 벡터)와 어떻게 플레이하는가
 * (성향)를 분리해, 후보 게임과의 성향 적합도를 별도 신호로 랭킹에 반영한다.
 * 모든 차원은 0..1.
 */

export interface PersonaProfile {
  /** 몰입도: 소수 게임을 깊게(1) vs 얕고 넓게(0). HHI + 상위5 비중 기반 */
  depth: number;
  /** 정주행 성향: 전체 유저 중앙값 대비 오래 플레이하는가 */
  commitment: number;
  /** 도전 성향: Difficult/Souls-like 등 고난도 태그 비중 */
  challenge: number;
  /** 소셜 성향: 멀티/협동(1) vs 싱글(0) */
  social: number;
  /** 발굴 성향: 비주류(소유자 적은) 게임 비중 */
  niche: number;
  /** 신작 선호: 라이브러리 내 플레이가 최신 게임에 쏠렸는가 (appid 근사) */
  fresh: number;
  /** 유형 라벨 (예: "도전적인 싱글 다이버") */
  archetype: string;
  archetypeDescription: string;
}

const CHALLENGE_TAGS = new Set([
  "Difficult", "Souls-like", "Roguelike", "Rogue-like", "Roguelite", "Rogue-lite",
  "Bullet Hell", "Precision Platformer", "Permadeath", "Hardcore", "Challenging",
  "Action Roguelike", "CRPG",
]);
const SOCIAL_TAGS = new Set([
  "Multiplayer", "Online Co-Op", "Co-op", "Co-Op", "PvP", "Competitive", "MMO",
  "Massively Multiplayer", "Team-Based", "4 Player Local", "Local Co-Op", "eSports",
  "Hero Shooter", "Battle Royale",
]);
const SOLO_TAGS = new Set(["Singleplayer", "Story Rich", "Single-player"]);

function tagVotes(facts: GameFacts, set: Set<string>): number {
  let v = 0;
  for (const [tag, votes] of Object.entries(facts.tags)) if (set.has(tag)) v += votes;
  return v;
}

function totalVotes(facts: GameFacts): number {
  return Object.values(facts.tags).reduce((a, b) => a + b, 0);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 게임의 도전 성향: 고난도 태그 투표 비중 (0..~0.4가 흔해 2.5배 스케일) */
export function challengeOf(facts: GameFacts): number | null {
  const total = totalVotes(facts);
  if (total === 0) return null;
  return clamp01((tagVotes(facts, CHALLENGE_TAGS) / total) * 2.5);
}

/** 게임의 소셜 성향: 멀티 태그 vs 싱글 태그 비율. 둘 다 없으면 null */
export function socialOf(facts: GameFacts): number | null {
  const social = tagVotes(facts, SOCIAL_TAGS);
  const solo = tagVotes(facts, SOLO_TAGS);
  if (social + solo === 0) return null;
  return social / (social + solo);
}

/** 게임의 니치 성향: 소유자 30k→1, 20M→0 (로그 스케일). 미상이면 null */
export function nicheOf(facts: GameFacts): number | null {
  if (facts.ownersEstimate <= 0) return null;
  return clamp01(1 - (Math.log10(facts.ownersEstimate) - 4.5) / 2.8);
}

/** 가중 평균 (null 제외). 유효 표본 없으면 fallback */
function weightedDim(
  entries: { value: number | null; weight: number }[],
  fallback = 0.5,
): number {
  let sum = 0;
  let wsum = 0;
  for (const { value, weight } of entries) {
    if (value === null) continue;
    sum += value * weight;
    wsum += weight;
  }
  return wsum > 0 ? sum / wsum : fallback;
}

export function buildPersona(
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  model: TasteModel,
): PersonaProfile {
  const played = owned.filter((g) => g.playtime_forever >= MIN_EVIDENCE_MINUTES);
  const weighted = played
    .map((g) => ({ g, facts: factsByAppid.get(g.appid), w: model.preferenceWeights.get(g.appid) ?? 0 }))
    .filter((x) => x.w > 0);

  // 몰입도: HHI(0.02≈잡식 … 0.3+≈몰빵)를 로그 스케일로 0..1 매핑 + 상위5 비중 보정
  const times = played.map((g) => g.playtime_forever);
  const hhi = herfindahlIndex(times);
  const total = times.reduce((a, b) => a + b, 0) || 1;
  const top5 = [...times].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) / total;
  const depth = clamp01(0.6 * clamp01(Math.log10(Math.max(hhi, 0.005) / 0.005) / Math.log10(0.4 / 0.005)) + 0.4 * top5);

  // 정주행: (내 플레이 / 전체 중앙값)의 중앙값. 1/3배→0, 1배→0.5, 3배→1 (로그)
  const ratios = weighted
    .filter((x) => x.facts && x.facts.medianPlaytime > 0)
    .map((x) => x.g.playtime_forever / x.facts!.medianPlaytime)
    .sort((a, b) => a - b);
  const medianRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
  const commitment = clamp01(0.5 + Math.log(Math.max(medianRatio, 1e-3)) / (2 * Math.log(3)));

  const challenge = weightedDim(weighted.map((x) => ({ value: x.facts ? challengeOf(x.facts) : null, weight: x.w })));
  const social = weightedDim(weighted.map((x) => ({ value: x.facts ? socialOf(x.facts) : null, weight: x.w })));
  const niche = weightedDim(weighted.map((x) => ({ value: x.facts ? nicheOf(x.facts) : null, weight: x.w })));

  // 신작 선호: 플레이타임 가중 appid 백분위 (appid는 출시 시점에 대체로 단조 증가 — 근사)
  const allIds = owned.map((g) => g.appid).sort((a, b) => a - b);
  const pct = (appid: number) => allIds.findIndex((x) => x >= appid) / Math.max(1, allIds.length - 1);
  const fresh = weightedDim(played.map((g) => ({ value: pct(g.appid), weight: g.playtime_forever })));

  const dims = { depth, commitment, challenge, social, niche, fresh };
  const { archetype, archetypeDescription } = nameArchetype(dims);
  return { ...dims, archetype, archetypeDescription };
}

/** 상위 특성 2개를 조합해 결정적으로 유형명을 만든다 */
function nameArchetype(d: Omit<PersonaProfile, "archetype" | "archetypeDescription">): {
  archetype: string;
  archetypeDescription: string;
} {
  const traits: { key: string; strength: number; label: string; desc: string }[] = [
    { key: "challenge", strength: d.challenge - 0.45, label: "도전자", desc: "어려운 게임에서 재미를 찾고" },
    { key: "social", strength: d.social - 0.55, label: "소셜 플레이어", desc: "함께 플레이할 때 빛나며" },
    { key: "solo", strength: 0.4 - d.social, label: "싱글 몰입러", desc: "혼자만의 몰입을 즐기고" },
    { key: "niche", strength: d.niche - 0.5, label: "발굴가", desc: "남들이 모르는 게임을 찾아다니며" },
    { key: "main", strength: 0.28 - d.niche, label: "메인스트림", desc: "검증된 인기작을 선호하고" },
    { key: "depth", strength: d.depth - 0.55, label: "다이버", desc: "꽂힌 게임을 수백 시간 파는 타입" },
    { key: "breadth", strength: 0.35 - d.depth, label: "탐험가", desc: "다양한 게임을 두루 맛보는 타입" },
    { key: "commit", strength: d.commitment - 0.6, label: "정주행러", desc: "시작한 게임은 끝까지 가는 타입" },
    { key: "fresh", strength: d.fresh - 0.62, label: "신작 헌터", desc: "새로 나온 게임부터 손이 가는 타입" },
  ];
  const top = traits.filter((t) => t.strength > 0).sort((a, b) => b.strength - a.strength).slice(0, 2);
  if (top.length === 0) {
    return { archetype: "균형형 플레이어", archetypeDescription: "특정 성향에 치우치지 않고 고르게 즐기는 타입" };
  }
  if (top.length === 1) {
    return { archetype: top[0].label, archetypeDescription: `${top[0].desc}.` };
  }
  return {
    archetype: `${top[0].label} × ${top[1].label}`,
    archetypeDescription: `${top[0].desc}, ${top[1].desc}.`,
  };
}

/**
 * 후보 게임과 사용자 성향의 적합도 (0..1).
 * 태그 내용 유사도와 독립적인 신호: 도전/소셜/니치 축에서 얼마나 "그 사람답게"
 * 플레이할 만한 게임인가. 후보 쪽 값이 미상인 축은 중립(차이 0.25) 처리.
 */
export function personaFit(persona: PersonaProfile, facts: GameFacts): number {
  const axes: { user: number; cand: number | null; weight: number }[] = [
    { user: persona.challenge, cand: challengeOf(facts), weight: 0.4 },
    { user: persona.social, cand: socialOf(facts), weight: 0.35 },
    { user: persona.niche, cand: nicheOf(facts), weight: 0.25 },
  ];
  let score = 0;
  for (const { user, cand, weight } of axes) {
    const diff = cand === null ? 0.25 : Math.abs(user - cand);
    score += weight * (1 - diff);
  }
  return clamp01(score);
}
