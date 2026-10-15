# ADR-0015: First methodology packs

Status: Accepted
Date: 2026-10-15
Arch doc sections: §6, §8, §15, §16
Research: [AI privacy and methodology](../research/2026-10-ai-privacy-and-methodology.md)

## Context

M0 requires the first two methodology packs. Most comparable tools only warn about leakage; DataRobot blocks high-risk leakage. Kapoor & Narayanan (2023) give a three-part leakage taxonomy (L1 split, L2 proxy features, L3 distribution).

## Decision

### Pack 1: Exploration
For investigations with no model, or before choosing one.

| Check | Verdict on violation |
| --- | --- |
| No target is invented when the goal has none (§15.5) | FAIL (blocks) |
| Findings are labelled association, never cause (§15.12) | FAIL (blocks release) |
| Small sample for a claim | WARNING |
| Heavy missing data in a used column | WARNING |

### Pack 2: Supervised (classification and regression)
One pack; the two tasks share most rules.

| Check | Leakage type | Verdict |
| --- | --- | --- |
| Preprocessing and feature selection fitted inside each fold only | L1 | FAIL |
| Final holdout sealed during model selection (§15.11) | L1 | FAIL |
| Duplicate rows across train and test | L1 | WARNING; FAIL above threshold |
| Feature is a high-risk target proxy | L2 | FAIL (feature excluded unless the user confirms it is legitimate) |
| Feature is a moderate-risk proxy | L2 | WARNING |
| Time column present → chronological split | L3 | FAIL if random split |
| Repeated entity (e.g. customer) → group split | L3 | FAIL if not grouped, unless acknowledged |
| Dummy baseline included in comparison | — | FAIL |
| Class imbalance → suitable metric | — | WARNING |

All verdicts are `PASS | FAIL | WARNING | NOT_ASSESSED`, versioned, with rationale and artifact citations (§8 Gate B). `FAIL` blocks per Gate B; the user may acknowledge some, recorded as an `Assumption`.

## Alternatives considered

- Classification and regression as two separate packs. Rejected: duplicated rules.
- Forecasting first. Deferred: harder rules; it is the next pack after M1.

## Consequences

- Exploration covers §15.5 and §15.12; Supervised covers §15.4, §15.6, §15.11.
- Thresholds (duplicates, proxy risk, small sample) are pack parameters, tuned on benchmark tasks.
- Next pack: Forecasting.

## Validation

Benchmark tasks in `benchmarks/adversarial/` with deliberately leaky setups (one per L1/L2/L3 case). Each must be caught with the stated verdict (M3 exit).
