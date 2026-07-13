# Evidence-to-Product Quality Framework

## Status

This document is the project contract for player analysis and recommendation changes. It takes precedence over unvalidated formulas and product claims in DESIGN.md.

The inherited engine at commit e38c956 is a deterministic heuristic baseline. The current reset removes unvalidated persona, multi-cluster ranking, and forced novelty selection from the product path. Passing unit tests proves only implementation behavior. It does not prove preference, motivation, satisfaction, future behavior, or recommendation impact.

Issue #2 is a blocked archive, not an implementation specification. Its fixed tag share, K/minority-share thresholds, and confidence formula are discarded as product rules; separately identified transformations and operational caps may remain only as disclosed legacy controls subject to this gate. A holdout fabricated from one current snapshot is prohibited rather than retained as a challenger.

The inherited ranker may remain temporarily as a versioned **legacy control baseline** so challengers can be compared against it. That status is not signal promotion and grants no preference, prediction, or causal claim. New signals, reweighting, and stronger copy are subject to the gate prospectively; claim-safety defects are fixed immediately.

## Goal

Turn ideas and user examples into product improvements through a repeatable chain:

    idea or counterexample
      -> competing hypotheses
      -> observable target and identification limits
      -> independent ground truth
      -> temporal evaluation and ablation
      -> promote, narrow, or reject
      -> monitor after release

An idea is valuable even when its literal claim fails. It may reveal a confounder, missing state, misleading label, or a better data-collection requirement.

## Claim ladder

Never jump over a layer.

| Layer | Examples | Product contract |
| --- | --- | --- |
| Observation | library inclusion, cumulative minutes, last played, achievement, game capability | May be stated as fact with provenance |
| Behavioral summary | time concentration, observed activity, repeated library inflow | Descriptive only; name the observation window and coverage |
| Natural-behavior prediction | first launch or revisit without claiming recommendation impact | Requires a risk set, longitudinal snapshots, temporal evaluation, calibration, and model version |
| Product causal effect | incremental launch, save, or satisfaction caused by a recommendation | Requires randomized exposure/control or another design that identifies the stated causal contrast |
| Psychological construct | preference, intent, sociality, challenge motivation, collector identity | Requires an independent validated measure and construct-validity study |

Use observed engagement, recent activity, and mode evidence before using preference, intent, or personality.

## Confidence is not one number

Keep these fields separate:

- data coverage: how much of the required input was observed
- provenance: Steam Web API, Store, SteamSpy, explicit response, or derived
- evidence grade: direct, proxy, or not identifiable
- prediction probability: only for a defined outcome and only after calibration
- uncertainty interval: only after a sampling/model procedure demonstrates coverage

Wrapping a heuristic in lower, upper, or confidence fields does not create a statistical interval.

## Hypothesis card

Every analytical change must record:

1. ID and claim
2. Product surface and decision it could change
3. Direct observations used
4. Target or independent ground truth
5. Competing explanations and unavailable variables
6. Baseline and one-change ablation
7. Temporal split and eligible candidate universe
8. Primary metric, guardrails, and minimum meaningful effect
9. Subgroups and missingness checks
10. Cost, latency, privacy, and claim-level abstention behavior
11. Decision: promote, narrow, reject, or collect more data

No target means no learned probability. No independent criterion means no psychological label.

## Current hypothesis registry

