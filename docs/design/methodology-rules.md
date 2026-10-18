# Methodology rules: design

Status: design for ADR-0040 (checks) and ADR-0042 (rules that decide). Date: 2026-10-18.

## 1. Summary

In most data science work, method decisions live in an analyst's head and end up as unexplained lines of code. sprisk turns them into **rules**. A rule observes the data, applies a published method with settings a person controls, and decides the next steps. Every decision has a reason, an owner and a record. Gate B checks then verify what was built.

One line: **other tools help you analyse faster; sprisk makes sure the analysis is right, explains every choice, and keeps a person in control.**

## 2. The problem

A typical notebook:

```python
df = pd.read_csv("penguins.csv")
df = df.drop(columns=["Comments"])     # why this column? not written down
df = df.fillna(df.median())            # filled using ALL rows: test data leaks
X_train, X_test = train_test_split(df)
model.fit(X_train); score = 0.97       # inflated, and nobody can tell
```

| What goes wrong | Effect |
| --- | --- |
| `"NA"` is read as text | Missing values look like real data |
| The drop has no stated reason | Nobody can review or repeat the choice |
| Filling before the split | Test rows leak into training; the score is too high |
| New data arrives | The same code runs blindly |
| An AI assistant writes it | Faster, with the same mistakes |

## 3. What "methodology" means here

Methodology is the set of rules that decide whether a result can be trusted. Every method decision has the same shape:

```
Observe  →  Rule + settings  →  Decision  →  Next steps
```

From an analyst's own text: "Columns with many missing values are removed (we choose 20%); otherwise fill them, after the train/test split."

| Part | In the text | Kind |
| --- | --- | --- |
| Observe | 608 rows; some columns have gaps | Measured by the profiler |
| Rule | Too many missing → drop; else fill | Written once, versioned |
| Setting | 20% | A person's choice |
| Judgment | "Depends on the column's importance" | A person's override, with a reason |
| Constraint | Fill only after the split | Hard rule, cannot be overridden |
| Next steps | Drop some columns, fill others | Built by sprisk |

Three kinds of human method logic, handled three ways:

| Kind | Example | Handled as |
| --- | --- | --- |
| Always true | Never learn from the test set | Code rule and check |
| Needs a fact | One patient must not be in train and test | Code rule plus a fact the person confirms |
| Judgment | Is this sample representative? | A recorded answer from a named person |

## 4. Worked example: penguins

Real fixture `tests/fixtures/datasets/penguins_raw.csv`, 344 rows, 17 columns.

**Rule 1, what counts as missing:** the file writes gaps as the text `NA`. Without this rule every column shows 0% missing.

**Rule 2, missing values, threshold 20%:**

| Column | Missing | Decision | Reason |
| --- | --- | --- | --- |
| Comments | 84.3% | Drop | Over 20% |
| Delta 15 N | 4.1% | Fill (median) | Under 20% |
| Delta 13 C | 3.8% | Fill (median) | Under 20% |
| Sex | 3.2% | Fill (most frequent) | Under 20%, text column |
| Four body measurements | 0.6% each | Fill (median) | Under 20% |

**Steps built:** drop `Comments`, then split, then fill, learning from train rows only.

**At 3%:** Sex and both Delta columns are dropped too. One setting changes the flow, with visible reasons.

**Override:** keep `Sex`, reason "needed to compare species by sex". It is recorded with the person's name.

## 5. How it compares

| | Notebook | AI notebook assistant | sprisk |
| --- | --- | --- | --- |
| Who decides | The analyst, unrecorded | The AI, invisibly | A written rule and your settings |
| Reason for each choice | Lost | Not given | One sentence per decision |
| Same input, same result | Depends on who runs it | No | Yes |
| Leak protection | Memory | None | Built into the steps, then checked |
| Control | Edit code | Re-prompt | Settings, overrides, Apply |
| New data | Runs blindly | Runs blindly | Shows changed decisions and waits |
| Review | Read all the code | Not possible | Read the decision record |

## 6. Architecture

```
        Python (worker)                  Rust (control plane)              Web
 ┌───────────────────────────┐   ┌──────────────────────────────┐   ┌──────────────┐
 │ Profile (ADR-0038)        │   │ Stores MethodologyDecision   │   │ Decisions    │
 │        ↓                  │   │        ↓                     │   │ view:        │
 │ Rules, stage by stage:    │──▶│ Apply → new PipelineVersion  │◀─▶│ settings     │
 │ decide(obs, settings)     │   │ through the normal API       │   │ table        │
 │  → decision + reason      │   │        ↓                     │   │ overrides    │
 │                           │   │ Compile + Gate B checks      │   │ Apply + diff │
 └───────────────────────────┘   └──────────────────────────────┘   └──────────────┘
```

