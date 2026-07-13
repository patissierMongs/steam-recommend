# 분석 퀄리티 판정 이력

분석·추천 변경의 권위 있는 계약은 [VALIDATION.md](./VALIDATION.md)다. 이 파일은 경쟁 구현과
과거 판정이 왜 유지·축소·철회됐는지 기록한다. 학술 문헌 두 개, 합성 테스트, 또는 한 계정의
사례가 있다고 해서 신호를 `PROMOTED`로 승격하지 않는다. 문헌은 가설의 개연성과 설계 선택을
도울 뿐, 이 제품의 타깃에 대한 예측 타당도를 대신하지 않는다.

## 2026-07-13 동시 구현 재검토

원격 커밋 `906ac7f`, `a3f4d50`, `300fde2`와 validation-first 구현을 병합하며 다음처럼
재판정했다.

### 유지한 관측·안전 규칙

- Store에서 `game`으로 확인된 항목만 프로필과 표시 후보의 게임 주장에 사용한다.
- 태그·리뷰·소유자 추정·최근 실행의 결측은 좋아함이나 싫어함의 의미론적 증거가 아니다.
- 백로그·후보 조회 결과가 플레이 기록 IDF corpus를 바꾸지 않게 한다.
- 리뷰어 공개 라이브러리 동시출현을 실제 co-play 또는 협동 세션이라고 부르지 않는다.
- 노출·행동·보상 로그가 없는 결정적 슬롯을 bandit 또는 epsilon-greedy라고 부르지 않는다.
- persona, 임의 클러스터 수/share, 강제 novelty 슬롯은 별도 타깃 검증 전 제품 경로에서
  제거한다.

이 항목들은 추천 효과가 검증된 신호가 아니라, 관측과 주장을 일치시키는 claim-safety 또는
입력 오염 방지 규칙이다.

### 철회한 승격 규칙

- `독립 렌즈 2개`는 표본 수, 교차검증, 외부 타당도 또는 효과 재현이 아니다.
- 플레이타임은 observed engagement이지 재미·선호·만족의 직접 측정이 아니다. 라이브러리
  포함과 태그도 사용자의 stated preference가 아니다.
- 누적시간 HHI, challenge/social 태그, AppID 순서, 고정 가중치와 임계값은 정의된 미래
  타깃으로 검증되지 않았다.
- 한 공개 계정의 사례와 같은 데이터에서 지표를 고르고 성공을 선언하면 탐색 결과를 검증
  결과로 재사용하는 selection bias가 생긴다.

## H-013 경쟁 구현 판정

### C15a — 제품 추천 섹션 재등장

**기각.** 원래 보유 게임은 제품의 미보유 추천 후보에서 제외된다. 보유 상태를 마스킹한
oracle 평가와 실제 retrieval을 분리해야 한다.

### C15b — 모든 태그 top-2 합집합 일괄 제거

**보조 스트레스 arm으로 축소.** 다중 태그 중복으로 프로필 대부분이 사라질 수 있다. 따라서
정확도 점수가 아니라 입력 붕괴 여부만 확인한다. support 하한과 무관한 문자 그대로의 합집합을
사용하며, 잔여 프로필이 비면 랭커 결과를 보류한다.

### C15c — 태그 top-2 대상의 leave-one-out 집계

**독립 평가법으로 기각.** 원격 `holdout.ts`는 한 번에 한 게임만 숨겨 원래 top-2 동시 마스킹
가설을 바꿨고, 제품의 태그+리뷰 랭커가 아닌 content score만 검사했다. 후보군도 남은 보유
게임과 실행 시 임의로 넣은 negatives라 prediction-time risk set이 아니며 K 포화를 보류하지
않았다. 별도 route나 UI에도 연결되지 않아 재현 가능한 세션이 아니었다.

### C15d — popularity 하위 40% niche recovery

**승격 철회, collect-more-data.** 같은 실계정 결과를 본 뒤 `popularity percentile < 0.4`를
선택하고 같은 계정에서 성과를 선언했다. popularity 기준으로 낮은 항목만 고른 뒤 popularity와
비교하면 기준선에 불리한 조건을 사후 선택하게 된다. 한 계정의 세 게임 순위는 사례 메모일 수
있지만 추천기가 인기 이상 가치를 낸다는 검증은 아니다.

