# Architecture Decision Records

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-rust-monolith-python-workers.md) | Rust modular monolith control plane with separate Python AI and compute workers | Proposed |
| [0002](0002-typed-pipeline.md) | Typed, versioned Pipeline and registered operator contracts; no prompt-to-raw-code execution by default | Proposed |
| [0003](0003-three-linked-domains.md) | Three linked domains: execution DAG, evidence graph, decision graph | Proposed |
| [0004](0004-sqlite-local-postgres-hosted.md) | SQLite and filesystem locally; PostgreSQL and S3-compatible storage hosted, with shared contracts | Proposed |
| [0005](0005-append-only-history.md) | Append-only run and audit history plus transactional operational state; not full event sourcing | Proposed |
| [0006](0006-science-in-python-policy-in-rust.md) | Scientific checks in Python; structural and policy enforcement in Rust; no claim of universal correctness | Proposed |
| [0007](0007-bounded-ai-autonomy.md) | AI autonomous only within bounded budgets; external AI transfer off by default | Proposed |
| [0008](0008-one-experiment-protocol.md) | One experiment protocol and artifact registry for manual, programmatic and AI workflows | Proposed |
| [0009](0009-cloud-via-adapters.md) | Cloud via adapters and worker isolation, not a microservice rewrite | Proposed |
| [0010](0010-dockable-workbench.md) | Dockable workbench with versioned view registry and layout, separate from pipelines; Dockview preferred, FlexLayout compared | Proposed |
| [0011](0011-pluggable-views.md) | Visualizations and code editors consume artifact/query APIs; UI never executes privileged code or copies full datasets | Proposed |
| [0012](0012-domain-naming.md) | Consistent domain naming | Accepted |
| [0013](0013-attempt-state-machine.md) | Attempt state machine | Accepted |
| [0014](0014-ai-data-exposure-policy.md) | AI data exposure policy | Accepted |
| [0015](0015-first-methodology-packs.md) | First methodology packs: exploration, supervised | Accepted |
| [0016](0016-methodology-chosen-params.md) | Params chosen by methodology: column roles and ParamChoice | Accepted |
| [0017](0017-gate-b-as-worker-attempt.md) | Gate B runs as a worker attempt | Accepted |
| [0018](0018-studio-cockpit-workbench.md) | Studio cockpit is the default workbench layout and workflow | Accepted |
| [0019](0019-methodology-as-steerable-decision-graph.md) | Methodology guides pipeline decisions without becoming a separate workflow | Proposed |
| [0020](0020-code-steps.md) | Code steps run the user's Python as a recorded pipeline step | Accepted |
| [0021](0021-node-framework-v1.md) | Adopt the Node Framework V1 on top of the existing engine | Accepted |
| [0022](0022-operators-are-plain-functions.md) | Operators are plain Python functions; the worker does the plumbing | Accepted |
| [0023](0023-charts-are-steps.md) | Charts are steps: Python aggregates, the browser draws | Superseded by ADR-0024 (drawing) and ADR-0032 (no chart builder) |
| [0024](0024-figures-from-any-python-library.md) | Steps return figures from any Python plotting library; the worker saves them, the browser shows them | Accepted |
| [0025](0025-the-code-decides-the-tabs.md) | The code decides the tabs: one rule for every step | Accepted |
| [0026](0026-edits-run-from-the-edited-step.md) | An edit runs from the edited step onwards; Run graph runs from the start | Accepted |
| [0027](0027-ui-design-system-and-data-rendering.md) | UI design system and data rendering: tokens, primitives, one renderer per data kind, enforced limits | Accepted |
| [0028](0028-a-step-can-carry-its-own-code.md) | A step in a flow can carry its own code | Accepted |
| [0029](0029-large-figures-get-an-image-preview.md) | Large figures show a download link, not a frozen tab | Accepted |
| [0030](0030-data-explores-variables-visualizations-shows-and-builds.md) | Data explores variables; Visualizations shows displays and builds charts | Accepted |
| [0031](0031-code-steps-link-by-variable-name.md) | Code steps link by variable name | Accepted |
| [0032](0032-charts-come-only-from-code.md) | Charts come only from code: no Chart button | Accepted |
| [0033](0033-notebook-view-of-a-flow.md) | A flow can be read and edited as a notebook | Superseded by ADR-0036 |
| [0034](0034-notebook-uses-jupyterlab-widgets.md) | The notebook view is JupyterLab's own notebook, with sprisk as its kernel | Superseded by ADR-0035 |
| [0035](0035-notebook-looks-like-vs-code.md) | The notebook view is a VS Code-style notebook on Monaco | Accepted; run path replaced by ADR-0036 |
| [0036](0036-session-notebook-and-published-node.md) | Notebooks run in a session; a node is made only when the person picks a boundary | Accepted |
| [0037](0037-notebooks-belong-to-a-flow.md) | Notebooks belong to a flow and keep it in sync | Accepted |
| [0038](0038-datasets-view.md) | The Datasets view lists the tables flows load and profiles them in Python | Accepted |
| [0039](0039-role-views-and-run-report.md) | One flow, a view per role, and a run report | Accepted |
| [0040](0040-layered-methodology-checks.md) | Methodology checks read the graph, the code, what ran, and the question | Accepted |
| [0041](0041-notebook-delete-rename-and-streaming.md) | Notebooks can be deleted and renamed, and a cell's output shows while it runs | Accepted |
| [0042](0042-methodology-rules-decide-and-build-steps.md) | Methodology rules observe, decide, and build steps | Accepted |
| [0043](0043-a-decision-can-remove-a-step.md) | A methodology decision can remove a step | Accepted |
| [0044](0044-model-shortlist-and-cross-validated-selection.md) | Models are shortlisted by a rule and chosen by cross-validation | Accepted |
| [0045](0045-rule-manifests-hold-only-what-the-system-uses.md) | A rule manifest holds only what the system uses | Accepted |
| [0046](0046-comparing-a-shortlist.md) | How a shortlist is compared | Accepted |
| [0047](0047-embedded-and-resource-constrained-targets.md) | Embedded and resource-constrained targets in methodology and deployment | Proposed |
| [0048](0048-copilot-via-subscription-bridges-and-local-models.md) | Copilot chat via subscription CLI bridges and local models | Proposed |
| [0049](0049-remote-jupyter-and-colab-kernel-execution.md) | Remote Jupyter and Google Colab kernel execution for deep learning | Proposed |
| [0047](0047-model-selection-methodology.md) | Sprisk's model-selection methodology | Accepted |

## Open questions (arch doc §17)

- License: Apache-2.0 vs AGPLv3 / dual licensing.
- Desktop packaging: Tauri + embedded Python.
- Hosted worker transport.
- Evidence ontology depth.
- OpenLineage / MLflow coverage.
- Multi-tenant enforcement and plugin marketplace policy.
- Name and trademark check.

Each one becomes an ADR when decided. Write new ADRs with `/adr`.
