import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { CONSENT_COOKIE, verifyConsentValue } from "@/lib/instrumentation/consent";
import { recordDashboardInstrumentation } from "@/lib/instrumentation/record";

/**
 * Stage 1 수집 동의 패널 + 기록 트리거 (docs/STAGE1_INSTRUMENTATION.md).
 *
 * 로그인한 본인 대시보드에서만 렌더된다. 동의가 유효하면 이 렌더에서 snapshot과
 * 일부 섹션 impression을 기록한다 — 제3자 프로필 열람은 어떤 경우에도 기록하지 않는다.
 * 서버가 INSTRUMENTATION_ENABLED=1이 아니면 동의가 있어도 sink는 no-op이다.
 */
export async function InstrumentationPanel({ steamid }: { steamid: string }) {
  const cookieStore = await cookies();
  const sessionSteamid = verifySessionValue(cookieStore.get(SESSION_COOKIE)?.value);
  if (sessionSteamid !== steamid) return null; // 본인 대시보드가 아니면 표시·기록 모두 없음

  const consented = verifyConsentValue(cookieStore.get(CONSENT_COOKIE)?.value, steamid);
  if (consented) {
    await recordDashboardInstrumentation(steamid);
  }

  return (
    <div className="mt-6 rounded-xl border border-edge bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold">시간 분리 스냅샷 수집 (Stage 1)</h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {consented
              ? "동의됨 — 본인 대시보드를 열 때 라이브러리 스냅샷과 추천 노출 기록을 가명(salt HMAC)으로 남깁니다. 추천 품질 검증(시간 분리 평가)에만 쓰이며, 철회하면 이후 수집이 즉시 중단됩니다."
              : "현재 꺼짐 — 동의하면 본인 대시보드를 열 때 라이브러리 스냅샷과 추천 노출 기록을 가명(salt HMAC)으로 남깁니다. 이 데이터 없이는 추천 정확도를 검증할 수 없습니다. 게임 이름·프로필 텍스트는 수집하지 않으며 언제든 철회할 수 있습니다."}
          </p>
        </div>
        <form action="/api/instrumentation/consent" method="post">
          <input type="hidden" name="action" value={consented ? "revoke" : "grant"} />
          <button
            type="submit"
            className="rounded-lg border border-edge bg-raised px-4 py-2 text-sm font-medium text-accent transition hover:border-accent"
          >
            {consented ? "수집 동의 철회" : "수집 동의"}
          </button>
        </form>
      </div>
    </div>
  );
}