| ID | Hypothesis | Status | What would change the status |
| --- | --- | --- | --- |
| P-001 | Missingness may be predictive after validation, but is not semantic evidence of preference | Normative claim-safety policy | Regression tests ensure the unsupported claim abstains; validated independent signals may still operate |
| H-001 | Game-relative playtime predicts future engagement better than raw time | Plausible, unvalidated | Temporal next-play/revisit ablation |
| H-002 | Slow and fast interest representations improve recommendations | Transfer hypothesis | Longitudinal snapshots and next-item comparison |
| H-003 | Multi-interest representation preserves useful minority interests | Transfer hypothesis | Flat versus multi-interest ranking plus calibration/diversity guardrails |
| H-004 | Repeated ownership in a facet adds signal beyond played games | Unidentified | Future first-launch or blind explicit-interest prediction |
| H-005 | Correlated-ownership saturation predicts a defined target better than raw title count | Competing hypotheses | Must help bundle-like cases without erasing repeated franchise engagement |
| H-006 | Low-play VR ownership measures VR-related library concentration | Descriptive only | Interest or intent requires explicit VR use/interest; predictive use requires a future target |
| H-007a | Co-op capability tags predict actual co-op mode use | Predictive hypothesis | Mode-specific telemetry, a time-aligned risk set, precision, and abstention coverage |
| H-007b | Co-op mode use measures sociality or stable co-op preference | Rejected as a construct claim | Independent construct measure, convergent/discriminant validity, repeated measurement, and invariance work |
| H-008 | Broad tag weight should be at most 15 percent | Rejected as a fixed rule | Surface-specific ablation may learn a different contribution |
| H-009 | Current persona axes measure stable player traits | Rejected for product claims | Convergent, discriminant, and test-retest validation against an independent scale |
| H-010 | Positive-reviewer library play-record co-occurrence improves a defined outcome | High-selection-bias predictive hypothesis | Time-aligned samples and incremental ranking lift over popularity/content baselines; never interpret as co-play |
| H-011 | Inverse-owner novelty improves the hidden-gem surface without unacceptable relevance loss | Exploratory | Surface-specific target, relevance non-inferiority, catalog-exposure gain, and ablation |
| H-012 | Current thresholds, weights, and sampling constants define useful decisions | Legacy-control parameters only | Parameter-by-parameter sensitivity against a surface target; operational caps use separate latency/coverage budgets |
| H-013 | Recovering per-tag top-played games masked from one current snapshot demonstrates recommendation accuracy | Rejected as an accuracy claim; allowed as a ranker-only reconstruction diagnostic | Incremental recovery over tag-only/review-only on a fixed oracle pool may justify further temporal testing, never signal promotion by itself |

Spotify research supports multi-faceted and slow/fast user-modeling as research directions, not as proof that they transfer to cumulative Steam snapshots. Spotify evaluated richer time-stamped events at large scale. The Steam version must earn the transfer independently.

## Evaluation protocol

### Estimands and targets by surface

Each surface must predeclare one primary target, the prediction-time risk set, how unobserved and censored outcomes are handled, the evaluation unit, and user weighting. Distinguish catalog eligibility, candidate-generator retrieval pool, and ranking pool so retrieval failure is not hidden as ranker failure. Do not switch targets after reading results.

| Surface | Natural-behavior target candidate | Independent criterion | Product-causal target candidate |
| --- | --- | --- | --- |
| Backlog | first launch within 30 days among owned, not-yet-launched games | blind explicit interest | incremental qualified launch versus randomized control |
| Lapsed | revisit within 30 days among eligible inactive games | blind intent-to-revisit | incremental qualified revisit versus randomized control |
| New/unowned | later library inflow where observable | blind explicit interest | incremental Store open or save versus randomized control |
| Interest map | none without an independent label | blind facet-ranking agreement | not defined unless the product decision and causal contrast are specified |
| VR/co-op mode | later independently confirmed mode use | audited mode use or blind confirmation | not defined for descriptive inference |

Enjoyment, satisfaction, purchase intent, and future launch are different targets.

### Data

- Capture opt-in snapshots so training data precedes outcomes.
- Preserve prediction-time owned state, playtime, last-played values, Store/tag/review/SteamSpy metadata, regional/platform eligibility, and candidate universe.
- Log impression, position, surface, full eligible candidate set, algorithm version, and randomized propensity before learning from responses.
- Collect explicit labels before showing the model output to reduce anchoring.
- Keep raw Steam IDs and API keys out of fixtures, logs, issues, and training exports.
- Treat unavailable purchase source, bundle origin, HMD ownership, and actual mixed-game mode as not identifiable.

### Comparisons

Always include simple baselines and one-change ablations:

- popularity/review-summary only
- current released baseline
- playtime/recency only
- content/tags only
- candidate model with exactly one new signal

Use global temporal cutoffs and only state and items available at prediction time. A holdout made from one current snapshot is prohibited as an estimate of future recommendation quality: it cannot reconstruct past ownership, playtime, metadata, or eligibility and therefore leaks future information. It may be used only as the explicitly labeled H-013 implementation diagnostic below. Separate tuning and final evaluation by both time and user where the claim requires generalization.

Account for repeated observations with a hierarchical model or paired user-cluster bootstrap. Predeclare a minimum practical effect and justify sample size from pilot variance or simulation for the chosen estimator; do not apply a generic NDCG power formula.

