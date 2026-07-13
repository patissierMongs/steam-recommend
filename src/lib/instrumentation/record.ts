import "server-only";
import { getAnalysis, getBacklogRecs, getLapsedRecs } from "@/lib/analysis/pipeline";
import { backlogEligible, lapsedEligible } from "@/lib/analysis/recommend";
import { buildImpression, buildSnapshot, subjectId } from "./events";
import { getSink, instrumentationSalt } from "./sink";

/**
 * Stage 1 대시보드 배선 (docs/STAGE1_INSTRUMENTATION.md).
 *
 * 기록 조건 전부 충족 시에만 동작한다:
 * (a) 서버 opt-in (INSTRUMENTATION_ENABLED=1, 아니면 sink가 no-op)
 * (b) 뷰어가 로그인 본인이고 (c) 그 계정의 유효한 동의 쿠키 — 호출자가 검증해 넘긴다.
 * 제3자 프로필 열람은 절대 기록하지 않는다.
 *
 * 이번 증분은 snapshot + 백로그/다시잡을 impression만 기록한다. featured 기반 섹션
 * (신작·숨은 보석·동시출현)은 candidate universe가 featured 피드·리뷰어 표본에 걸쳐 있어
 * 잘못된 universe를 기록하면 Stage 2 risk set이 오염된다 — 정확한 universe 추출이
 * 마련될 때까지 보류한다(기록하지 않는 것이 틀리게 기록하는 것보다 낫다).
 *
 * 실패는 렌더를 깨지 않는다. dev JSONL sink는 append-only라 렌더마다 이벤트가 쌓인다 —
 * 중복 억제·쿼터는 배포용 sink의 몫으로 문서화되어 있다.
 */
export async function recordDashboardInstrumentation(steamid: string): Promise<void> {
  try {
    const sink = getSink();
    const salt = instrumentationSalt();
    const analysis = await getAnalysis(steamid);
    if (!analysis) return;
    const subject = subjectId(steamid, salt);
    const shownAt = new Date(analysis.nowMs).toISOString();

    await sink.recordSnapshot(buildSnapshot(subject, shownAt, "auto", analysis.owned));

    const [backlog, lapsed] = await Promise.all([getBacklogRecs(steamid), getLapsedRecs(steamid)]);
    if (backlog && backlog.length > 0) {
      const universe = analysis.owned
        .filter((g) => backlogEligible(g, analysis.factsByAppid.get(g.appid)))
        .map((g) => g.appid);
      await sink.recordImpression(
        buildImpression({
          subject,
          section: "backlog",
          shownAt,
          recommendations: backlog,
          candidateUniverse: universe,
        }),
      );
    }
    if (lapsed && lapsed.length > 0) {
      const universe = analysis.owned
        .filter((g) => lapsedEligible(g, analysis.factsByAppid.get(g.appid), analysis.nowMs))
        .map((g) => g.appid);
      await sink.recordImpression(
        buildImpression({
          subject,
          section: "lapsed",
          shownAt,
          recommendations: lapsed,
          candidateUniverse: universe,
        }),
      );
    }
  } catch {
    // 수집 실패가 제품 렌더를 깨서는 안 된다 — 이벤트는 유실될 수 있는 관측일 뿐이다.
  }
}
