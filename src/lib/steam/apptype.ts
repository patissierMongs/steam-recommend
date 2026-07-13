/** 앱 타입 판정 — 순수 함수 (서버 전용 의존성 없음, 단위 테스트 가능) */

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

/**
 * 추천 대상 여부. appType이 null(상점 조회 실패·미확인)이면 통과시킨다 —
 * 타입을 확정할 수 없을 때 게임을 감추면 상점 장애 시 섹션이 비므로,
 * DLC 제거는 "확정된 비-게임만 제외"하는 best-effort 정책이다.
 */
export function isGameType(appType: string | null): boolean {
  return appType === null || !NON_GAME_TYPES.has(appType.toLowerCase());
}
