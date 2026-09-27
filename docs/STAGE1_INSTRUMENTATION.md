# Stage 1 — Instrumentation Design

## Why this exists

`VALIDATION.md`의 stage gate에서 **Stage 1 = instrumentation**이다: opt-in longitudinal
snapshot과 impression·position·candidate-universe·model-version·response·propensity 로깅.
H-013 실측 실행(`ANALYSIS_QUALITY.md` 2026-07-13)이 확인한 병목이 바로 이것이다 — 현재
스냅샷 하나로는 어떤 신호도 승격할 수 없고, **시간 분리된 관측 없이는 Stage 2 오프라인 예측
평가 자체가 불가능**하다. 이 문서는 그 데이터 계약을 동결한다.

이 단계는 **데이터를 모으는 것**이지 신호를 승격하는 것이 아니다. 여기서 수집한 데이터는
Stage 2(시간 정렬 risk set·ablation·calibration)에서만 판정에 쓰인다.

## 무엇을 측정하는가 — claim ladder 위치

| 이벤트 | claim ladder | 이 데이터가 가능케 하는 것 |
| --- | --- | --- |
| LibrarySnapshot | Observation | 시간에 따른 ownership·playtime·last-played 변화 = ground truth |
| RecommendationImpression | Observation | 서버가 무엇을·어떤 순서로·어떤 모델로 만들었나 + candidate universe 전체 |
| RecommendationExposure | Observation | 그중 어떤 순위의 카드가 실제로 화면에 들어왔나 (클라이언트 확인) |
| RecommendationInteraction | Observation | 명시적 응답(클릭/아웃바운드) — 있으면 |

이 넷은 전부 **관측 로그**다. "선호"·"만족"·"추천이 행동을 유발" 같은 상위 주장은 여기서
만들지 않는다. Stage 2/3가 시간 정렬과 (필요 시) 무작위 노출로 그 사다리를 오른다.

## 이벤트 스키마 (동결 대상)

버전 필드 `schemaVersion`를 모든 레코드에 둔다. 스키마 변경은 버전을 올리고 기존 로그를
불변으로 남긴다(append-only, 사후 수정 금지).

### 1. LibrarySnapshot — 종단 ground truth

    {
      schemaVersion: "s1/v2",
      subject: string,            // 가명화된 안정 id (아래 프라이버시)
      capturedAt: string,         // ISO8601, 서버 시각
      source: "login" | "auto" | "manual",
      games: [
        { appid, playtimeForever, playtime2Weeks?, rtimeLastPlayed? }
      ]
    }

- **왜 필요**: 같은 subject의 두 스냅샷을 비교하면 신규 실행(첫 launch), 재방문(revisit),
  신규 구매(ownership 증가)를 **노출 이후 시점**에 관측할 수 있다. 이것이 유일한 행동 라벨원.
- **누수 방지**: 예측 시점 이후의 스냅샷만 outcome으로 쓰고, 예측 입력에는 절대 넣지 않는다.
  스냅샷은 원자적으로 그 시각 상태를 기록할 뿐, 미래를 포함하지 않는다.

### 2. RecommendationImpression — 서버가 만든 목록

    {
      schemaVersion: "s1/v2",
      impressionId: string,       // 결정적 id (subject|section|generatedAt|모델)
      subject: string,
      generatedAt: string,        // ISO8601, 랭킹이 끝난 직후의 서버 시각
      modelVersion: string,       // 랭커 버전 (아래)
      section: "backlog" | "lapsed" | "coplay" | "newReleases" | "hiddenGems",
      candidateUniverseSize: number,   // 랭킹 후보 풀 크기 (retrieval vs ranking 분리)
      candidateUniverseHash: string,   // 후보 집합 지문 (재현/누수 점검)
      candidateUniverse: number[],     // 정렬·중복 제거한 후보 appid 전체
      deterministic: boolean,
      items: [
        { appid, position, score, tasteMatch, reviewLowerBound, propensity? }
      ]
    }

