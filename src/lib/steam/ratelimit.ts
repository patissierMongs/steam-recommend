import "server-only";

/**
 * 외부 API 예의 계층: 프로세스 전역 최소 간격 스로틀 + 429/5xx 적응형 백오프.
 * 'use cache' 함수 내부에서만 호출되므로 캐시 미스(실제 요청)에서만 비용이 발생하고,
 * 웜 캐시 경로에는 영향이 없다. 서버 인스턴스별 best-effort.
 *
 * 참고: 콜드 캐시에서 대형 라이브러리를 분석하면 여전히 수 분이 걸릴 수 있다.
 * 프로덕션에서는 'use cache: remote'(공유 지속 캐시)로 전환해 콜드 로드 자체를 줄일 것.
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

/** SteamSpy: 공식 권고는 1 req/s. 캐시 전제하에 완만히 접근 + 429 시 백오프로 흡수 */
export const throttleSteamSpy = makeThrottle(600);
/** Steam Store API(appdetails 등): 대략 200 req/5min(≈1.5s) IP 한도 */
export const throttleStore = makeThrottle(500);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 지수 백오프(+지터), 상한 10초 */
function backoffMs(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
}

export interface PoliteFetchOptions {
  throttle: () => Promise<void>;
  timeoutMs?: number;
  retries?: number;
}

/**
 * 스로틀 후 fetch. 429/5xx는 Retry-After를 존중해 지수 백오프로 재시도한다.
 * 재시도를 모두 소진해도 실패하면 마지막 응답을 그대로 반환(호출부가 상태코드로 판단).
 * 네트워크 오류/타임아웃은 재시도 후 throw → 'use cache'가 나쁜 데이터를 캐시하지 않게 한다.
 */
export async function politeFetch(url: string, opts: PoliteFetchOptions): Promise<Response> {
  const { throttle, timeoutMs = 12_000, retries = 2 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : backoffMs(attempt);
      await sleep(wait);
      continue;
    }
    return res;
  }
  // 도달 불가(위 루프가 항상 반환/throw)하지만 타입 만족용
  throw lastError ?? new Error("politeFetch: 재시도 소진");
}