### Metrics

- ranking: NDCG@K, Recall@K, HitRate@K
- probability: Brier score, log loss, reliability plot, calibration slope and intercept; ECE only as a sensitivity metric because binning changes it
- descriptive facet agreement: Spearman or Kendall and test-retest, which do not by themselves establish construct validity
- high-claim mode inference: precision, recall, and abstention coverage
- list guardrails: catalog coverage, intra-list diversity, and popularity exposure
- operations: input coverage, latency, API calls, and failure rate

Offline accuracy alone is not a release decision.

Exposure, position, and response are selectively observed; treating unexposed items or non-response as negative creates an MNAR learning problem. Non-response cannot automatically be labeled dislike, and observational post-exposure prediction cannot establish incremental recommendation effect.

### H-013 single-snapshot tag-masking diagnostic

This is a **known-positive reconstruction probe**, not an offline accuracy estimate.

- Use only the fixed, Store-confirmed profile evidence cohort already fetched by the product; currently this is at most the top 40 played games. Do not refill the cap after masking.
- Run one fold per tag only when at least four distinct games carry the tag. Mask the two highest raw-playtime games globally from that fold's owned input, IDF corpus, profile, recency, and owned-app set, leaving at least two tag examples.
- Keep candidate-side public game metadata, but never pass the targets' playtime or recency to a ranker.
- Form one four-way complete-case comparison pool per fold: every ranked candidate must have a tag score, review score, and positive owners estimate. Run the legacy tag+review formula, tag-only, review-only, and owners-estimate-only popularity baseline on exactly that pool. This is the legacy formula re-normalized on a diagnostic pool, not the unchanged production list.
- Keep every intended target in the metric denominator even when its public metadata is incomplete. Report target coverage and candidate-signal coverage; never drop a hard target or fold after observing missingness.
- Compare against analytic uniform-random expectation using the number of targets actually present in the common pool while keeping all intended targets in the Recall denominator.
- Report Recall/HitRate/NDCG at K=5/10/12/20, MRR/rank percentile, exact target ranks, model coverage, unique masked games, and raw current-featured-feed ID membership.
- If candidate count N is at most K, report effective K=N and mark that fold saturated; exclude it from the corresponding macro performance value while still disclosing the fold and its coverage.
- A manually injected target evaluates oracle ranking only. Every target here is injected because it was originally owned. Raw featured-feed ID membership is a separate observation and must never be called natural retrieval or end-to-end retrieval.
- Because games repeat across tag folds, results are correlated. Report macro fold summaries descriptively and never attach a population p-value or confidence claim.
- Independently mask the third- and fourth-highest-playtime games in each eligible tag as an exploratory target-selection sensitivity arm. It is not a matched or causal control because the top two games remain in that arm's training profile.
- The literal union of the top two games from every observed tag, including tags below the primary support threshold, is a secondary profile-collapse stress arm, not the primary score. If the residual tag profile is empty, withhold all ranker metrics rather than displaying a review-only degeneration as legacy recovery.
- Record diagnostic/model versions, run time, filtered featured-app-ID, candidate-ID and metadata fingerprints, profile-evidence fingerprint, and the filtered-featured-app-ID → outside-library → facts → Store-confirmed candidate funnel. If upstream metadata timestamps are unavailable, say so instead of implying frozen reproducibility.

Interpretation: beating random alone is weak. Matching tag-only, review-only, or popularity-only shows only that the corresponding public item facts reconstruct selected known positives. A top-two result similar to the third/fourth-place arm weakens the claim that high playtime itself is special. Consistent incremental recovery over every baseline on this one account means only that H-013 is not contradicted as an implementation diagnostic; it still requires multi-user longitudinal evaluation before any product claim or signal promotion.

First real execution (2026-07-13, supplied account, fingerprints in `ANALYSIS_QUALITY.md`): every fold was saturated at a complete-case pool of 5 candidates, so Hit@K/Recall@K/NDCG were withheld and only rank percentile/MRR were interpretable. Tag-only re-ranked the masked top-played positives best (rank-1 48%, MRR 0.972), but the top-two arm (48%) was indistinguishable from the third/fourth-place sensitivity arm (49%), the combined legacy formula did not beat the tag-only or popularity-only baselines, and the union arm collapsed to an empty profile. Per the interpretation above this weakens the high-playtime-is-special claim and promotes no signal; the run only shows H-013 is not contradicted as an implementation diagnostic on this one account.

