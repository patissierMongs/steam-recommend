# steam-recommend 추천 엔진 설계

> **검증 상태:** 이 문서는 현재 휴리스틱 기준선을 설명한다. 수식과 가중치는 사용자 선호나
> 미래 행동을 검증한 모델이 아니다. 다중 클러스터, persona 적합도, 강제 novelty 슬롯은 제품
> 경로에서 제거했다. 새 분석 신호의 채택과 제품 문구는
> [VALIDATION.md](./VALIDATION.md)의 가설 등록, 시간 분리 평가, 신호 승격 게이트를 따른다.
> 제공 실계정 결과는 반례·민감도 테스트이며 통계적 정확도 증명이 아니다.

플레이 여부(binary)만 쓰는 단순 추천이 아니라, **플레이타임·태그·리뷰·라이브러리 동시출현** 신호를
휴리스틱으로 결합하는 추천 기준선. 모든 계산은 서버에서 실시간으로 수행하되,
사용자 독립적인 데이터(게임별 태그/리뷰/리뷰어 표본 분포)는 캐시한다.

## 데이터 소스

| 소스 | 엔드포인트 | 용도 | 캐시 |
| --- | --- | --- | --- |
| Steam Web API | `IPlayerService/GetOwnedGames` | 라이브러리 + 플레이타임 + 최근 플레이 시각 | 없음 (개인화) |
| Steam Web API | `ISteamUser/GetPlayerSummaries`, `ResolveVanityURL` | 프로필, 커스텀 URL 해석 | 없음 |
| Steam Store API | `api/appdetails` | 장르, 출시일, 이미지, 설명, 가격 | 24h (appid별) |
| Steam Store API | `api/featuredcategories` | 신작/인기/할인 후보 풀 | 1h |
| Steam Store API | `appreviews/{appid}` | 최근 긍정 리뷰어 SteamID 표본 | 7d |
| SteamSpy | `api.php?request=appdetails` | **태그(투표수 포함)**, 리뷰 수, 소유자 추정, 중앙값 플레이타임 | 24h (appid별) |

Steam Web API 키는 서버 전용(`STEAM_API_KEY`). 브라우저에서 직접 호출하지 않는다.

## 1. 관측 engagement 가중치 (검증 전 휴리스틱)

Hu–Koren–Volinsky(2008)의 암묵적 피드백 아이디어에서 착안한 기준선이다.
이 값은 선호나 confidence의 추정치가 아니라 누적 플레이 관측의 가중치다.

```
relative_time_ratio(g) = playtime(g) / median_playtime_global(g)   # SteamSpy median_forever로 정규화
w(g) = log2(1 + hours(g)) · min(2, 0.5 + relative_time_ratio(g))   # 절대량 × 상대시간 배율
w(g) *= recency_decay(last_played, half_life = 2y, floor = 0.35)
```

- `log` 감쇠: 극단 플레이타임의 영향 완화
- **중앙값 정규화**: 게임별 일반적 플레이 길이 차이 완화 가설
- 시간 감쇠: 최근 관측에 더 큰 가중치를 주는 가설
- 중앙값 또는 최근 플레이 시각이 없으면 해당 변환은 중립값 1로 보류

30분, 2년, 0.35, 정규화 식은 모두 H-001/H-002 평가 전 기준값이다.

## 1.5 외부 연구에서 가져온 검증 후보

Spotify가 공개한 연구 아이디어를 Steam 입력에 맞게 단순화한 실험적 기준선이다.
Spotify의 모델 또는 검증 결과가 이 구현에 전이됐다고 주장하지 않는다.

| 외부 연구 방향 | 현재 판정 |
| --- | --- |
| **다중 관심사 표현** | H-003 transfer hypothesis. 임의 K·최소 share·max-over-clusters가 검증되지 않아 현재 제품 랭킹과 UI에서 비활성 |
| **느린/빠른 관심사 분리** | H-002 transfer hypothesis. Steam의 시간순 snapshot과 타깃이 생기기 전에는 구현하지 않음 |
| **암묵적 피드백 confidence** | 현재 누적시간 식은 confidence가 아니라 관측 가중치. Spotify/Hu 계열의 검증 결과가 이 입력에 전이됐다고 주장하지 않음 |
| **Explore/exploit** | 노출·propensity·보상 로그가 없어 구현하지 않음. 기존 강제 novelty 슬롯은 제거 |

