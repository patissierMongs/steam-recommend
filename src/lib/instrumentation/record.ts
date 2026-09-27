import "server-only";
import { getAnalysis, getBacklogRecs, getLapsedRecs } from "@/lib/analysis/pipeline";
import { backlogEligible, lapsedEligible } from "@/lib/analysis/recommend";
import { buildImpression, buildSnapshot, recSectionElementId, subjectId, type RecSection } from "./events";
import { getSink, instrumentationSalt } from "./sink";

export interface ExposureTarget {
  impressionId: string;
  section: RecSection;
  elementId: string;
}

/**
 * Stage 1 대시보드 배선 (docs/STAGE1_INSTRUMENTATION.md).
 *
 * 기록 조건 전부 충족 시에만 동작한다:
 * (a) 서버 opt-in (INSTRUMENTATION_ENABLED=1, 아니면 sink가 no-op)
 * (b) 뷰어가 로그인 본인이고 (c) 그 계정의 유효한 동의 쿠키 — 호출자가 검증해 넘긴다.
 * 제3자 프로필 열람은 절대 기록하지 않는다.
 *
 * 이번 증분은 snapshot + 백로그/다시잡을 impression(서버가 만든 목록)만 기록한다. 실제 노출은
 * 클라이언트가 카드의 화면 진입을 확인한 뒤 /api/instrumentation/exposure로 따로 보낸다. featured 기반 섹션
 * (신작·숨은 보석·동시출현)은 candidate universe가 featured 피드·리뷰어 표본에 걸쳐 있어
 * 잘못된 universe를 기록하면 Stage 2 risk set이 오염된다 — 정확한 universe 추출이
 * 마련될 때까지 보류한다(기록하지 않는 것이 틀리게 기록하는 것보다 낫다).
 *
 * 실패는 렌더를 깨지 않는다(빈 배열 반환). dev JSONL sink는 append-only라 렌더마다 이벤트가 쌓인다 —
 * 중복 억제·쿼터는 배포용 sink의 몫으로 문서화되어 있다.
 */
export async function recordDashboardInstrumentation(steamid: string): Promise<ExposureTarget[]> {
  try {
    const sink = getSink();
    const salt = instrumentationSalt();
    const analysis = await getAnalysis(steamid);
    if (!analysis) return [];
    const subject = subjectId(steamid, salt);

    await sink.recordSnapshot(
      buildSnapshot(subject, new Date(analysis.nowMs).toISOString(), "auto", analysis.owned),
    );

    const [backlog, lapsed] = await Promise.all([getBacklogRecs(steamid), getLapsedRecs(steamid)]);
    const generatedAt = new Date().toISOString();
    const targets: ExposureTarget[] = [];

    const sections = [
      {
        section: "backlog" as const,
        recs: backlog,
        universe: analysis.owned
          .filter((g) => backlogEligible(g, analysis.factsByAppid.get(g.appid)))
          .map((g) => g.appid),
      },
      {
        section: "lapsed" as const,
        recs: lapsed,
        universe: analysis.owned
          .filter((g) => lapsedEligible(g, analysis.factsByAppid.get(g.appid), analysis.nowMs))
          .map((g) => g.appid),
      },
    ];
    for (const { section, recs, universe } of sections) {
      if (!recs) continue;
      const impression = buildImpression({
        subject,
        section,
        generatedAt,
        recommendations: recs,
        candidateUniverse: universe,
      });
      await sink.recordImpression(impression);
      if (recs.length > 0) {
        targets.push({ impressionId: impression.impressionId, section, elementId: recSectionElementId(section) });
      }
    }
    return targets;
  } catch {
    return [];
  }
}
