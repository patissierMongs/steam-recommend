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
import { runTagHoldoutDiagnostic } from "@/lib/analysis/tag-holdout";
import { mapWithConcurrency } from "@/lib/concurrency";

/**
 * 요청 단위 오케스트레이션. React.cache로 같은 렌더 패스의 Suspense 섹션들이
 * 분석 결과를 공유한다(개인화 데이터라 서버 캐시는 하지 않는다).
 */

/** 플레이 기록 태그 프로필에 쓸 상위 게임 수 */
export const PROFILE_TOP_PLAYED = 40;
/** 백로그 후보 팩트 조회 상한 (SteamSpy 예의) */
export const BACKLOG_FETCH_CAP = 100;
export const LAPSED_FETCH_CAP = 40;
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

  const byPlaytime = [...owned].sort(
    (a, b) => b.playtime_forever - a.playtime_forever || a.appid - b.appid,
  );
  const topPlayed = byPlaytime
    .filter((g) => g.playtime_forever >= MIN_EVIDENCE_MINUTES)
    .slice(0, PROFILE_TOP_PLAYED);

  const backlogCandidates = owned
    .filter((g) => g.playtime_forever < 120)
    // 취득 시각은 공개 API에 없다. AppID는 의미 있는 최신성 신호가 아니라
    // 조회 예산을 재현 가능하게 자르기 위한 순서일 뿐이다.
    .sort((a, b) => b.appid - a.appid)
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
  // SteamSpy 태그가 있으면 경량 fetch는 Store 타입을 생략한다. 프로필 입력만큼은
  // Software/Utilities 혼입을 막기 위해 타입을 확인하고, 실패 시 unknown으로 보류한다.
  const typedProfileFacts = await mapWithConcurrency(topPlayed, SPY_CONCURRENCY, async (game) => {
    const base = factsByAppid.get(game.appid);
    if (!base) return null;
    return base.appType === null ? enrichWithStore(base) : base;
  });
  const profileFactsByAppid = new Map<number, GameFacts>();
  for (const facts of typedProfileFacts) {
    if (!facts) continue;
    factsByAppid.set(facts.appid, facts);
    profileFactsByAppid.set(facts.appid, facts);
  }
  // 백로그/lapsed 후보 팩트는 추천에만 사용하고 프로필 corpus에는 넣지 않는다.
  const model = buildTasteModel(owned, profileFactsByAppid, nowMs);
  return {
    owned,
    ownedAppids: new Set(owned.map((g) => g.appid)),
    factsByAppid,
    model,
    nowMs,
  };
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
 * factsProvider가 팩트를 못 주거나 Store 타입 확인이 실패하면 해당 카드 주장을 보류한다.
 */
