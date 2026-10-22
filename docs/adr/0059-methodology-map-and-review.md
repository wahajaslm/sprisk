# ADR-0059: The methodology map and its review
Status: Accepted
Date: 2026-10-22
Arch doc sections: §8 (methodology engine), §8.2 (rule kinds), §8.3 (decision lifecycle), §9.1 (method behaviors). Extends ADR-0042, ADR-0043, ADR-0045.

## Context
- A rule runs today only when its step is already in the flow: Rust finds the rule from the step's operator. A missing step is never found. Example: no encoder step, so the encoding rule never runs.
- 38 rule actions are `insert_step`. Rust builds only `replace_node` and `remove_node`.
- Every rule declares a `stage`, but nothing orders rules by it. ADR-0042's stage list puts cleaning before split.
- Cleaning rules measure train rows (rule 8), so the split must exist first. The course does the same: split first, then explore and clean the train rows (knowledge: Methodology_in_Data_Science, step 2).
- Methodology is not one line. It branches on the question and the data, runs once per column and per candidate model, and loops back on evaluation results.

## Decision
**The methodology map is the rule packs plus the fact catalog.** There is no separate map file. Its content, decision by decision, is in [methodology-map.md](../architecture/methodology-map.md).

**Each decision climbs an evaluation ladder only as far as it needs** (§8.2 names):
1. **Invariant or conditional requirement:** a rule of practice settles it from facts. Same facts, same answer.
2. **Advisor:** practice says "it depends". Try the routes on the same cross-validation folds with a fixed seed, pick by a stated criterion.
3. **Domain judgment:** neither practice nor data can settle it. The fact is asked for, or a best guess is marked `inferred` and must be confirmed before anything depends on it.

**Decision order is derived, not listed.**
- A rule's place comes from what it `reads`: question facts need nothing; `column.*` and `rows` need the split and a run; `flow.model_*` needs the model step; `decision.<key>` needs the rule that decides it.
- Decision order: question → data → split → cleaning → features → models → evaluation → reporting.
- A cycle in what rules read is refused when packs load.

**Step order in the flow uses fixed slots.** Before the split: markers and types → duplicates → drop columns → fixed features. After the split, fitted on train rows: learned features → outliers → fill → encode → scale → select or reduce → rebalance → model. Nothing fitted on rows goes before the split. Structure (types, IDs, duplicates) may be measured on the whole table; statistics only on train rows.

**A rule can add a missing step.** `insert_step` becomes a `GraphEffect`. Rust places the step by its slot and compiles the preview, like replace and remove.

**The review.** `POST /pipeline_versions/{id}/methodology/review` returns every applicable decision with one status: `settled`, `proposal`, `needs_fact`, `needs_run`, `waiting`. Its `next` list is the open items with nothing open before them. It is read-only and stateless. Apply stays the existing per-proposal Apply.

**Refinement needs proof.** A route that differs from common practice cites its reason and a test that proves it: a check that fails under the old route, a benchmark over the scenario library, or a dataset where the old route breaks.

## Alternatives considered
- **A hand-written stage list as the order.** Rejected: it puts cleaning before split, and goes stale as rules are added.
- **A separate map file.** Rejected: a second source of truth next to the rule manifests.
- **Guards in YAML.** Rejected again (ADR-0042): a rule's Python `decide()` returns `not_applicable` with its reason.
- **Evaluate rules in a Python worker** (ADR-0042). Superseded: Rust already builds observations and calls `decide()` in a bounded process. Ordering is scheduling, so Rust owns it. Python only decides.

## Consequences (good and bad)
- Good: a missing step is found and built by the rule that owns it.
- Good: every flow is a path through one map, for UI, CLI and a future AI agent alike (rule 4).
- Good: coverage is visible: which decisions are settled, open, or blocked on a person.
- Bad: one `decide()` process per applicable rule per review. Rules at the same depth run concurrently within the runner's limit.
- Bad: per-column and per-candidate fan-out, decision facts and loops on run results are later slices.

## Validation
- A bare flow (source → split → model) on penguins: the review proposes the missing fill step after the split; applying it compiles and Gate B passes.
- The missingness rule's `drop_column` inserts `select_columns` before the split.
- The review orders split before cleaning, and reports `needs_run` for a cleaning rule before the flow has run.
- A Rakuten-shaped synthetic stand-in, run from a bare flow, reaches the end with every step built by a rule.

## Arch doc edits
- §8.3: add `insert_step` to the effect plan, and the review step before proposals.
