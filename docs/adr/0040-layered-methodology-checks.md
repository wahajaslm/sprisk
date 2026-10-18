# ADR-0040: Methodology checks read the graph, the code, what ran, and the question
Status: Proposed
Date: 2026-10-18
Arch doc sections: §4 (`QuestionVersion`, `MethodologyCheck`, `Assumption`), §8 (Gates B and C), §9. Builds on ADR-0015, ADR-0017, ADR-0037.

## Context
- Gate B runs before the first step (ADR-0017). Today it has one rule, `supervised.split_leakage@1.0.0`, and it reads only the graph.
- Since ADR-0037, most real work is in `sprisk.code.python` steps made from notebooks. Their code is a black box to a graph rule: `StandardScaler().fit(df)` in a cell passes.
- Many rules depend on context only a person knows: which column is one patient, which column is time, what the target is. `QuestionVersion` already holds these as `Fact`s with an origin (`explicit`, `inferred`, `measured`, `confirmed`).

## Decision
- **Three kinds of human methodology, handled three ways:**

  | Kind | Example | Handled as | Missing input |
  | --- | --- | --- | --- |
  | Universal rule | Never fit on the holdout | Code rule | Always runs |
  | Rule needing a fact | One patient never in both train and test | Code rule + a `QuestionVersion` fact | `not_assessed`, naming the fact needed |
  | Judgment | Is the sample representative? | An `Assumption` a named person answers | Blocks release |

- **A rule uses a fact only when its origin is `explicit`, `measured` or `confirmed`.** An `inferred` fact (AI or heuristic) leaves the rule `not_assessed` until a person confirms it (rule 3).
- **Four layers, one verdict type.** Every layer writes `MethodologyCheck` records:
  1. **Plan** (exists): rules on the graph, in Gate B before the first step.
  2. **Code**: the same Gate B rules also read the code of code steps, by AST only, never by running it. They look for fits on data that does not come from a split's train output.
  3. **Runtime**: the worker records a fingerprint of the rows each scikit-learn `fit` received, and each split records its holdout rows. A check after the step compares them. Any overlap is a FAIL, however the code was written.
  4. **Claim** (Gate C): before a release, causal wording on a predictive result fails.
- **`MethodologyCheck` gains `evidence`:** the Attempt ids and artifact hashes the verdict rests on. Contract change through `/new-contract`.
- **Overrides.** A FAIL on a universal rule cannot be waived. A WARNING can be waived by a named person with a reason, scoped to one pipeline version. The waiver is an `Assumption` and shows on any release.
- **Rules are built test-first from bad pipelines.** Each rule ships with fixtures: a pipeline that must FAIL, one that must PASS, one that must return `not_assessed`. These fixtures are the library of known mistakes.
- **Rules never call an LLM.** They are deterministic. The AI may explain a check or suggest a fact; it never sets a verdict.
- **First rules, in order:** code-layer `split_leakage`; `group_leakage` (needs `unit_of_analysis`); runtime fit fingerprints; `temporal_order` (needs `time_column`).

## Alternatives considered
- **Only graph rules; require built-in operators for splits and fits.** Rejected: people write plain Python in notebooks (ADR-0036).
- **LLM reviews the code for leakage.** Rejected: not deterministic, and LLM output is never permission (rule 3).
- **Only runtime checks.** Rejected: they find a leak after compute is spent. Plan and code layers stop it before the run.

## Consequences (good and bad)
- Good: leaks in notebook code are caught, not only leaks in built-in steps.
- Good: runtime fingerprints are evidence of what happened, not a guess from the code.
- Good: missing context becomes a clear question to the person instead of a silent pass.
- Bad: the code layer can miss leaks hidden behind helper functions or dynamic code. Its `limitations` say so; the runtime layer is the backstop.
- Bad: the runtime layer sees only scikit-learn `fit` calls at first. Other libraries are `not_assessed`.
- Bad: row fingerprints need a stable row id per table. Tables without one get a hash of row content, which treats duplicate rows as the same row.

## Validation
- Tests per rule: a FAIL, a PASS and a `not_assessed` fixture. An `inferred` fact gives `not_assessed`; the same fact `confirmed` gives a verdict.
- Acceptance §15.4: a notebook that scales all rows before splitting fails at Gate B, and the run report shows the FAIL on that step.
- Acceptance §15.6: `group_leakage` fails a row-level split when `unit_of_analysis` is confirmed, and is `not_assessed` when it is only inferred.
- Acceptance §15.11 and §15.12: covered by runtime fingerprints and the claim layer.
- Runtime: a code step that fits on holdout rows the code layer missed fails after the step, citing both Attempts.

## Arch doc edits
- §8 Gate B: add the code and runtime layers and the fact-origin rule.
- §4 `MethodologyCheck`: add evidence (Attempt ids, artifact hashes).
