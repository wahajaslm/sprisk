# ADR-0042: Methodology rules observe, decide, and build steps
Status: Proposed
Date: 2026-10-18
Arch doc sections: §4 (domain model), §6 (capabilities), §7 (planning), §8 (methodology), §15.1. Builds on ADR-0017, ADR-0037, ADR-0038, ADR-0040.

## Context
- Analysts make method decisions by hand: look at the data, apply a known rule, choose the next steps. Example: "drop a column over 20% missing, otherwise fill it after the split."
- These decisions end up as lines of code with no reason, no owner and no record. Re-run on new data, they apply blindly.
- Gate B checks (ADR-0040) catch mistakes after the fact. Nothing builds the right steps in the first place.
- What exists: the column profile (ADR-0038: `missing`, `distinct`, `data_type`, histogram), methodology packs run as worker Attempts (ADR-0017), and operators for the actions (`sprisk.clean.select_columns`, `sprisk.clean.impute` with train/test ports). `sprisk.io.file_source` already takes `missing_values`.

## Decision
- **A rule is a package** in a methodology pack: `methodology/<pack>/rules/<rule>/` with `manifest.yaml`, one Python function and tests.
- **The manifest is declarative.** It names:
  - What the rule observes: profile fields only, never raw rows.
  - Its settings, as JSON Schema with defaults. The UI builds its controls from this.
  - Its subject: `column` or `table`.
  - Its possible decisions.
  - Each decision's action: an existing operator and its params, and where it goes (`before_split`, or `fit_on: train`).
- **The logic is one pure Python function:** `decide(observation, settings) -> (decision, reason)`. No rule language. Same inputs, same output.
- **Rules in a pack run in a fixed order** (a chain). Each rule reads the profile as left by the rules before it. There is no general rule engine.
- **Evaluation runs as a worker Attempt**, like Gate B. It reads the profile artifact and returns the decision table. Moving a setting re-evaluates only the function, never the flow.
- **New immutable entity `MethodologyDecision`** (contract via `/new-contract`): rule ref, dataset version, profile artifact, settings, one row per subject (observation, decision, reason), overrides (decision, reason, who), and the resulting `pipeline_version_id`. A change of setting or override makes a new record (rule 5).
- **Overrides need a reason.** Hard constraints in the manifest (e.g. `fit_on: train`) cannot be overridden.
- **Apply builds steps through the normal API.** Rust turns the decisions into a new `PipelineVersion` using the manifest's actions, compiles it and runs Gate B. Rules get no private route (rule 4). The AI, later, uses the same path.
- **The rule owns only the steps it made.** Each generated node names its decision. If a person edits such a step on the canvas, it stops being the rule's, as with notebook steps (ADR-0037).
- **New data never changes a flow by itself.** The rule re-evaluates on the new profile. If any decision differs, the Decisions view shows the change and waits for Apply.
- **UI: a `decisions` view type.** Settings on top, the decision table below (close calls marked), an override per row, Apply with a diff of the flow.
- **First pack `methodology/cleaning`, two rules in order:**
  1. `cleaning.missing_markers`: which text means missing (default `NA`, empty). Action: `file_source.missing_values`.
  2. `cleaning.missing_values`: drop above a threshold (default 20%), otherwise fill. Action: `select_columns` before the split; `impute` after it, fit on train.

## Alternatives considered
- **A rule language (YAML conditions).** Rejected: a second language to learn, test and debug. Python functions are tested like any code.
- **Rules edit the flow directly.** Rejected: a private path around compile and authorization (rules 3, 4).
- **Rules read the raw data.** Rejected: slow and unbounded. The profile is capped and cached (ADR-0038).
- **Only Gate B checks, no decisions.** Rejected: catching a leak is worse than never building it.

## Consequences (good and bad)
- Good: every method choice has a reason, a setting and an owner, and can be audited.
- Good: correct placement (fill after the split) is built, not remembered.
- Good: a new rule is a new folder; no changes to Rust, the compiler or the UI (§15.1).
- Bad: `impute` fills numbers only today (`median`, `mean`, `zero`). Text columns need a `most_frequent` method first.
- Bad: rules see only what the profile measures. A rule needing more (e.g. missingness by target) needs a profile field first.
- Bad: a fixed chain cannot express rules that depend on each other both ways. Accepted until a real case needs it.

## Validation
- Fixture tests: penguins (`NA` markers, `Comments` 84% missing) gives the expected decision table at 20% and at 3%; an override is kept with its reason.
- Apply on penguins builds drop → split → fill(train), and Gate B passes it.
- Changing the data so a column crosses the threshold shows a changed decision and leaves the flow untouched.
- A second rule (outliers) is added with no change outside its folder.

## Arch doc edits
- §4: add `MethodologyDecision`.
- §8: add "rules that decide" alongside Gates A–D.
- §2A `ViewType` list: add `decisions`.
