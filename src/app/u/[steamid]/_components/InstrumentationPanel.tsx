import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { CONSENT_COOKIE, verifyConsentValue } from "@/lib/instrumentation/consent";
import { recordDashboardInstrumentation, type ExposureTarget } from "@/lib/instrumentation/record";
import { instrumentationEnabled } from "@/lib/instrumentation/sink";
import { ExposureTracker } from "./ExposureTracker";

/**
 * Stage 1 수집 동의 패널 + 기록 트리거 (docs/STAGE1_INSTRUMENTATION.md).
 *
 * 로그인한 본인 대시보드에서만 렌더된다. 서버 수집이 켜져 있고 동의가 유효하면 이 렌더에서
 * snapshot과 일부 섹션 impression(서버가 만든 목록)을 기록하고, 노출은 ExposureTracker가
 * 화면 진입을 확인한 뒤 따로 보낸다. 서버 수집이 꺼져 있으면 동의 버튼 대신 그 사실을 표시한다.
 */
export async function InstrumentationPanel({ steamid }: { steamid: string }) {
  const cookieStore = await cookies();
  const sessionSteamid = verifySessionValue(cookieStore.get(SESSION_COOKIE)?.value);
  if (sessionSteamid !== steamid) return null; // 본인 대시보드가 아니면 표시·기록 모두 없음

  const consented = verifyConsentValue(cookieStore.get(CONSENT_COOKIE)?.value, steamid);
  const enabled = instrumentationEnabled();
  let targets: ExposureTarget[] = [];
  if (consented && enabled) {
    targets = await recordDashboardInstrumentation(steamid);
  }

  const status = !enabled
    ? "이 서버는 수집 기능이 꺼져 있어(INSTRUMENTATION_ENABLED 미설정) 동의 여부와 관계없이 아무것도 기록하지 않습니다."
    : consented
      ? "동의됨 — 본인 대시보드를 열 때 라이브러리 스냅샷과 추천 목록을, 카드가 실제로 화면에 보이면 노출 기록을 가명(salt HMAC)으로 남깁니다. 추천 품질 검증(시간 분리 평가)에만 쓰이며, 철회하면 이후 수집이 즉시 중단됩니다."
      : "현재 꺼짐 — 동의하면 본인 대시보드를 열 때 라이브러리 스냅샷과 추천 목록·노출 기록을 가명(salt HMAC)으로 남깁니다. 이 데이터 없이는 추천 정확도를 검증할 수 없습니다. 게임 이름·프로필 텍스트는 수집하지 않으며 언제든 철회할 수 있습니다.";

  return (
    <div className="mt-6 rounded-xl border border-edge bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold">시간 분리 스냅샷 수집 (Stage 1)</h3>
          <p className="mt-1 text-xs leading-5 text-muted">{status}</p>
        </div>
        {targets.length > 0 ? <ExposureTracker targets={targets} /> : null}
        {enabled ? (
          <form action="/api/instrumentation/consent" method="post">
            <input type="hidden" name="action" value={consented ? "revoke" : "grant"} />
            <button
              type="submit"
              className="rounded-lg border border-edge bg-raised px-4 py-2 text-sm font-medium text-accent transition hover:border-accent"
            >
              {consented ? "수집 동의 철회" : "수집 동의"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
