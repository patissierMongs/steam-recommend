import type {
  DiagnosticRanker,
  HeldoutGameDiagnostic,
  HoldoutArmDiagnostic,
  MacroAtK,
  RandomMacroAtK,
  RankerMacroDiagnostic,
  TagHoldoutFold,
  TagHoldoutReport,
} from "@/lib/analysis/tag-holdout";
import { TAG_HOLDOUT_KS, TAG_HOLDOUT_PRIMARY_K } from "@/lib/analysis/tag-holdout";
import { EmptyNote, Section } from "./Section";

const RANKER_LABEL: Record<DiagnosticRanker, string> = {
  combined: "legacy 수식 (태그+리뷰 · 공통 풀)",
  tagOnly: "태그-only",
  reviewOnly: "리뷰-only",
  popularityOnly: "소유자 추정-only (인기도)",
};

const SIGNAL_LABEL = {
  tag: "태그 신호 없음",
  review: "리뷰 신호 없음",
  popularity: "소유자 추정 없음",
} as const;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function nullablePercent(value: number | null): string {
  return value === null ? "보류" : percent(value);
}

function rankText(game: HeldoutGameDiagnostic, ranker: DiagnosticRanker): string {
  const rank = game.ranks[ranker];
  if (rank !== null) return `${rank}위`;
  return game.missingSignals.length
    ? `보류 (${game.missingSignals.map((signal) => SIGNAL_LABEL[signal]).join(", ")})`
    : "보류";
}

function primaryMetric(row: RankerMacroDiagnostic): MacroAtK {
  return row.atK.find(({ k }) => k === TAG_HOLDOUT_PRIMARY_K)!;
}