## 현재 H-013 구현

`/u/{steamid}/validation/tag-holdout`은 다음만 검사한다.

- support가 4개 이상인 각 태그에서 플레이타임 상위 두 게임을 함께 숨기고 fold별로 모델을
  처음부터 다시 만든다.
- 표적을 owned, IDF, 프로필, recency, owned-app set에서 제거하되 공개 item metadata는
  후보 쪽에만 남긴다.
- 태그·리뷰·ownersEstimate가 모두 있는 같은 complete-case 후보에서 legacy 수식,
  tag-only, review-only, popularity-only와 분석적 random 기대를 비교한다.
- 의도한 표적은 metadata가 빠져도 분모에서 삭제하지 않고 coverage 실패로 남긴다.
- 후보 수 `N <= K`인 fold는 포화로 표시해 해당 K macro 판정에서 제외한다.
- 플레이타임 3~4위 마스킹은 top-2 선택 민감도 arm이며 matched 또는 인과 대조군이 아니다.
- current featured app-ID 포함과 평가용 강제 삽입을 분리하고, 후보 funnel·fingerprint·버전을
  기록한다.

이 결과가 모든 기준선보다 높더라도 현재 snapshot의 known-positive reconstruction이 이 한
계정에서 반증되지 않았다는 뜻뿐이다. 제품 정확도, 미래 행동, 심리적 선호, 모집단 효과 또는
신호 승격은 longitudinal multi-user 평가 전까지 보류한다.

## 2026-07-13 H-013 지정 계정 실행 기록

### Codex 로컬-cache preflight (순위 평가 없음)

Codex는 구현 커밋 `f7eabc3`에서 해당 계정의 로컬 Steam 실행 기록을 읽기 전용으로 점검했다.
이 소스는 현재 전체 ownership snapshot이 아니므로 후보 순위를 계산하지 않았다.

| 관측 | 결과 |
| --- | ---: |
| local app / positive-playtime / 30분 이상 기록 | [redacted] |
| 2026-07-13T07:21:23Z 공개 프로필의 `games owned` 표시 | [redacted] |
| top-40 Store / SteamSpy coverage | 40 / 40 |
| Store-confirmed tagged evidence | 37 |
| observed / support≥4 tags | 167 / 52 |
| per-tag top-2 표적 관측 / 고유 게임 | 104 / 20 |
| literal-union 마스킹 / 잔여 evidence / 잔여 tags | 36 / 1 / 4 |

local source SHA-256 prefix는 `[redacted]`, tag-evidence SHA-256 prefix는
`[redacted]`다. evidence 수와 literal-union 붕괴는 아래 API 실행 기록과 독립적으로
비슷한 구조를 보였지만, ownership risk set이 불완전하므로 rank·accuracy·retrieval을
검증하거나 아래 수치를 재현하지 않는다.

### Claude API 실행 기록 (독립 재현 없음)

원격 Claude 세션은 `getTagHoldoutDiagnostic`를 지정 공개 계정과 실제 Steam Web API 입력으로
1회 실행했다고 기록했다. 개인 라이브러리 보호를 위해 게임 이름·appid는 남기지 않았다. Codex
환경에는 API credential이 없어 독립 재실행하지 못했으므로, 아래 수치는 별도 재현된 결과가
아니라 커밋 `1d26e97`에 보존된 집계 기록이다. 개인 라이브러리 호출은 코드상 `no-store`지만
SteamSpy·Store·featured 공개 item 데이터는 Next 서버 캐시에서 왔을 수 있다.

- diagnosticVersion `H-013/v2`, modelVersion `legacy-tag-review/complete-case-v1`
- fingerprints의 hash 부분: profileEvidence `bc7eb81d`, featuredAppId `225955fa`, candidateId
  `a0f6565c`, candidateMetadata `f3dff11b`. 원 출력의 `fnv1a32:` 접두사는 문서에 보존되지
  않았고 upstream metadata 갱신 시각은 미노출(null)이다.
- `runStartedAt`, 전체 report, 정확한 실행 명령, `libraryItemsAtLeast30m`, target/signal coverage,
  익명 fold exact-rank·결측 필드는 보존되지 않았다. 따라서 fingerprint는 입력 변경 탐지에는
  쓰지만 이 문서만으로 실행을 독립 재현할 수 없다.