- **노출이 아니다**: 서버 렌더 시점에 기록하므로 응답이 중단되거나 화면 아래쪽 섹션이면
  사용자는 보지 못했을 수 있다. 노출 분석은 아래 RecommendationExposure만 쓴다.
- **generatedAt은 스냅샷 capturedAt과 분리**: 콜드 캐시에서 분석이 수 분 걸리므로, 라이브러리를
  읽은 시각을 목록 생성 시각으로 쓰면 그 사이의 행동이 노출 이후로 잘못 분류된다.
- **candidate universe를 ID 목록으로 기록**: 해시만으로는 카탈로그·조회 범위가 바뀐 뒤
  "무엇을 보일 수 있었나"를 복원할 수 없다. retrieval 실패와 ranker 실패를 나누고 baseline을
  재랭킹하려면 후보 ID 전체가 필요하다(VALIDATION.md 평가 프로토콜).
- **빈 목록도 기록**: 평가했지만 후보가 없던 경우를 평가하지 않은 경우와 구분해야 coverage와
  실패율 추정이 편향되지 않는다.
- **propensity**: 무작위/탐색 노출을 도입하면 그 확률을 기록해 Stage 2에서 IPS 등 불편
  추정에 쓴다. 결정적 랭킹이면 `propensity` 생략(=1로 간주하지 않고 "결정적"으로 표시).

### 3. RecommendationExposure — 실제 노출

    {
      schemaVersion: "s1/v2",
      impressionId: string,       // 어떤 목록의 노출인지
      subject: string,            // 서버가 세션에서 계산 (클라이언트 입력 아님)
      section: "backlog" | "lapsed",
      exposedAt: string,          // ISO8601, 서버 수신 시각
      positions: number[]         // 화면에 절반 이상 들어온 카드의 순위 (1부터)
    }

- 클라이언트(`ExposureTracker`)가 IntersectionObserver로 카드의 화면 진입을 확인한 뒤
  `/api/instrumentation/exposure`로 보낸다. 서버 수집·로그인 본인·유효한 동의가 모두
  충족될 때만 기록한다.
- impressionId는 클라이언트가 보낸 값이라 검증되지 않은 참조다. Stage 2 조인에서 짝이 없는
  노출은 버린다.

### 4. RecommendationInteraction — 응답 (선택)

    {
      schemaVersion: "s1/v2",
      impressionId: string,       // 어떤 노출에 대한 반응인지
      appid: number,
      action: "click" | "outbound_store",
      at: string
    }

- 클릭은 관심의 약한 신호일 뿐 만족이 아니다. outcome의 1차 소스는 스냅샷 기반 행동이며,
  클릭은 보조 관측이다.

## modelVersion — 노출의 귀속

impression은 어떤 랭킹 로직이 만든 것인지 알아야 한다. 랭커에 버전 상수를 둔다:

- 현재 기준선: `rank-tag-review/z-heuristic-v1` (= `0.40·z(taste) + 0.35·z(review)`,
  검증된 가중치 아님). 계수·후보 규칙이 바뀌면 버전을 올린다.
- H-013 진단 모델(`legacy-tag-review/complete-case-v1`)과 별개다. impression은 **제품
  랭커** 버전을 기록한다.

## 프라이버시·동의 (필수 게이트)

라이브러리 스냅샷은 개인 데이터다. 다음을 강제한다:

1. **opt-in 기본 OFF.** 명시적 동의 없이 어떤 이벤트도 기록하지 않는다. 기본 sink는 no-op.
2. **가명화.** `subject`는 raw SteamID64가 아니라 서버 비밀로 salt한 HMAC-SHA256 해시.
   같은 salt 안에서만 스냅샷↔impression 조인 가능. salt 폐기 시 재식별 불가.
3. **저장소 격리.** 원시 라이브러리·이벤트 로그는 **repo·fixture·VCS에 절대 커밋 금지**.
   런타임 디렉터리는 gitignore. (기존 규칙: STEAM_API_KEY·원시 라이브러리 비커밋과 동일선상.)
