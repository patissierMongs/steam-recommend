import {
  getBacklogRecs,
  getCoplayRecs,
  getHiddenGemRecs,
  getLapsedRecs,
  getNewReleaseRecs,
  BACKLOG_FETCH_CAP,
  LAPSED_FETCH_CAP,
} from "@/lib/analysis/pipeline";
import { hasApiKey } from "@/lib/steam/webapi";
import { EmptyNote, Section } from "./Section";
import { GameCardGrid } from "./GameCard";

/**
 * 추천 섹션들 — 각각 async 서버 컴포넌트로 page의 <Suspense>에서 개별 스트리밍.
 * 데이터 실패는 섹션 안에서 격리해 나머지 대시보드를 살린다.
 */

export async function BacklogSection({ steamid }: { steamid: string }) {
  let recs;
  try {
    recs = await getBacklogRecs(steamid);
  } catch {
    return <SectionError title="백로그에서 추천" />;
  }
  if (!recs) return null;
  return (
    <Section
      title="백로그에서 추천"
      subtitle={`2시간 미만 기록 항목 중 외부 조회 예산상 AppID 내림차순 최대 ${BACKLOG_FETCH_CAP}개만 평가해, 확보된 태그 코사인과 리뷰 긍정률 Wilson 하한으로 정렬한 검증 전 기준선입니다. AppID는 취득 시각을 뜻하지 않습니다.`}
    >
      {recs.length === 0 ? (
        <EmptyNote>2시간 미만 기록 후보가 없거나 분석할 데이터가 부족합니다.</EmptyNote>
      ) : (
        <GameCardGrid recs={recs} />
      )}
    </Section>
  );
}

export async function LapsedSection({ steamid }: { steamid: string }) {
  let recs;
  try {
    recs = await getLapsedRecs(steamid);
  } catch {
    return <SectionError title="다시 잡을 게임" />;
  }
  if (!recs || recs.length === 0) return null;
  return (
    <Section
      title="다시 잡을 게임"
      subtitle={`2~40시간 기록 후 6개월 이상 최근 실행이 없는 항목 중 누적시간 내림차순 최대 ${LAPSED_FETCH_CAP}개만 평가해, 확보된 태그·리뷰 신호로 정렬한 검증 전 기준선입니다. 완료 여부나 만족도는 추론하지 않습니다.`}
    >
      <GameCardGrid recs={recs} />
    </Section>
  );
}

export async function CoplaySection({ steamid }: { steamid: string }) {
  if (!hasApiKey()) {
    return (
      <Section title="리뷰어 라이브러리 동시출현">
        <EmptyNote>
          이 섹션은 리뷰어들의 공개 라이브러리를 조회해야 해서 서버에 STEAM_API_KEY가 있어야 계산됩니다.
        </EmptyNote>
      </Section>
    );
  }
  let anchors;
  try {
    anchors = await getCoplayRecs(steamid);
  } catch {
    return <SectionError title="리뷰어 라이브러리 동시출현" />;
  }
  if (!anchors || anchors.length === 0) return null;
  return (
    <Section
      title="리뷰어 라이브러리 동시출현"
      subtitle="당신의 최다 플레이 게임을 긍정 리뷰한 유저들의 공개 라이브러리에서, 전역 인기도로 완만히 보정해 함께 관측된 현재 라이브러리 밖 게임을 골랐습니다(표본 기반 근사)."
    >
      <div className="space-y-8">
        {anchors.map((anchor) => (
          <div key={anchor.appid}>
            <h3 className="mb-3 text-sm font-semibold">
              <span className="text-accent">{anchor.name}</span> 리뷰어 라이브러리에 함께 있는 게임
              <span className="ml-2 text-[11px] font-normal text-muted">
                리뷰어 표본 {anchor.sampleSize}명
              </span>
            </h3>
            <GameCardGrid recs={anchor.recommendations} />
          </div>
        ))}
      </div>
    </Section>
  );
}

export async function NewReleasesSection({ steamid }: { steamid: string }) {
  let recs;
  try {
    recs = await getNewReleaseRecs(steamid);
  } catch {
    return <SectionError title="플레이 기록과 가까운 신작" />;
  }
  if (!recs) return null;
  return (
    <Section
      title="플레이 기록과 가까운 신작"
      subtitle="Steam 신작·출시 예정 목록을, 확보된 태그 코사인과 리뷰 긍정률 Wilson 하한으로 정렬한 검증 전 기준선입니다."
    >
      {recs.length === 0 ? (
        <EmptyNote>지금 신작 풀에서 정렬 근거를 확보한 게임이 없습니다.</EmptyNote>
      ) : (
        <GameCardGrid recs={recs} />
      )}
    </Section>
  );
}

export async function HiddenGemsSection({ steamid }: { steamid: string }) {
  let recs;
  try {
    recs = await getHiddenGemRecs(steamid);
  } catch {
    return <SectionError title="숨은 보석" />;
  }
  if (!recs || recs.length === 0) return null;
  return (
    <Section
      title="숨은 보석"
      subtitle="소유자 추정 200만 미만·리뷰 30개 이상인 후보 중, 플레이 기록 태그 프로필과 가까운 현재 라이브러리 밖 게임을 찾는 검증 전 기준선입니다."
    >
      <GameCardGrid recs={recs} />
    </Section>
  );
}

function SectionError({ title }: { title: string }) {
  return (
    <Section title={title}>
      <EmptyNote>외부 데이터 조회에 실패해 이 섹션을 건너뜁니다. 잠시 후 새로고침해 보세요.</EmptyNote>
    </Section>
  );
}
