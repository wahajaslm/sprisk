# ADR-0019: Methodology guides pipeline decisions without becoming a separate workflow

Status: Accepted for the core interaction; advanced cross-investigation projection deferred
Date: 2026-10-16
Arch doc sections: §4, §5, §6, §7, §8, §15, §16
Related: ADR-0015, ADR-0016, ADR-0018

## Context

sprisk already has the execution model needed for experimentation:

```text
Project
└── PipelineVersion (immutable operator graph)
    └── Run (one execution)
        └── Attempt (one try of one node)
```

`MethodologyCheck` records scientific verdicts against a pipeline version, and
`ParamChoice` records why methodology selected a parameter. Studio already has a
Flow canvas and an Experiments view that can compare runs and restore their
settings.

What is missing is the bridge between a scientific choice expressed in plain
language and the executable operator nodes in a `PipelineVersion`.

The bridge must satisfy competing needs:

- A normal data-science workflow must remain as direct as inspect, change, run,
  and compare.
- Users must be able to steer decisions without knowing operator identifiers or
  editing YAML.
- Registered operators and deterministic rules must work without an LLM.
- Custom Python and genuinely new approaches must remain possible.
- AI may suggest or explain, but may not silently change policy, grant
  permission, or bypass validation.
- Different choices must remain reproducible and comparable through immutable
  pipeline versions and runs.

## Decision

### 1. The primary user object remains the flow

Methodology does not introduce a second canvas or a project-management system.
The normal Studio interaction remains:

```text
Data → Clean → Split → Train → Evaluate
```

The user clicks a normal flow node to inspect or change a scientifically
meaningful choice. The inspector initially shows only the current choice, a
short recommendation, and the available alternatives:

```text
Split data

● By customer    Recommended
○ By time
○ Random

Customers appear more than once.

[Apply]  [Why?]
```

`Why?` progressively reveals the evidence, applicable rule, risks, and
provenance. Operator ids, manifests, YAML, rule code, and graph compilation are
not shown in the normal workflow.

### 2. Methodology has three distinct concepts

```text
Rule      What must or should be scientifically true?
Decision  What human-understandable choice is required?
Choice    Which answer was selected?
```

Example:

```text
Rule:     Test customers should not occur in training.
Decision: How should observations be separated?
Choice:   By customer.
```

A rule may require a decision, recommend one of its choices, or validate the
compiled pipeline. Rules do not execute the pipeline.

### 3. Choices compile to executable pipeline fragments

A choice has a stable internal id and a user-facing label. Its hidden binding
resolves to a versioned pipeline fragment containing one or more registered
operators and parameter bindings.

```text
Human choice                   Executable result

“By customer”                 group_split(
                    compile →   group_column = customer_id,
                                test_size = 0.2
                              )
```

A fragment may contain several nodes. For example, “drop mostly-empty columns”
may profile columns, select those above a threshold, drop them, and impute the
remaining values. A choice is therefore not assumed to map one-to-one to an
operator.

The Rust compiler resolves fragments, pins operator versions, validates params
and ports, enforces permissions, and produces an ordinary `PipelineVersion`.
Python workers execute its operators through the existing runtime. The
scheduler does not execute methodology decisions directly.

### 4. Recommendations are evidence-based and deterministic when possible

Python evidence checks compute scientific facts that require data libraries,
such as missing fractions, class balance, repeated entity ids, or candidate
event-time columns. Each check is named, versioned, tested, and produces a typed
result tied to the dataset/profile artifact it examined.

Declarative recommendation rules consume those results. They may use only
declared evidence fields and a small validated set of comparisons and boolean
operations. They cannot execute arbitrary code.

Evidence must include semantics where statistics alone are insufficient. A
column having a date type does not by itself justify temporal validation; the
system also needs to know whether it represents event time and whether the goal
concerns future prediction.

When a deterministic rule applies, its recommendation is authoritative over an
AI suggestion. When no rule applies, the user may choose manually or request an
AI suggestion. The suggestion is labelled as AI-originated and requires normal
validation and user confirmation.

### 5. Rule strength and override behavior are explicit

Every rule has one of four strengths:

| Strength | Meaning |
| --- | --- |
| Invariant | The graph or execution would be invalid; it cannot be bypassed. |
| Blocking | The result is scientifically unsafe by default. An explicitly permitted override requires an `Assumption`, identity, reason, and audit record; the failure remains visible. |
| Warning | The user may continue, but the concern remains attached to the run and resulting claims. |
| Recommendation | Supplies a default or guidance only. |

An LLM can never downgrade, disable, or override a rule. Rust enforces the
policy result; Python owns scientific checks as established by ADR-0006 and
ADR-0017.

### 6. Every interaction uses the same path

A choice can originate from the UI, CLI/SDK, a deterministic rule, or an AI
proposal. All origins produce the same typed request and travel through the same
compiler, policy, and execution path.

```text
UI selection ───────────┐
CLI/SDK request ────────┤
Rule recommendation ───┼──▶ choice → compile → PipelineVersion → Run
AI proposal ────────────┘
```

The recorded provenance distinguishes `explicit`, `inferred`, `measured`, and
`confirmed` choices and identifies the deciding user, rule version, or AI
planning session where applicable.

### 7. Custom and new approaches are not limited by the catalogue

The choice catalogue is a trusted starting set, not a closed universe. A user
may always:

- choose a registered operator directly in advanced mode;
- compose existing operators;
- add an explicitly authorized custom-code node; or
- ask AI to propose a registered-operator pipeline or reviewable custom code,
  subject to the security policy.

An unregistered idea begins as an experimental flow change, not as a trusted
methodology rule:

```text
New idea
→ create a new pipeline version
→ run and compare it
→ collect checks and results
→ optionally propose it as a reusable project choice
→ review and publish a new methodology version
```

AI never silently promotes an experiment into methodology.

### 8. Different decisions are pipeline versions; executions are runs

Changing a choice creates a new immutable `PipelineVersion` linked to its
parent. Running that version creates a `Run`. Re-running the same version creates
another run without another methodological choice.

```text
PipelineVersion A: group split
├── Run 12
└── Run 14

PipelineVersion B: temporal split
└── Run 13
```

Shared unchanged nodes reuse eligible cached artifacts. Only the changed node
and its descendants execute again.

The main canvas shows one selected version at a time. The Experiments view lists
runs, highlights the decision and parameter differences between their pipeline
versions, compares metrics and methodology checks, and can restore a selected
version to the Flow view.

The user-facing vocabulary is deliberately small:

```text
Flow  the analysis being edited
Run   one execution recorded in history
```

`PipelineVersion`, parent links, and cache invalidation remain backend concepts.
A separate flow is created only for a genuinely different analytical purpose,
similar to creating another notebook—not for every alternative parameter or
method.

### 9. Methodology storage separates published packs from project adaptation

Pack authors maintain reviewable methodology manifests and their choice
catalogues as versioned files. Normal users edit methodology through the UI,
not by editing those files.

A project adaptation never overwrites the published pack:

```text
Published methodology version
        +
Project overrides
        =
Resolved immutable methodology version used by a run
```

Project overrides may change defaults, permitted thresholds, or
recommendations, and may add project-scoped experimental choices. They cannot
remove invariants or silently weaken blocking rules. Saving an adaptation
creates a new version; old pipeline versions and runs keep the methodology
version they used.

Stable ids, rather than display labels, are persisted. Labels may be edited or
localized without changing meaning.

### 10. Methodology can improve, but never silently learns policy

sprisk records choices, evidence, checks, results, and explicit user feedback.
Those records may support a proposed improvement such as:

```text
Observed: grouped splitting removed entity leakage in three relevant runs.
Proposal: when repeated entity ids are confirmed, recommend grouped splitting.
```

The proposal may come from a user, pack author, deterministic analysis, or AI.
It remains a draft until a person reviews its applicability, evidence,
implementation binding, rule strength, and tests. Acceptance creates a new
project, workspace, or published methodology version. Historical versions do
not change.

### 11. Frontend workflow

The default sequence is:

```text
1. Import data
2. Profile it and compute applicable evidence
3. Create or open a flow
4. Show recommendations inside normal node inspectors
5. User applies or changes a choice
6. Compile a new pipeline version
7. Run affected nodes
8. Show results and checks
9. Compare with earlier runs when desired
```