4. **보존·삭제.** 보존 창(예: 12개월)과 subject별 삭제 경로를 둔다. 동의 철회 시 이후 수집
   중단 + 기존 데이터 삭제.
5. **최소 수집.** 분석에 필요한 필드만. 프로필 텍스트·아바타·친구 목록 등은 수집하지 않는다.

## 저장 백엔드 — 인터페이스로 추상화, 아직 락인 안 함

`InstrumentationSink` 인터페이스 뒤에 둔다. 구현은 교체 가능:

- **NullSink** (기본): no-op. opt-out/미동의 상태. 프로덕션 기본값.
- **JsonlSink** (개발): gitignore된 런타임 디렉터리에 append-only JSONL. 로컬 검증용.
- **(배포 결정, 미정)**: 종단 조인·보존·삭제가 필요하므로 실제로는 관리형 DB(Postgres 등)나
  객체 스토리지가 맞다. 이 선택은 배포 시점에 별도로 한다. **이 PR은 스키마와 인터페이스만
  동결**하고 특정 DB에 묶지 않는다.

이 환경(ephemeral 컨테이너)에서는 JsonlSink 데이터도 컨테이너 재활용 시 사라진다 — 개발
검증 전용임을 명시한다.

## Stage 2로 가는 경로 (여기서 구현 안 함)

수집이 충분히 쌓이면 Stage 2에서:

1. 각 impression에 대해 **노출 이후** 스냅샷들로 outcome(첫 launch/revisit/구매)을 라벨.
2. **시간 정렬 risk set**: 예측 시점에 가능했던 후보만, 미래 정보 배제.
3. baseline(인기·태그-only)·ablation·calibration·subgroup robustness.
4. 사전 등록한 최소 유의미 효과·불확실성 기준 충족 시에만 신호 승격 후보.

Stage 1의 성공 기준은 "추천이 좋다"가 아니라 **"Stage 2를 편향 없이 돌릴 수 있는 데이터가
모였다"** 이다.

## 이번 증분의 범위

- [x] 이벤트 스키마 타입 + `schemaVersion`·`MODEL_VERSION` 동결
- [x] `InstrumentationSink` 인터페이스 + `NullSink`(기본) + `JsonlSink`(개발)
- [x] 가명화 `subjectId(steamid, salt)` (HMAC-SHA256)
- [x] 단위 테스트 (기본 no-op·해시 안정성·JSONL append)
- [x] 동의 UI + 배선: steamid 바인딩 서명 동의 쿠키(`consent.ts`, 세션과 서명 도메인 분리),
  본인 대시보드 한정 패널(`InstrumentationPanel`), 동의+서버 opt-in 시 snapshot과
  백로그·다시잡을 impression 기록(`record.ts`). 후보 universe는 랭커와 같은 술어
  (`backlogEligible`/`lapsedEligible`)를 공유해 risk set 정의가 어긋나지 않는다.
- [ ] **보류 — featured 기반 섹션(신작·숨은 보석·동시출현) impression**: candidate
  universe가 featured 피드·리뷰어 표본에 걸쳐 있어, 잘못된 universe를 기록하면 Stage 2
  risk set이 오염된다. 정확한 universe 추출이 마련될 때까지 기록하지 않는다
  (틀리게 기록하는 것보다 안 기록하는 쪽이 낫다).
- [x] s1/v2: impression 시각을 목록 생성 직후로 분리(`generatedAt`), 후보 ID 전체 기록,
  빈 목록 기록, 클라이언트 확인 기반 노출 이벤트(`RecommendationExposure`) 추가,
  서버 수집이 꺼져 있으면 동의 패널에 그 사실을 표시
- [ ] **다음 증분**: interaction(click) 기록, 중복 억제·쿼터, 보존·삭제 잡, 배포용 sink 선택
