import type { TasteProfileSummary } from "@/lib/types";
import { PROFILE_TOP_PLAYED } from "@/lib/analysis/pipeline";
import { Section } from "./Section";

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-3" title={hint}>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight">{value}</p>
    </div>
  );
}

/** 플레이 기록의 기술통계와 태그 프로필을 시각화한다. */
export function TasteSection({ summary }: { summary: TasteProfileSummary }) {
  return (
    <Section
      title="Steam 라이브러리 기록 요약"
      subtitle={`전체 항목의 누적 기록과, 누적시간 상위 최대 ${PROFILE_TOP_PLAYED}개 조회 범위 중 확인된 태그 ${summary.analyzedGames}개·장르 ${summary.genreAnalyzedGames}개 게임의 분포를 분리해 표시합니다. 선호·동기·성격을 측정한 값은 아닙니다.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="라이브러리 항목" value={summary.totalGames.toLocaleString()} />
        <StatTile label="전체 누적시간" value={`${summary.totalHours.toLocaleString()}시간`} />
        <StatTile
          label="미실행 항목"
          value={`${summary.neverPlayed}개 (${Math.round((summary.neverPlayed / Math.max(1, summary.totalGames)) * 100)}%)`}
          hint="Steam 라이브러리 응답에서 누적시간이 0인 항목"
        />
        <StatTile
          label="30분+ 항목 중앙값"
          value={`${summary.medianHoursPerPlayed}시간`}
          hint="Steam 라이브러리 응답에서 누적시간 30분 이상인 항목 기준"
        />
        <StatTile
          label="플레이타임 HHI"
          value={summary.concentrationHHI.toFixed(3)}
          hint="전체 Steam 라이브러리 응답 항목의 누적시간 집중도입니다. 비게임 앱이 포함될 수 있으며 유형이나 성격을 뜻하지 않습니다."
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
          {summary.topTags.length === 0 ? (
            <p className="mt-3 text-xs text-muted">확인된 SteamSpy 태그가 없어 이 항목을 보류합니다.</p>
          ) : null}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            장르 분포 (확인된 {summary.genreAnalyzedGames}개 게임, 플레이타임 가중)
          </h3>
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
