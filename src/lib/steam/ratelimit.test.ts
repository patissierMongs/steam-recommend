import { afterEach, describe, expect, it, vi } from "vitest";
import { politeFetch, retryAfterMs } from "./ratelimit";

const instantThrottle = () => Promise.resolve();

afterEach(() => vi.restoreAllMocks());

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : "ok", { status, headers });
}

describe("retryAfterMs", () => {
  it("초 단위 정수를 ms로", () => {
    expect(retryAfterMs("0")).toBe(0);
    expect(retryAfterMs("5")).toBe(5000);
  });

  it("30초 상한", () => {
    expect(retryAfterMs("100")).toBe(30_000);
  });

  it("HTTP-date 형식(미래)을 남은 ms로", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = retryAfterMs(future);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  it("과거 HTTP-date는 0으로 클램프", () => {
    expect(retryAfterMs(new Date(Date.now() - 10_000).toUTCString())).toBe(0);
  });

  it("헤더 없음/무효는 null", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("not-a-date")).toBeNull();
  });
});

describe("politeFetch", () => {
  it("200이면 재시도 없이 반환", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(200));
    const res = await politeFetch("https://x.test", { throttle: instantThrottle });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("429 후 200이면 재시도해 성공한다", async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(response(429, { "retry-after": "0" }))
        .mockResolvedValueOnce(response(200));
      const p = politeFetch("https://x.test", { throttle: instantThrottle, retries: 2 });
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("계속 5xx면 재시도를 소진하고 마지막 응답을 반환", async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(503));
      const p = politeFetch("https://x.test", { throttle: instantThrottle, retries: 2 });
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.status).toBe(503);
      expect(fetchSpy).toHaveBeenCalledTimes(3); // 최초 + 2회 재시도
    } finally {
      vi.useRealTimers();
    }
  });

  it("네트워크 오류는 재시도 후 throw (나쁜 데이터 캐시 방지)", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
      const p = politeFetch("https://x.test", { throttle: instantThrottle, retries: 1 });
      const assertion = expect(p).rejects.toThrow("network");
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
