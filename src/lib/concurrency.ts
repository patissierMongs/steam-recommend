/** 외부 API 예의용 동시성 제한 fan-out. 실패는 null로 격리(allSettled 의미론). */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
      } catch {
        results[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
