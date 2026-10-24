# ADR-0065: Understand a dataset in the Dataset tab
Status: Accepted
Date: 2026-10-24
Arch doc sections: §4 (domain model), §8 (methodology), §9.4 (data-access matrix), §11 (UI). Builds on ADR-0038, ADR-0059, ADR-0063 and ADR-0064. Refines the proposed "Data Understanding Methodology Extension" specification.

## Context
A person who opens a dataset should see what it holds, what an investigation found in it, what was decided and whether the decision held. The path stays **question → method needs → evidence → decision → apply → verification**. An investigation may also end in a finding, a request for context or a limitation.

What the code has today:
- **The Dataset tab** has Preview, Profile and Lineage. The profile reads every row, test rows included, and says it is for looking only. It shows nothing an investigation found.
- **Records exist but are shown elsewhere.** Decisions, promises and the Report are records (ADR-0063, ADR-0064). They appear on the canvas, the notebook and the inspector. Nothing in the UI fetches the Report.
- **A decision does not record its evidence.** The decide step keeps the option and reason, not the evidence `decide()` read or the step that measured it.
- **A finding-only decision is invisible.** An option with no action shapes no step, so the canvas and notebook, which group by step, never show it.
- **Repeated-record evidence is thin.** `near_duplicates` groups matching titles. Nothing measures records per stated identifier or missing identifiers. No evidence producer draws a chart.
- **The profile counts rows identical in every column** (`duplicate_rows`), but no view shows it.

Phase 0 of the specification is ADR-0064. Its seal, split promises, one Apply path and Report are on the methodology branch; roles and its proof of concept are in progress there.

## Decision

**The Dataset tab is a view over records.** It decides nothing, runs no analysis and keeps no scientific state (rule 9). Its tabs:

| Tab | Shows | Scope |
| --- | --- | --- |
| Preview | The first rows. | Every row, for looking only. |
| Profile | Types, missing values, distributions, repeated rows. | Every row, for looking only. Never evidence for a decision. |
| Investigation | Each investigation that used the table, one analysis per decision, and its report. | The rows each producer read, as its manifest declares. |
| Lineage | The flows and steps that load the table. | — |

**An investigation is a walk on a question.** The tab lists the walks whose flow versions load the table. Each one opens with its context line: dataset, question, scope. Two walks on one table keep their own decisions, so one dataset can carry different interpretations.

**One analysis per decision.** Each card reads, in order:
- the method's question;
- the observation: the evidence fields `decide()` read;
- the chart its producer drew;
- the interpretation: the decision's reason;
- the decision and its assurance, or "no change" when the option has no action;
- each promise's standing, stale never shown as pass;
- a link to the step in the flow.

**The report comes from records.** The Investigation tab shows the walk's `Report` (ADR-0064): the answer, each claim with its evidence ids, and the limitations. It is immutable and is never rewritten.

**Decisions record the evidence they read.** The decide walk step, its `MethodologyDecision` and `FlowDecision` gain `evidence: [{kind, step, fields}]`. That means the kind, the node that measured it, and the values `decide()` saw. `FlowDecision.steps` includes the producer. This is the provenance the card needs. It is built in the ADR-0064 lane.

**Finding-only outcomes are decisions without a patch.** An option with no action makes a decision record and no graph change. It appears in the Investigation tab and the report. No new outcome kind is added.

**Evidence producers may draw their evidence.** A producer may have a `figures` output beside `evidence`. Its chart is built from the same counts as its evidence, never from the rows themselves.
- `near_duplicates` draws **Rows per title group**.
- A new producer, `identity_frequency`, reads the column bound to `common.item_identity`. It produces `data.identity_frequency`: rows, items, repeated items, rows in repeated items, the largest item and missing identifiers. It draws **Records per item**. A missing identifier is counted as missing, never as an item.
- Both charts are one shape: how many items have 1, 2, 3 … records.

**`repeated_items` reads `data.identity_frequency`** when the question names the item column. Its reason states how many rows share an item. Rows with no identifier are named as a limitation, because the item split refuses them. Uniqueness alone never confirms identity: title groups are still asked, never assumed.

**The profile's repeated rows stay descriptive.** The Profile tab shows rows identical in every column, labelled as a whole-table count. Evidence for a decision must come from a producer with a declared scope. Full-row equality over every column reads the label on every row, which the ADR-0063 load check refuses for producers.

## Refinements of the specification
- **Phase 0 is ADR-0064**, so it is not repeated here.
- **The six information sections become four tabs.** Overview and Analysis live in Investigation; Data is Preview; History is Lineage. There is no separate dashboard.
- **Records per identifier needs a stated identifier.** Without one, title groups are the identity proxy and carry the same chart.
- **Coverage is the list of cards.** Each line of it links to a decision, its evidence or a promise. No completion flags, quality score or "ready" status.

## Not in this slice
Each needs its own change:
- a duplicate producer with an explicit comparison-column policy;
- normalized matching beyond titles;
- removing confirmed duplicates, as an option with a retention promise;
- a descriptive investigation with no target;
- temporal embargoes;
- saving more than the one report per walk.

## Alternatives considered
- **A data-understanding dashboard beside the Dataset tab.** Rejected: two places for one dataset.
- **Charts drawn in the browser from evidence fields.** Rejected: a producer's chart belongs to its run and stays with it, and the browser does not compute (rule 9).
- **Derive a decision's evidence in the UI from method needs and operator outputs.** Rejected: it guesses provenance a record should state.
- **A `finding` outcome kind.** Rejected: an option with no action already says it.

## Consequences (good and bad)
- Good: one place shows what was found, decided and checked for a table, each claim traceable.
- Good: a producer's chart and its evidence come from one run, so they cannot disagree.
- Bad: a table loaded by many flows lists many investigations; the list is paged by its walks.
- Bad: until the evidence field lands, a card shows the decision and promises without its observation and chart.

## Validation
- Python: `identity_frequency` counts items, repeated items and missing identifiers, and its chart matches its evidence; `near_duplicates` draws its groups; `repeated_items` reports frequency and missing identifiers.
- Web: the Investigation tab lists a table's walks, shows a finding-only decision, its chart, promise standings, and the report; the Profile tab shows repeated rows as a whole-table count.
- The Rakuten stand-in walk shows the repeated-titles card with its chart, the group split's `no_group_overlap` promise and the report.

## Arch doc edits
- §4: a method decision records the evidence it read (`kind`, `step`, `fields`).
- §11: the Dataset tab has Preview, Profile, Investigation and Lineage; Profile is for looking only.
