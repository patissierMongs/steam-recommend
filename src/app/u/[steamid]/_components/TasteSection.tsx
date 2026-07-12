import type { TasteProfileSummary } from "@/lib/types";
import { Section } from "./Section";

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-3" title={hint}>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight">{value}</p>
    </div>
  );
}

/**
 * 취향 프로필 시각화.
 * 태그 막대는 단일 시리즈 크기 비교(막대 차트) — 단일 색상, 라벨/수치는 텍스트 토큰.
 */
export function TasteSection({ summary }: { summary: TasteProfileSummary }) {
  const concentration =
    summary.concentrationHHI > 0.25 ? "집중형" : summary.concentrationHHI > 0.1 ? "균형형" : "잡식형";

  return (
    <Section
      title="취향 프로필"
      subtitle={`플레이 기록이 있는 ${summary.analyzedGames}개 게임의 태그를 플레이타임 가중 TF-IDF로 분석했습니다.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="보유 게임" value={summary.totalGames.toLocaleString()} />
        <StatTile label="총 플레이" value={`${summary.totalHours.toLocaleString()}시간`} />
        <StatTile
          label="미플레이"
          value={`${summary.neverPlayed}개 (${Math.round((summary.neverPlayed / Math.max(1, summary.totalGames)) * 100)}%)`}
          hint="한 번도 실행하지 않은 보유 게임"
        />
        <StatTile
          label="플레이한 게임 중앙값"
          value={`${summary.medianHoursPerPlayed}시간`}
          hint="30분 이상 플레이한 게임 기준"
        />
        <StatTile
          label="플레이 성향"
          value={concentration}
          hint={`플레이타임 집중도 HHI = ${summary.concentrationHHI.toFixed(3)} (1에 가까울수록 소수 게임에 집중)`}
        />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">상위 태그</h3>
          <ul className="mt-3 space-y-2">
            {summary.topTags.slice(0, 10).map((t) => (
              <li key={t.tag} className="group">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">{t.tag}</span>
                  <span className="truncate text-[11px] text-muted" title={t.topGames.join(", ")}>
                    {t.topGames.slice(0, 2).join(", ")}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-raised">
                  <div
                    className="h-2 rounded-full bg-accent"
                    style={{ width: `${Math.max(3, Math.round(t.weight * 100))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">장르 분포 (플레이타임 가중)</h3>
          <ul className="mt-3 space-y-2">
            {summary.genreShares.map((g) => (
              <li key={g.genre}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-foreground">{g.genre}</span>
                  <span className="text-[11px] text-muted">{Math.round(g.share * 100)}%</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-raised">
                  <div
                    className="h-2 rounded-full bg-accent"
                    style={{ width: `${Math.max(2, Math.round(g.share * 100))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {summary.genreShares.length === 0 ? (
            <p className="mt-3 text-xs text-muted">장르 데이터를 확보하지 못했습니다.</p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
