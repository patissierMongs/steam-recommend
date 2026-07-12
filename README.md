# steam-recommend

Steam 프로필을 불러와 라이브러리와 플레이타임을 기반으로 다음에 할 게임을 추천하는 웹 앱.

## 기능 (계획)

- Steam OpenID 로그인 → SteamID 획득
- 라이브러리 + 플레이타임 조회 (`IPlayerService/GetOwnedGames`)
- 라이브러리 내 "다음에 할 게임" 추천 (미플레이 / 방치된 게임 / 취향 태그 기반)
- 취향에 맞는 신작(미보유) 추천

## 스택

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- Steam Web API는 서버 라우트에서만 호출 (API 키 노출 방지)

## 시작하기

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

`.env.local` 값:

| 키 | 설명 |
| --- | --- |
| `STEAM_API_KEY` | https://steamcommunity.com/dev/apikey 에서 발급 |
| `NEXT_PUBLIC_BASE_URL` | OpenID `return_to` 콜백 베이스 URL |
| `SESSION_SECRET` | 세션 쿠키 서명용 랜덤 문자열 |

## 알려진 제약

- `GetOwnedGames`는 대상 프로필의 **게임 상세 정보가 공개**여야 응답한다. 비공개면 빈 목록이 온다.
- Steam Web API는 CORS를 허용하지 않으므로 브라우저에서 직접 호출할 수 없다. 반드시 서버 경유.
