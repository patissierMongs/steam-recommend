import "server-only";

/**
 * 프로세스 전역 최소 간격 스로틀. 'use cache' 함수 내부에서 호출되므로
 * 캐시 미스(실제 외부 요청)에서만 대기가 발생하고, 웜 캐시 경로에는 비용이 없다.
 * 서버 인스턴스별 best-effort — 외부 API 예의 목적이지 엄밀한 보장이 아니다.
 */
function makeThrottle(minIntervalMs: number): () => Promise<void> {
  let nextSlot = 0;
  return async () => {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + minIntervalMs;
    const wait = slot - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
}

/** SteamSpy: 공식 한도는 1 req/s — 캐시 전제하에 완만하게 초과하는 수준으로 유지 */
export const throttleSteamSpy = makeThrottle(200);
/** Steam Store API(appdetails 등): 대략 200 req/5min 수준의 IP 한도 */
export const throttleStore = makeThrottle(150);