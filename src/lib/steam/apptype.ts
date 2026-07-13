/** 앱 타입 판정 — 순수 함수 (서버 전용 의존성 없음, 단위 테스트 가능) */
import type { GameFacts } from "@/lib/types";

/** 게임 본편이 아닌 앱 타입 — 추천 대상에서 제외 */
export const NON_GAME_TYPES = new Set([
  "dlc",
  "music",
  "video",
  "movie",
  "series",
  "episode",
  "demo",
  "mod",
  "hardware",
  "advertising",
]);

/** 소프트웨어/유틸리티를 가리키는 SteamSpy 태그·장르 (Wallpaper Engine, 3DMark 등) */
const SOFTWARE_MARKERS = new Set([
  "Utilities",
  "Software",
  "Web Publishing",
  "Animation & Modeling",
  "Video Production",
  "Audio Production",
  "Photo Editing",
  "Design & Illustration",
  "Software Training",
  "Benchmark",
  "Game Development",
]);

/**
 * 추천 대상 여부. appType이 null(상점 조회 실패·미확인)이면 통과시킨다 —
 * 타입을 확정할 수 없을 때 게임을 감추면 상점 장애 시 섹션이 비므로,
 * DLC 제거는 "확정된 비-게임만 제외"하는 best-effort 정책이다.
 */
export function isGameType(appType: string | null): boolean {
  return appType === null || !NON_GAME_TYPES.has(appType.toLowerCase());
}

/**
 * 취향/persona/클러스터 입력에서 제외할 비-게임 판정 (P8).
 * 상점 타입이 확정 비-게임이거나, SteamSpy 태그/장르가 소프트웨어를 강하게 가리키면 true.
 * appType이 null이어도 SteamSpy만으로 Wallpaper Engine·3DMark 류를 걸러낸다.
 */
export function looksLikeNonGame(facts: GameFacts): boolean {
  if (facts.appType && !isGameType(facts.appType)) return true;
  if (facts.genres.some((g) => SOFTWARE_MARKERS.has(g))) return true;
  const entries = Object.entries(facts.tags);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total > 0) {
    const softwareVotes = entries.filter(([t]) => SOFTWARE_MARKERS.has(t)).reduce((a, [, v]) => a + v, 0);
    if (softwareVotes / total > 0.3) return true; // 태그 투표의 30%+ 가 소프트웨어 마커
  }
  return false;
}
