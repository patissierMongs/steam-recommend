import "server-only";
import { cache } from "react";
import type { CoplayAnchor, GameFacts, OwnedGame, Recommendation } from "@/lib/types";
import { getOwnedGames, getPlayerSummary } from "@/lib/steam/webapi";
import { enrichWithStore, getManyScoringFacts } from "@/lib/steam/appdata";
import { getFeaturedPool } from "@/lib/steam/featured";
import { getCoplaySample, STEAM_POPULATION } from "@/lib/steam/coplay";
import { buildTasteModel, summarizeTaste, type TasteModel } from "@/lib/analysis/taste";
import {
  rankBacklog,
  rankCoplay,
  rankHiddenGems,
  rankLapsed,
  rankNewReleases,
} from "@/lib/analysis/recommend";
import { smoothedLogLift } from "@/lib/analysis/stats";
import { mapWithConcurrency } from "@/lib/concurrency";

/**
 * 요청 단위 오케스트레이션. React.cache로 같은 렌더 패스의 Suspense 섹션들이
 * 분석 결과를 공유한다(개인화 데이터라 서버 캐시는 하지 않는다).
 */

/** 취향 증거로 쓸 플레이 상위 게임 수 */
const PROFILE_TOP_PLAYED = 40;
/** 백로그 후보 팩트 조회 상한 (SteamSpy 예의) */
const BACKLOG_FETCH_CAP = 100;
const LAPSED_FETCH_CAP = 40;
const SPY_CONCURRENCY = 6;

export const getProfile = cache(getPlayerSummary);
export const getLibrary = cache(getOwnedGames);

export interface LibraryAnalysis {
  owned: OwnedGame[];
  ownedAppids: Set<number>;
  factsByAppid: Map<number, GameFacts>;
  model: TasteModel;
  nowMs: number;
}

export const getAnalysis = cache(async (steamid: string): Promise<LibraryAnalysis | null> => {
  const owned = await getLibrary(steamid);
  if (!owned || owned.length === 0) return null;
  const nowMs = Date.now();

  const byPlaytime = [...owned].sort((a, b) => b.playtime_forever - a.playtime_forever);
  const topPlayed = byPlaytime.filter((g) => g.playtime_forever >= 30).slice(0, PROFILE_TOP_PLAYED);

  const backlogCandidates = owned
    .filter((g) => g.playtime_forever < 120)
    .sort((a, b) => b.appid - a.appid) // appid 내림차순 ≈ 최신 등록 게임 우선
    .slice(0, BACKLOG_FETCH_CAP);

  const lapsedCutoff = nowMs / 1000 - 180 * 86400;
  const lapsedCandidates = byPlaytime
    .filter(
      (g) =>
        g.playtime_forever >= 120 &&
        g.playtime_forever <= 40 * 60 &&
        g.rtime_last_played !== undefined &&
        g.rtime_last_played > 0 &&
        g.rtime_last_played < lapsedCutoff,
    )
    .slice(0, LAPSED_FETCH_CAP);

  const fetchSet = new Map<number, { appid: number; name?: string }>();
  for (const g of [...topPlayed, ...backlogCandidates, ...lapsedCandidates]) {
    fetchSet.set(g.appid, { appid: g.appid, name: g.name });
  }

  const factsByAppid = await getManyScoringFacts([...fetchSet.values()], SPY_CONCURRENCY);
  const model = buildTasteModel(owned, factsByAppid, nowMs);
  return { owned, ownedAppids: new Set(owned.map((g) => g.appid)), factsByAppid, model, nowMs };
});

export const getTasteSummary = cache(async (steamid: string) => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  return summarizeTaste(analysis.owned, analysis.factsByAppid, analysis.model);
});

async function enrichTop(recs: Recommendation[], analysis: LibraryAnalysis): Promise<Recommendation[]> {
  const enriched = await mapWithConcurrency(recs, 6, async (rec) => {
    const facts = analysis.factsByAppid.get(rec.appid);
    if (!facts) return rec;
    const full = await enrichWithStore(facts);
    return {
      ...rec,
      headerImage: full.headerImage,
      shortDescription: rec.shortDescription || full.shortDescription,
      releaseDate: rec.releaseDate || full.releaseDate,
      priceFormatted: rec.priceFormatted ?? full.priceFormatted,
    };
  });
  return enriched.map((r, i) => r ?? recs[i]);
}

export const getBacklogRecs = cache(async (steamid: string): Promise<Recommendation[] | null> => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  const recs = rankBacklog(analysis.model, analysis.owned, analysis.factsByAppid);
  return enrichTop(recs, analysis);
});

export const getLapsedRecs = cache(async (steamid: string): Promise<Recommendation[] | null> => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  const recs = rankLapsed(analysis.model, analysis.owned, analysis.factsByAppid, analysis.nowMs);
  return enrichTop(recs, analysis);
});

