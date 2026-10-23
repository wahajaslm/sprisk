# Flow Studio — Backend Capability Gap Analysis

This document catalogs the backend capabilities, endpoints, and architectural services that the **Flow Studio Design System** (ADR-0061) presumes or exposes in the UI, but which are currently mocked, stubbed, or not yet fully implemented in the Sprisk backend (`packages/engine`, `crates/core`, or Python services).

---

## 1. Objective Synthesis & Pipeline Generation Engine

The **Objective** page (replacing Atlas as the first studio tab) allows researchers to state their business/scientific goal in natural language, answer a dynamic 3-open-question ledger, and generate an end-to-end pipeline onto the Flow canvas.

### Missing Backend Capabilities:
- **Natural Language Goal Decomposition**:
  - LLM-assisted extraction of target variables, task category (binary classification, regression, ranking), evaluation metrics, and domain constraints.
- **Profiling Checklist Evaluator**:
  - Endpoint to run instant pre-flight checks on loaded data:
    - Target distribution check (e.g., *79 positive, 43 negative*).
    - Missingness profile (*no missing values in 122 peptides*).
    - Unseen test split integrity (*122 unseen peptides reserved*).
- **Pipeline Synthesizer**:
  - Service translating answered questions and verified dataset constraints into a DAG of operator nodes (`apps/web/src/flow/layout.ts` coordinates).

---

## 2. Interactive Notebook Kernel Execution Service

The **Notebooks** page provides a scratchpad interface with numbered execution badges (`[1]`, `[2]`), syntax-highlighted code cells, and multi-format outputs.

### Missing Backend Capabilities:
- **Jupyter / IPython Kernel Protocol Adapter**:
  - Ephemeral Python kernel lifecycle management (launch, interrupt, restart, shutdown).
  - WebSocket/gRPC communication protocol for cell execution requests and status events (`busy`, `idle`).
- **Streaming Output Protocol**:
  - Streaming stdout / stderr chunks, rich ANSI terminal formatting, and tracebacks.
  - MIME-bundle output handling for Plotly figures (`application/vnd.plotly.v1+json`), tables (`application/json`), and SVG images.
- **Shared Session Context**:
  - Variable sharing between notebook scratchpads and the Flow canvas pipeline run state (e.g. inspecting an intermediate pipeline artifact in a notebook).

---

## 3. Model Deployment, Monitoring & Drift Detection Service

The **Deploy** page tracks production and staging model cards, evaluation metrics (ROC AUC, accuracy, F1, calibration error), confusion matrices, and live serving health.

### Missing Backend Capabilities:
- **Model Card & Version Registry**:
  - Storage and versioning of model artifacts, training hyperparameters, methodology decisions, and lineage back to training dataset versions and runs.
- **Live Serving Health & Telemetry**:
  - Real-time p95 / p99 inference latency instrumentation (`/api/models/{id}/metrics`).
  - Request volume and throughput monitoring.
- **Automated Feature Drift & Population Stability Index (PSI)**:
  - Streaming baseline comparison service calculating PSI across inference input batches.
  - Alert trigger for threshold breaches (e.g., `pI · PSI 0.27` flagged in red).
- **Holdout Evaluation Suite**:
  - Endpoint computing ROC curve coordinates, confusion matrix cells, and calibration curve buckets on demand.

---

## 4. Evidence & Decision Ledger Service (Reports)

The **Reports** view manages the question ledger, linking hypotheses to empirical run metrics, reasoning, and next actions.

### Missing Backend Capabilities:
- **Evidence Linking Graph**:
  - Relational mapping between questions, accepted answers, and specific artifact runs (e.g., `Run 16 · test set · ROC AUC 0.951`).
- **Reactive Invalidation Engine**:
  - Background daemon that flags linked answers when a subsequent run alters metric values (e.g., Copilot: *"I will flag it if run 17 changes any of them"*).
- **Formal Sign-off & Audit Export**:
  - Generation of reproducible PDF/HTML compliance reports summarizing methodology rules, verification gates, and decisions.

---

## 5. Domain Pack Registry & Extension Provider

The **Settings** view introduces domain-specific packs (e.g. *Audio*, *Edge and embedded*, *Genomics*) that extend the platform with specialized operators, viewers, methodology rules, and deployment targets.

### Missing Backend Capabilities:
- **Pack Manifest & Registry API**:
  - Pack packaging specification (`manifest.json` declaring step operators, rules, and hardware targets).
  - Version resolution and upgrade management (`/api/packs/installed`, `/api/packs/upgrade`).
- **Pluggable Operator Runtime**:
  - Dynamic registration of Rust/Python operator routines into the execution engine.
- **Specialized Data Viewers**:
  - Backend streaming support for domain media (e.g., audio audio slicing, waveform extraction, spectrogram generation).

---

## 6. Real-time Telemetry & Run Log Streaming (Experiments)

The **Experiments** view displays live run progress, step execution states, resource sparklines, and verification gate failures.

### Missing Backend Capabilities:
- **High-Frequency Resource Sampler**:
  - Per-process / per-container CPU and GPU utilization telemetry (100ms interval sparkline points).
- **Structured Gate Verification Engine**:
  - Explicit gate assertions executed between steps with typed violation events (e.g., `Gate failed: Missing values rule violated (24.2% ≥ 20.0%)`).

---

## 7. Global Search & Command Indexer (⌘K)

The **Command Palette** offers sub-10ms lookup across steps, operators, dataset tables, model cards, and global navigation.

### Missing Backend Capabilities:
- **Workspace Search Index**:
  - In-memory or SQLite FTS5 index spanning pipeline nodes, operator catalog, dataset schemas, and recent runs.
  - Server-assisted fuzzy matching for large-scale enterprise deployments.