The UI does not require a methodology dashboard. An advanced methodology workflow
may later expose project defaults, rule explanations, version history and a derived
cross-investigation graph, but it is not part of the basic workflow and never becomes
a second executable graph.

### 12. Backend workflow

```text
React Studio
  sends a typed choice or pipeline edit
        ↓
Rust control plane
  records provenance
  resolves the choice to a fragment
  compiles and validates a new PipelineVersion
  authorizes and schedules a Run
        ↓
Python worker
  computes evidence or executes scientific operators
  returns artifacts and diagnostics
        ↓
Gate B worker attempt
  emits immutable MethodologyChecks
        ↓
Rust control plane
  enforces gates and stores run history
        ↓
React Studio
  displays results, reasons, warnings, and comparisons
```

## Contract implications

The existing `PipelineVersion`, `Run`, `Attempt`, `Artifact`, `Operator`,
`PipelineProposal`, `MethodologyCheck`, and `ParamChoice` concepts remain the
foundation.

Before implementation, contracts are needed for the smallest missing bridge:

- a versioned methodology identity and its resolved project version;
- a decision and stable choice identity with user-facing text;
- a choice binding to a versioned pipeline fragment;
- typed evidence output with artifact provenance;
- rule strength and override policy.

Contract names must follow ADR-0012 and are not fixed by this ADR. Avoid adding
an entity when a field on an existing entity provides the required immutable
provenance.

## First vertical slice

Do not implement a general methodology editor or a large decision catalogue
first. Prove one end-to-end case during M2:

```text
Input evidence: repeated entity ids and/or confirmed event-time semantics
Decision:       How should observations be separated?
Choices:        Random, by entity, by time
Binding:        One registered split operator per applicable choice
Compilation:    Choice creates a new PipelineVersion
Execution:      Run it through the existing worker path
Validation:     Emit the applicable leakage/chronology MethodologyCheck
UI:             Select in the Split inspector and compare runs in Experiments
```

Acceptance criteria:

1. The workflow functions with AI disabled.
2. UI, CLI/SDK, rule, and AI-originated selections use the same API and compiler.
3. A choice resolves only to pinned, authorized operators with schema-valid
   parameters.
4. Changing the choice creates a child pipeline version and reruns only affected
   descendants when caching permits.
5. Run comparison shows the changed choice, metrics, evidence, and methodology
   verdicts.
6. A blocking failure cannot be hidden or bypassed by an AI proposal.
7. A custom experimental implementation remains possible without being promoted
   automatically into the trusted catalogue.

## Non-goals

- Showing a separate decision graph on the default canvas.
- Requiring users to write YAML or name operators.
- Enumerating every data-science decision in advance.
- Automatically learning or rewriting scientific policy from run metrics.
- Making AI necessary for creating, editing, running, or comparing a flow.
- Building project-management boards, variant dashboards, or a plugin
  marketplace as part of this decision.

## Consequences

- Good: methodology becomes understandable guidance inside the existing data
  science workflow.
- Good: the current immutable pipeline and run model remains authoritative.
- Good: deterministic rules, manual work, registered operators, custom code, and
  AI proposals converge on one execution path.
- Good: new ideas can be tested immediately without silently becoming trusted
  policy.
- Cost: choice bindings, evidence provenance, and project methodology versions
  require new contract work.
- Cost: comparing runs must join execution results with pipeline and choice
  provenance rather than treating metrics as standalone rows.
- Risk: too many visible decisions would recreate a form-driven methodology
  product. Progressive disclosure and the small first slice are required.
- Risk: learned recommendations may confuse correlation with scientific
  validity. Improvements therefore remain reviewed, versioned proposals.

## Relationship to earlier decisions

- ADR-0015 continues to define the initial scientific policy. Its checks are not
  replaced by UI choices.
- ADR-0016 continues to define parameter meaning and `ParamChoice` provenance.
- ADR-0017 remains the execution model for Gate B methodology checks.
- ADR-0018 remains the Studio layout. This ADR narrows its decision-node concept:
  methodology is normally presented in ordinary node inspectors, while the
  Experiments view compares completed runs.
