import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-20 text-center">
      <h1 className="text-xl font-bold">올바른 SteamID가 아닙니다</h1>
      <p className="mt-3 text-sm text-muted">
        주소의 SteamID64(17자리 숫자)를 확인해주세요. 커스텀 URL 이름은 홈에서 검색하면
        자동으로 해석됩니다.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
      >
        홈으로
      </Link>
    </main>
  );
}
