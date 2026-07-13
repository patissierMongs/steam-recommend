import Image from "next/image";
import type { Recommendation } from "@/lib/types";

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  const h = minutes / 60;
  return h >= 100 ? `${Math.round(h)}시간` : `${Math.round(h * 10) / 10}시간`;
}

/** 근거 배지: 왜 이 게임이 추천됐는지 카드에서 바로 읽히게 한다 */
function Badges({ rec }: { rec: Recommendation }) {
  const { breakdown } = rec;
  const badges: { label: string; title: string }[] = [];
  if (breakdown.tasteMatch !== null && breakdown.tasteMatch > 0) {
    badges.push({
      label: `태그 유사도 ${breakdown.tasteMatch.toFixed(2)}`,
      title: "플레이 기록 태그 프로필과 후보 태그의 코사인 유사도입니다. 선호 확률이 아닙니다.",
    });
  }
  if (breakdown.reviewLowerBound !== null) {
    badges.push({
      label: `리뷰 하한 ${Math.round(breakdown.reviewLowerBound * 100)}%`,
      title: "관측 리뷰 긍정률의 명목상 Wilson 하한 — 리뷰 수를 반영한 순위 통계량이며 개인 만족도 확률이 아닙니다.",
    });
  }
  if (breakdown.lift !== undefined && breakdown.lift > 1) {
    badges.push({
      label: `동시출현 ×${breakdown.lift >= 10 ? Math.round(breakdown.lift) : Math.round(breakdown.lift * 10) / 10}`,
      title:
        "앵커 게임의 긍정 리뷰어 표본 라이브러리에서 전역 인기도 대비 함께 관측된 정도 (smoothed lift, 근사치)",
    });
  }
  if (rec.playtimeMinutes !== undefined) {
    badges.push({
      label: rec.playtimeMinutes === 0 ? "미플레이" : `${formatHours(rec.playtimeMinutes)} 플레이`,
      title: "내 플레이 기록",
    });
  }
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <span
          key={b.label}
          title={b.title}
          className="rounded bg-raised px-1.5 py-0.5 text-[11px] font-medium text-foreground/90"
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

export function GameCard({ rec }: { rec: Recommendation }) {
  return (
    <a
      href={`https://store.steampowered.com/app/${rec.appid}/`}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col overflow-hidden rounded-lg border border-edge bg-surface transition hover:border-accent"
    >
      <div className="relative aspect-460/215 bg-raised">
        <Image
          src={rec.headerImage}
          alt=""
          fill
          sizes="(max-width: 768px) 50vw, 25vw"
          className="object-cover"
        />
        {rec.discountPercent > 0 ? (
          <span className="absolute right-1.5 top-1.5 rounded bg-positive/90 px-1.5 py-0.5 text-[11px] font-bold text-black">
            -{rec.discountPercent}%
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-1 text-sm font-semibold text-foreground group-hover:text-accent">
          {rec.name}
        </h3>
        <Badges rec={rec} />
        {rec.breakdown.matchedTags.length > 0 ? (
          <p className="line-clamp-1 text-[11px] text-accent/90" title="플레이 기록 프로필과 겹치는 태그">
            {rec.breakdown.matchedTags.join(" · ")}
          </p>
        ) : null}
        {rec.shortDescription ? (
          <p className="line-clamp-2 text-[11px] leading-4 text-muted">{rec.shortDescription}</p>
        ) : null}
        <div className="mt-auto flex items-center justify-between pt-1 text-[11px] text-muted">
          <span>{rec.releaseDate}</span>
          <span className="font-medium text-foreground/80">
            {rec.isFree ? "무료" : (rec.priceFormatted ?? "")}
          </span>
        </div>
      </div>
    </a>
  );
}

export function GameCardGrid({ recs }: { recs: Recommendation[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {recs.map((rec) => (
        <GameCard key={rec.appid} rec={rec} />
      ))}
    </div>
  );
}