## Signal promotion gate

A signal enters ranking only when all relevant checks pass:

- The observation, target, and non-identifiable alternatives are documented.
- Temporal evaluation shows incremental value over the baseline.
- The predeclared minimum useful effect and uncertainty criterion are met.
- Ablation shows the signal is not merely duplicating another feature.
- Calibration and major coverage/library-size subgroups do not collapse.
- Missing input does not become positive or negative semantic evidence. Abstain only from the unsupported claim; other independently validated signals may continue.
- Product copy stays at or below the validated claim layer.
- Latency, API, and privacy budgets pass.

Psychological labels additionally require convergent validity, discriminant validity, and test-retest reliability against an independent instrument. Otherwise expose only the underlying observation.

Psychological constructs also require content validity, an appropriate factor structure, cultural/language measurement invariance, and evidence that the score relates to behavior without collapsing into adjacent constructs. Correlation and test-retest alone are insufficient.

Claims that the product causes behavior additionally require a randomized online design, a predeclared incremental-effect estimator, and non-inferiority guardrails. Offline next-event prediction cannot pass this causal gate.

Interleaving can compare policies' relative preference under its assumptions, but it does not by itself identify a recommendation-versus-no-exposure incremental launch or save effect.

Failed signals are removed or retained as clearly labeled descriptive evidence. They are not kept with a small arbitrary weight.

## Role of the supplied profile

The public profile REDACTED_STEAMID64 is an adversarial case study because it has a large backlog, an extreme playtime outlier, sparse recent activity, and mixed content/software metadata. Use it to test:

- outlier included versus excluded
- metadata coverage at top 20, 40, 80, and full-library budgets
- broad-tag sensitivity
- correlated ownership perturbations
- missing-metadata abstention
- manual VR/co-op counterexamples

These checks measure robustness and expose contradictions. They cannot establish population effect size, significance, calibration, or psychological validity.

## Stage gates

1. **Stage 0 — claim safety:** remove persona/fit defaults, co-play wording, arbitrary type labels, forced novelty slots, and negative missing-value sentinels.
2. **Stage 1 — instrumentation:** opt-in longitudinal snapshots plus impression, position, candidate-universe, model-version, response, and propensity logging.
3. **Stage 2 — offline prediction:** time-aligned risk sets, user/time separation, baselines, ablations, calibration, uncertainty, and subgroup robustness.
4. **Stage 3 — online evaluation:** randomized exposure/control for incremental product impact; interleaving only for an explicitly defined relative-policy estimand.
5. **Stage 4 — psychological constructs:** only with independent validated instruments and full construct-validity work.

## Continuous improvement loop

For every release:

1. Freeze the hypothesis card, baseline, metric, and stop rule.
2. Run temporal offline evaluation and robustness tests.
3. Record rejected as well as promoted signals in the registry.
4. Ship behind a versioned experiment only after the gate passes.
5. Monitor calibration, coverage, latency, and subgroup drift.
6. Reopen the hypothesis when data distribution or product surface changes.

Keep a fixed final temporal holdout blind until the predeclared decision point. Record repeated looks, subgroup exploration, and stopping; use multiplicity control or a hierarchical gate when many hypotheses are evaluated.

The registry is evidence history, not a backlog of features that must eventually ship.

## Research anchors

- Implicit feedback is missing-not-at-random: https://proceedings.neurips.cc/paper/2018/hash/8d9766a69b764fefc12f56739424d136-Abstract.html
- Unbiased learning from MNAR implicit feedback: https://arxiv.org/abs/1909.03601
- Temporal leakage can reverse recommender comparisons: https://arxiv.org/abs/2010.11060
- Cross-game player-motivation validation requires surveys plus server behavior: https://doi.org/10.1016/j.chb.2015.03.018
- A broad validated gaming motives/preferences scale: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00608/full
- Spotify multi-faceted interests: https://research.atspotify.com/2023/02/users-interests-are-multi-faceted-recommendation-models-should-be-too
- Spotify slow/fast interests and its actual event data: https://research.atspotify.com/2022/2/modeling-users-according-to-their-slow-and-fast-moving-interests