/** 신작/미보유 후보 풀의 팩트 (요청 내 공유; 서버 캐시는 appid 단위 fetcher가 담당) */
const getCandidateFacts = cache(async (steamid: string): Promise<Map<number, GameFacts> | null> => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  const pool = await getFeaturedPool();
  const all = [...pool.newReleases, ...pool.topSellers, ...pool.specials, ...pool.comingSoon];
  const notOwned = all.filter((c) => !analysis.ownedAppids.has(c.appid));
  return getManyScoringFacts(notOwned, SPY_CONCURRENCY);
});

export const getNewReleaseRecs = cache(async (steamid: string): Promise<Recommendation[] | null> => {
  const [analysis, candidateFacts] = await Promise.all([getAnalysis(steamid), getCandidateFacts(steamid)]);
  if (!analysis || !candidateFacts) return null;
  const pool = await getFeaturedPool();
  const freshIds = new Set([...pool.newReleases, ...pool.comingSoon].map((c) => c.appid));
  const fresh = [...candidateFacts.values()].filter((f) => freshIds.has(f.appid));
  const recs = rankNewReleases(analysis.model, fresh, analysis.ownedAppids);
  // 후보 팩트는 SteamSpy 기반 — 표시 전 상점 정보(가격/설명) 보강
  const enriched = await mapWithConcurrency(recs, 6, (r) => enrichRec(r, candidateFacts));
  return enriched.map((r, i) => r ?? recs[i]);
});

async function enrichRec(rec: Recommendation, facts: Map<number, GameFacts>): Promise<Recommendation> {
  const base = facts.get(rec.appid);
  if (!base) return rec;
  const full = await enrichWithStore(base);
  return {
    ...rec,
    name: full.name,
    headerImage: full.headerImage,
    shortDescription: full.shortDescription,
    releaseDate: full.releaseDate,
    priceFormatted: full.priceFormatted,
    discountPercent: full.discountPercent,
    isFree: full.isFree,
  };
}

/** co-play 앵커: 선호 가중치 상위 3개 (팩트 확보된 게임만) */
export const getCoplayRecs = cache(async (steamid: string): Promise<CoplayAnchor[] | null> => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  const anchors = [...analysis.model.preferenceWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([appid]) => appid);
  if (anchors.length === 0) return [];

  const results = await mapWithConcurrency(anchors, 3, async (anchorAppid) => {
    const sample = await getCoplaySample(anchorAppid);
    if (sample.sampleSize < 5) return null; // 표본이 너무 작으면 통계로서 무의미

    const candidateIds = sample.counts
      .filter((c) => c.count >= 3 && !analysis.ownedAppids.has(c.appid))
      .slice(0, 40);
    const facts = await getManyScoringFacts(
      candidateIds.map((c) => ({ appid: c.appid })),
      SPY_CONCURRENCY,
    );

    const scored = candidateIds
      .map((c) => {
        const f = facts.get(c.appid);
        if (!f) return null;
        const baseRate = f.ownersEstimate > 0 ? f.ownersEstimate / STEAM_POPULATION : 0.001;
        return { facts: f, coCount: c.count, logLift: smoothedLogLift(c.count, sample.sampleSize, baseRate) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const recs = rankCoplay(analysis.model, scored, analysis.ownedAppids, 6);
    const enriched = await mapWithConcurrency(recs, 4, (r) => enrichRec(r, facts));
    const anchorFacts = analysis.factsByAppid.get(anchorAppid);
    const anchorName =
      anchorFacts?.name ?? analysis.owned.find((g) => g.appid === anchorAppid)?.name ?? String(anchorAppid);
    return {
      appid: anchorAppid,
      name: anchorName,
      sampleSize: sample.sampleSize,
      recommendations: enriched.map((r, i) => r ?? recs[i]),
    } satisfies CoplayAnchor;
  });

  return results.filter((a): a is CoplayAnchor => a !== null && a.recommendations.length > 0);
});

/** 숨은 보석: 신작 풀 ∪ co-play 후보 중 저인지도·고품질·고매칭 */
export const getHiddenGemRecs = cache(async (steamid: string): Promise<Recommendation[] | null> => {
  const [analysis, candidateFacts, coplay] = await Promise.all([
    getAnalysis(steamid),
    getCandidateFacts(steamid).catch(() => null),
    getCoplayRecs(steamid).catch(() => null),
  ]);
  if (!analysis) return null;

  const poolFacts = new Map<number, GameFacts>(candidateFacts ?? []);
  // co-play 섹션이 이미 확보한 후보의 팩트를 재조회 (appid 단위 서버 캐시 히트라 저렴)
  if (coplay) {
    const extraIds = coplay
      .flatMap((a) => a.recommendations.map((r) => r.appid))
      .filter((id) => !poolFacts.has(id));
    const extra = await getManyScoringFacts(
      extraIds.map((appid) => ({ appid })),
      SPY_CONCURRENCY,
    );
    for (const [id, f] of extra) poolFacts.set(id, f);
  }

  const recs = rankHiddenGems(analysis.model, [...poolFacts.values()], analysis.ownedAppids);
  const enriched = await mapWithConcurrency(recs, 6, (r) => enrichRec(r, poolFacts));
  return enriched.map((r, i) => r ?? recs[i]);
});