- cohort: top-40 played → 태그 있는 evidence 37개 → observed 태그 177개 → eligible(support≥4)
  54개. fold 54개, target 관측 108개(태그별 top-2), unique masked 게임 19개.
- 후보 funnel: featured 54 → outside-library 49 → facts 49 → Store-confirmed 47.
  fold별 oracle pool 49, complete-case pool은 항상 5(coverage 10.2%).
- masked 게임이 현재 featured feed에 등장한 수: **0**. 모든 표적은 강제 삽입된 oracle 후보이며
  실제 retrieval이 아니다.

### 지표 판정

- **Hit@K·Recall@K·NDCG@K (K=5/10/12/20)는 전 fold 포화(informativeFolds=0)라 전부 보류.**
  complete-case 후보가 fold마다 정확히 5개(≤최소 K=5)여서 top-K가 자명해진다. 이 계정에서
  H-013의 사전 지정 주 평가는 `inconclusive`다. rank percentile·MRR·rank-1 비중은 계산할 수
  있지만, complete-case coverage 10.2%, 54개 fold가 19개 게임을 반복 공유하는 탐색적 기술
  통계다. 특히 rank-1은 포화를 관측한 뒤 강조한 사후 요약이다.

- primary arm(top-2 마스킹), 108 표적 기준 target-level rank-1 / 평균순위 / percentile와
  fold-level MRR:
  - tagOnly 48% / 1.92 / 77.1% / 0.972 — 최상
  - combined(legacy) 39% / 2.69 / 57.9% / 0.873
  - popularityOnly 38% / 2.30 / 67.6% / 0.843
  - reviewOnly 17% / 3.63 / 34.3% / 0.552 — 5개 중 중앙 이하
- 민감도 arm(3·4위 마스킹), 108 표적: tagOnly 49% / MRR 0.988, popularityOnly 47% / 0.963,
  combined 44% / 0.941, reviewOnly 31% / 0.752.
- union profile-collapse arm: status `insufficient-profile`. 관측된 177개 태그를 모두 마스킹하면
  evidence 37개가 전부 제거되어(retained 0, residual profile 태그 0) 랭커 결과를 보류했다.
  이는 공격적인 다중 태그 합집합 규칙이 근거 전체를 덮는다는 뜻이며, 하나의 실제 취향
  클러스터나 심리적 일관성을 확인하지 않는다.

### 결론 (신호 승격 없음)

1. 저장된 사후 요약에서는 tagOnly의 target-level rank-1이 48%로 가장 높았다. 그러나
   target coverage가 보존되지 않아 균등 무작위의 대응 기대값도 재계산할 수 없고, fold가 게임을
   반복 공유하므로 이 비율을 독립 시행의 효과로 해석하지 않는다. 태그 자기재구성과 일치하는
   탐색 패턴일 뿐이다.
2. **판별 검사 약화:** primary tagOnly rank-1(48%)과 민감도 arm(49%)은 수치상 거의 같다.
   사전 등록한 해석("3·4위 arm과 비슷한 top-2 결과는 고플레이 자체가 특별하다는 주장을
   약화한다")대로, 이 실행은 고플레이 표적만 특별히 잘 복원한다는 근거를 주지 않는다. 그러나
   correlated fold 한 계정만으로 두 arm의 동등성까지 입증하지도 않는다. 사용자의 원가설
   ("태그별 최장 플레이 2개를 빼도 다시 등장 → 정확도 높음")에서 재등장은 관측됐지만 정확도
   결론은 성립하지 않는다.
3. combined(legacy)와 popularityOnly 비교는 metric-dependent다. combined는 rank-1·fold MRR이
   조금 높지만 평균순위·percentile은 더 낮다. 사전 단일 판정 기준이 없고 fold별 oracle pool
   49개 중 complete-case가 5개뿐이므로 production 수식의 증분 가치는 `inconclusive`다.
4. 강제 삽입 + featured-feed 등장 0 → oracle 재정렬만 측정하며 자연 retrieval이 아니다.

따라서 실행 경로는 작동했지만 사전 지정 top-K 지표는 전부 포화되어 정보가 없었다. 어떤 신호도
승격하지 않으며, "고플레이 특이성" 하위 가설은 이 계정에서 약화됐다. 승격은 여전히 시간
분리·다중 사용자 평가를 요구한다.
