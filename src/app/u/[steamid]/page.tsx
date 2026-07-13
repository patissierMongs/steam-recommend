import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAnalysis, getProfile, getTasteSummary } from "@/lib/analysis/pipeline";
import { SteamApiError } from "@/lib/steam/webapi";
import { ProfileHeader } from "./_components/ProfileHeader";
import { TasteSection } from "./_components/TasteSection";
import { StructureSection } from "./_components/StructureSection";
import { InstrumentationPanel } from "./_components/InstrumentationPanel";
import {
  BacklogSection,
  CoplaySection,
  HiddenGemsSection,
  LapsedSection,
  NewReleasesSection,
} from "./_components/RecSections";
import { LibraryExplorer } from "./_components/LibraryExplorer";
import { EmptyNote, Section, SectionSkeleton } from "./_components/Section";

type Params = Promise<{ steamid: string }>;

const STEAMID64_RE = /^\d{17}$/;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { steamid } = await params;
  if (!STEAMID64_RE.test(steamid)) return { title: "프로필 분석" };
  try {
    const profile = await getProfile(steamid);
    return { title: profile ? `${profile.personaname}의 추천` : "프로필 분석" };
  } catch {
    return { title: "프로필 분석" };
  }
}

export default async function DashboardPage({ params }: { params: Params }) {
  const { steamid } = await params;
  if (!STEAMID64_RE.test(steamid)) notFound();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Suspense fallback={<HeaderSkeleton />}>
        <ProfileHeader steamid={steamid} />
      </Suspense>
      <Suspense fallback={<AnalysisPending />}>
        <Dashboard steamid={steamid} />
      </Suspense>
    </main>
  );
}

/** 라이브러리 분석이 공통 선행 조건 — 완료 후 섹션별로 추가 작업을 스트리밍 */
async function Dashboard({ steamid }: { steamid: string }) {
  let analysis;
  try {
    analysis = await getAnalysis(steamid);
  } catch (err) {
    if (err instanceof SteamApiError) {
      if (err.kind === "no-key") {
        return (
          <NoticeCard title="라이브러리 연동에 서버 API 키가 필요합니다">
            로그인과 프로필 조회는 됐지만, 라이브러리 항목·플레이타임을 불러오려면 서버에{" "}
            <strong>STEAM_API_KEY</strong>가 필요합니다(Steam이 라이브러리 조회에 API 키를
            요구합니다). 서버 운영자가{" "}
            <a
              href="https://steamcommunity.com/dev/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              steamcommunity.com/dev/apikey
            </a>{" "}
            에서 키를 발급받아 <code className="rounded bg-background px-1">.env.local</code>의{" "}
            <code className="rounded bg-background px-1">STEAM_API_KEY</code>에 넣고 서버를 재시작하면,
            이후에는 로그인만으로 자동으로 추천이 표시됩니다.
          </NoticeCard>
        );
      }
      return <NoticeCard title="Steam API 오류">{err.message}</NoticeCard>;
    }
    throw err;
  }

  if (!analysis) {
    return (
      <NoticeCard title="라이브러리를 분석할 수 없습니다">
        이 프로필은 게임 상세 정보가 비공개이거나 라이브러리가 비어 있습니다. 본인 프로필이라면
        Steam <strong>프로필 편집 → 프라이버시 설정 → 게임 상세 정보</strong>를
        &ldquo;공개&rdquo;로 바꾼 뒤 다시 시도해주세요.
      </NoticeCard>
    );
  }

  const summary = await getTasteSummary(steamid);
  // 플레이 기록 태그 벡터가 있어야 코사인 기준선을 계산할 수 있다.
  const noTaste = analysis.model.profile.size === 0;

  return (
    <>
      <Suspense fallback={null}>
        <InstrumentationPanel steamid={steamid} />
      </Suspense>
      {summary ? <TasteSection summary={summary} /> : null}
      {noTaste ? (
        <div className="mt-6">
          <EmptyNote>
            확인된 게임 태그가 없어 태그 유사도만 보류합니다. 리뷰 표본 요약이나 리뷰어
            라이브러리 동시출현처럼 별도로 확보된 신호는 계속 표시됩니다.
          </EmptyNote>
        </div>
      ) : null}
      <Suspense fallback={<SectionSkeleton title="행동 구조 분석 — 태그 외 피벗" />}>
        <StructureSection steamid={steamid} />
      </Suspense>
      <Section
        title="실험적 검증 세션"
        subtitle="태그별 고플레이 게임 두 개를 숨기고 재구성 순위를 확인하는 별도 진단입니다. 추천 정확도나 미래 행동 검증은 아닙니다."
      >
        <Link
          href={`/u/${steamid}/validation/tag-holdout`}
          className="inline-flex rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-accent transition hover:border-accent"
        >
          태그 마스킹 복원 세션 열기 →
        </Link>
      </Section>
      <Suspense fallback={<SectionSkeleton title="백로그에서 추천" />}>
        <BacklogSection steamid={steamid} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="다시 잡을 게임" />}>
        <LapsedSection steamid={steamid} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="리뷰어 라이브러리 동시출현" />}>
        <CoplaySection steamid={steamid} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="플레이 기록과 가까운 신작" />}>
        <NewReleasesSection steamid={steamid} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="숨은 보석" />}>
        <HiddenGemsSection steamid={steamid} />
      </Suspense>
      <Section
        title="전체 라이브러리"
        subtitle={`${analysis.owned.length.toLocaleString()}개 항목 — 검색·정렬할 수 있습니다.`}
      >
        <LibraryExplorer
          rows={analysis.owned.map((g) => ({
            appid: g.appid,
            name: g.name,
            playtimeMinutes: g.playtime_forever,
            lastPlayed: g.rtime_last_played ?? 0,
          }))}
        />
      </Section>
    </>
  );
}

function NoticeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-10 rounded-xl border border-edge bg-surface p-8 text-center">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted">{children}</p>
      <Link href="/" className="mt-5 inline-block text-sm text-accent hover:underline">
        ← 다른 프로필 조회
      </Link>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4 rounded-xl border border-edge bg-surface p-5">
      <div className="size-[72px] rounded-lg bg-raised" />
      <div className="space-y-2">
        <div className="h-6 w-48 rounded bg-raised" />
        <div className="h-3 w-64 rounded bg-raised" />
      </div>
    </div>
  );
}

function AnalysisPending() {
  return (
    <div className="mt-10">
      <div className="rounded-xl border border-edge bg-surface px-5 py-4 text-sm text-muted">
        라이브러리를 불러와 태그·리뷰 데이터를 분석하는 중입니다… 라이브러리가 크면 첫 분석에
        수십 초가 걸릴 수 있습니다 (게임별 공개 메타데이터만 서버에 캐시됩니다).
      </div>
      <SectionSkeleton title="Steam 라이브러리 기록 요약" cards={4} />
      <SectionSkeleton title="백로그에서 추천" cards={4} />
    </div>
  );
}
