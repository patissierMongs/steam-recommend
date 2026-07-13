# steam-recommend

Steam 프로필의 누적 플레이 기록·태그·리뷰·리뷰어 공개 라이브러리 동시출현을 사용하는
추천 웹 앱입니다. 현재 알고리즘은 **검증 전 휴리스틱 기준선**이며, 단위 테스트 통과가 선호·동기·
미래 행동의 타당성을 뜻하지 않습니다. 구현은 [설계 문서](docs/DESIGN.md), 신호 채택 기준은
[검증 계약](docs/VALIDATION.md)을 참고하세요.

## 기능

- **Steam OpenID 로그인** 또는 SteamID64 / 커스텀 URL / 프로필 주소 입력으로 조회
- **플레이 기록 태그 요약**: 누적시간 가중 태그 TF-IDF, 장르 분포, 플레이타임 HHI를 관측값으로 표시
- **백로그 기준선**: 2시간 미만 기록 항목 중 조회 예산상 AppID 내림차순 최대 100개만 태그 코사인과 리뷰 긍정률 Wilson 하한으로 정렬(AppID는 취득 시각이 아님)
- **다시 잡을 게임 기준선**: 2~40시간 기록 후 6개월 이상 최근 실행이 없는 항목 중 누적시간 내림차순 최대 40개를 정렬
- **리뷰어 라이브러리 동시출현**: 최다 플레이 게임의 최근 긍정 리뷰어 표본에서 1시간 이상
  기록된 게임을 집계하고 전역 인기도로 완만히 보정합니다. 함께 한 세션이나 협동 플레이를 뜻하지 않습니다.
- **신작·숨은 보석 기준선**: 공개 후보 풀을 확보된 태그·리뷰·소유자 추정 신호로 정렬
- **태그 마스킹 복원 진단**: 태그별 고플레이 게임 2개를 숨긴 fold에서 공통 complete-case 후보의 legacy·태그·리뷰·인기도 기준선과 3~4위 마스킹 대조군을 비교(추천 정확도 주장이 아닌 H-013 구현 검사)
- 카드에는 태그 코사인, 리뷰 Wilson 하한, 동시출현 lift, 공통 태그 등 실제 계산 근거만 표시

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
| `STEAM_API_KEY` | https://steamcommunity.com/dev/apikey 에서 발급 (라이브러리·리뷰어 공개 라이브러리 조회에 필수) |
| `APP_BASE_URL` | OpenID `return_to` 콜백 베이스 URL (예: `http://localhost:3000`). 미설정 시 요청 origin 사용 |
| `SESSION_SECRET` | 세션 쿠키 HMAC 서명용 랜덤 문자열 (16자 이상) |

## 알려진 제약

- `GetOwnedGames`는 대상 프로필의 **게임 상세 정보가 공개**여야 응답한다. 비공개면 안내 화면이 뜬다.
- Steam Web API는 CORS를 허용하지 않으므로 모든 호출은 서버 경유 (`src/lib/steam/*`는 `server-only`).
- SteamSpy 데이터(태그·소유자 추정)는 제3자 추정치다. 태그를 못 받으면 Store 장르로
  가장하지 않고 해당 태그 코사인을 보류하며, Store 장르는 별도 표시 데이터로만 사용한다.
- 리뷰어 표본은 최근 긍정 리뷰 작성자·공개 라이브러리 사용자로 강하게 선택 편향되어 있고,
  현재 라이브러리는 리뷰 시점 이후 기록까지 포함합니다. lift·최소 지지도는 이 편향을 제거하지 않습니다.
- 첫 분석은 외부 API 예의를 위한 스로틀(SteamSpy·상점) 때문에 라이브러리가 크면 **수 분**이
  걸릴 수 있다(최대 ~180개 후보 콜드 조회 시 SteamSpy 스로틀만 100초 이상). appid 단위 서버
  캐시로 이후 요청은 빠르다. Serverless 배포 시 `'use cache'`가 인메모리라 인스턴스 간 지속되지
  않으므로, 콜드 로드 자체를 줄이려면 `'use cache: remote'`(공유 지속 캐시) 전환을 권장한다.
