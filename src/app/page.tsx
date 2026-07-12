import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const ERROR_MESSAGES: Record<string, string> = {
  notfound: "프로필을 찾지 못했습니다. SteamID64, 커스텀 URL 이름, 프로필 주소를 다시 확인해주세요.",
  login: "Steam 로그인 검증에 실패했습니다. 다시 시도해주세요.",
  nokey: "서버에 STEAM_API_KEY가 설정되지 않아 프로필을 조회할 수 없습니다. .env.local을 확인하세요.",
  empty: "조회할 프로필을 입력해주세요.",
};

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          다음에 할 게임, <span className="text-accent">데이터</span>가 골라드립니다
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted">
          플레이타임 가중 태그 프로필(TF-IDF), 리뷰의 Wilson 신뢰하한, 같은 게임을 즐긴
          유저들의 동시보유 lift까지 — 단순 &ldquo;플레이 여부&rdquo;가 아니라 통계적으로
          의미 있는 신호를 결합해 백로그·신작·숨은 보석을 추천합니다.
        </p>
      </section>

      <Suspense fallback={null}>
        <ErrorBanner searchParams={searchParams} />
      </Suspense>

      <section className="mt-10 rounded-xl border border-edge bg-surface p-6">
        <form action="/api/lookup" method="GET" className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            name="q"
            required
            placeholder="SteamID64, 커스텀 URL 이름 또는 프로필 주소"
            className="min-w-0 flex-1 rounded-lg border border-edge bg-background px-4 py-3 text-sm outline-none placeholder:text-muted/70 focus:border-accent"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent-strong px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
          >
            프로필 분석
          </button>
        </form>
        <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-muted sm:flex-row">
          <p>
            예: <code className="rounded bg-background px-1.5 py-0.5">76561197960434622</code> 또는{" "}
            <code className="rounded bg-background px-1.5 py-0.5">steamcommunity.com/id/닉네임</code>
          </p>
          <a
            href="/api/auth/steam"
            className="rounded-lg border border-edge bg-raised px-4 py-2 font-medium text-foreground transition hover:border-accent"
          >
            Steam으로 로그인
          </a>
        </div>
      </section>

      <Suspense fallback={null}>
        <SessionShortcut />
      </Suspense>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "취향 프로필",
            body: "플레이타임을 log 감쇠·중앙값 정규화·시간 감쇠로 가중해 태그 TF-IDF 벡터를 만듭니다.",
          },
          {
            title: "통계적 품질 보정",
            body: "리뷰 긍정률 대신 Wilson 신뢰하한으로 표본 크기를 반영해 순위를 매깁니다.",
          },
          {
            title: "동시보유 lift",
            body: "당신의 최애 게임을 좋아한 유저들의 라이브러리에서 기대 대비 과대표된 게임을 찾습니다.",
          },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border border-edge bg-surface p-5">
            <h2 className="text-sm font-semibold text-accent">{f.title}</h2>
            <p className="mt-2 text-xs leading-5 text-muted">{f.body}</p>
          </div>
        ))}
      </section>

      <p className="mt-8 text-center text-xs text-muted">
        추천을 받으려면 대상 프로필의 <strong>게임 상세 정보</strong>가 공개여야 합니다
        (Steam 프로필 → 프라이버시 설정).
      </p>
    </main>
  );
}

async function ErrorBanner({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const code = typeof params.error === "string" ? params.error : null;
  // Object.hasOwn: `"__proto__" in obj` 등 프로토타입 체인 매칭으로 객체가 렌더되어 크래시하는 것 방지
  if (!code || !Object.hasOwn(ERROR_MESSAGES, code)) return null;
  return (
    <div className="mx-auto mt-8 max-w-xl rounded-lg border border-red-400/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
      {ERROR_MESSAGES[code]}
    </div>
  );
}

async function SessionShortcut() {
  const cookieStore = await cookies();
  const steamid = verifySessionValue(cookieStore.get(SESSION_COOKIE)?.value);
  if (!steamid) return null;
  return (
    <div className="mt-6 text-center">
      <Link
        href={`/u/${steamid}`}
        className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-surface px-5 py-2.5 text-sm font-medium text-accent transition hover:border-accent"
      >
        내 대시보드로 이동 →
      </Link>
    </div>
  );
}