function candidateRange(folds: TagHoldoutFold[]): string {
  if (folds.length === 0) return "—";
  const values = folds.map(({ candidateCount }) => candidateCount).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return `${values[0]} / ${median} / ${values.at(-1)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight">{value}</p>
    </div>
  );
}

function saturationText(metric: MacroAtK | RandomMacroAtK): string {
  return metric.informativeFolds === 0
    ? `포화 · ${metric.saturatedFolds} fold 전부 판정 제외`
    : `${metric.informativeFolds} 정보성 / ${metric.saturatedFolds} 포화`;
}

function MacroTable({
  arm,
  title,
  note,
}: {
  arm: HoldoutArmDiagnostic;
  title: string;
  note: string;
}) {
  const primary = arm.macro[0] ? primaryMetric(arm.macro[0]) : null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="태그 fold / 표적 관측" value={`${arm.folds.length} / ${arm.foldTargetObservations}`} />
        <Stat label="고유 표적 게임" value={`${arm.uniqueHeldoutGames}개`} />
        <Stat label="공통 후보 N (최소/중앙/최대)" value={candidateRange(arm.folds)} />
        <Stat
          label={`Recall@${TAG_HOLDOUT_PRIMARY_K} 정보성 fold`}
          value={primary ? `${primary.informativeFolds} / ${arm.folds.length}` : "—"}
        />
      </div>
      <h3 className="mt-5 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted">{note}</p>
      {arm.folds.length === 0 ? (
        <div className="mt-4">
          <EmptyNote>두 게임을 숨긴 뒤에도 충분한 근거가 남는 태그가 없습니다.</EmptyNote>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-edge">
          <table className="w-full min-w-[1120px] text-left text-xs">
            <thead className="bg-raised text-[11px] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">4-way complete-case 비교</th>
                <th className="px-3 py-2 text-right font-medium">평균 N / 후보 coverage</th>
                <th className="px-3 py-2 text-right font-medium">표적 coverage</th>
                <th className="px-3 py-2 text-right font-medium">MRR</th>
                <th className="px-3 py-2 text-right font-medium">순위 백분위</th>
                <th className="px-3 py-2 text-right font-medium">K</th>
                <th className="px-3 py-2 text-right font-medium">fold 상태</th>
                <th className="px-3 py-2 text-right font-medium">Recall</th>
                <th className="px-3 py-2 text-right font-medium">HitRate</th>
                <th className="px-3 py-2 text-right font-medium">NDCG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge bg-surface">
              {arm.macro.flatMap((row) =>
                row.atK.map((metric, index) => (
                  <tr key={`${row.ranker}-${metric.k}`}>
                    <td className="px-3 py-2 font-medium">
                      {index === 0 ? RANKER_LABEL[row.ranker] : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {index === 0
                        ? `${row.meanRankedCandidates.toFixed(1)} / ${percent(row.meanCandidateCoverage)}`
                        : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {index === 0 ? percent(row.rankedTargetCoverage) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {index === 0 ? row.meanReciprocalRank.toFixed(3) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {index === 0 ? percent(row.meanRankPercentile) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{metric.k}</td>
                    <td className="px-3 py-2 text-right text-muted">{saturationText(metric)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {nullablePercent(metric.meanRecall)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {nullablePercent(metric.hitRate)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {metric.meanNdcg === null ? "보류" : metric.meanNdcg.toFixed(3)}
                    </td>
                  </tr>
                )),
              )}
              {arm.randomMacro.map((metric, index) => (
                <tr key={`random-${metric.k}`}>
                  <td className="px-3 py-2 font-medium">{index === 0 ? "균등 무작위 기대값" : ""}</td>
                  <td className="px-3 py-2 text-right text-muted">—</td>
                  <td className="px-3 py-2 text-right text-muted">—</td>
                  <td className="px-3 py-2 text-right text-muted">—</td>
                  <td className="px-3 py-2 text-right text-muted">—</td>
                  <td className="px-3 py-2 text-right tabular-nums">{metric.k}</td>
                  <td className="px-3 py-2 text-right text-muted">{saturationText(metric)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {nullablePercent(metric.meanExpectedRecall)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {nullablePercent(metric.meanHitProbability)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TagHoldoutReportView({ report }: { report: TagHoldoutReport }) {
  const primaryArm: HoldoutArmDiagnostic = {
    folds: report.folds,
    macro: report.macro,
    randomMacro: report.randomMacro,
    foldTargetObservations: report.foldTargetObservations,
    uniqueHeldoutGames: report.uniqueHeldoutGames,
  };
  const primaryMacro = report.macro[0] ? primaryMetric(report.macro[0]) : null;
  const unionMetric = report.unionStress.rankers?.combined.atK.find(
    ({ k }) => k === TAG_HOLDOUT_PRIMARY_K,
  );
  const unionRandom = report.unionStress.random.find(({ k }) => k === TAG_HOLDOUT_PRIMARY_K);

  return (
    <>
      <Section
        title="H-013 · 태그별 고플레이 게임 마스킹 복원 진단"
        subtitle={`누적 플레이 상위 최대 ${report.profileFetchCap}개 조회 cohort의 알려진 게임을 숨긴 현재 snapshot 구현 검사입니다. 미래 행동·선호·후보 생성 성능·추천 인과효과의 정확도 평가가 아닙니다.`}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="태그 근거 / 30분+ 라이브러리"
            value={`${report.evidenceGames} / ${report.libraryItemsAtLeast30m}`}
          />
          <Stat label="실행 fold / 관측 태그" value={`${report.eligibleTags} / ${report.observedTags}`} />
          <Stat
            label="표적 관측(중복) / 고유 게임"
            value={`${report.foldTargetObservations} / ${report.uniqueHeldoutGames}`}
          />
          <Stat
            label="raw featured feed에 있던 표적"
            value={`${report.uniqueHeldoutListedInCurrentFeaturedFeed} / ${report.uniqueHeldoutGames}`}
          />
        </div>

        <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-muted">
          support≥4인 태그마다 raw 플레이타임 상위 2개를 owned·IDF·프로필·recency 입력에서
          제거하고 모델을 새로 만들었습니다. 모든 표적은 원래 보유 게임이라 평가 후보군에 강제
          삽입됩니다. raw featured feed ID 포함 여부는 별도 관측일 뿐 end-to-end retrieval이
          아닙니다. 태그 fold는 게임을 반복 공유하므로 독립 표본이나 모집단 정확도로 해석하지
          않습니다.
        </div>

        <div className="mt-4 rounded-lg border border-edge bg-surface px-4 py-3 text-xs leading-6 text-muted">
          <p className="font-medium text-foreground">후보 퍼널</p>
          <p className="mt-1 tabular-nums">
            패키지·번들·중복 제거 featured 앱 ID {report.candidateFunnel.filteredFeaturedAppIds} → 원래 라이브러리 제외 {" "}
            {report.candidateFunnel.outsideOriginalLibraryIds} → scoring facts 확보 {" "}
            {report.candidateFunnel.scoringFactsRetrieved} → Store-confirmed game {" "}
            {report.candidateFunnel.storeConfirmedGames}
          </p>
          <p>
            fold별 네 랭커 비교는 여기서 다시 태그·리뷰·소유자 추정이 모두 있는 공통 후보만
            사용합니다. N≤K인 fold는 effective K=N이므로 해당 K macro 판정에서 제외합니다.
          </p>
        </div>

        <details className="mt-4 rounded-lg border border-edge bg-surface px-4 py-3 text-xs text-muted">
          <summary className="cursor-pointer font-medium text-foreground">실행 조건 및 재현성</summary>
          <dl className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
            <div><dt className="inline">프로토콜</dt><dd className="inline"> · {report.diagnosticVersion}</dd></div>
            <div><dt className="inline">모델</dt><dd className="inline"> · {report.modelVersion}</dd></div>
            <div><dt className="inline">실행 시작</dt><dd className="inline"> · {report.runStartedAt}</dd></div>
            <div>
              <dt className="inline">메타데이터 as-of</dt>
              <dd className="inline"> · {report.metadataAsOf ?? "미기록 — upstream 기준 시각 미제공"}</dd>
            </div>
            <div><dt className="inline">profile evidence</dt><dd className="inline"> · {report.profileEvidenceFingerprint}</dd></div>
            <div><dt className="inline">featured app IDs</dt><dd className="inline"> · {report.featuredAppIdFingerprint}</dd></div>
            <div><dt className="inline">candidate IDs</dt><dd className="inline"> · {report.candidateIdFingerprint}</dd></div>
            <div><dt className="inline">candidate metadata</dt><dd className="inline"> · {report.candidateMetadataFingerprint}</dd></div>
            <div><dt className="inline">규칙</dt><dd className="inline"> · mask=2, 30분+, K={TAG_HOLDOUT_KS.join("/")}, 동률 AppID 오름차순</dd></div>
          </dl>
          <p className="mt-3">
            fingerprint는 입력 변화 탐지용이며 원본 snapshot을 보관하지 않습니다. upstream
            메타데이터 시각이 없어 이 화면만으로 동일 실행을 완전히 재현할 수 없습니다.
          </p>
        </details>
      </Section>

      <Section
        title="태그-fold macro · 게임 중복 포함"
        subtitle="태그·리뷰·ownersEstimate가 모두 존재하는 같은 complete-case 후보를 네 랭커가 순위화합니다. 결측 표적은 fold에서 삭제하지 않고 coverage 실패와 0 hit로 남깁니다."
      >
        <MacroTable
          arm={primaryArm}
          title="고플레이 상위 2개 마스킹"
          note="MRR과 순위 백분위는 전체 fold의 기술 통계이며, 결측 표적의 백분위는 0입니다. K별 평균은 후보군이 K보다 큰 정보성 fold만 사용하고 포화 fold 수를 함께 공개합니다."
        />
      </Section>

      <Section
        title="마스킹 위치 민감도 · 탐색 대조군"
        subtitle="같은 태그의 플레이타임 3~4위 두 게임을 별도로 숨깁니다. matched control이나 플레이타임의 인과효과 검증이 아니라, top-2 표적 선택에 결과가 얼마나 민감한지 보는 보조 arm입니다."
      >
        <MacroTable
          arm={report.lowerPlayControl}
          title="차상위 플레이타임 2개(3~4위) 마스킹"
          note="control fold에서는 원래 상위 2개가 훈련 프로필에 남으므로 두 arm의 프로필 강도와 후보 coverage가 달라질 수 있습니다."
        />
        <p className="mt-4 text-xs leading-5 text-muted">
          두 표의 raw 차이를 플레이타임 효과로 계산하지 않습니다. 서로 다른 표적과 훈련 프로필,
          complete-case N을 가진 별도 민감도 arm이기 때문입니다.
        </p>
      </Section>

      <Section
        title="전체 관측 태그 합집합 제거 · 보조 스트레스"
        subtitle="support 하한과 무관하게 관측된 모든 태그의 상위 최대 2개를 한 번에 제거합니다. 다중 태그 중복으로 근거 대부분을 지울 수 있어 주 평가로 사용하지 않습니다."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="마스킹 태그 / 고유 게임" value={`${report.unionStress.maskedTags} / ${report.unionStress.maskedGames}`} />
          <Stat label="남은 근거 / 잔여 profile 태그" value={`${report.unionStress.retainedEvidenceGames} / ${report.unionStress.residualProfileTags}`} />
          <Stat label="공통 후보 / oracle 후보" value={`${report.unionStress.candidateCount} / ${report.unionStress.oracleCandidateCount}`} />
          <Stat label="complete-case 표적 coverage" value={percent(report.unionStress.targetCoverage)} />
        </div>
        <div className="mt-4 rounded-lg border border-edge bg-surface px-4 py-3 text-xs leading-6 text-muted">
          {report.unionStress.status === "insufficient-profile" ? (
            <p className="text-amber-300">태그 입력이 붕괴해 legacy와 기준선 결과를 모두 보류합니다.</p>
          ) : report.unionStress.status === "no-observed-tags" ? (
            <p>관측된 양수-vote 태그가 없어 합집합 arm을 실행하지 않았습니다.</p>
          ) : (
            <p>
              legacy Recall@{TAG_HOLDOUT_PRIMARY_K}: {unionMetric?.saturated ? "보류 (후보군 포화)" : unionMetric ? percent(unionMetric.recall) : "보류"}
              {" · "}균등 무작위 기대: {unionRandom?.saturated ? "보류 (후보군 포화)" : unionRandom ? percent(unionRandom.expectedRecall) : "보류"}
            </p>
          )}
        </div>
      </Section>

      {[...report.folds, ...report.lowerPlayControl.folds].length > 0 ? (
        <Section
          title="fold별 exact rank"
          subtitle="모든 표적은 평가용으로 강제 삽입됩니다. raw featured feed ID 포함 여부, complete-case 결측 이유, 공통 후보 N을 별도로 표시합니다."
        >
          <div className="max-h-[720px] overflow-auto rounded-lg border border-edge">
            <table className="w-full min-w-[1320px] text-left text-xs">
              <thead className="sticky top-0 bg-raised text-[11px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">arm / 태그 / support</th>
                  <th className="px-3 py-2 font-medium">숨긴 게임 (시간·후보 출처)</th>
                  <th className="px-3 py-2 font-medium">legacy</th>
                  <th className="px-3 py-2 font-medium">태그-only</th>
                  <th className="px-3 py-2 font-medium">리뷰-only</th>
                  <th className="px-3 py-2 font-medium">인기도-only</th>
                  <th className="px-3 py-2 text-right font-medium">공통 N / oracle N</th>
                  <th className="px-3 py-2 text-right font-medium">표적 coverage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge bg-surface">
                {[...report.folds, ...report.lowerPlayControl.folds].map((fold) => (
                  <tr key={`${fold.arm}-${fold.tag}`} className="align-top">
                    <td className="px-3 py-2">
                      <span className="block text-[11px] text-muted">
                        {fold.arm === "topPlay" ? "상위 2" : "3~4위"}
                      </span>
                      <span className="font-medium">{fold.tag}</span>
                      <span className="ml-1 text-muted">
                        {fold.originalSupport}→{fold.retainedSupport}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {fold.heldout.map((game) => (
                        <div key={game.appid} title={`AppID ${game.appid}`}>
                          {game.name} ({(game.playtimeMinutes / 60).toFixed(1)}h) · 평가용 강제 삽입 · {" "}
                          {game.listedInCurrentFeaturedFeed ? "feed ID 있음" : "feed ID 없음"}
                        </div>
                      ))}
                    </td>
                    {(["combined", "tagOnly", "reviewOnly", "popularityOnly"] as const).map(
                      (ranker) => (
                        <td key={ranker} className="px-3 py-2 tabular-nums">
                          {fold.heldout.map((game) => (
                            <div key={game.appid}>{rankText(game, ranker)}</div>
                          ))}
                        </td>
                      ),
                    )}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fold.candidateCount} / {fold.oracleCandidateCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fold.completeCaseTargets} / {fold.heldout.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section
        title="판정 규칙"
        subtitle="이 화면은 단일 성공/실패 또는 정확도 점수를 만들지 않습니다."
      >
        <ul className="space-y-1 text-xs leading-5 text-muted">
          <li>균등 무작위 Recall/Hit 기대만 넘으면 약한 구현 수준 복원입니다.</li>
          <li>태그-only와 비슷하면 태그 자기재구성, 리뷰-only와 비슷하면 공개 리뷰 신호로 설명될 수 있습니다.</li>
          <li>인기도-only와 비슷하면 고플레이 표적의 인기 게임 선택 편향 가능성이 큽니다.</li>
          <li>모든 기준선보다 일관되게 높아도 이 계정에서 H-013이 반증되지 않았다는 뜻뿐입니다.</li>
          <li>어떤 결과도 추천 정확도·모집단 효과·심리적 선호·제품 신호 승격을 뜻하지 않습니다.</li>
        </ul>
        {primaryMacro?.informativeFolds === 0 && report.folds.length > 0 ? (
          <p className="mt-3 text-xs text-amber-300">
            현재 후보군은 Recall@{TAG_HOLDOUT_PRIMARY_K}에서 모든 primary fold가 포화되어 주 수치 판정을 보류합니다.
          </p>
        ) : null}
      </Section>
    </>
  );
}
