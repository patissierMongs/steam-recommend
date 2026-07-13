import type { CoplaySample } from "@/lib/steam/coplay";

/**
 * H-018 후보 생성 확장 (retrieval-v2) — docs/ALGORITHM_AUDIT.md D1.
 *
 * 발견 섹션의 후보가 featured feed(~49개)에 갇혀 있어 랭커가 무엇을 하든 추천이
 * 변하지 않는다는 구조 진단에 대한 1단계 처방. 이미 수집하는 리뷰어 라이브러리
 * 동시출현 표본(getCoplaySample)을 후보 "생성" 소스로 승격한다 — 아이템-아이템
 * 협업필터링의 표본 근사다.
 *
 * 이것은 retrieval 변경이지 랭킹 신호 변경이 아니다: 후보는 기존 검증 전 기준선
 * 수식으로 그대로 랭킹되고, 어떤 가중치도 바뀌지 않는다. 품질 향상 주장은 하지
 * 않으며, 사전 등록된 확인 항목은 "재구성 진단의 포화 해소"다(VALIDATION.md H-018).
 */

export interface AggregatedCandidate {
  appid: number;
  /** 이 후보가 등장한 앵커 수 */
  anchors: number;
  /** 앵커 표본들의 동시출현 수 합 */
  totalCount: number;
}

/**
 * 여러 앵커의 동시출현 표본을 병합한다. 정렬은 결정적:
 * 더 많은 앵커에서 반복 등장한 후보 우선 → 총 동시출현 수 → appid.
 * (여러 앵커 교차 등장은 단일 앵커 인기보다 사용자 플레이 이력 전반과의
 * 연관을 시사한다 — 관측 규칙이며 검증된 선호 신호가 아니다.)
 */
export function aggregateCoplayCandidates(
  samples: readonly CoplaySample[],
  ownedAppids: ReadonlySet<number>,
  cap: number,
): AggregatedCandidate[] {
  const merged = new Map<number, AggregatedCandidate>();
  for (const sample of samples) {
    for (const { appid, count } of sample.counts) {
      if (ownedAppids.has(appid)) continue;
      const cur = merged.get(appid) ?? { appid, anchors: 0, totalCount: 0 };
      cur.anchors += 1;
      cur.totalCount += count;
      merged.set(appid, cur);
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.anchors - a.anchors || b.totalCount - a.totalCount || a.appid - b.appid)
    .slice(0, cap);
}
