import type { GameFacts, OwnedGame } from "@/lib/types";
import { MIN_EVIDENCE_MINUTES } from "@/lib/analysis/taste";
import { smoothedLogLift } from "@/lib/analysis/stats";

/**
 * 특징 태그 조합 — 개별 태그가 아니라 태그 "쌍"을 관측 단위로 본다 (H-017).
 *
 * 동기: Multiplayer·Action·Free to Play·Singleplayer 같은 광역 태그는 다양하게
 * 플레이할수록 프로필 상위에 누적된다(사용자 관측, 실계정에서 확인). 개별 태그의
 * 빈도 대신 "함께 나타나는 정도가 개별 빈도의 곱(독립 가정)을 초과하는 쌍"을 보면
 * 광역 태그는 자연히 무정보(lift≈0)가 되고, 조합만이 남는다.
 *
 * 이것은 플레이 근거 게임의 관측 요약이다 — 선호·추천 신호가 아니며 랭킹에 쓰지
 * 않는다. 랭킹 표현 교체는 H-017 검증 게이트를 통과해야 한다.
 */

export interface TagComboSignal {
  tagA: string;
  tagB: string;
  /** 함께 나타난 플레이 근거 게임 수 */
  support: number;
  /** 평활화된 log(관측 동시출현 / 독립 기대) — 양수면 기대 초과 */
  logLift: number;
  /** 이 조합을 함께 가진 게임 (플레이타임 내림차순 상위) */
  games: string[];
}

export interface TagComboProfile {
  combos: TagComboSignal[];
  /** 조합 계산에 쓴 플레이 근거 게임 수 */
  corpusSize: number;
  /** 광역 판정으로 쌍 후보에서 제외된 태그 (corpus 과반 출현) — 화면 공개용 */
  broadTags: string[];
}

/** 쌍 지지도 하한 — 이 미만의 동시출현은 순수 노이즈라 표시하지 않는다 (표시 규칙, 공개) */
export const MIN_PAIR_SUPPORT = 3;

function isConfirmedGame(facts: GameFacts): boolean {
  return facts.appType?.toLowerCase() === "game";
}

export function buildTagComboProfile(
  owned: OwnedGame[],
  factsByAppid: Map<number, GameFacts>,
  limit = 10,
): TagComboProfile {
  // corpus: 플레이 근거가 있는 확인된 게임의 태그 존재 집합 (투표수 크기는 스팸 취약이라 미사용)
  const corpus: { name: string; minutes: number; tags: Set<string> }[] = [];
  for (const g of owned) {
    if (g.playtime_forever < MIN_EVIDENCE_MINUTES) continue;
    const facts = factsByAppid.get(g.appid);
    if (!facts || !isConfirmedGame(facts)) continue;
    const tags = new Set(
      Object.entries(facts.tags)
        .filter(([, votes]) => votes > 0)
        .map(([tag]) => tag),
    );
    if (tags.size > 0) corpus.push({ name: facts.name, minutes: g.playtime_forever, tags });
  }
  const n = corpus.length;

  // 태그별 문서 빈도. corpus 과반에 나타나는 태그는 "광역"으로 쌍 후보에서 제외 —
  // 어차피 lift≈0이고, 사용자가 지적한 누적형 태그가 정확히 여기 해당한다.
  const df = new Map<string, number>();
  for (const g of corpus) for (const tag of g.tags) df.set(tag, (df.get(tag) ?? 0) + 1);
  const broadTags = [...df.entries()]
    .filter(([, d]) => d / n > 0.5)
    .map(([tag]) => tag)
    .sort();
  const broad = new Set(broadTags);

  // 쌍 동시출현 집계
  const pairCount = new Map<string, number>();
  const pairGames = new Map<string, { name: string; minutes: number }[]>();
  for (const g of corpus) {
    const eligible = [...g.tags].filter((t) => !broad.has(t)).sort();
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const key = `${eligible[i]}\u0000${eligible[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        let list = pairGames.get(key);
        if (!list) pairGames.set(key, (list = []));
        list.push({ name: g.name, minutes: g.minutes });
      }
    }
  }

  const combos: TagComboSignal[] = [];
  for (const [key, co] of pairCount) {
    if (co < MIN_PAIR_SUPPORT) continue;
    const [tagA, tagB] = key.split("\u0000");
    const baseRate = ((df.get(tagA) ?? 0) / n) * ((df.get(tagB) ?? 0) / n);
    const logLift = smoothedLogLift(co, n, baseRate);
    if (logLift <= 0) continue; // 기대 이하 조합은 무정보
    combos.push({
      tagA,
      tagB,
      support: co,
      logLift,
      games: (pairGames.get(key) ?? [])
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 3)
        .map((g) => g.name),
    });
  }
  combos.sort((a, b) => b.logLift - a.logLift || b.support - a.support);

  return { combos: combos.slice(0, limit), corpusSize: n, broadTags };
}
