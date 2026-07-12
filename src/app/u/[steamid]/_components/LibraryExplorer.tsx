"use client";

import { useMemo, useState } from "react";

interface LibraryRow {
  appid: number;
  name: string;
  playtimeMinutes: number;
  lastPlayed: number; // unix sec, 0 = 기록 없음
}

type SortKey = "playtime" | "recent" | "name";

function formatPlaytime(minutes: number): string {
  if (minutes === 0) return "—";
  if (minutes < 60) return `${minutes}분`;
  return `${(minutes / 60).toFixed(1)}시간`;
}

// UTC 고정 포맷: 클라이언트 컴포넌트는 SSR도 되므로, 서버 TZ와 브라우저 TZ가 다르면
// toLocaleDateString이 hydration mismatch를 낸다. timeZone을 고정해 결정적으로 만든다.
const DATE_FMT = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});

function formatLastPlayed(unixSec: number): string {
  if (!unixSec) return "—";
  return DATE_FMT.format(new Date(unixSec * 1000));
}

export function LibraryExplorer({ rows }: { rows: LibraryRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("playtime");
  const [limit, setLimit] = useState(50);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : [...rows];
    matched.sort((a, b) => {
      switch (sortKey) {
        case "playtime":
          return b.playtimeMinutes - a.playtimeMinutes;
        case "recent":
          return b.lastPlayed - a.lastPlayed;
        case "name":
          return a.name.localeCompare(b.name, "ko");
      }
    });
    return matched;
  }, [rows, query, sortKey]);

  const visible = filtered.slice(0, limit);

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(50);
          }}
          placeholder="게임 이름 검색"
          className="min-w-0 flex-1 rounded-lg border border-edge bg-background px-3 py-2 text-sm outline-none placeholder:text-muted/70 focus:border-accent"
        />
        <select
          aria-label="정렬 기준"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-edge bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="playtime">플레이타임순</option>
          <option value="recent">최근 플레이순</option>
          <option value="name">이름순</option>
        </select>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-edge">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-raised text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">게임</th>
              <th className="w-28 px-3 py-2 text-right font-medium">플레이타임</th>
              <th className="w-32 px-3 py-2 text-right font-medium">최근 플레이</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge bg-surface">
            {visible.map((row) => (
              <tr key={row.appid} className="hover:bg-raised/60">
                <td className="px-3 py-2">
                  <a
                    href={`https://store.steampowered.com/app/${row.appid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent"
                  >
                    {row.name}
                  </a>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {formatPlaytime(row.playtimeMinutes)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {formatLastPlayed(row.lastPlayed)}
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted">
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>
          {visible.length.toLocaleString()} / {filtered.length.toLocaleString()}개 표시
        </span>
        {filtered.length > limit ? (
          <button
            type="button"
            onClick={() => setLimit((l) => l + 100)}
            className="rounded border border-edge px-2 py-1 transition hover:border-accent hover:text-foreground"
          >
            더 보기
          </button>
        ) : null}
      </div>
    </div>
  );
}
