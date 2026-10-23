# ADR-0062: Decision-centered methodology and edit-aware verification
Status: Proposed
Date: 2026-10-23
Arch doc sections: §4 (domain model), §8 (methodology), §9 (runs), §11 (evaluation). Builds on ADR-0042 (rules decide and build steps), ADR-0045 (rule manifests), ADR-0055 (a flow is its notebooks), ADR-0057 (a rule can add a step), ADR-0059 (map and review) and ADR-0060 (the engine). Problem statement: [hidden-methodology-problem.md](../design/hidden-methodology-problem.md).

## Context
The problem statement lists what users and developers cannot see. This ADR fixes the coupling and verification causes behind it. It extends existing contracts and code. It adds no new entity, folder layout or building block.

What exists today:
- **A rule finds its step by operator id.** `applies_to` lists operators. `review::plan` gives a rule every node whose operator it lists (`crates/sprisk-methodology/src/review.rs`, `catalog::decides`). A rule with no such node runs with no subject only when the question fits it.
- **The host is often not the step the rule makes.** `exact_duplicates` lists `random_split` but adds Drop duplicates. Nothing on `sprisk.clean.drop_duplicates` points back to it.
- **A rule's context comes from `reads`, not from its host.** Question facts need no step. `column.*` and `rows` need the split and a run. This already works without the step the rule will add.
- **One owner per decision.** A second rule claiming the same `decides` is refused when packs load (`catalog.rs`, ADR-0042).
- **Rules cannot read each other's decisions yet.** ADR-0059 designed `decision.<key>` facts. `facts.rs` does not provide them, and no rule reads one.
- **Verification is one check per rule.** `verification: { check_id, invariant }` sits at rule level (`methodology.schema.json`). Alternatives have none, so a group split and a temporal split name the same check. 25 rules have `check_id: none`.
- **Checks are chosen by operator.** The scheduler runs the split check on nodes whose operator a split rule decides (`is_split`, `run.rs` `check_splits`).
- **An edited cell loses its decision.** An edit beyond values makes the step a code step. `asCodeSteps` (`apps/web/src/notebook/stageCells.ts`) keeps id, stage and notes, and drops `methodology_decision_id`.
- **A split cell may not become code.** The API refuses with `split_is_not_code` (`crates/sprisk-api/src/lib.rs`), so the split check is never silently skipped. Other ready-made steps can become code.
- **Check results already link to decisions.** `MethodologyCheck` has `methodology_decision_id` and `coverage: complete | partial | not_assessed`.

## Decision

