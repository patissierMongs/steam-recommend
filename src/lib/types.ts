/** 도메인 타입 — Steam Web API / Store API / SteamSpy 응답의 필요한 부분만 모델링 */

// ── Steam Web API ──────────────────────────────────────────────

export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number; // 분
  playtime_2weeks?: number; // 분
  rtime_last_played?: number; // unix sec, 0이면 기록 없음
  img_icon_url?: string;
}

export interface PlayerSummary {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  personastate: number;
  communityvisibilitystate: number; // 3 = 공개
  timecreated?: number;
  loccountrycode?: string;
}

// ── Steam Store API ────────────────────────────────────────────

export interface AppDetails {
  steam_appid: number;
  name: string;
  type: string; // "game" | "dlc" | ...
  is_free: boolean;
  short_description: string;
  header_image: string;
  capsule_image?: string;
  developers?: string[];
  publishers?: string[];
  genres?: { id: string; description: string }[];
  categories?: { id: number; description: string }[];
  release_date?: { coming_soon: boolean; date: string };
  metacritic?: { score: number; url: string };
  price_overview?: {
    currency: string;
    initial: number;
    final: number;
    discount_percent: number;
    final_formatted: string;
  };
  recommendations?: { total: number };
}

export interface FeaturedItem {
  id: number;
  name: string;
  discounted: boolean;
  discount_percent: number;
  original_price: number | null;
  final_price: number | null;
  currency: string;
  large_capsule_image: string;
  small_capsule_image: string;
  header_image: string;
}

export interface ReviewSummary {
  total_positive: number;
  total_negative: number;
  total_reviews: number;
  review_score_desc: string;
}

export interface ReviewAuthorSample {
  steamid: string;
  num_games_owned: number;
  playtime_forever: number;
}

// ── SteamSpy ───────────────────────────────────────────────────

export interface SteamSpyApp {
  appid: number;
  name: string;
  developer: string;
  positive: number;
  negative: number;
  owners: string; // "20,000 .. 50,000"
  average_forever: number; // 분
  median_forever: number; // 분
  ccu: number;
  tags: Record<string, number>; // 태그 → 투표수 (없으면 빈 배열로 옴)
}

// ── 통합 게임 데이터 (분석 입력) ─────────────────────────────────

/** appid별로 병합·캐시되는 사용자 독립적 게임 정보 */
export interface GameFacts {
  appid: number;
  name: string;
  /** 태그 → 투표수. SteamSpy 부재 시 appdetails 장르를 균등 가중 의사-태그로 폴백 */
  tags: Record<string, number>;
  genres: string[];
  positive: number;
  negative: number;
  /** SteamSpy 소유자 구간의 기하평균 추정 (0 = 미상) */
  ownersEstimate: number;
  /** 전체 유저 중앙값 플레이타임(분), 0 = 미상 */
  medianPlaytime: number;
  headerImage: string;
  shortDescription: string;
  releaseDate: string;
  comingSoon: boolean;
  isFree: boolean;
  priceFormatted: string | null;
  discountPercent: number;
  developers: string[];
  /** appdetails.type — "game"만 추천 대상 */
  appType: string | null;
}

// ── 추천 결과 ──────────────────────────────────────────────────

export interface ScoreBreakdown {
  /** 취향 벡터와의 코사인 유사도 (0..1) */
  tasteMatch: number;
  /** Wilson 신뢰하한 (0..1), 리뷰 없으면 null */
  quality: number | null;
  /** 동시보유 lift 배수 (co-play 섹션만) */
  lift?: number;
  /** 이 후보와 겹치는 사용자 상위 태그 */
  matchedTags: string[];
}

export interface Recommendation {
  appid: number;
  name: string;
  headerImage: string;
  shortDescription: string;
  releaseDate: string;
  priceFormatted: string | null;
  discountPercent: number;
  isFree: boolean;
  score: number;
  breakdown: ScoreBreakdown;
  /** 보유 게임 섹션용 부가 정보 */
  playtimeMinutes?: number;
  lastPlayed?: number;
  medianPlaytime?: number;
  ownersEstimate?: number;
}

export interface TasteTag {
  tag: string;
  weight: number; // 프로필 내 상대 비중 (0..1, 최대 태그 = 1)
  topGames: string[]; // 이 태그에 가장 기여한 게임들
}

export interface TasteProfileSummary {
  topTags: TasteTag[];
  genreShares: { genre: string; share: number }[]; // 플레이타임 가중
  totalGames: number;
  playedGames: number;
  neverPlayed: number;
  totalHours: number;
  medianHoursPerPlayed: number;
  concentrationHHI: number;
  analyzedGames: number; // 태그 데이터를 확보해 프로필에 반영된 게임 수
}

export interface CoplayAnchor {
  appid: number;
  name: string;
  sampleSize: number; // 라이브러리 공개 리뷰어 수
  recommendations: Recommendation[];
}
