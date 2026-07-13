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
