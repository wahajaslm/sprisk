# Backlog

Work deliberately deferred. Each item names where it came from and the milestone it belongs to.
Remove an item when it is done; link the commit or ADR.

## Scheduler (deferred from M1 step 6)
| Item | Milestone |
| --- | --- |
| Run independent steps in parallel; more than one worker | M3 |
| Caching: `cache_hit` from a cache key with every §9 field | M3 |
| Run Gate B (methodology checks) before execution and block on FAIL | M1 step 7 (CLI) |
| User cancel of a run or attempt | M1 step 7 / API |
| Cancel a running attempt without killing the worker process | M3 |
| Runs execute inside the API process; move to a separate runner that resumes queued/running runs after a restart | before hosted (M5) |
| OpenAPI document for the HTTP routes, generated from `contracts/` | M5 |
| Stream artifact content instead of loading it whole (`/artifacts/{id}/content`) | when artifacts grow |

## Methodology
| Item | Source | Milestone |
| --- | --- | --- |
| Remaining Supervised rules: chronology, baseline included, duplicates across split, target proxies, group split, imbalance metric | ADR-0015 | M3 |
| Exploration pack rules | ADR-0015 | M3 |
| `split_leakage`: detect selection across pipeline versions that reuse one split (key on split artifact hash) | methodology review | M3 |
| Rule `target_untouched`: cleaning transforms must not include the target column | methodology review | M3 |
| Rule `report_only`: no step that chooses features or models may read a `feature_importance` (or other test-set report) output | methodology review | M3 |
| Per-project pack settings (thresholds, severity, applicability) — needs an ADR | design discussion | M3 |
| Acknowledged FAIL recorded as an `Assumption`; per-rule "override permitted" | ADR-0015, ADR-0017 | M3 |
| Custom project-scoped packs (untrusted) | design discussion | M5 |
| Column roles (`x-sprisk-column`) and `ParamChoice` | ADR-0016 (Proposed) | M2/M3 |

## Operators and worker
| Item | Source | Milestone |
| --- | --- | --- |
| Random split: `group_column` (stratify done) | methodology review | M3 |
| Record the producing package with each model artifact; refuse skops loads from non-first-party producers, or load them in a sandbox (trusted `sklearn.tree._tree.Tree`) | security review | before third-party plugins |
| Re-check trusted skops types before hosted / multi-tenant stores (arch §13) | security review | M5 |
| Planner: reject any `PipelineProposal` that sets a node's `code` (ADR-0028), with a test | security review | M2 |
| Linear model: mark integer columns as categorical | methodology review | M3 |
| Metrics: record train row count and class counts | methodology review | M3 |
| Stream splits with `scan_parquet`/`sink_parquet` (bounded memory) | simplicity review | when data size needs it |
| Unexpected operator exceptions crash the worker; retried as transient until the cap | worker design | revisit after M1 |
| Third-party plugin code: isolation before loading non-core packs | arch §12 | M5 |
| API bearer token so other local processes cannot call it (Host check only stops browsers) | security review | before hosted (M5) |
| Local paths are checked at submit and run start; a file swapped for a symlink afterwards is not caught (worker should open the resolved path) | security review | M3 |
| Table peek: cap Parquet footer size and decoded page bytes, and time out the read (a forged file can still make the API decode a lot) | security review | before untrusted packs (M5) |
| Table peek: send a fixed error code to the browser; keep parquet/object_store detail in the server log | security review | M3 |
| Parquet media type string is written in Rust, Python and TS; move it into `contracts/` | simplicity review | next contract change |
| Canvas node facts cost about two cached requests per node; add one batched "node facts" read if graphs get large | simplicity review | when graphs exceed ~30 nodes |
| Ports do not declare their table shape, so the UI finds the profile output by operator id; add a declared output schema | simplicity review | with ADR-0019 evidence contracts |
| Code steps: approval gate so AI-proposed code never runs without the user's explicit run, plus a §15 security test | security review (ADR-0020) | before the M2 planner ships |
| Code steps: run user code in a separate sandbox process (no network, read-only inputs, no lease credentials); `network: none` is declared, not enforced | security review (ADR-0020) | before hosted (M5) |
| Flaky e2e: `worker_killed_mid_run_is_replaced…` can finish before the kill lands (0 lost attempts); make the kill wait on a known-running attempt | seen 2026-10-16 | next test pass |
| Caching: test a control-plane restart mid-run where reconciled `cache_hit` attempts feed downstream inputs | simplicity review | next scheduler change |

## Engine (from the ADR-0064 proof of concept)
| Item | Source | Milestone |
| --- | --- | --- |
| `no_row_in_both` compares every column but the target, so it relies on the column-roles rule dropping identifiers before the split | ADR-0064 methodology review | M4 |
| Exact duplicate rows with no item column have no remedy but a person: offer dropping duplicates before the split | ADR-0063 amendment 2026-10-25, methodology review | M4 |
| A method that refuses because no fair option is left stops the walk as `error`; it should stop as `limitation` | ADR-0063 amendment 2026-10-25 | M4 |
| The temporal option does not check its purging (`no_group_overlap` would block every temporal walk without an item column) | ADR-0064 methodology review | M4 |
| The build step's Load steps cite no decision record; they come from the walk's sources | ADR-0064 proof of concept | M4 |
| Name the remaining old-rule operators by role: the scale step (`decision.rs`), the impute zero fill (review flow facts), the code step | ADR-0064 step 3 | with ADR-0063 slice 6 |
| A forest grows on every core in each worker; several workers at once oversubscribe the cores | ADR-0064 step 5 review | before hosted (M5) |

