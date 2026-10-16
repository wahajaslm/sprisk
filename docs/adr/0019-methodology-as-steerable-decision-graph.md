# ADR-0019: Methodology is a user-steerable decision graph

Status: Proposed (under discussion)
Date: 2026-10-16
Arch doc sections: §4, §6, §7, §8

## Context

- ADR-0015 described methodology as rule packs that check a pipeline. In Studio, methodology is the thing that *produces* the pipeline: stages, judgment calls, recommended choices (ADR-0018).
- One methodology must apply to many datasets and projects.
- Users must be able to steer it without naming operators or writing files.

## Decision

### 1. A methodology is a versioned decision graph
Stages (Explore, Clean, Features, Split, Model, Evaluate), decision points per stage, choices per decision, recommendations, and locked rules. Applying it to a dataset produces a `PipelineVersion` plus one `ParamChoice` per decision (ADR-0016).

### 2. Two layers
| Layer | Who | Contains |
| --- | --- | --- |
| Methodology | Users, in the UI | Decisions in plain words, choices, "recommend X when <fact> <op> <value>", settings, locked rules |
| Choice catalogue | Pack authors, code-reviewed | Each choice → operators and params; evidence checks (Python) that compute facts such as "% missing" or "has date column" |

Users never see operator ids. Recommendations are picked from listed facts and comparisons; there is no free-form expression or code.

### 3. Three levels of steering
| Level | Where | Can do |
| --- | --- | --- |
| Per run | Decision tab | Pick a choice, move a setting; downstream steps re-run |
| Per project | Methodology view | Turn decisions on/off, change defaults and thresholds, add decisions from the catalogue; cannot disable locked rules |
| Authors | Pack files | Add choices, bind them to operators, write evidence checks |

Every per-project change saves a new methodology version. Runs keep the version they used.

### 4. Locked rules
Scientific invariants (never learn from test rows; baseline included) are part of every methodology and cannot be switched off. A user may override one only with a recorded reason (`Assumption`); the original failure is kept. `split_leakage` becomes the "never learn from test rows" rule.

## Open questions

- Format of the stored methodology (YAML file vs records edited only through the UI).
- How the Copilot (M2) walks the graph and fills choices.
- Whether one project can mix methodologies by stage.

## Consequences

- Good: one methodology, many datasets; users steer in plain words.
- Good: the engine is unchanged underneath (PipelineVersion, ParamChoice, Gate A/B).
- Bad: new entities (methodology version, choice catalogue, evidence check) need contracts.
- Bad: ADR-0015 is reframed; its packs become locked rules and recommendations.
