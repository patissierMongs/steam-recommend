# steam-recommend

Steam 프로필을 불러와 **플레이타임·태그·리뷰·동시보유(co-play)** 신호를 통계적으로 결합해
다음에 할 게임을 추천하는 웹 앱. 알고리즘 상세는 [docs/DESIGN.md](docs/DESIGN.md) 참고.

## 기능

- **Steam OpenID 로그인** 또는 SteamID64 / 커스텀 URL / 프로필 주소 입력으로 조회
- **취향 프로필**: 플레이타임 가중(log 감쇠 × 중앙값 정규화 × 시간 감쇠) 태그 TF-IDF 벡터,
  장르 분포, 플레이 집중도(HHI)
- **백로그에서 추천**: 보유했지만 안 한 게임을 취향 코사인 유사도 × 리뷰 Wilson 신뢰하한으로 랭킹
- **다시 잡을 게임**: 하다가 6개월+ 방치한 게임 중 아직 다 즐기지 못한 취향 매칭 게임
- **이 게임을 즐겼다면**: 최다 플레이 게임의 긍정 리뷰어들의 공개 라이브러리를 표본으로,
  전체 보급률 대비 과대표된 게임을 smoothed lift(PMI)로 랭킹 — 실시간 아이템 기반 협업 필터링
- **취향에 맞는 신작**: Steam 신작/출시 예정 풀을 취향·품질로 정렬
- **숨은 보석**: 인기도(소유자 수)의 역수를 명시적으로 보상해, 유명하지 않지만
  리뷰 신뢰하한이 높고 취향에 맞는 게임 발굴
- 모든 추천 카드에 근거 배지(취향 매칭 %, Wilson 하한, lift 배수, 매칭 태그) 표시

## 스택

- Next.js 16 (App Router, **Cache Components**) + TypeScript + Tailwind CSS v4
- 외부 API: Steam Web API(개인화, 캐시 없음) · Steam Store API · SteamSpy(appid 단위 `'use cache'` 24h)
- 개인화 데이터는 절대 서버 캐시에 넣지 않고 Suspense 스트리밍으로 요청 단위 렌더링
- 테스트: vitest (`npm test`) — Wilson/코사인/lift/세션 서명 등 핵심 로직 단위 테스트

## 시작하기

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

`.env.local` 값:

| 키 | 설명 |
| --- | --- |
| `STEAM_API_KEY` | https://steamcommunity.com/dev/apikey 에서 발급 (라이브러리 조회·co-play에 필수) |
| `APP_BASE_URL` | OpenID `return_to` 콜백 베이스 URL (예: `http://localhost:3000`). 미설정 시 요청 origin 사용 |
| `SESSION_SECRET` | 세션 쿠키 HMAC 서명용 랜덤 문자열 (16자 이상) |

## 알려진 제약

- `GetOwnedGames`는 대상 프로필의 **게임 상세 정보가 공개**여야 응답한다. 비공개면 안내 화면이 뜬다.
- Steam Web API는 CORS를 허용하지 않으므로 모든 호출은 서버 경유 (`src/lib/steam/*`는 `server-only`).
- SteamSpy 데이터(태그·소유자 추정)는 제3자 추정치다. 다운 시 상점 장르로 폴백한다.
- co-play 표본은 리뷰 작성자 편향이 있다 — lift 통계·최소 지지도(n≥3)·표본 크기 표시로 완화.
- 첫 분석은 외부 API 예의를 위한 스로틀(SteamSpy·상점) 때문에 라이브러리가 크면 **수 분**이
  걸릴 수 있다(최대 ~180개 후보 콜드 조회 시 SteamSpy 스로틀만 100초 이상). appid 단위 서버
  캐시로 이후 요청은 빠르다. Serverless 배포 시 `'use cache'`가 인메모리라 인스턴스 간 지속되지
  않으므로, 콜드 로드 자체를 줄이려면 `'use cache: remote'`(공유 지속 캐시) 전환을 권장한다.
