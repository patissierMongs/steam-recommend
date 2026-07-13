import type { TasteProfileSummary } from "@/lib/types";
import type { PersonaProfile } from "@/lib/analysis/persona";
import { Section } from "./Section";

export interface ClusterView {
  topTags: string[];
  share: number;
  games: string[];
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-3" title={hint}>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight">{value}</p>
    </div>
  );
}

const PERSONA_DIMS: { key: keyof Omit<PersonaProfile, "archetype" | "archetypeDescription">; label: string; low: string; high: string }[] = [
  { key: "depth", label: "몰입", low: "얕고 넓게", high: "깊게 판다" },
  { key: "commitment", label: "정주행", low: "맛보기", high: "끝까지" },
  { key: "challenge", label: "도전", low: "캐주얼", high: "하드코어" },
  { key: "social", label: "소셜", low: "싱글", high: "멀티" },
  { key: "niche", label: "발굴", low: "메인스트림", high: "비주류" },
  { key: "fresh", label: "신작", low: "클래식", high: "최신작" },
];

function PersonaCard({ persona }: { persona: PersonaProfile }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4">
      <p className="text-[11px] text-muted">플레이 성향 분석</p>
      <p className="mt-1 text-lg font-bold text-accent">{persona.archetype}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{persona.archetypeDescription}</p>
      <ul className="mt-4 space-y-2.5">
        {PERSONA_DIMS.map((d) => {
          const v = persona[d.key];
          return (
            <li key={d.key}>
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="font-medium text-foreground">{d.label}</span>
                <span className="text-muted">
                  {d.low} ↔ {d.high}
                </span>
              </div>
              <div className="relative mt-1 h-2 rounded-full bg-raised">
                <div
                  className="absolute top-1/2 size-3 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-background bg-accent"
                  style={{ left: `${Math.round(v * 100)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ClusterChips({ clusters }: { clusters: ClusterView[] }) {
  if (clusters.length === 0) return null;
  return (
    <div className="rounded-lg border border-edge bg-surface p-4">
      <p className="text-[11px] text-muted">
        취향 클러스터 — 취향을 하나로 뭉개지 않고 갈래별로 나눠 추천에 사용합니다
      </p>
      <ul className="mt-3 space-y-2">
        {clusters.map((c, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
              {Math.round(c.share * 100)}%
            </span>
            <span className="text-xs font-medium text-foreground">{c.topTags.join(" · ")}</span>
            <span className="truncate text-[11px] text-muted" title={c.games.join(", ")}>
              {c.games.slice(0, 2).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 취향 프로필 시각화.
 * 태그 막대는 단일 시리즈 크기 비교(막대 차트) — 단일 색상, 라벨/수치는 텍스트 토큰.
 */
export function TasteSection({
  summary,
  persona,
  clusters,
}: {
  summary: TasteProfileSummary;
  persona: PersonaProfile;
  clusters: ClusterView[];
}) {
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

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <PersonaCard persona={persona} />
        <ClusterChips clusters={clusters} />
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
