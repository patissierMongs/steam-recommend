export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="flex animate-pulse items-center gap-4 rounded-xl border border-edge bg-surface p-5">
        <div className="size-[72px] rounded-lg bg-raised" />
        <div className="space-y-2">
          <div className="h-6 w-48 rounded bg-raised" />
          <div className="h-3 w-64 rounded bg-raised" />
        </div>
      </div>
      <p className="mt-10 text-center text-sm text-muted">프로필을 불러오는 중…</p>
    </main>
  );
}
