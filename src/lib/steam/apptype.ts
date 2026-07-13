/** 앱 타입 판정 — 순수 함수 (서버 전용 의존성 없음, 단위 테스트 가능) */

/** 표시 가능한 확인된 게임 본편인지 여부. */
export function isGameType(appType: string | null): boolean {
  return appType?.toLowerCase() === "game";
}

/** Store 타입 확인 전 랭킹 후보로만 유지할 수 있는지 여부. 표시 전에는 isGameType을 다시 적용한다. */
export function isPotentialGameType(appType: string | null): boolean {
  return appType === null || isGameType(appType);
}
