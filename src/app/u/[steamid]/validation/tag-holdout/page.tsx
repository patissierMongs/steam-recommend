import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTagHoldoutDiagnostic } from "@/lib/analysis/pipeline";
import { SteamApiError } from "@/lib/steam/webapi";
import { isProfileParam } from "@/lib/demo";
import { ProfileHeader } from "../../_components/ProfileHeader";
import { TagHoldoutReportView } from "../../_components/TagHoldoutReport";

type Params = Promise<{ steamid: string }>;

export const metadata: Metadata = { title: "태그 마스킹 복원 진단" };

export default function TagHoldoutPage({ params }: { params: Params }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Suspense fallback={<p className="text-sm text-muted">프로필을 불러오는 중입니다…</p>}>
        <DiagnosticHeader params={params} />
      </Suspense>
      <Suspense fallback={<DiagnosticPending />}>
        <DiagnosticContent params={params} />
      </Suspense>
    </main>
  );
}

async function readSteamid(params: Params): Promise<string> {
  const { steamid } = await params;
  if (!isProfileParam(steamid)) notFound();
  return steamid;
}

async function DiagnosticHeader({ params }: { params: Params }) {
  const steamid = await readSteamid(params);
  return (
    <>
      <ProfileHeader steamid={steamid} />
      <Link href={`/u/${steamid}`} className="mt-4 inline-block text-sm text-accent hover:underline">
        ← 추천 화면으로 돌아가기
      </Link>
    </>
  );
}

async function DiagnosticContent({ params }: { params: Params }) {
  const steamid = await readSteamid(params);
  let report;
  let apiError: string | null = null;
  try {
    report = await getTagHoldoutDiagnostic(steamid);
  } catch (error) {
    if (error instanceof SteamApiError) apiError = error.message;
    else throw error;
  }
  if (apiError) return <DiagnosticNotice>{apiError}</DiagnosticNotice>;
  if (!report)
    return <DiagnosticNotice>분석 가능한 공개 라이브러리 데이터를 확보하지 못했습니다.</DiagnosticNotice>;
  return <TagHoldoutReportView report={report} />;
}

function DiagnosticNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-10 rounded-xl border border-edge bg-surface px-5 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}

function DiagnosticPending() {
  return (
    <div className="mt-10 rounded-xl border border-edge bg-surface px-5 py-5 text-sm leading-6 text-muted">
      현재 featured 후보 전체의 Store 타입을 확인한 뒤 태그별 fold를 다시 계산하고 있습니다. 콜드
      캐시에서는 수 분이 걸릴 수 있습니다.
    </div>
  );
}