| Part | Owner | Status |
| --- | --- | --- |
| Profile of each column | Python profiler | Exists (ADR-0038) |
| Rule evaluation | Python worker Attempt, like Gate B | Path exists (ADR-0017) |
| Decision record | Rust store, `MethodologyDecision` contract | New |
| Apply | Rust: decisions → steps → new flow version | New, uses the existing create path |
| Compile and check | Rust compiler, Gate B | Exists (ADR-0040) |
| Decisions view | Web | New |

Hard project rules this keeps:

- Logic in Python, authority in Rust (rule 2).
- Rules propose; Rust compiles and authorizes. No private route (rules 3, 4).
- Decisions are immutable records (rule 5).
- Rules read the profile, never full datasets (rule 9, bounded memory).

## 7. A rule package

```
methodology/cleaning/rules/missing_values/
  manifest.yaml   what it observes, settings, decisions, actions, stage, needs, source
  rule.py         decide(observation, settings) -> (decision, reason)
  tests/          fixture datasets with expected decision tables
```

```yaml
id: cleaning.missing_values@1.0.0
stage: cleaning
applies_to: column
needs: [data.missing_markers]
decides: column.missing_handling
observes: [missing, data_type]
source: "scikit-learn: Common pitfalls (data leakage); van Buuren, Flexible Imputation of Missing Data"
settings:
  mode:      { enum: [fill, drop_above_threshold], default: fill }
  threshold: { type: number, default: 0.20, minimum: 0, maximum: 1 }
  fill:      { enum: [median, mean, most_frequent], default: median }
decisions: [keep, fill, drop]
actions:
  drop: { operator: sprisk.clean.select_columns, place: before_split }
  fill: { operator: sprisk.clean.impute, place: after_split, fit_on: train }
```

```python
def decide(column, settings):
    if column.missing == 0:
        return "keep", "nothing missing"
    share = column.missing / column.rows
    if settings.mode == "drop_above_threshold" and share > settings.threshold:
        return "drop", f"{share:.0%} missing, over {settings.threshold:.0%}"
    return "fill", f"{share:.0%} missing; fill with {settings.fill}, learned from train rows"
```

Design choices:

- **No rule language.** Logic is plain Python; the rest is declarative, so Rust and the UI read it without running code.
- **Best practice is the default.** Here the default fills inside the split rather than dropping. The weaker "drop above 20%" is available but needs a reason.
- **Constraints live in the manifest** (`fit_on: train`) and cannot be overridden.
- **Every rule cites its source** and has a named expert reviewer per version.

## 8. Many rules together

### Stages

Every rule belongs to one stage. Stages run in order; each sees the decisions before it.

| Stage | Example rules |
| --- | --- |
| 1. Question | Is there a real target? Prediction or cause? |
| 2. Data | What counts as missing? Duplicates? Unit of analysis? |
| 3. Cleaning | Missing values, outliers, rare categories |
| 4. Split | Random, by group, or by time? Holdout size? |
| 5. Features | Encoding, scaling, selection, all inside CV |
| 6. Models | Baseline required; candidates |
| 7. Evaluation | Metric fits the problem; uncertainty; subgroups |
| 8. Reporting | No causal claims from prediction; limits stated |

### Ordering and conflicts

- `needs` gives the order inside a stage (topological, `networkx`). A cycle is refused.
- `decides` has **one owner**. Two rules claiming `split.method` are refused when packs load. Rules never fight silently.
- A need that is missing or only AI-inferred makes the rule **ask**, never guess.

### The question picks the packs

`QuestionVersion.task` and its confirmed facts select packs. A time-series question gets time-ordered splits and never sees a random-split rule.

### Rules and checks are a pair

| Rule (ADR-0042) | Check (ADR-0040) |
| --- | --- |
| Builds it right | Catches it built wrong, by any route: hand code, AI code, a bug in a rule |
| "Split by patient" | "Is any patient on both sides?" |

## 9. The decision record

`MethodologyDecision` (immutable, new contract):

| Field | Example |
| --- | --- |
| rule | `cleaning.missing_values@1.0.0` |
| dataset_version_id, profile artifact | The exact data observed |
| settings | `mode fill, fill median` |
| rows | `Comments: 84.3% missing → drop, "over 20%"` |
| overrides | `Sex → fill, "needed to compare species by sex", by <person>` |
| pipeline_version_id | The flow version it built |
| created_at | Time |