multi-interest와 slow/fast 분리는 각각 H-003/H-002로 등록하며 temporal 평가 전에는
제품 품질 향상으로 확정하지 않는다.

## 2. 플레이 기록 태그 벡터 — TF-IDF + 코사인 유사도

- 게임의 태그 벡터: SteamSpy 태그 투표수를 `sqrt` 감쇠 후 L1 정규화 → TF
- IDF: 30분 이상 플레이 근거가 있고 Store 타입이 `game`으로 확인됐으며 태그를 확보한 게임만의 문서빈도로
  `log((N+1)/(df+1))+1`. 백로그·후보 조회 개수나 순서가 프로필을 바꾸지 않게 한다.
- 사용자 프로필 벡터: `P = Σ w(g) · tfidf(g)` (플레이 ≥ 30분인 게임만)
- 후보 점수: `cosine(P, tfidf(c))`
- 프로필 corpus에서 보지 못한 후보 태그의 IDF: `log(N+1)+1` (`df=0`의 smoothed IDF)

코사인은 태그 벡터 유사도이지 선호 확률이 아니다. 후보 태그가 없으면 0점 불일치가 아니라
`null`로 보류한다. 태그가 있으나 교집합이 없을 때만 관측된 0 유사도다.

## 2.5 실험적 라이브러리 패턴 요약 — 제품 비활성

기존 `personaFit`과 고난도/소셜/니치 유형 라벨은 H-009를 만족하지 못해 코드와 제품에서
제거했다. 현재 대시보드는 총시간, 중앙값, 미플레이 수, HHI, 장르·태그 분포 같은 기술통계만
표시한다. HHI에는 임의의 "집중형/잡식형" 유형 구간을 붙이지 않는다.

## 3. 리뷰 긍정률 요약 — Wilson score 신뢰하한

리뷰 긍정 비율을 그대로 쓰면 표본이 작은 게임이 과대평가된다.
독립 Bernoulli 표본이라는 명목상 가정 아래 **Wilson score interval의 95% 하한**을 리뷰 축의 순위 통계량으로 사용:

```
WLB = (p̂ + z²/2n − z·√(p̂(1−p̂)/n + z²/4n²)) / (1 + z²/n),  z = 1.96
```

리뷰 10개에 100% 긍정(WLB ≈ 0.72)보다 리뷰 5,000개에 93% 긍정(WLB ≈ 0.92)이 위가 된다.
이는 관측된 리뷰의 이항 비율에 대한 보수적 요약이지, 리뷰 작성자 선택 편향을 제거한 게임
품질 또는 사용자 만족도 확률은 아니다.

## 4. 리뷰어 라이브러리 동시출현 신호

강하게 선택 편향된 표본의 탐색 신호를 다음처럼 계산한다:

1. 앵커 게임 선정: 사용자 `w(g)` 상위 K=3
2. 앵커의 최근 긍정 리뷰 작성자 표본 M≤30명 수집(`num_games_owned≥5`인 작성자만)
3. 각 리뷰어의 현재 공개 라이브러리에서 1시간 이상 기록된 게임별 출현 횟수 `n(Y)` 집계
4. 순위 통계량은 **평활화된 관측/기대 로그비**:

```
lift(Y | A) = (n(Y) / M) / p(Y)        # p(Y) = SteamSpy 소유자 추정 중앙값 / 전체 모수
score = log( (n(Y) + s) / (M · p(Y) + s) )   # add-s 평활화, n(Y) ≥ 3 필수
```

원시 빈도 대신 lift를 쓰면 "모두가 가진 게임"(CS2, TF2)보다
**선택 편향된 리뷰어 표본에서 기대치 대비 과대표된 게임**이 올라올 수 있다.
표본이 작으므로 평활화와 최소 지지도(n≥3)로 분산 폭주를 막는다.
앵커별 표본 분포는 사용자 독립적이므로 7일 캐시로 공유한다.

