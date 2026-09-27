"use client";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-20 text-center">
      <h1 className="text-xl font-bold">분석 중 문제가 발생했습니다</h1>
      <p className="mt-3 text-sm text-muted">
        Steam 쪽 API가 일시적으로 응답하지 않았을 수 있습니다.
        {error.digest ? ` (오류 코드: ${error.digest})` : ""}
      </p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="mt-6 rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
      >
        다시 시도
      </button>
    </main>
  );
}