A new setting or override is a new record. Nothing is edited in place.

## 10. Flows

**Apply**

1. Profile the dataset (exists).
2. Run the question's packs, stage by stage. Each rule returns its decision table.
3. The person adjusts settings and overrides. Only `decide()` reruns, so it is instant.
4. Apply: Rust builds the steps from the manifests' actions and shows the diff.
5. Rust saves a new `PipelineVersion`, compiles it and runs Gate B.
6. The `MethodologyDecision` is stored, naming the flow version.

**New data**

1. A new dataset version is profiled.
2. Rules rerun on the new profile.
3. Same decisions: nothing to do. Different: the Decisions view shows what changed and waits. The flow is never changed silently.

**Hand edits**

The rule owns only the steps it made. A step edited on the canvas becomes the person's, as with notebook steps (ADR-0037).

## 11. The person's controls

| Control | Allowed | Not allowed |
| --- | --- | --- |
| Settings | Any value the manifest allows | Values outside its schema |
| Weaker option (e.g. drop above 20%) | With a reason | Without one |
| Override one decision | With a reason; recorded with name | Overriding a hard constraint |
| AI suggestion | Accept or reject a suggested setting | The AI setting a decision |
| Missing fact | Confirm or correct | The rule guessing it |

## 12. Following best practice

- Rules are based on published guidance: scikit-learn "Common pitfalls", TRIPOD+AI, REFORMS, Kapoor and Narayanan's leakage taxonomy, CRISP-DM stages.
- Each rule version cites its source and has a named reviewer.
- Each rule has fixture datasets where the right answer is known.
- When guidance changes, a new rule version ships. Old results keep their old version.

## 13. Application areas

Cross-cutting packs:

| Pack | Example rule |
| --- | --- |
| Fairness | Report scores per subgroup; warn on large gaps |
| Uncertainty | Confidence intervals across CV folds |
| Multiple testing | Correct p-values when many tests run |
| Sample size | Warn when rows per feature or class are too few |
| Distribution shift | Compare new data's profile with training's |
| Privacy | Detect personal data (`presidio`) and ask first |
| Reproducibility | Require seeds; record the environment |
| No target | Exploration rules; never fabricate a target |

Field packs:

| Field | Key rules |
| --- | --- |
| Medicine | Split by patient; survival methods; TRIPOD+AI report |
| Finance, sensors, time series | Split by time; no look-ahead features |
| Spatial | Spatial cross-validation by region |
| Genomics | Batch effects; selection inside CV |
| Surveys | Survey weights |
| Text and images | Near-duplicates across the split |
| Marketing and A/B | Confounders; randomisation checks |

Organisation-level needs: a team can adopt its own pack version, with the change recorded; reporting packs can map to regulation (EU AI Act, FDA); after deployment, `OutcomeObservation` compares real outcomes with predictions; a coverage view shows stages where no rule was applied.

## 14. Implementation plan

Each step is test-first, using penguins as the fixture.

| # | Work | Area |
| --- | --- | --- |
| 1 | `MethodologyDecision` contract and roundtrip fixtures | `contracts/` |
| 2 | `methodology/cleaning` pack: `missing_markers`, `missing_values`; decision-table tests | Python |
| 3 | `impute` gains `most_frequent` for text columns | `plugins/clean` |
| 4 | Pack loader: stage, needs, one owner per decision | Python |
| 5 | Evaluate, store and Apply endpoints; build steps; compile; Gate B | Rust |
| 6 | Decisions view: settings, table, overrides, Apply with diff | Web |
| 7 | Second rule (outliers) with no changes outside its folder | Proof |
| 8 | Split pack (random, group, time), then evaluation pack | Next packs |

Already done: Gate B code checks (`code_leakage`), plain-word check messages.

## 15. Risks and limits

| Risk | Mitigation |
| --- | --- |
| Rules interact | Stages plus `needs`; one owner per decision |
| Generated steps clash with hand edits | The rule owns only its own steps |
| Too many settings | Defaults; show only rows that need attention |
| Weak rules | Published sources, expert review, fixture tests |
| Rules see only what the profile measures | Add a profile field first when a rule needs one |
| Overbuilding | Stop after two rules work end to end and review the design |

What it is not: not a general rule engine, not automatic (nothing changes without Apply), and not a replacement for judgment.

## 16. References

- ADR-0017 Gate B runs as a worker attempt
- ADR-0037 Notebooks belong to a flow
- ADR-0038 Datasets view and profiles
- ADR-0039 Role views and run report
- ADR-0040 Layered methodology checks
- ADR-0042 Methodology rules observe, decide and build steps