> **lift 해석의 한계(솔직한 명시).** ① 표본 M이 작아 기대치 `M·p(Y)`가 평활화 상수 `s`보다
> 작은 경우가 많아, 순위는 사실상 표본 내 출현 횟수(coCount) 위주가 되고 인기도 보정은 완만하게만
> 작용한다. ② `p(Y)=owners/POP`의 `POP`(≈1.2억)는 프라이어이며, 평활화와 맞물려 순위에 영향을 준다
> (상수라 무영향이 아님). ③ 표본은 앵커의 최근 긍정 리뷰어 중 공개 라이브러리 사용자라 전체
> 모집단과 다르다. 현재 라이브러리는 리뷰 작성 시점 이후 기록도 포함하므로 post-review temporal
> contamination이 있다. 과거 cutoff 평가에 현재 데이터를 사용하면 그때 비로소 prediction-time leakage다.
> 따라서 UI의 "동시출현 ×N" 배지는 **근사치**로 표시하며, 이 섹션은 정밀한 통계적
> lift가 아니라 "긍정 리뷰어의 공개 라이브러리에서 함께 관측된, 전역 인기로 완만히 보정된 게임"으로
> 읽어야 한다. 같은 세션이나 협동 플레이를 뜻하지 않는다.

## 5. 섹션별 랭킹

각 섹션 내에서 알려진 구성값끼리만 z-정규화 후 가중합한다. 해당 신호가 결측이면 그 축의
기여를 0으로 두되 다른 확보 신호는 사용할 수 있다. 태그와 리뷰가 모두 없는 일반 후보는
추천하지 않는다. 모든 카드에는 실제 확보된 값만 표시한다.

| 섹션 | 후보 | 점수 |
| --- | --- | --- |
| 백로그에서 추천 | 라이브러리 포함 & 플레이 < 2h | `0.40·z(cosine) + 0.35·z(WLB)` |
| 다시 잡을 게임 | 라이브러리 포함, 2h ≤ 플레이 ≤ 40h, 6개월+ 방치 | `0.40·z(cosine·(1−0.4·relativeTime)) + 0.35·z(WLB)` |
| 리뷰어 라이브러리 동시출현 | 리뷰어 표본 출현 상위 (현재 라이브러리 밖) | `0.50·z(lift) + 0.20·z(cosine) + 0.15·z(WLB)` |
| 신작 추천 | featured new_releases ∪ coming_soon (현재 라이브러리 밖) | `0.40·z(cosine) + 0.35·z(WLB)` |
| 숨은 보석 | 동시출현 ∪ 신작·인기 후보 중 소유자 200만 미만, 리뷰 30+ | `cosine^0.4 · WLB^0.3 · novelty^0.15` |

계수 합이 1이 아닌 것은 제거한 `personaFit`의 비중을 다른 미검증 신호로 재분배하지 않았기
때문이다. 순위에는 남은 계수의 상대비만 작용한다. 최종 계수는 H-012 평가 전에는 확정하지 않는다.

### 숫자 파라미터의 지위

아래 값은 모두 현행 legacy control을 재현하기 위한 값이며 제품 규칙이나 acceptance가 아니다.

| 종류 | 현재 값 예 | 검증 |
| --- | --- | --- |
| 운영 예산 | profile 40, backlog 100, lapsed 40, 동시출현 후보 25, concurrency 6 | latency/API budget과 top-20/40/80/full coverage 민감도 |
| surface eligibility 휴리스틱 | 30분, 2시간, 40시간, 180일, 소유자 200만, 리뷰 30 | H-012 surface별 risk set·target 민감도 |
| ranking/variance 파라미터 | 가중치, reviewer 30, 보유 5개, 표본 플레이 60분, support 3, POP 1.2억, smoothing 1 | H-010/H-011/H-012 one-change ablation과 불확실성 |

운영 cap은 정확도 계수가 아니고, 나머지 숫자는 데이터에서 추정된 값이 아니다.

