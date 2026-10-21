# Sprisk core workbench integration map

**Status:** M0 reconciliation, revised 21 October 2026. Awaiting sign-off.
**Target:** [`sprisk-enterprise-platform-design-v2.md`](sprisk-enterprise-platform-design-v2.md) §21.1.
**Scope:** the local core workbench. External auth, hosted storage and deployment stay deferred.

## Bottom line

- One graph, one compiler, one scheduler. No duplicate was found (see [Duplicates check](#duplicates-check)).
- Both §21.2 slices of the decision chain run end to end in tests: the split decision and the missingness decision.
- The 19 October gaps (no question persistence, no proposals or effects, no decision-to-check link) are closed for the split. The open gaps are listed in [Open gaps](#open-gaps), most important first.

## Duplicates check

| Concern | The one implementation | Evidence |
|---|---|---|
| Graph compiler | `crates/sprisk-graph::compile` (petgraph) | No toposort or DAG compile in `python/` or `apps/web/src` |
| Scheduler | `crates/sprisk-scheduler` | The worker runs only what it is leased: no retries, no ordering |
| Executable graph | `PipelineVersion` on `FlowCanvas` | Comparisons are `PipelineVersion`s with `compares`; `flows.ts` keeps them out of the flow list. `MethodologyMap` is a static rule tree |
| Wire types | `contracts/schemas`, generated into Rust, Python and TS | `just contracts-check` fails on stale generated code |

**One overlap to resolve:** Gate B's `split_leakage` and `code_leakage` rebuild the graph in Python with networkx to find ports and order. That is analysis, not compilation, but it repeats port knowledge the compiler owns. See open gap 6.

## Repository map

Columns follow §21.1. Owner is the area responsible: **Rust** (control plane), **Python** (workers and plugins), **Methodology** (rule and check packs), **Web** (workbench).

### Control plane (Rust)

| Existing source path | Service/module | Actual contract | Decision | Gap | Owner | Tests |
|---|---|---|---|---|---|---|
| `contracts/schemas/pipeline_version.schema.json`, `crates/sprisk-contracts` | Graph model | `PipelineVersion`, `Node`, `Edge`, `PortRef` | Reuse | One node kind, an operator step, varied by optional fields (`code`, `from_notebook`, `methodology_decision_id`). No subgraphs | Rust | `sprisk-contracts/tests/roundtrip.rs::pipeline_version` |
| Same schema, checked in `sprisk-graph` | Universal nodes | Operator step; code step (`NodeCode`, ADR-0028); notebook cells become code steps; model and comparison steps | Extend | No node-type enum. Other node kinds in the arch doc are absent | Rust | `sprisk-graph/tests/compile.rs::a_code_step_s_ports_are_the_names_in_its_params`; `sprisk-api/tests/api.rs::notebook_cells_become_a_flow_that_runs` |
| `crates/sprisk-graph/src/lib.rs` | Compiler (Gate A) | `compile(PipelineVersion, Registry) -> Plan` | Reuse | The plan is an ordered step list: no partitioning or resource planning | Rust | `compile.rs::valid_pipeline_compiles_to_steps_in_dependency_order`, `::cycles_are_rejected` |
| `crates/sprisk-scheduler` (`run.rs`, `next.rs`, `cache.rs`, `process.rs`) | Scheduler, attempts, leases, cache | `Run`, `Attempt`, `AttemptState`, `WorkerMessage` | Reuse | One step at a time. Local Python subprocess workers only | Rust | `scheduler/tests/run.rs::transient_failure_is_retried_as_a_new_attempt`, `::silent_worker_times_out_and_a_new_worker_retries`; `cli/tests/e2e.rs::worker_killed_mid_run_is_replaced_and_nothing_false_is_committed` |
| None | Event loop / outbox | — | New | No outbox, run-event stream or SSE: clients poll runs and attempts. Notebook cells stream as NDJSON only | Rust | `sqlite_store.rs::an_audit_event_is_appended_for_its_entity` (audit table only) |
| `crates/sprisk-registry` | Operator registry | `Operator`, `OperatorSource` | Reuse | Filesystem only; no signing | Rust | `registry/tests/registry.rs::every_core_plugin_manifest_is_valid`, `::implementation_digest_follows_the_pack_source_code` |
| `crates/sprisk-artifacts` | Artifact store | `Artifact`, `ArtifactManifest`, `TablePage` | Extend | `object_store` with `LocalFileSystem` only; S3/GCS not wired | Rust | `artifacts/tests/artifact_store.rs::commit_rejects_hash_mismatch_and_stores_nothing`, `::committing_same_content_twice_is_idempotent` |
| `crates/sprisk-store`, `migrations/sqlite` (0001–0012) | Metadata store | Runs, attempts, versions, questions, proposals, decisions, selections | Extend | SQLite only (sqlx) | Rust | `sqlite_store.rs::pipeline_version_round_trips_and_is_never_replaced`, `::an_apply_key_gives_its_decision_to_the_same_choice_and_refuses_another` |
| `crates/sprisk-api` | HTTP API (axum) | `api.schema.json` types | Reuse | About 40 routes; no auth or tenancy | Rust | `api.rs::pipeline_version_is_compiled_then_stored`, `::run_executes_in_the_background_and_reports_attempts_and_outputs` |
| `crates/sprisk-methodology`, API `methodology/*` routes | Resolver, proposal, Apply, comparison | `MethodologyRule`, `RuleObservation`, `RuleDecision`, `DecisionProposal`, `MethodologyDecision`, `SelectionDecision`, `ModelSelection` | Reuse | At most one active rule per operator; draft rules are never routed | Rust | `api.rs::split_methodology_is_resolved_previewed_and_applied_once`, `::the_first_vertical_slice_fills_gaps_with_the_train_median_through_an_applied_decision` |
| `local_host_only` middleware, `data_roots`, CLI `loopback_addr` | Permissions and policy | — | New | No users, roles or policy engine. A lease's `network: none` is declared; enforcement is not verified | Rust | `api.rs::source_path_outside_the_data_roots_is_refused`, `::request_from_a_non_local_origin_is_refused`; `cli/tests/cli.rs::serve_refuses_non_loopback_addresses_until_auth_exists` |
| None | Model packaging | — | New (M5) | No export, bundle or serving format | Rust | none |
| `apps/cli` | CLI (clap) | `PipelineVersion`, `Run` | Reuse | `serve`, `run`, `runs show` only | Rust | `cli/tests/cli.rs::run_command_submits_waits_and_reports_through_the_api`; `e2e.rs::iris_classification_model_beats_the_baseline` |

### Workers and packs (Python)

| Existing source path | Service/module | Actual contract | Decision | Gap | Owner | Tests |
|---|---|---|---|---|---|---|
| `python/sprisk-workers` (`serve.py`), launched by `sprisk-scheduler/src/process.rs` | Python execution protocol: one JSON message per line on stdin/stdout | `WorkerMessage` (handshake, lease, heartbeat, complete, fail, cancel) | Reuse | `file://` URIs only. Cancel during an attempt is ignored, so Rust kills the process. User code runs in the worker process, not a sandbox (ADR-0020, ADR-0028) | Python | `test_serve.py::test_handshake_is_first_and_lists_operators`, `::test_inputs_are_verified_and_passed_by_port` |
| `sprisk_workers/plain.py`, `manifests.py` | Operator execution; `FoldStep` refits preparation per fold | `Operator` (`fits_on_train`, `model`) | Reuse | `TRUSTED_PACKAGES` import allow-list stands in for plugin isolation (§12) | Python | `test_manifests.py::test_entrypoint_outside_core_ops_is_refused`; `test_compare.py::test_preparation_between_the_split_and_the_model_is_refit_on_each_fold` |
| `plugins/code` (`sprisk_code`) | Code steps and notebook kernels (jupyter_client) | `NotebookExecute`, `CodeSplit`, `NotebookVariables` | Reuse | Four versions of the python operator are registered | Python | `test_cells.py::test_three_cells_become_three_linked_steps` |
| `methodology/supervised/src/sprisk_supervised` | Gate B checks | `MethodologyCheck` | Extend | Four checks: `split_leakage`, `code_leakage`, `split_design` (plan), `split_rows` (runtime). Only `split_design` cites a decision. No check for fit scope or target leakage. Leakage is judged only from what an evaluator scores | Methodology | `test_pack.py::test_returns_every_rule_result`; `test_split_leakage.py::test_two_models_on_one_test_table_fail_and_cite_them` |
| `methodology/{supervised,unsupervised}/rules` | Rule packs | `RuleObservation` to `RuleDecision` via `decide()` | Extend | 6 of 30 rules are active: data split, scaling, missingness, outliers, model shortlist, clustering. Drafts include `categorical_encoding`, `target_leakage`, `fit_scope_integrity`, `class_imbalance`, `time_series_leakage`, `probability_calibration` | Methodology | `test_rule_examples.py::test_the_active_rules_are_the_ones_with_code` |
| `plugins/profile` | Profiling (polars, duckdb) | `DatasetProfile`, `FigureSet` | Reuse | No PII detection (`presidio` absent) | Python | `test_dataset.py::test_counts_rows_columns_missing_and_distinct` |
| `plugins/ml` | Models, `cross_validate@2`, `select_model@3`, `evaluate` (scikit-learn, scipy) | `Operator.model`, `SelectionDecision` | Reuse | One-hot encoding lives inside each model's `ColumnTransformer`; there is no standalone encoding step. No calibration operator | Python | `test_compare.py::test_a_model_no_better_than_the_dummy_on_the_same_folds_does_not_win`; `test_linear_model.py::test_category_seen_only_in_test_does_not_break_prediction` |
| `plugins/{clean,validation,io}` | Cleaning, splits, file source | `Operator` (`fits_on_train`) | Reuse | Fit scope is proven by tests, not by runtime evidence | Python | `test_fits_on_train.py::test_each_test_row_depends_only_on_itself_and_the_train_rows`; `test_temporal_split.py::test_temporal_split_puts_all_train_strictly_before_test` |
| `python/sprisk-contracts` | Generated pydantic models | All | Reuse | None | Python | `test_roundtrip.py::test_valid_fixture_round_trips` |

### Workbench (Web)

| Existing source path | Service/module | Actual contract | Decision | Gap | Owner | Tests |
|---|---|---|---|---|---|---|
| `apps/web/src/workbench` | Docks (dockview), selection (zustand) | ids only | Reuse | Selection holds no investigation or question context | Web | `docks.test.tsx` "follows the selection" |
| `apps/web/src/views/FlowCanvas.tsx`, `src/flow` | Canvas (@xyflow/react, elkjs) | `PipelineVersion` | Reuse | None | Web | `cockpit.test.tsx` "places each step to the right of the steps it reads" |
| `views/inspector/ParametersTab.tsx`, `SplitMethodology.tsx` | Decision panel for any active rule | `DecisionProposal`, `ApplyMethodologyDecision` | Extend | The panel is titled "Split methodology" for every rule; headline text is chosen by operator name | Web | `parameters-tab.test.tsx` "is offered when an active rule decides the step's operator" |
| `views/inspector/ChecksTab.tsx` | Verification view | `MethodologyCheck`, `MethodologyDecision` | Extend | Shows a decision only when the check cites one, which today means the split | Web | `cockpit.test.tsx` "names each verdict's rule, phase and coverage, and what the decision that set the step chose" |
| `views/Experiments.tsx`, `ModelComparison.tsx` | Run comparison; model and preparation comparison | `Run`, `SelectionDecision`, `ModelSelection` | Extend | Run-to-run comparison shows settings and metrics, but not decisions or checks | Web | `experiments.test.tsx` "compares the two chosen runs…", "shows each way of doing the step against the rule's recommendation…" |
| `views/QuestionLedger.tsx` | Question editor | `QuestionVersion` | Extend | No UI test | Web | none |
| `views/datasets`, `views/methodology`, `views/notebook` | Profiles, rule catalogue, notebooks | `LoadedTable`, `MethodologyRule`, `NotebookVersion` | Reuse | Rules are read-only; no policy versioning | Web | `datasets.test.tsx` "never asks for a table's rows or content…" |
| `src/api/client.ts` | API client (TanStack Query, Ajv) | every response parsed through `@sprisk/contracts` | Reuse | None | Web | `boundaries.test.ts` "only src/api calls the network" |

**Hard rule 9 holds:** the browser runs no analytical code and loads no full dataset. Rows are paged, large artifacts become downloads, and notebook cells run in the server kernel.

## Slices proven

| Slice | Test |
|---|---|
| Split: question fact → rule → alternative → effect → version → run → check | `api.rs::split_methodology_is_resolved_previewed_and_applied_once`; `test_split_design.py` |
| §21.2: data with gaps → train-row profile → median → preview → Apply → fold-local fit → check → result | `api.rs::the_first_vertical_slice_fills_gaps_with_the_train_median_through_an_applied_decision` |
| Model and preparation choice by cross-validation | `api.rs::sprisk_selects_a_model_by_itself_once_per_version`, `::sprisk_compares_a_preparation_step_by_itself_once_per_version` |

## Coverage of the data science workflow

Checked against the course in `knowledge/` (git-ignored), mainly `Sprint_5_-_Machine_learning_24/Methodology_in_Data_Science`, whose five steps are below.

| Course step | In Sprisk | Missing |
|---|---|---|
| 1. Understand the problem | Question ledger with task, target, time and entity facts | No UI test |
| 2. Process and explore | Profiles, charts, notebooks; missingness, outlier and split rules | Data-quality contracts (DATA-01); PII detection |
| 3. Feature engineering and encoding | Scaling rule; code steps for derived features | No encoding step or active encoding rule (SCI-05); custom transformers only as code |
| 4. Modelling and interpretation | Shortlist, repeated CV, corrected t-test, one-SE rule; permutation importance | Tuning (grid/random search), studies and budgets (M4); interpretability rule is a draft |
| 5. Present results as a decision | Metrics, out-of-fold figures, comparison reasons | Business guardrails and thresholds in selection (EXP-02); calibration |

## Open gaps

Most important first.

1. **M4 experiments:** no study or trial records, no budgets, no grid or random search (EXP-01, EXP-02).
2. **Checks cite decisions for the split only.** Other Gate B checks do not link to the decision that set a step.
3. **Encoding:** no standalone one-hot step, and the `categorical_encoding` rule is a draft (SCI-03, SCI-05).
4. **Data contracts:** no column-type contract finding or point-in-time check (DATA-01, DATA-02).
5. **Reopen and trace:** nothing tests reopening the workbench and following question → decision → version → run → check → comparison.
6. **Gate B graph walk:** the Python checks rebuild the graph with networkx. They should read port facts the compiler provides, so port rules live in one place.
7. **Run events:** clients poll; there is no outbox or event stream.
8. **Certification:** fit scope is proven by tests only; no runtime scope evidence (SCI-02, SCI-08).
9. **In-app help:** operators and rules carry one-line descriptions only. Help pages for each step and rule can draw on the course in `knowledge/`, written in our own words.
10. **Draft rules:** 24 of 30 rules are drafts. Each is checked against the matching course notebooks in `knowledge/` before it becomes active; its manifest still cites the primary sources.

## Explicitly deferred

- External identity, managed database or object storage, remote workers and hosted deployment.
- Model packaging, registry and serving (M5, M6).
- LLM planning.
- Claims of runtime fit-scope certification until runtime row evidence exists.
