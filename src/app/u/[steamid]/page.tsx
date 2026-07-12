import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAnalysis, getProfile, getTasteSummary } from "@/lib/analysis/pipeline";
import { SteamApiError } from "@/lib/steam/webapi";
import { ProfileHeader } from "./_components/ProfileHeader";
import { TasteSection } from "./_components/TasteSection";
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
      return (
        <NoticeCard title={err.kind === "no-key" ? "서버 설정 필요" : "Steam API 오류"}>
          {err.message}
        </NoticeCard>
      );
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

  return (
    <>
      {summary ? <TasteSection summary={summary} /> : null}
      {analysis.model.preferenceWeights.size === 0 ? (
        <div className="mt-6">
          <EmptyNote>
            플레이 기록(30분 이상)이 있는 게임이 없어 취향 기반 추천을 만들 수 없습니다.
          </EmptyNote>
        </div>
      ) : (
        <>
          <Suspense fallback={<SectionSkeleton title="백로그에서 추천" />}>
            <BacklogSection steamid={steamid} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title="다시 잡을 게임" />}>
            <LapsedSection steamid={steamid} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title="이 게임을 즐겼다면" />}>
            <CoplaySection steamid={steamid} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title="취향에 맞는 신작" />}>
            <NewReleasesSection steamid={steamid} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title="숨은 보석" />}>
            <HiddenGemsSection steamid={steamid} />
          </Suspense>
        </>
      )}
      <Section
        title="전체 라이브러리"
        subtitle={`${analysis.owned.length.toLocaleString()}개 게임 — 검색·정렬할 수 있습니다.`}
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
        수십 초가 걸릴 수 있습니다 (결과는 서버에 캐시됩니다).
      </div>
      <SectionSkeleton title="취향 프로필" cards={4} />
      <SectionSkeleton title="백로그에서 추천" cards={4} />
    </div>
  );
}
