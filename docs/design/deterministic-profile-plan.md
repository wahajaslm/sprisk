# Deterministic dataset profile plan

## Purpose

The Dataset Explore tab must show measurements because they are relevant to a stated
investigation, not because a client-side heuristic chose interesting charts. Given the same
dataset version, Question Version, scope and rule-pack digests, it must produce the same plan.

The plan is a read-only control-plane record. It never changes data or makes a methodology
decision.

```text
DatasetVersion + DatasetProfile + QuestionVersion + ProfileScope + ProfileRules
  -> ProfilePlan
  -> permitted probes and ordered presentation sections
  -> findings / methodology proposals through their existing paths
```

## Inputs

| Input | Owner | Use |
| --- | --- | --- |
| Table artifact and content hash | artifact store | Fix the data version and profile evidence. |
| `DatasetProfile` | Python profile worker | Measured shape: roles, gaps, text, distributions and correlations. |
| `QuestionVersion` | Rust API | Objective, task, target, unit, entity, time and stated constraints. |
| `ProfileScope` | Rust API | `input`, `train`, `test`, `transformed` or `comparison`. |
| Method/rule digest | methodology catalog | Makes the selection repeatable and explainable. |

The API refuses a plan that names a Question Version from another investigation than the
pipeline that supplied the table. The browser does not infer a target or choose sections.

## Wire model

Add these contract types in a follow-up contract change:

```text
ProfilePlan
  artifact_id
  question_version_id?            # absent for unscoped data exploration
  scope
  sections: ProfileSection[]
  limitations: ProfileLimitation[]
  profile_code_digest
  methodology_digest

ProfileSection
  id
  title
  purpose
  evidence_scope
  reason                         # deterministic, user-facing explanation
  probes: ProfileProbe[]

ProfileProbe
  id
  artifact_id
  status: available | needs_run | needs_fact | unavailable
  reason
```

`ProfilePlan` contains no table values and no chart data. Existing profile and artifact endpoints
supply the bounded aggregate data that a selected probe needs.

## Rule catalogue

The first catalogue is deliberately small and fixed. It is evaluated in this order.

| Section | Applies when | Scope | Required profile evidence |
| --- | --- | --- | --- |
| Overview | Always | input | dimensions, profile coverage, column roles |
| Data quality | Always | input | gaps, blanks, duplicates, constants, type conflicts |
| Columns | Always | input | column distributions and role suggestions |
| Relationships | at least two measured numeric columns | input | correlation pairs |
| Target | target is bound and exists | input, exploratory only | class/target distribution and feature relation |
| Classification | task is classification and target is bound | input | class balance, rare class coverage |
| Regression | task is regression and target is bound | input | target distribution and extremes |
| Text | a selected feature is text | input; train after split | blank share, word counts, repeated values, HTML |
| Categories | a selected feature is categorical | input; train after split | cardinality and rare values |
| Entity integrity | entity column is bound | input then train/test | records per entity and group overlap |
| Temporal integrity | time column is bound | input then train/test | coverage, ordering, temporal gaps |
| Split check | train and test artifacts exist | comparison | train/test shift and overlap checks |
| Change report | transformed output exists | comparison | schema, row, column and gap changes |

No section becomes a decision merely by appearing. `Target` uses all rows only to help a person
understand the question. Any probe that can select a feature, a transformation or a model must
be requested again on `train` scope before methodology consumes it.

## Deterministic selection

1. Resolve bindings from the Question Version. A target/entity/time field with no confirmed
   binding is `needs_fact`, not guessed from a column name.
2. Read only the stored profile for the requested artifact and scope.
3. Evaluate each catalogue predicate in its fixed order.
4. Add its section when the predicate is true; otherwise omit it or add a `needs_fact` probe
   where the missing ledger fact matters.
5. Produce the reason from fixed templates, naming the supplied fact and its origin.
6. Return the plan with code/catalogue digests and profile coverage limits.

Examples of fixed reasons:

```text
Text exploration appears because designation and description are text features for
the stated classification objective. This input-scope view is descriptive only.

Split check is waiting because no completed split has produced train and test artifacts.
```

## Rakuten acceptance case

For the confidential Rakuten data, tests use the existing Rakuten-shaped stand-in:

```text
Objective: predict product type from listing title and description
Task: classification
Target: prdtypecode
Unit: listing
Input: designation, description, productid, imageid, prdtypecode
```

The input plan must contain, in order:

1. Overview
2. Data quality
3. Columns
4. Target and class balance
5. Text exploration

It must explain that product/image IDs are identifier candidates, descriptions have blank/HTML
evidence, and class balance is relevant to the classification objective. It must not present
train/test shift until a split exists. Once a stratified split succeeds, the train plan adds
train-only text/cardinality diagnostics and the comparison plan adds the split check.

## Delivery order

1. Add the contract and API endpoint `GET /artifacts/{id}/profile_plan` with optional
   `question_version_id` and scope inputs.
2. Implement the fixed Rust selector with API tests for the Rakuten-shaped case and no-question
   baseline case.
3. Add an API hook and a top-of-page `Why these views` panel in Dataset Explore.
4. Gate existing Dataset sections by `ProfilePlan` IDs. The UI uses plan reasons verbatim; it
   does not recreate predicates.
5. Add train/test and transformed-artifact scopes when those artifacts are available.
6. Introduce versioned Data Contracts and map Great Expectations results into a dedicated
   quality probe. The existing GX spike remains an adapter; it is not a source of implicit
   contracts.

## Acceptance criteria

- Same inputs return byte-for-byte equivalent ordered section IDs and reasons.
- An absent or unconfirmed target never activates target/classification/regression views.
- A profile based on all rows never authorizes a learnt preprocessing or feature decision.
- The Rakuten-shaped input plan is stable and exposes text/classification reasons.
- The web app renders API-returned sections only and labels scope/coverage/limitations.
- Every plan references immutable profile and question versions, never mutable browser state.
