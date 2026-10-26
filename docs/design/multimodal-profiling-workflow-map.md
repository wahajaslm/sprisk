# Multimodal profiling and exploration workflow map

## Scope

This document describes Sprisk's **Data Understanding, Profiling and
Exploration** workflow. It does not train, select or evaluate models.

It may establish evidence that a later preparation or modelling workflow needs:
for example, that a group-aware split is necessary, that images are absent for
some records, or that a declared target is imbalanced. It cannot use a model
score to decide that evidence is sufficient.

```text
Data understanding
  -> versioned Data Understanding & Exploration Report
  -> preparation requirements and safe split requirements
  -> downstream feature engineering / modelling / evaluation
```

## The six user-facing stages

The stages are a workflow view over one shared architecture. They are not six
independent engines.

```text
Methods declare evidence needs
  -> operators collect bounded evidence in the correct scope
  -> evidence rules determine sufficiency or a gap
  -> decisions record permitted next actions
  -> verification records whether an approved, in-scope correction worked
```

### 01 — Understand

**Purpose:** establish what the source contains and what the investigation is
actually about.

| Input | Deterministic system work | Human setup fact, only where data cannot know it |
| --- | --- | --- |
| Data source | register immutable assets, inspect schemas/manifests, detect candidate modalities | none |
| Baseline profile | measure structure, coverage, integrity and observed roles | none |
| Objective | retain supplied text | intended decision/objective |
| Semantics | show candidates and ambiguity | unit of analysis, target, entity/time meaning, prediction-time availability, domain |

**Output:** a frozen, versioned Question Ledger and a Dataset Version. A missing
semantic fact remains explicitly unknown; it is never guessed from a name such
as `date`, `id`, or `label`.

### 02 — Plan

**Purpose:** select only the profiling operators needed to answer the Ledger's
data-understanding questions.

```text
Question Ledger + detected modalities + operator catalogue
  -> applicable evidence needs
  -> allowed scope and budget
  -> dependency-ordered execution plan
```

For every operator, the plan records: why it applies, input artifact, scope,
sampling/compute bound, dependencies, expected evidence schema, and what would
make it inapplicable.

**Output:** an immutable execution plan. Unsupported modalities, unavailable
assets and unresolved facts appear as explicit gaps, not hidden omissions.

### 03 — Investigate

**Purpose:** run read-only profiling operators, collect measurements and create
bounded visual evidence.

An operator produces facts, not recommendations. Its result includes code and
configuration version, artifact version, scope, sampling method and limitations.

The investigation may add a new operator only when a declared evidence rule is
activated. For example:

```text
image coverage by declared category shows an uneven gap
  -> activate image-availability-by-target evidence
  -> record whether the evidence is sufficient
```

The loop is bounded by a plan budget, depth and catalogue dependencies. “This
looks interesting” is not a sufficient reason to recurse indefinitely.

**Output:** Profile Facts, visualisations, findings, limitations and an evidence
coverage record.

### 04 — Reason and decide

**Purpose:** interpret only the evidence required by the frozen methodology and
record the result.

Valid outputs are:

| Result | Meaning |
| --- | --- |
| sufficient | the stated data-understanding evidence is present; continue or hand off |
| more evidence needed | activate a predeclared follow-up probe if budget/scope permits |
| problem identified | record a data-quality, integrity, leakage or suitability risk |
| no intervention needed | evidence supports leaving the source unchanged |
| blocked | essential information or asset is missing |

The system can recommend requirements such as “preserve duplicate groups in any
later split” or “retain an image-availability indicator for preparation.” It
does not claim that a model will score better.

**Output:** traceable findings, decision records, unresolved questions, and
preparation/split requirements.

### 05 — Apply and verify

**Purpose:** apply only an approved, in-scope data correction and verify its
declared promise.

This stage has a strict boundary:

| Belongs here | Does not belong here |
| --- | --- |
| registering a repaired asset version; correcting an invalid manifest link; applying an approved structural correction; verifying before/after integrity | imputing values for a model, normalising features, tokenising/vectorising text, fitting encoders, training a model, comparing model scores |

Preparation transformations belong to the downstream **Data Preparation**
workflow. They may consume this workflow's decisions, and must be fit on
training data when they learn from data.

**Output:** new immutable data artifacts and before/after verification evidence,
or a return to Plan/Investigate if the stated correction failed.

### 06 — Document and hand off

**Purpose:** make the understanding reproducible and usable downstream without
turning it into an ungrounded universal rule.

The handoff contains:

1. dataset and asset versions;
2. confirmed Ledger bindings and stated domain;
3. applicable modality profiles and their limits;
4. quality, integrity, alignment and leakage risks;
5. unresolved questions and blocked assumptions;
6. approved source corrections and verification evidence; and
7. downstream requirements for splitting and preparation.

Project history can compare versions and retain reusable, explicitly scoped
insights. It must never conclude that a particular modality, model or
transformation is always superior from one project result.

## Modality activation map

The detailed probe catalogue lives in
[`core-modality-exploration-map.md`](core-modality-exploration-map.md). At a
workflow level, the planner composes packs as follows:

| Detected or confirmed capability | Activate during investigation |
| --- | --- |
| structured records/table | Tabular structural, quality, distribution and relationship probes |
| text field or document asset | Text extraction, quality, length, language and duplicate probes |
| image reference/asset | Image integrity, geometry, appearance, duplicate and annotation probes |
| audio reference/asset | Audio integrity, format, signal, duplicate and transcript-coverage probes |
| video reference/asset | Video integrity, format, bounded-frame and temporal-annotation probes |
| Ledger-bound time/event field | Temporal parse, order, cadence, coverage, availability and shift probes |
| record links across modalities | Alignment and asset-coverage probes |

## Worked example: product-category data understanding

Given a listings table with `listing_id`, `seller_id`, `title`, `description`,
`image_path`, `category_code` and `created_at`:

```text
Understand
  detects table + text + image-reference capabilities
  proposes candidate identifier, target and time field
  records person-confirmed unit = listing and target = category_code

Plan
  selects table profile, text profile, image integrity/geometry, target profile,
  duplicate-group investigation and temporal parsing
  does not select audio or video probes

Investigate
  measures missing images, empty text, target counts, image readability,
  duplicate candidates and invalid timestamps

Reason
  records: missing images are concentrated in particular categories;
  duplicate groups must not cross a later evaluation split;
  invalid timestamps require source clarification or correction

Apply / verify
  may repair an approved manifest reference and verify it resolves;
  does not train a text-only or multimodal model

Document / hand off
  supplies source-quality facts and group/time constraints to preparation
```

## Non-negotiable guardrails

```text
No implicit semantic binding.
No raw asset/table payload in profile responses.
No data-derived preparation fitted outside training scope.
No test/holdout evidence used for selection.
No model score presented as a profiling result.
Every result is versioned, bounded and explains its limitations.
```
