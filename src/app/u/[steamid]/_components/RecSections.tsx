import {
  getBacklogRecs,
  getCoplayRecs,
  getHiddenGemRecs,
  getLapsedRecs,
  getNewReleaseRecs,
} from "@/lib/analysis/pipeline";
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
      subtitle="보유 중이지만 거의 플레이하지 않은 게임 중 취향 매칭(코사인)과 리뷰 신뢰하한(Wilson)이 높은 순."
    >
      {recs.length === 0 ? (
        <EmptyNote>미플레이 게임이 없거나 분석할 데이터가 부족합니다.</EmptyNote>
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
      subtitle="어느 정도 하다가 6개월 이상 방치한 게임 중, 지금 취향과 잘 맞고 아직 다 즐기지 못한 순."
    >
      <GameCardGrid recs={recs} />
    </Section>
  );
}

export async function CoplaySection({ steamid }: { steamid: string }) {
  let anchors;
  try {
    anchors = await getCoplayRecs(steamid);
  } catch {
    return <SectionError title="이 게임을 즐겼다면" />;
  }
  if (!anchors || anchors.length === 0) return null;
  return (
    <Section
      title="이 게임을 즐겼다면"
      subtitle="당신의 최다 플레이 게임을 긍정 리뷰한 유저들의 공개 라이브러리에서, 전역 인기도로 완만히 보정해 자주 함께 플레이되는 미보유 게임을 골랐습니다(표본 기반 근사)."
    >
      <div className="space-y-8">
        {anchors.map((anchor) => (
          <div key={anchor.appid}>
            <h3 className="mb-3 text-sm font-semibold">
              <span className="text-accent">{anchor.name}</span> 플레이어들이 많이 하는 게임
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
    return <SectionError title="취향에 맞는 신작" />;
  }
  if (!recs) return null;
  return (
    <Section
      title="취향에 맞는 신작"
      subtitle="Steam 신작·출시 예정 목록에서 미보유 게임을 취향 매칭과 리뷰 신뢰하한으로 정렬했습니다."
    >
      {recs.length === 0 ? (
        <EmptyNote>지금 신작 풀에서 취향에 맞는 게임을 찾지 못했습니다.</EmptyNote>
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
      subtitle="유명하진 않지만(소유자 200만 미만) 리뷰 신뢰하한이 높고 취향에 맞는 미보유 게임 — 인기도의 역수를 명시적으로 보상한 순위입니다."
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
