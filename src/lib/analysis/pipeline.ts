import "server-only";
import { cache } from "react";
import type { CoplayAnchor, GameFacts, OwnedGame, Recommendation } from "@/lib/types";
import { getOwnedGames, getPlayerSummary } from "@/lib/steam/webapi";
import { enrichWithStore, getManyScoringFacts, isGameType } from "@/lib/steam/appdata";
import { getFeaturedPool } from "@/lib/steam/featured";
import { getCoplaySample, STEAM_POPULATION } from "@/lib/steam/coplay";
import { buildTasteModel, MIN_EVIDENCE_MINUTES, summarizeTaste, type TasteModel } from "@/lib/analysis/taste";
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
  /** 라이브러리에 30분+ 플레이한 게임이 있는데 메타데이터를 하나도 못 받은 상태
   * (SteamSpy/상점 장애) — "무플레이"와 구분해 UI에서 다르게 안내한다. */
  degraded: boolean;
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
  // 취향 벡터(태그) 확보 여부로 판단한다. 팩트가 있어도 태그가 비면 model.profile은
  // 비므로(preferenceWeights만 채워짐) 코사인이 전부 0이 되어 취향 추천이 무의미해진다.
  // 30분+ 플레이 게임이 있는데 취향 벡터가 비면 데이터 장애/태그 부재로 간주.
  const hasPlayedGames = owned.some((g) => g.playtime_forever >= MIN_EVIDENCE_MINUTES);
  const degraded = hasPlayedGames && model.profile.size === 0;
  return { owned, ownedAppids: new Set(owned.map((g) => g.appid)), factsByAppid, model, nowMs, degraded };
});

export const getTasteSummary = cache(async (steamid: string) => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  return summarizeTaste(analysis.owned, analysis.factsByAppid, analysis.model);
});

/**
 * 상위 후보에 상점 상세(가격/설명/출시일/타입)를 덧입히고, 타입이 확인된 비-게임
 * (DLC/데모/사운드트랙 등)을 제거한 뒤 표시 개수로 자른다.
 * 랭커에는 여유분을 요청해 DLC 제거 후에도 개수가 유지되게 한다.
 * factsProvider가 팩트를 못 주거나 상점 보강이 실패하면(타입 미확인) 그대로 유지한다.
 */
async function enrichAndFilter(
  recs: Recommendation[],
  factsProvider: (appid: number) => GameFacts | undefined,
  displayLimit: number,
): Promise<Recommendation[]> {
  const enriched = await mapWithConcurrency(recs, 6, async (rec) => {
    const base = factsProvider(rec.appid);
    if (!base) return { rec, keep: true };
    const full = await enrichWithStore(base);
    const merged: Recommendation = {
      ...rec,
      name: full.name || rec.name,
      headerImage: full.headerImage || rec.headerImage,
      shortDescription: rec.shortDescription || full.shortDescription,
      releaseDate: rec.releaseDate || full.releaseDate,
      priceFormatted: rec.priceFormatted ?? full.priceFormatted,
      discountPercent: rec.discountPercent || full.discountPercent,
      isFree: rec.isFree || full.isFree,
    };
    return { rec: merged, keep: isGameType(full.appType) };
  });
  const out: Recommendation[] = [];
  enriched.forEach((e, i) => {
    if (e === null) out.push(recs[i]); // 보강 자체 실패 → 타입 미확인, 유지
    else if (e.keep) out.push(e.rec);
  });
  return out.slice(0, displayLimit);
}

export const getBacklogRecs = cache(async (steamid: string): Promise<Recommendation[] | null> => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  const recs = rankBacklog(analysis.model, analysis.owned, analysis.factsByAppid, 18);
  return enrichAndFilter(recs, (id) => analysis.factsByAppid.get(id), 12);
});

export const getLapsedRecs = cache(async (steamid: string): Promise<Recommendation[] | null> => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  const recs = rankLapsed(analysis.model, analysis.owned, analysis.factsByAppid, analysis.nowMs, 12);
  return enrichAndFilter(recs, (id) => analysis.factsByAppid.get(id), 8);
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
  const recs = rankNewReleases(analysis.model, fresh, analysis.ownedAppids, 18);
  // 후보 팩트는 SteamSpy 기반 — 표시 전 상점 정보(가격/설명/타입) 보강 + DLC 제거
  return enrichAndFilter(recs, (id) => candidateFacts.get(id), 12);
});

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
      .slice(0, 25); // 앵커당 SteamSpy fan-out 상한 (예의)
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

    const recs = rankCoplay(analysis.model, scored, analysis.ownedAppids, 9);
    const enriched = await enrichAndFilter(recs, (id) => facts.get(id), 6);
    const anchorFacts = analysis.factsByAppid.get(anchorAppid);
    const anchorName =
      anchorFacts?.name ?? analysis.owned.find((g) => g.appid === anchorAppid)?.name ?? String(anchorAppid);
    return {
      appid: anchorAppid,
      name: anchorName,
      sampleSize: sample.sampleSize,
      recommendations: enriched,
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

  const recs = rankHiddenGems(analysis.model, [...poolFacts.values()], analysis.ownedAppids, 15);
  return enrichAndFilter(recs, (id) => poolFacts.get(id), 10);
});