async function enrichAndFilter(
  recs: Recommendation[],
  factsProvider: (appid: number) => GameFacts | undefined,
  displayLimit: number,
): Promise<Recommendation[]> {
  const enriched = await mapWithConcurrency(recs, 6, async (rec) => {
    const base = factsProvider(rec.appid);
    if (!base) return { rec, keep: false };
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
  enriched.forEach((e) => {
    if (e !== null && e.keep) out.push(e.rec);
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

/** 신작/현재 라이브러리 밖 후보 풀의 팩트 (요청 내 공유; 서버 캐시는 appid 단위 fetcher가 담당) */
const getCandidateFacts = cache(async (steamid: string): Promise<Map<number, GameFacts> | null> => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  const pool = await getFeaturedPool();
  const all = [...pool.newReleases, ...pool.topSellers, ...pool.specials, ...pool.comingSoon];
  const notOwned = all.filter((c) => !analysis.ownedAppids.has(c.appid));
  return getManyScoringFacts(notOwned, SPY_CONCURRENCY);
});

/**
 * 태그 마스킹 진단은 순위 분모 전체의 타입이 확정돼야 한다. 표시 상위 카드만 사후 확인하는
 * 제품 경로와 달리, 현재 featured 후보 팩트 전체를 Store로 확인해 고정 후보군을 만든다.
 */
interface VerifiedDiagnosticCandidates {
  candidates: GameFacts[];
  featuredAppids: Set<number>;
  funnel: {
    filteredFeaturedAppIds: number;
    outsideOriginalLibraryIds: number;
    scoringFactsRetrieved: number;
    storeConfirmedGames: number;
  };
}

const getVerifiedDiagnosticCandidates = cache(
  async (steamid: string): Promise<VerifiedDiagnosticCandidates | null> => {
    const [analysis, candidates, featured] = await Promise.all([
      getAnalysis(steamid),
      getCandidateFacts(steamid),
      getFeaturedPool(),
    ]);
    if (!analysis || !candidates) return null;
    const rawFeatured = new Map(
      [...featured.newReleases, ...featured.topSellers, ...featured.specials, ...featured.comingSoon].map(
        (item) => [item.appid, item],
      ),
    );
    const outsideOriginalLibraryIds = [...rawFeatured.keys()].filter(
      (appid) => !analysis.ownedAppids.has(appid),
    ).length;
    const verified = await mapWithConcurrency(
      [...candidates.values()],
      SPY_CONCURRENCY,
      enrichWithStore,
    );
    const games = verified
      .filter((facts): facts is GameFacts => facts !== null && isGameType(facts.appType))
      .sort((a, b) => a.appid - b.appid);
    return {
      candidates: games,
      featuredAppids: new Set(rawFeatured.keys()),
      funnel: {
        filteredFeaturedAppIds: rawFeatured.size,
        outsideOriginalLibraryIds,
        scoringFactsRetrieved: candidates.size,
        storeConfirmedGames: games.length,
      },
    };
  },
);

/**
 * 별도 ranker-only 진단 세션. 현재 snapshot의 태그별 고플레이 게임을 마스킹하며,
 * 결과는 미래 추천 정확도나 candidate retrieval 평가로 승격하지 않는다.
 */
export const getTagHoldoutDiagnostic = cache(async (steamid: string) => {
  const [analysis, candidateUniverse] = await Promise.all([
    getAnalysis(steamid),
    getVerifiedDiagnosticCandidates(steamid),
  ]);
  if (!analysis || !candidateUniverse) return null;

  // 정확히 현행 profile cohort만 사용한다. backlog/lapsed 팩트가 우연히 확인됐더라도
  // 진단 범위를 top-played 40 밖으로 확장하거나 fold별로 refill하지 않는다.
  const profileFactsByAppid = new Map<number, GameFacts>();
  for (const appid of analysis.model.engagementWeights.keys()) {
    const facts = analysis.factsByAppid.get(appid);
    if (facts) profileFactsByAppid.set(appid, facts);
  }
  return runTagHoldoutDiagnostic(
    analysis.owned,
    profileFactsByAppid,
    candidateUniverse.candidates,
    candidateUniverse.featuredAppids,
    analysis.nowMs,
    PROFILE_TOP_PLAYED,
    candidateUniverse.funnel,
  );
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

/** 리뷰어 라이브러리 동시출현 앵커: 관측 가중치 상위 3개 */
export const getCoplayRecs = cache(async (steamid: string): Promise<CoplayAnchor[] | null> => {
  const analysis = await getAnalysis(steamid);
  if (!analysis) return null;
  const anchors = [...analysis.model.engagementWeights.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 3)
    .map(([appid]) => appid);
  if (anchors.length === 0) return [];

  const results = await mapWithConcurrency(anchors, 3, async (anchorAppid) => {
    const sample = await getCoplaySample(anchorAppid);
    if (sample.sampleSize < 5) return null; // 검증 전 운영상 최소 표본 하한

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
        if (!f || f.ownersEstimate <= 0) return null;
        const baseRate = f.ownersEstimate / STEAM_POPULATION;
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

/** 숨은 보석: 신작 풀 ∪ 리뷰어 라이브러리 동시출현 후보 중 저인지도 후보 */
export const getHiddenGemRecs = cache(async (steamid: string): Promise<Recommendation[] | null> => {
  const [analysis, candidateFacts, coplay] = await Promise.all([
    getAnalysis(steamid),
    getCandidateFacts(steamid).catch(() => null),
    getCoplayRecs(steamid).catch(() => null),
  ]);
  if (!analysis) return null;

  const poolFacts = new Map<number, GameFacts>(candidateFacts ?? []);
  // 동시출현 섹션이 확보한 후보의 팩트를 재조회 (appid 단위 서버 캐시 히트)
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

  const recs = rankHiddenGems(analysis.model, [...poolFacts.values()], analysis.ownedAppids, 11);
  return enrichAndFilter(recs, (id) => poolFacts.get(id), 11);
});
