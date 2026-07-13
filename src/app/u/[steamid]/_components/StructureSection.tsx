import { getStructureProfiles } from "@/lib/analysis/pipeline";
import type { DepthPoint } from "@/lib/analysis/depth";
import { Section } from "./Section";

/**
 * 태그 외 피벗 구조 분석 (docs/VALIDATION.md H-014~H-017).
 * 전부 관측/행동요약 층 — 선호·만족·예측을 주장하지 않고 랭킹에도 쓰지 않는다.
 */

function hours(minutes: number): string {
  const h = minutes / 60;
  return h >= 100 ? `${Math.round(h).toLocaleString()}시간` : `${Math.round(h * 10) / 10}시간`;
}

function ratioLabel(logRatio: number): string {
  const r = 2 ** logRatio;
  if (r >= 100) return `×${Math.round(r).toLocaleString()}`;
  if (r >= 10) return `×${Math.round(r)}`;
  return `×${Math.round(r * 10) / 10}`;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-3" title={hint}>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight">{value}</p>
    </div>
  );
}

function DepthList({ title, note, points }: { title: string; note: string; points: DepthPoint[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-[11px] leading-4 text-muted">{note}</p>
      {points.length === 0 ? (
        <p className="mt-3 text-xs text-muted">해당 항목이 없습니다.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {points.map((p) => (
            <li
              key={p.appid}
              className="flex items-baseline justify-between gap-2 rounded-lg border border-edge bg-surface px-3 py-2 text-xs"
            >
              <span className="truncate font-medium text-foreground">{p.name}</span>
              <span className="shrink-0 text-[11px] text-muted">
                {hours(p.playtimeMinutes)} / 기준 {hours(p.medianMinutes)} ={" "}
                <strong className="text-foreground">{ratioLabel(p.logRatio)}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function StructureSection({ steamid }: { steamid: string }) {
  const profiles = await getStructureProfiles(steamid);
  if (!profiles) return null;
  const { depth, combos } = profiles;
  if (depth.points.length === 0 && combos.combos.length === 0) return null;

  return (
    <Section
      title="행동 구조 분석 — 태그 외 피벗"
      subtitle={`개별 태그 빈도 대신, 게임별 기준점 대비 상대 플레이 깊이(log₂ 비율)와 독립 기대를 초과하는 태그 조합을 봅니다. 깊이 기준점은 각 게임의 최근 리뷰 작성자 표본(최대 100명) 플레이타임 중앙값입니다 — 리뷰를 남긴 사람이라는 자기선택 편향이 있으며 전체 유저 중앙값이 아닙니다. 전부 관측 요약이며, 선호·만족을 측정하거나 추천 순위에 쓰는 값이 아닙니다.`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="상대 깊이 중앙값"
          value={ratioLabel(depth.medianLogRatio)}
          hint="각 게임의 리뷰 작성자 표본 중앙값 플레이타임 대비 이 라이브러리의 배율, 그 중앙값"
        />
        <StatTile
          label="리뷰어 중앙값보다 깊이 간 비율"
          value={`${Math.round(depth.shareAboveNorm * 100)}%`}
          hint="상대 깊이가 그 게임의 리뷰어 표본 중앙값(×1)을 넘는 항목 비율"
        />
        <StatTile
          label="깊이 분석 게임"
          value={`${depth.points.length}개`}
          hint="확인된 게임 + 30분 이상 + 리뷰어 표본 기준점(10명 이상) 확보 항목"
        />
        <StatTile
          label="깊이 ↔ 리뷰 순위 상관"
          value={
            depth.reviewDepthCorr
              ? `ρ ${depth.reviewDepthCorr.spearman.toFixed(2)} (n=${depth.reviewDepthCorr.n})`
              : "표본 부족"
          }
          hint="Spearman, 단일 계정 기술 통계 — 0에 가까우면 리뷰 점수는 이 계정의 플레이 깊이와 무관하게 움직입니다"
        />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <DepthList
          title="저인지 · 깊은 몰입"
          note={`소유자 추정이 이 라이브러리 중앙값(${depth.ownersSplit.toLocaleString()}명) 이하인데, 그 게임의 리뷰어 표본 중앙값보다 오래 플레이한 항목.`}
          points={depth.deepNiche}
        />
        <DepthList
          title="고인지 · 이른 이탈"
          note="소유자 추정이 중앙값을 넘는 유명 게임인데, 리뷰어 표본 중앙값에 못 미치고 멈춘 항목."
          points={depth.shallowMainstream}
        />
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-foreground">
          특징 태그 조합 (개별 태그 빈도 초과 동시출현)
        </h3>
        <p className="mt-1 text-[11px] leading-4 text-muted">
          플레이 근거 {combos.corpusSize}개 게임에서, 두 태그가 각자의 출현율 곱(독립 기대)보다
          자주 함께 나타나는 쌍입니다. 과반 출현 광역 태그
          {combos.broadTags.length > 0 ? ` (${combos.broadTags.join(", ")})` : ""}는 조합 후보에서
          제외했습니다 — 다양하게 플레이할수록 자동으로 상위에 오는 태그이기 때문입니다.
        </p>
        {combos.combos.length === 0 ? (
          <p className="mt-3 text-xs text-muted">지지도 기준을 넘는 조합이 없습니다.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {combos.combos.map((c) => (
              <li
                key={`${c.tagA}+${c.tagB}`}
                className="rounded-lg border border-edge bg-surface px-3 py-2 text-xs"
                title={`함께 나타난 게임 ${c.support}개 · log-lift ${c.logLift.toFixed(2)}`}
              >
                <span className="font-medium text-foreground">
                  {c.tagA} + {c.tagB}
                </span>
                <span className="ml-2 text-[11px] text-muted">
                  {c.support}개 · {c.games.slice(0, 2).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">플레이타임 개발사 집중</h3>
          <ul className="mt-3 space-y-2">
            {depth.developerShares.slice(0, 5).map((d) => (
              <li key={d.developer}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-foreground">{d.developer}</span>
                  <span className="text-[11px] text-muted">
                    {Math.round(d.share * 100)}% · {d.games}개
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-raised">
                  <div
                    className="h-2 rounded-full bg-accent"
                    style={{ width: `${Math.max(2, Math.round(d.share * 100))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">실행 여부와 리뷰 품질</h3>
          {depth.launchReviewGap ? (
            <p className="mt-3 text-xs leading-5 text-muted">
              실행한 게임({depth.launchReviewGap.nPlayed}개)의 리뷰 하한 중앙값은{" "}
              <strong className="text-foreground">
                {depth.launchReviewGap.playedMedianWlb.toFixed(2)}
              </strong>
              , 한 번도 실행하지 않은 게임({depth.launchReviewGap.nUnplayed}개)은{" "}
              <strong className="text-foreground">
                {depth.launchReviewGap.unplayedMedianWlb.toFixed(2)}
              </strong>
              입니다. 두 값이 비슷하다면, 이 계정에서 리뷰 점수는 실행 여부를 가르는 관측
              신호가 아닙니다 — 현재 추천 수식의 리뷰 가중치(0.35)가 개인화 신호인지 일반 품질
              사전인지는 시간 분리 평가로만 판정합니다.
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted">비교할 리뷰 표본이 부족합니다.</p>
          )}
        </div>
      </div>
    </Section>
  );
}
