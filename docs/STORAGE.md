# 영속 저장소 설계 (결정 기록, 2026-07-13)

## 문제

사용자 관측: "매번 API를 호출하지 말고 DB에 넣어 한 번만 업데이트하면 되지 않나."
정확한 지적이며, 현재 구조의 한계는 다음과 같다.

- Next `'use cache'`(appid 단위, 24h~30d TTL)는 **컨테이너/배포 교체 시 소멸**하고,
  **쿼리 불가**하며, TTL 만료마다 원 API를 다시 때린다. 콜드 진단 1회에 ~4분이
  걸리는 이유가 이것이다.
- Stage 1 이벤트(JsonlSink)는 dev 전용·휘발 — 시간 분리 평가에는 영속 저장이 필수.
- 진단 재현성: 같은 입력 스냅샷으로 재실행할 수 없다(featured 피드 시변 문제의 일부).

## 설계 — 읽기 경로는 read-through, 저장소는 인터페이스 뒤

기존 fetcher(appdata.ts 등)의 앞단에 영속 스토어를 둔다. `'use cache'`는 hot layer로
유지하고, 그 미스가 API 대신 스토어를 먼저 본다.

    요청 → 'use cache'(메모리/디스크 hot) → GameDataStore(영속) → 원 API(미스·만료 시)
                                              └ upsert(payload, fetched_at)

테이블(전부 사용자 무관 공개 데이터 + 가명 이벤트):

| 테이블 | 키 | 내용 | 신선도 규칙 |
| --- | --- | --- | --- |
| `game_facts` | appid | SteamSpy+Store 병합 팩트(payload JSON) | 현행 cacheLife와 동일(1~7d) |
| `coplay_samples` | anchor_appid | 리뷰어 라이브러리 동시출현 표본 | 7~30d |
| `review_medians` | appid | 리뷰 작성자 플레이타임 중앙값 | 7~30d |
| `snapshots` / `impressions` / `interactions` | Stage 1 스키마 그대로 | 가명 이벤트 (InstrumentationSink 구현) | append-only, 보존 12개월 |
| `diagnostic_runs` | run id | 익명화 진단 아티팩트 | 불변 |

효과:
- **"한 번만 업데이트"**: 배치 pre-warm 잡(예: 라이브러리·확장 후보 appid를 야간 갱신)이
  가능해져 요청 경로에서 원 API 호출이 사라진다. 콜드 4분 → DB 조회 수 초.
- 외부 API 예의(레이트리밋) 개선, SteamSpy 장애 격리.
- 진단이 `fetched_at` 고정 스냅샷 위에서 재실행 가능 → 재현성 향상.
- Stage 1 sink 결정이 함께 해소된다(같은 저장소).

## 백엔드 선택지 (사용자 결정 필요)

| 선택지 | 장점 | 단점/제약 |
| --- | --- | --- |
| **A. Postgres (managed)** — 배포 권장 | 종단 조인·보존/삭제 경로·동시성. Stage 2 분석 쿼리에 적합 | 배포 인프라 필요 (이 저장소 밖의 결정) |
| **B. SQLite (단일 노드 볼륨)** | 파일 하나, 운영 단순. 소규모 배포에 충분 | 이 개발 컨테이너는 ephemeral이라 세션 간 소멸 — 실 영속성은 볼륨 있는 배포에서만 |
| C. 현상 유지 ('use cache'만) | 변경 없음 | 위 문제 전부 지속 |

**권고: 인터페이스(`GameDataStore`)를 먼저 동결하고 SQLite 구현으로 시작(B), 배포 시
A로 교체.** 스키마·인터페이스가 같으므로 교체 비용이 낮다. 단, 이 개발 환경에서는
어떤 파일 DB도 컨테이너 재활용 시 사라진다 — 실 데이터 축적은 배포 후에만 의미 있다.

## 전체 카탈로그 수집 (2026-07-13 실측 구현)

사용자 후속 질문 "캐시가 아니라 아예 스팀의 10만+ 게임 데이터를 받아올 수는 없나"에
대한 답: **가능하고, 구현·실증했다** (`src/lib/catalog/store.ts` +
`scripts/ingest-catalog.ts`, node:sqlite 실험 API — 외부 의존성 없음).

실측 결과 (이 컨테이너, 실제 실행):

| 단계 | 소스 | 실측 | 전체 소요 추정 (레이트리밋 기준) |
| --- | --- | --- | --- |
| A. 전체 게임 ID·이름·last_modified | `IStoreService/GetAppList` (게임만, 50k/페이지) | **174,270개 / 4요청 / 수 초** | 수 초 · `last_modified`로 증분 갱신 |
| B. 인기 스파인 (리뷰수·소유자·ccu·가격) | SteamSpy `request=all` (1000/페이지, 1req/60s) | 2페이지 2,000개 | 전체 ~1.5시간 (야간 배치 1회) |
| C. 태그 (투표수) | SteamSpy per-app appdetails (1req/s 예의) | 40초에 36개 | 상위 2만 ≈ 5.6h · 전체 스파인 ≈ ~1일 |
| D. Store 상세 (타입·장르·출시일) | appdetails (~40req/min 관례) | 미구현 (다음 증분) | 상위 2만 ≈ ~8h |

- 전 단계 **idempotent·재개 가능** (meta 커서) — cron 반복 실행이 곧 "한 번 받고 바뀐
  것만 갱신"이다. DB 파일은 `.catalog/`(gitignore), 174k 앱 + 스파인 2k에 5.8MB.
- 참고: 구 `ISteamApps/GetAppList`는 폐기됨(실측 Not Found) — `IStoreService` 사용.
- **추천에 주는 의미**: 태그 카탈로그가 쌓이면 H-018의 두 번째 후보 소스(태그-이웃
  retrieval)가 열린다 — "사용자의 특징 태그 조합을 가진 게임"을 featured/동시출현이
  아닌 **17만 전체에서** 질의할 수 있다. 이 역시 retrieval 변경이며 품질 주장은
  Stage 2를 거친다.
- 제약: 이 개발 컨테이너는 ephemeral — 실제 축적·cron은 볼륨 있는 배포에서. 읽기
  경로(read-through) 통합은 다음 증분.

## 비범위

- 원시 개인 라이브러리를 평문 식별자로 저장하지 않는다(이벤트는 가명 subject).
- DB 도입은 성능·재현성 변경이지 추천 품질 주장이 아니다 — 신호 승격과 무관.
