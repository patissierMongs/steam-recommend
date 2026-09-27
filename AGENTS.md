<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Evidence rules for player analysis

- Read docs/VALIDATION.md before changing analysis, ranking, persona, or recommendation copy.
- Treat every supplied idea as a falsifiable hypothesis, not a product requirement.
- Separate observations, behavioral summaries, natural-behavior predictions, product causal effects, and psychological claims.
- Do not add weights, thresholds, confidence values, or persona labels without an explicit target and validation plan.
- A real Steam profile is a stress-test case, not statistical proof.
- Missingness may be predictive only after validation; it is never semantic evidence of preference. Abstain at the unsupported claim, not automatically from the whole recommendation.
- Add or reweight a production ranking signal only after the validation gate passes. The inherited heuristic may remain solely as a versioned legacy control and is not a promoted signal.

## Git progress records

- Keep meaningful, validated progress in git checkpoint commits and push the active feature branch; do not leave substantial completed work only in the working tree.
- Use commit messages and PR/issue updates that distinguish implementation checks from unverified recommendation-quality claims.