숨은 보석은 소유자 추정의 역수를 명시적으로 보상하는 H-011 기준선이다. 이것을 공정성 또는
popularity-debiasing 효과로 부르지 않으며, 관련성 비열등성과 노출 다양성 ablation 전에는 승격하지 않는다.

## 6. 플레이 기록 기반 대시보드

- TF-IDF 상위 태그 (기여 플레이타임 포함)
- 장르 분포 (플레이타임 가중)
- 통계 요약: 총/중앙값 플레이타임, 미플레이 비율, 플레이타임 집중도(HHI, Herfindahl 지수)

## 7. 태그별 고플레이 게임 마스킹 복원 진단

`/u/{steamid}/validation/tag-holdout`은 제품 추천과 분리된 H-013 진단 경로다. 현행 profile
조회 cohort(누적시간 상위 최대 40개)에서 태그 support가 4개 이상일 때 raw 플레이타임 상위
2개를 해당 fold의 라이브러리 입력·IDF·프로필에서 제거하고 모델을 새로 만든다.

현재 featured의 Store-confirmed 후보군에 숨긴 두 게임을 강제로 추가한다. 그중 태그·리뷰·
ownersEstimate가 모두 있는 complete-case 후보만 똑같이 사용해 legacy 태그+리뷰 수식,
태그-only, 리뷰-only, 인기도-only와 분석적 무작위 기대값을 비교한다. 결측 표적은 fold에서
삭제하지 않고 coverage 실패로 남기며, 후보 N이 K 이하인 macro 값은 포화로 보류한다. 이
legacy 결과는 공통 진단 풀에서 다시 정규화한 수식이지 제품 목록의 재현이 아니다.

강제 추가 결과는 ranker reconstruction일 뿐 candidate retrieval이 아니다. 숨긴 게임이 raw
featured feed에 원래 있었는지만 별도로 표시한다. 같은 태그의 플레이타임 3~4위 두 게임을
숨기는 arm은 top-2 표적 선택 민감도를 보는 탐색 대조군이며 인과 대조군이 아니다. support와
무관하게 모든 관측 태그의 상위 최대 2개 합집합을 제거하는 검사는 프로필 붕괴를 보는 보조
스트레스 arm이다. 잔여 태그 프로필이 비면 랭킹 결과를 보류한다.

보고서에는 profile/candidate fingerprint, 실행·모델 버전, 후보 확보 funnel을 남긴다. 다만
upstream metadata의 기준 시각과 원본 snapshot을 보존하지 않으므로 완전한 재현 artifact는
아니다. 이 진단은 current snapshot의 자기일관성과 누출·후보 누락을 찾을 수 있지만 미래
실행, 신규 게임 적합성, 선호, 추천 인과효과를 검증하지 않는다. 전체 계약은 VALIDATION
H-013을 따른다.

## 지연·비용 통제

- appid별 데이터는 `"use cache"` + `cacheLife`로 서버 캐시 (SteamSpy/appdetails 24h)
- SteamSpy·상점은 동시성 제한(≤6) + 전역 최소 간격 스로틀로 예의 있게 호출, 분석 대상 캡:
  태그 프로필은 플레이 상위 40개, 백로그 후보는 최대 100개, 장기 미실행 후보는 최대 40개,
  리뷰어 동시출현 후보는 앵커당 25개
- 대시보드는 섹션별 `<Suspense>` 스트리밍 — 프로필 헤더 즉시, 무거운 섹션은 준비되는 대로
- provenance 분리: SteamSpy 태그 미확보 시 태그 코사인은 `null`; appdetails 장르는 별도 표시값

## 알려진 제약

- `GetOwnedGames`는 대상 프로필의 게임 상세가 공개일 때만 응답 (비공개 → 안내 UI)
- 리뷰어 표본은 최근 긍정 리뷰 작성자·공개 라이브러리 사용자로 선택 편향되어 있다.
  lift와 최소 지지도는 이 편향이나 시간 누출을 제거하지 않으며, UI에 표본 크기를 명시한다.
- SteamSpy 소유자 수치는 구간 추정치의 중앙값 사용