### 1. Rules are found by decision
- Rule ids and folders stay. `decides` is the key a rule is found by.
- The catalog builds a reverse index when packs load: for each operator, every rule that **builds** it (an alternative's `action.operator`) or **anchors** on it (`applies_to`). For each decision key, its owner and every rule that reads `decision.<key>`. No manifest edit is needed.
- `applies_to` keeps its job and is documented as the **anchor**: where in the flow the decision is placed (an inserted step goes before it). It no longer implies the rule is about that step. The inspector and map group rules by decision, not by anchor.
- **One owner per decision stays.** A decision such as `split.method` can depend on several things, such as the objective, repeated entities, time order and the target. Each comes to the owner as a fact it `reads`. A rule that informs another publishes its own decision, and the owner reads it as `decision.<key>`. Two owners would need a tie-break that no one can explain.
- `facts.rs` provides `decision.<key>`, as ADR-0059 designed. A rule reading it comes after the owner in decision order, and a cycle is refused when packs load.

### 2. Alternatives carry their own assumptions and checks
- Each alternative may add:
  - `assumptions`: short statements the route relies on, such as "customer_id identifies one customer".
  - `verification`: a list of `{ check_id, invariant }`.
- The rule-level `verification` stays and holds the obligations every route shares.
- The obligations of an applied decision are the rule-level checks plus the chosen alternative's checks.
- Both fields are optional, so existing rules load unchanged. The contract changes through `/new-contract`.
- First user, `data_split`:
  - every route: no row in both train and test
  - `entity_group`: no entity in both
  - `temporal`: no test timestamp before a training timestamp

### 3. The decision link survives code edits
- **The link stays.** A step turned into code keeps its `methodology_decision_id`.
- **Obligations come from the decision, not the operator.** A step's obligations are those of its decision's rule and alternative, whatever operator now runs it.
- **Checks run by outputs.** A check declares what it inspects, for example a `train` and a `test` table and a named column. When the step has those outputs, the check runs, whoever wrote the code. When it does not, the result is `not_assessed`. The split check moves from `is_split` to this.
- **`split_is_not_code` stays until split checks run by outputs.** Then a split cell may become code like any other step.
- **Verification state is four separate facts per step, not one status:**

| Fact | Meaning | Source |
| --- | --- | --- |
| Linked | The step carries a decision | `methodology_decision_id` |
| Modified | The step no longer runs what the decision built: another operator, or its code changed | operator and implementation digest, compared with the decision's version |
| Stale | The latest check result is for an earlier implementation or settings | check's pipeline version against the step's last change |
| Per obligation | passed, failed or not assessed | `MethodologyCheck` verdict and `coverage` |

- **Never shown as verified:** a step whose obligations are stale or not assessed.
- **Assumptions are never shown as checked.** A passed overlap check on custom code proves no overlap. It does not prove the code splits by customer.
- **A step with no decision** is shown as "custom code, no methodology". sprisk never invents a reason for it.

### 4. One resolved view for every screen
- `GET /pipeline_versions/{id}/nodes/{node}/methodology` returns, computed and not stored:
  - the decision: rule, alternative, reason, evidence and sources
  - assumptions
  - each obligation with its latest result
  - the four facts above
- The inspector, the notebook and notebook export all read this view. None of them works out methodology on its own.
- The notebook shows it as a generated Markdown cell before the step. It is not written into `Node.notes`, so it cannot drift from the decision.
- Export writes the same text, plus the decision, rule and check ids in cell metadata. Code cells stay plain Python (ADR-0055).

## Out of scope
- Settings and the choice as editable lines in the cell (problem statement §3.7). That is its own ADR.
- The P0 fixes need no ADR:
  - the rule panel bug on split steps
  - showing existing decision state on nodes and cells

## Alternatives considered
- **A new `ScientificTask` entity.** Rejected: `MethodologyDecision` with `methodology_decision_id` on the node already is that link. This ADR keeps it through edits instead.
- **A capability registry (`provides` / `requires`).** Rejected for now: each capability has one operator. Revisit when a second implementation exists.
- **New `procedures/`, `methods/` and `checks/` folders, and renaming rule to procedure and alternative to strategy.** Rejected: it moves 60 rules and changes no behaviour. ADR-0060 already rejected "strategy" as a second building block.
- **Notebook cells that call sprisk functions.** Rejected by ADR-0055.
- **Several rules owning one decision.** Rejected: one owner reads the others' decisions as facts.
- **Copying the reason onto the node.** Rejected: a second copy of `MethodologyDecision` that can drift.
- **Converting any edited code back into settings.** Rejected: only value edits are read back (ADR-0055). Guessing what arbitrary code does is unreliable.

## Consequences (good and bad)
- Good: a developer finds every rule for an operator, and every rule behind a decision, in one place.
- Good: editing code never silently removes an obligation. It turns into stale or not assessed, and the screen says so.
- Good: each split route is checked for what it promises, not a shared minimum.
- Good: the screens and exports show one source of methodology.
- Bad: a check by outputs only sees what the outputs hold. A group check needs the group column in `train` and `test`, or it is `not_assessed`.
- Bad: custom code can pass every check and still break an assumption. The screen shows assumptions as unchecked. It cannot prove them.
- Bad: `decision.<key>` adds order between rules. A cycle is refused at load, and some designs will have to be split.
- Bad: 25 rules have no check. This ADR makes that gap visible, but does not fill it.

## Validation
- `exact_duplicates` is listed for `sprisk.clean.drop_duplicates` as the rule that builds it, and for `random_split` only as its anchor.
- Applying `entity_group` creates the no-entity-overlap obligation. Applying `temporal` creates the time-order obligation instead. Both keep the shared no-row-overlap obligation.
- A ready-made step edited into code keeps `methodology_decision_id`. Its obligations still exist, and earlier results show as stale.
- A custom step with `train` and `test` outputs gets the overlap check. One without them gets `not_assessed`.
- A step with stale or not-assessed obligations never shows as verified.
- A step with no decision shows "custom code, no methodology".
- A rule reading `decision.split.method` runs after `data_split`. A read cycle is refused when packs load.
- Notebook export holds plain Python, the methodology text, sources and ids, as ADR-0055 requires.

## Delivery slices
1. Reverse index, anchor wording, and `decision.<key>` facts.
2. Per-alternative assumptions and checks, starting with `data_split`.
3. The link survives edits, checks run by outputs, the four facts, and then lifting `split_is_not_code`.
4. The resolved view, read by the inspector, the notebook and export.

## Open question for review
After these fixes, test the rule system on one full Rakuten walk before extending it. The aim is to see whether `decide()` can express the investigation without turning into tangled conditions. This ADR fixes coupling and verification. It does not show that the rules are expressive enough.
