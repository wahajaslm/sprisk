# ADR-0051: Adopting enterprise intelligence capabilities: automated compliance documentation, portable serving bundles, fairness auditing, and specialized agent fleets
Status: Proposed
Date: 2026-10-21
Arch doc sections: §8 (methodology engine), §11 (experiments & selection), §12 (model packaging & deployment), §18 (audit & reproducibility), §19 (technology plan & build-vs-integrate). Builds on ADR-0044, ADR-0048, ADR-0050.

## Context
- Comparative evaluation of modern enterprise platforms (such as H2O.ai's enterprise stack) highlights five core capabilities that bridge the gap between an individual data scientist's workbench and high-assurance enterprise adoption:
  1. Automated model risk and regulatory documentation (`AutoDoc`);
  2. High-performance, zero-dependency serving artifacts (e.g. H2O `MOJO`);
  3. Deep model interpretability, fairness, and disparate impact analysis (`AutoMLI`);
  4. Coordinated, specialized agent fleets communicating over open protocols (`MCP` / `A2A`);
  5. Publication of models into interactive decision applications for non-technical stakeholders.
- Sprisk already collects rich underlying evidence: immutable graph versions ([`PipelineVersion`](../../contracts/schemas/pipeline_version.schema.json)), split and code leakage checks (Gate B), paired statistical tests (ADR-0050), and holdout reuse tracking (`test_rows_seen_by`).
- However, Sprisk currently lacks:
  - An executive/regulatory documentation compiler (evidence remains in raw JSON/SQLite stores);
  - A portable production deployment format (identified as open gap M5 in the integration map);
  - Fairness/subgroup disparate impact invariants in Gate B checks;
  - Specialized multi-agent roles in the AI planning layer.

## Decision

Sprisk adopts these capabilities natively within its open-core, local-first architecture without adopting proprietary runtime engines.

### 1. Automated Compliance & Investigation Dossier (`AutoDoc`)
- Sprisk will provide an automated compilation command (`sprisk export-dossier` and workbench action) that synthesizes a complete, audit-ready compliance document (PDF, HTML, Markdown).
- **Contents:**
  - Executive summary and question context from `QuestionLedger`;
  - Data lineage, profile, and parsing invariants;
  - Proof of split integrity and absence of data leakage (Gate B verification);
  - Shortlist comparison results, paired repeated k-fold $t$-test evidence, and one-SE rule rationale (ADR-0050);
  - Out-of-fold diagnostics and feature importance;
  - Holdout score, evaluation limitations, and `test_rows_seen_by` history.
- Directly supports compliance with regulatory frameworks including the **EU AI Act**, US Federal Reserve **SR 11-7** (Model Risk Management), and HIPAA.

### 2. Zero-Dependency Portable Serving Bundles (`ModelPackage`)
- Resolves the M5 model packaging gap (§12) inspired by H2O's MOJO pattern:
  - A deployed model must never require spinning up the entire development graph or unconstrained Python environments.
  - The compiler exports an approved candidate into an immutable `ModelPackage` containing:
    1. Preprocessing transformations with `fits_on_train: true` serialized into deterministic execution steps;
    2. Estimator weights and graph exported to standard portable runtimes (ONNX / micro-Python runtime);
    3. Input/output Arrow schema contracts, type coercions, and null-handling rules;
    4. Signature digest and origin `TrialResult` / `SelectionDecision` references.
- Allows ultra-low-latency batch and REST scoring without data drift between preparation and inference.

### 3. Deep Interpretability & Fairness Invariants (Gate B Extension)
- Extend model evaluation beyond permutation importance ([`importance.py`](../../plugins/ml/src/sprisk_ml/importance.py)) by introducing an **Interpretability & Fairness Pack**:
  - **SHAP / TreeExplainers:** compute out-of-fold local and global feature attributions;
  - **Partial Dependence & Residual Diagnostics:** expose non-linear relationships and calibration curves;
  - **Fairness & Disparate Impact Checks:** when sensitive or protected attributes (e.g. demographic, geographic) are identified in the question context, Gate B checks enforce disparity ratio thresholds and flag discriminatory bias.

### 4. Specialized Multi-Agent Fleet via MCP & A2A
- Evolve the AI planning layer from a single generic LLM session into specialized, collaborating agent roles communicating over Model Context Protocol (MCP) and Agent-to-Agent (A2A) interfaces:
  - **Profiler Agent:** analyzes distributions, missingness, and cardinality;
  - **Auditor Agent:** inspects pipeline topology and code steps for split leakage and causal violations;
  - **Optimization Agent:** manages M4 trial budgets, parameter search spaces, and baseline selection;
  - **Compliance Agent:** drafts natural-language hypothesis justifications and regulatory dossiers.
- Each agent operates under Principle 1: *AI plans; trusted platform authorizes; workers compute; evidence records what happened.*

### 5. Interactive Decision App Export
- Bridge modeling into operational decision-making:
  - Add a lightweight export target that compiles an approved model and its feature contracts into a standalone, interactive **Decision Simulator** web view (React / static bundle).
  - Business stakeholders can adjust feature sliders, simulate scenarios, review confidence intervals, and evaluate business constraints without accessing the underlying data science workbench.

---

## Alternatives Considered

- **Adopting H2O-3 / Driverless AI directly as the platform core:** Rejected. H2O relies on a heavy Java/JVM cluster, proprietary licensing (Driverless AI), and opaque feature generation algorithms. Sprisk maintains an open-standard Python/Rust foundation.
- **Requiring manual regulatory report writing:** Rejected. Data scientists spend excessive time writing manual model cards and audit documents; generating this directly from deterministic execution evidence ensures reproducibility and saves weeks of effort.
- **Exporting only raw pickled Python estimators:** Rejected. Raw `pickle` files leak environment dependencies, do not bundle preprocessing transformations, present security risks, and fail production latency requirements.

---

## Consequences

### Positive
- Closes the critical gap between local experimentation and enterprise regulatory sign-off.
- Directly positions Sprisk as an enterprise-grade compliance and decision intelligence platform.
- Provides a clean commercial boundary for enterprise compliance packs and managed serving.

### Negative / Trade-offs
- ONNX compilation of arbitrary custom Python transformations requires fallback execution strategies.
- SHAP and fairness metrics increase evaluation compute time during model selection.
- Multi-agent coordination requires maintaining robust MCP schemas and agent state machines.

---

## Validation
- `sprisk export-dossier` generates an audit report verifying split integrity and model selection for an end-to-end classification flow.
- A compiled `ModelPackage` runs inference via a standalone test runner without importing the Sprisk graph compiler or training libraries.
- Gate B flags a warning or failure when a model exhibits significant disparate impact across declared protected groups.
