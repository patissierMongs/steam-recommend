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
  if (breakdown.tasteMatch > 0) {
    badges.push({
      label: `취향 ${Math.round(breakdown.tasteMatch * 100)}%`,
      title: "당신의 태그 프로필과의 코사인 유사도",
    });
  }
  if (breakdown.quality !== null) {
    badges.push({
      label: `긍정 ${Math.round(breakdown.quality * 100)}%+`,
      title: "리뷰 긍정 비율의 Wilson 95% 신뢰하한 — 표본 크기를 보정한 보수적 추정",
    });
  }
  if (breakdown.lift !== undefined && breakdown.lift > 1) {
    badges.push({
      label: `기대 ×${breakdown.lift >= 10 ? Math.round(breakdown.lift) : Math.round(breakdown.lift * 10) / 10}`,
      title: "전체 보급률 대비 이 그룹에서 몇 배나 자주 플레이되는지 (lift)",
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
          <p className="line-clamp-1 text-[11px] text-accent/90">
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
