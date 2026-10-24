---
title: "Sprisk — Enterprise Scientific AI/ML Platform"
subtitle: "System Architecture, Conceptual Model, Technical Design & Implementation Specification · v2.0"
author: "Sprisk Architecture"
date: "18 October 2026"
lang: en
---

# Executive decision

**Product definition.** Sprisk is an **enterprise-capable, end-to-end scientific data/AI/ML platform**. It supports the path from a question and raw data through analysis, reproducible experimentation and model selection to deployment, monitoring, feedback, controlled retraining and governance. It offers a methodology-aware graphical workbench, programmable universal nodes, and typed, auditable workflows. The core works **without an LLM**; AI orchestration is an optional future client of the same contracts.

**Architecture decision.** Keep **one canonical typed execution graph**, one Sprisk control plane that owns lifecycle decisions, and a pluggable execution/serving substrate. Extend the existing Rust + Python design rather than adding competing graph engines. Deployment and enterprise governance are **first-class architecture domains**, even if delivery proceeds in vertical slices.

**Correction to earlier framing.** "Do not install Kafka/Spark/Kubernetes merely because enterprises use them" is sound engineering advice. "Sprisk is not enterprise-focused" is not. Enterprise outcomes, organizational operation, heterogeneous backends, reliability and deployment are design requirements. Infrastructure products are replaceable adapters, not prerequisites imposed on every installation.

**Status:** architecture recommendation ready for **M0 repository reconciliation**. Names, code examples, interfaces and proposed source boundaries below are *design targets*, **not** verified files or existing capabilities. Prior ADR-0017 and ADR-0037–0042 are design context rather than a source-level audit. The final stack and persistence migration must be reconciled against the real repository.

**Design thesis:** *A scientific claim, a deployed model, and an operational decision should remain traceably connected to the question, features, data availability, methodology, code, execution evidence, and approvals that produced them.*

**Delivery priority:** get the local core scientific workbench working end to end first. External authentication, storage services and other platform integrations can be delayed until then. Enterprise architecture targets are not prerequisites for core development.

## Reading guide

- **Part I (Sections 1–4)**: product intent, scientific mental model, industry findings and architectural invariants.
- **Part II (Sections 5–11)**: components, methodology, data/features, graph execution, experiments and reproducibility.
- **Part III (Sections 12–16)**: enterprise model registry, deployment, monitoring, governance and user experience.
- **Part IV (Sections 17–22)**: API, persistence, technical topology, roadmap, acceptance criteria and risks.
- **Appendices**: machine-readable illustrative contracts, lifecycle walkthrough, terminology, decision log and sources.

# Part I — Goals and foundations

# 1. Product scope and user journeys

## 1.1 Users and outcomes

| Persona | Primary outcome | Sprisk capability |
|---|---|---|
| Data scientist / researcher | Investigate and compare defensible methods | Profiling, experiments, metrics, evidence, notebook/code nodes |
| ML engineer | Turn proven experiments into operational systems | Typed artifacts, pipelines, packaging, deployment, reproducibility |
| Data engineer | Establish reliable sources and reusable feature generation | Connectors, data contracts, lineage, historical joins, quality checks |
| Analytics / domain expert | Understand decisions, inputs and trade-offs | Atlas, interpretable decisions, domain confirmations, reports |
| Platform operator | Run workloads securely and efficiently | Quotas, worker backends, resource policies, observability, rollback |
| Organization admin / reviewer | Govern risk and accountability | Tenants, RBAC/ABAC, approvals, audit and release policies |

## 1.2 Supported investigation families

The **core abstractions** must accommodate exploratory statistics, classification, regression, forecasting, anomaly detection, clustering, causal investigations, recommendations, embeddings and deep learning. A methodology family is **available for execution** only when its operator adapters, evidence coverage, domain-specific checks and acceptance suite exist. A broad conceptual catalog must never be presented as all fully verified.

## 1.3 Two independent dimensions of readiness

Distinguish **architecture capability** (what design can express) from **release implementation** (what code is shipping). Enterprise identity, storage, deployment and governance remain target domains, but their implementations and provider choices can wait until the core workbench works. Reserve integration boundaries without requiring speculative enterprise schemas or infrastructure.

**Core-first scope (M0–M4):** local, single-user dataset import, profiling, canonical graph editing, methodology decisions and Apply, Python execution, evidence, results and experiment comparison. Use existing local metadata persistence and filesystem artifacts. Saving work and reproducible results is core; external storage services and persistence migrations are not prerequisites.

**Deferred platform work:** external auth/OIDC/SSO, multi-user RBAC and tenant isolation, managed databases, object storage, secret managers, remote compute/orchestration, hosted serving and enterprise operational infrastructure. Introduce these after the core acceptance gate in Section 21 when required by the relevant deployment. Local development does not claim authenticated multi-user operation or tenant isolation.

| Capability | Architectural status | First deliverable | Expand without redesign |
|---|---|---|---|
| Versioned graph, evidence, scopes | Core | One tabular training vertical slice | All modalities |
| Enterprise identity / isolation | Reserved boundary; implementation deferred | After core: organization RBAC, workload identity, audit | Federation, policy packs, residency variants |
| Data and feature contracts | Core | Structured data, typed features, read-only profiles | Warehouse / streaming / multimodal |
| Methodology and experimentation | Core | Classification, preprocessing, CV, comparison | Domain packs, Bayesian/multiobjective optimization |
| Model registry and deployment | Core | Local/managed batch then online serving adapter | GPU, multiregion, canary, edge |
| Monitoring and retraining | Core | Operational telemetry + basic input checks | Statistical drift, label feedback, scheduled retraining |
| Compute execution backends | Pluggable | Local isolated workers | Kubernetes / distributed processing adapters |
| LLM planner | Optional client | Not required | Proposed plans subject to the same Apply and verification |

## 1.4 What Sprisk is not

Sprisk does **not** need to implement its own object store, distributed dataframe engine, container orchestrator, feature-store database, or model-serving kernel. It must **integrate**, **coordinate**, **govern**, **trace** and **present** these capabilities coherently. Some enterprises will choose an all-in-one deployment; others will connect their existing stack.

# 2. Industrial evidence and architectural lessons

The [eugeneyan/applied-ml](https://github.com/eugeneyan/applied-ml) repository is a **curated reference index** of production ML case studies, not an SDK or executable platform to embed. The conclusions below distinguish observed ideas in the linked sources from **Sprisk design decisions**.

| Source | Reported industry design idea | Sprisk design implication | Priority |
|---|---|---|---|
| Google, *Data Validation for Machine Learning* | Data quality and training/serving skew are continuous operational concerns | Versioned data expectations, quality probes and serving-vs-training compatibility checks | Core |
| Stitch Fix, *Hamilton* | Functions and derived features benefit from explicit DAG dependencies | Feature-level dependency and lineage descriptors above the node graph | Core foundation |
| DoorDash, *Fabricator* | Declarative feature definitions and unified control/data plane lower handoff friction | Reusable feature definitions, offline and serving materializations via adapters | Core contract |
| LinkedIn, *Typed AI Features* | Feature meaning/types need a shared source of truth across experimentation and inference | Common feature metadata resolved by workers, compiler and serving | Core |
| Netflix, *Metaflow* | Immutable execution snapshots and accessible run history support scaling and reproduction | Versioned run manifest, environment and dependency snapshots | Core |
| Netflix, historical feature/time-travel designs | Historical joins must not accidentally include information unavailable at prediction time | Event-time / available-at / prediction-time contracts; point-in-time checks | Core for time-sensitive tasks |
| LinkedIn, *DARWIN* | Fragmented notebooks, experiments and tools slow scientists | One workbench with linked Atlas, methodology and executable graph views | UX foundation |
| MLflow model registry | Model versions, lineage, aliases and governance distinguish artifact from release | Native model registry contract, optional compatibility/export adapter | Core deployment |
| Ray Train (official docs) | Distributed training can remain an execution backend abstraction | Pluggable distributed-worker adapter, no alternative Sprisk scheduler | Scale adapter |

**Design principle from the collected cases:** enable ordinary users to choose correct defaults **without removing expert escape hatches**. Not every transformation must be declared in YAML; custom code remains a first-class node with explicit, narrower assurance claims.

**Source use limit:** these articles support the named ideas, not the claim that any particular technology is mandatory, nor that their operational statistics generalize to Sprisk's prospective customers. See the references appendix for original URLs.

# 3. Scientific mental model and stable identities

Six interconnected scientific concepts are retained from v1.3; enterprise lifecycle resources are added without introducing a second ontology for the same thing.

| Concept | Human question | Records it owns | It does **not** own |
|---|---|---|---|
| **Investigation** | What are we trying to learn or achieve? | Goals, units, facts, semantics, constraints | Computation or deployment |
| **Methodology** | What makes this inquiry defensible? | Applicability, obligations, evidence requirements, decisions | Arbitrary execution code |
| **Method** | What can this operator do and under what conditions? | Port types, learning behavior, effects, runtime binding | A universal recommendation |
| **Decision** | Why did we choose this alternative? | Evidence, alternatives, rationale, approval, effects | Direct graph mutation |
| **Experiment** | Which candidate works under a defined protocol? | Study, trial, attempt, protocol, metrics, selection | A second workflow scheduler |
| **Evidence** | What was observed, used, produced and checked? | Scopes, lineage, trace, artifacts, findings | Proof of scientific truth |

**Lifecycle resources**, linked to those six concepts: `FeatureDefinition`, `DatasetVersion`, `PipelineVersion`, `ModelPackage`, `ModelVersion`, `ReleaseCandidate`, `Deployment`, `MonitoringPolicy`, `ObservationWindow`, `FeedbackDataset`, `RetrainingRequest` and `PolicyDecision`. These are not standalone execution DAGs. They reference the canonical graph and immutable artifacts.

## 3.1 IDs and time

Every durable record has `{id, revision/version, tenant_id, created_at, created_by, provenance_refs}`. Distinguish **event time**, **availability time**, **ingest time**, **execution time**, and **decision time**. A graph node ID is stable within a graph version; a run always references the exact version executed.

## 3.2 Three graph projections

1. **Investigation Atlas:** goal, data, progress, evidence, outcomes, deployments and feedback.
2. **Methodology Workflow:** requirements, decisions, alternatives, reasoning and check status (a *derived* graph).
3. **Execution Canvas:** the **only canonical executable graph**, containing universal nodes, composite nodes and typed connections.

The views share IDs. The Atlas and methodology view may edit investigation context or decision state, but not contain an independently executable graph. All executable edits are resolved through graph effects or manual graph editor commands against one canonical graph version.

# 4. Non-negotiable architecture principles

1. **One canonical graph and one Sprisk execution lifecycle.** Backends can be numerous; orchestration identity and policies cannot fork.
2. **Enterprise control-plane/data-plane separation.** Control-plane records do not carry raw customer datasets through the UI/API by default.
3. **Deployment is a first-class transition.** Training success does not implicitly authorize deployment.
4. **One method capability contract for every trusted operation**, from imputation to inference packaging.
5. **Evidence is scoped, versioned and linked to producers.** An unexecuted check is not a PASS.
6. **Trust propagates downstream.** An opaque transform cannot be laundered by a trusted estimator.
7. **User review before generated graph mutations.** No invisible planner edits; identical manual edits receive identical compilation checks.
8. **Compute is pluggable.** Local, containerized and distributed workers implement one protocol.
9. **Data, features and model packaging maintain train–serve consistency.** Fitted preprocessing is part of the deployable pipeline.
10. **Security gates are not methodological recommendations.** Authentication, authorization, tenant boundaries and runtime isolation are enforced, not voted on by a heuristic.
11. **Historical results are immutable.** Reassess under new rules without rewriting history.
12. **Progressive implementation, not limited product scope.** Every new vertical slice must exercise existing abstractions, not create a parallel system.

# Part II — System and scientific architecture

# 5. System architecture and boundaries

```text
                           +----------------------------------------+
                           | SPRISK WORKSPACE (React/TypeScript)     |
                           | Atlas / Canvas / Inspector / 9 Docks   |
                           +------------------+---------------------+
                                              | HTTPS / SSE or WS
                           +------------------v---------------------+
                           | SPRISK CONTROL PLANE (Rust)            |
                           | API | tenancy/authz | investigations   |
                           | methodology | method registry | graph  |
                           | studies | policy/gates | releases      |
                           | deployment controller | event/outbox   |
                           +-----+--------------+------------------+
                                 |              |
                  control records|              | signed work/release intents
                                 v              v
                       +----------------+  +-------------------------+
                       | SQL METADATA   |  | EXECUTION / SERVING     |
                       | + AUDIT/OUTBOX |  | ADAPTER CONTRACTS       |
                       +----------------+  +-----------+-------------+
                                                       |
                  +------------------------------------+---------------------+
                  |                                    |                     |
          +-------v-------+                    +-------v-------+     +------v-------+
          | Local Python  |                    | Remote workers|     | Serving /    |
          | sandbox       |                    | / k8s / Ray  |     | batch target |
          +-------+-------+                    +-------+-------+     +------+-------+
                  |                                    |                    |
                  +----------------------+-------------+--------------------+
                                         |
                          +--------------v----------------+
                          | ARTIFACTS + DATA REFERENCES   |
                          | Object storage / metadata     |
                          | snapshots, traces, packages   |
                          +--------------+----------------+
                                         |
                       +-----------------v-----------------+
                       | GATE B / ASSURANCE / MONITORING   |
                       | compile, runtime, release, drift  |
                       +-----------------------------------+
```

## 5.1 Logical boundaries, not premature microservices

| Plane | Responsibility | Suggested implementation boundary |
|---|---|---|
| Control | Identity, revisions, decisions, policies, lifecycle, scheduling intent | Modular Rust application; split services only for proven scale/isolation needs |
| Scientific data | Datasets, table profiles, features, training examples, fitted states | Python worker + connectors/object storage |
| Compute | Executes typed compiled plans with resource and scope restrictions | Worker protocol and backend adapters |
| Serving | Hosts approved model packages, batch/online predictions and release state | Deploy target adapters and inference runtime |
| Assurance | Admission, runtime scope, scientific checks, release gates and monitoring findings | Gate B extension + policy evaluation |
| Presentation | Interactive graph, docks, artifacts, decisions, deployments | Existing TypeScript workbench |

**Important:** An external tool may implement part of a plane. E.g. KServe might perform serving and autoscaling, Ray distributed training, MLflow registry interoperability, or Feast feature access. Sprisk still owns its scientific identities, decisions, audits and releases.

## 5.2 Trust boundaries

**Delivery stage:** these are target requirements for enterprise deployments. External providers and enterprise enforcement integrations follow the core acceptance gate; they are not prerequisites for the local M0–M4 workbench.

1. Browser → API: OIDC session, origin/CSRF protection as applicable, tenant authorization, input validation.
2. API → metadata/object store: least-privilege service accounts and tenant-scoped access control.
3. API → worker: signed/short-lived execution grants; runtime receives only permitted references and secrets.
4. Worker → customer data sources: tenant-specific credentials with outbound restrictions; no uncontrolled credential copying into artifacts.
5. Registry → deployment target: package verification, signed image/package digests, environment credentials, scoped release grants.
6. Deployment → monitoring: aggregate telemetry by default; predictions, labels and PII collected only under policy.

A certified boundary is a *technical assertion backed by isolation tests*, not a flag in a manifest. Where isolation cannot be shown, report partial assurance.

# 6. Components, ownership and integration responsibilities

| Component | Core API/behavior | Owner | Dependencies |
|---|---|---|---|
| Investigation service | Create/revise goal, roles, semantic confirmations | Rust | metadata store |
| Dataset & feature catalog | schema expectations, data/feature versions, availability | Rust contracts + Python probes | data connectors/artifacts |
| Methodology resolver | determine pack applicability, required evidence and alternatives | Rust | investigation, catalog, findings |
| Method catalog | register typed operator capabilities and backend bindings | Rust registry, signed manifests | operator adapters |
| Decision/effect planner | proposal, graph diff, authorization, atomic Apply | Rust | existing graph/compiler |
| Graph compiler | validate ports, effects, scope and executable plan | Existing core, extend | typed graph, methods |
| Execution controller | durable attempts, scheduling, retry, cancellation, quotas | Rust (existing path) | workers, queue/event outbox |
| Scientific adapters | profile, fit, transform, predict, score, package | Python | NumPy/pandas/sklearn + future frameworks |
| Experiment controller | studies, trial specs, evaluation protocols and selection | Rust + Python strategy adapters | scheduler, artifacts |
| Assurance/Gate B | admission, runtime, result, release and deployment checks | Existing assurance + policies | evidence, monitoring |
| Registry & release | model/package versions, release candidates, approvals | Rust | artifacts, signed packages |
| Deployment controller | desired state, rollout, reconcile, rollback, status | Rust + target adapters | serving targets, telemetry |
| Monitoring & feedback | operational and statistical findings, label arrival, retraining requests | Rust policy + worker probes | events, datasets |
| Organization governance | tenant, project, role, environment, budget, audit | Rust/platform | auth, policy, metadata |
| Workbench | three views, inspector, bottom docks, approvals, deployments | React/TS | API/event stream |

**Reuse-before-new rule:** each owner above is logical. The M0 integration map identifies whether it is an existing module, an extension, or a missing module. Do not create duplicate dispatchers, artifacts or models under new names.

# 7. Investigation, feature semantics and data contracts

## 7.1 Investigation contract

An investigation records: question, intended action, objective family, target (if applicable), observation unit, entities, time semantics, feature availability assumptions, evaluation goals, cost/latency/quality guardrails, regulatory/business context, ownership and required reviews. A task's objective is not inferred from a column name.

**Fact attributes:** origin (`OBSERVED`, `INFERRED`, `ASSERTED`), separate confirmation and verification fields, evidence references, confidence only when meaningful, resolution status (`KNOWN`, `UNKNOWN`, `CONFLICTED`), effective revision. A repeated ID can be observed automatically; its real-world meaning requires justification.

## 7.2 Feature descriptors

Separate **physical type** (float, integer, string, timestamp), **semantic type** (quantitative, nominal, ordinal, cyclical, identifier, text), **analytical role** (feature, target, entity, time, group, excluded) and **availability behavior**. Allow unknown semantic types. Confirm ordinal order; never infer it solely from lexicographic sorting.

## 7.3 Versioned data expectations

A `DataContract` attaches to a dataset or serving input. It describes expected columns, allowed domains, null policy, freshness and quality checks. `DataContract` results can be a hard schema rejection, a review finding, or advisory drift—not all numerical changes are data corruption. Every expectation has provenance and an update workflow; profiles cannot silently overwrite the contract.

## 7.4 Derived features and feature lineage

A `FeatureDefinition` identifies a transformation of source features (including optional aggregation/join/window semantics), its execution method, output semantics and lineage. Lineage should record source field IDs, transformation version and resolved output features. **Guarantee detailed column lineage only for trusted/instrumented operators or explicitly declared contracts**; custom opaque Python may have dataset-level lineage only.

## 7.5 Point-in-time correctness

For time-sensitive predictive work, distinguish `event_at` (when fact occurred), `available_at` (when usable by the prediction system), `prediction_at` (decision time), and any `ingested_at`. Historical feature generation must honor the declared availability rule. Records with `event_at < prediction_at` but `available_at > prediction_at` must be excluded for a production-faithful backtest. Missing availability timestamps yield a limitation or `NEEDS_FACT`, never a fabricated PASS.

## 7.6 Offline and online feature consistency

The **feature contract is reusable across environments**. Offline training and online serving may employ distinct storage systems, but must reference compatible versions of the same feature definition, typing rules, normalization and available-at policies. Online feature stores, warehouses and streaming ingestion are **adapters** to these identities, not mandatory separate infrastructure in the core.

# 8. Methodology engine: contracts, rules and decisions

A methodology pack groups: applicability conditions; required context facts; evidence probes; decisions and alternatives; methodological invariants; advisories; report obligations; optional composite graph templates. Packs are immutable, versioned and content-digested. No free-form user-authored executable rule DSL in the first slice; manifests refer to **registered typed predicates and probes**.

## 8.1 Initial methods vs long-term families

Initial production method pack: read-only tabular profiling, supervised classification, missingness, nominal encoding, fit-scope integrity, baseline/model evaluation and experiment comparison. The registry data model accommodates regression, time-series, causal, clustering, ranking, deep learning and deployments. **Availability** is explicit (`DOCUMENTED`, `AVAILABLE`, `CERTIFIED`), so a catalog entry does not imply production support.

## 8.2 Rule types and results

| Rule kind | Meaning | Possible consequence |
|---|---|---|
| Invariant | enforceable property such as authorized fit scope | Deny run, invalidate evidence or block promotion |
| Conditional requirement | obligation activated by confirmed context | Request information or require design step |
| Advisor | evidence-backed recommendation, not universal law | Show options/experiments |
| Domain judgment | an externally meaningful fact is required | Record confirmation or limitation |

`Applicability = APPLICABLE | NOT_APPLICABLE | NEEDS_FACT` and `CheckStatus = PASS | WARN | FAIL | INCONCLUSIVE | NOT_RUN` are separate. Every check includes phase, subject, scope, reason, evidence, policy version and coverage. Unknown is not false.

## 8.3 Decision lifecycle

```text
context + scoped evidence -> methodology applicability -> alternatives
  -> immutable DecisionProposal -> typed EffectPlan (replace_node, remove_node; ADR-0043)
  -> graph diff preview
  -> authorization -> atomic Apply -> new PipelineVersion
  -> compile -> worker attempt -> verification -> findings
```

Proposals fingerprint all relevant revisions: question, dataset/parser, feature semantics, split manifest, graph base, method/operator code, policy pack and settings. A stale proposal fails Apply without partial mutation. The same idempotency key and same payload return the same commit; key reuse with a changed payload is conflict. Equivalent manual edits go through the same admission policy.

A method's option (ADR-0063) takes the same Apply (ADR-0064): it is a `MethodologyDecision` with its method, option, bindings, promises and effects, keyed per walk round. A base that gained a version is refused, and every step the option changed cites the decision. A method has no stored proposal; its option is computed from the base and its evidence each round.

# 9. Universal method contract and execution semantics

Every `MethodDefinition` is metadata **bound to an actual adapter** and has: identity/version, input ports, physical/semantic compatibility, task applicability, data reads (`X`, `y`, group, time), fit lifecycle, parameter schema, output effect/shape, resource needs, trust class, verification requirements, implementation digest and supported backend.

## 9.1 Core method behaviors

| Behavior | Examples | Consequence |
|---|---|---|
| Stateless transformation | Fixed-period sine/cosine | No fitted state; still requires semantic context |
| Feature-fitted transformation | Median, OHE, scaler, PCA | Fit on authorized data; freeze fitted state |
| Target-fitted transformation | Target encoding, WOE | Target access and cross-fitting constraints |
| Estimator fitting | Logistic regression, SVM, deep model | Scope, metrics and resource controls |
| Evaluation | Classification scoring, residual checks | Labels permitted for score, not unauthorized fit |
| Packaging / serving adapter | Model package or endpoint wrapper | Export/runtime compatibility and input contract |

## 9.2 Planned and resolved output schemas

Transformations may expand columns, produce sparse matrices, tensors or non-tabular artifacts. Compiler validates a **planned type family**; worker emits **resolved schema** after fit, including names/order/types/shape/lineage. Consumers accepting dynamic schema must bind it explicitly. Validation-only categories need an unknown-category policy; no silent refitting.

## 9.3 Portable execution envelope

The compiled graph produces a serializable `ExecutionPlan` with stable node/port references, method digests, purpose-specific scoped inputs, resource constraints and destination artifact IDs. Local and remote backends must receive the same logical plan. Workers may stream outputs but can only declare successful completion after durable artifact and evidence commit.

## 9.4 Data-access matrix

| Action | Train X | Train y | Validation X | Validation y | Final y |
|---|---:|---:|---:|---:|---:|
| Feature transform `fit` | Yes | No | No | No | No |
| Model/target encoder `fit` | Yes | Yes | No | No | No |
| Frozen `transform` / `predict` | Possibly | No | Yes | No | No |
| Validation `score` | — | — | Predictions derived from X | Yes | No |
| Final authorized `score` | — | — | Final predictions | No | Yes |

A score reads labels legitimately; a fit cannot use held-out labels. The same preprocessing is fitted independently inside each CV training fold. Cross-fitting-specific methods require a registered certified adapter; otherwise mark unavailable, not silently treat as generic transformation.

# 10. Graph compiler, workers and execution modes

## 10.1 Universal node model

Preserve user-established universal nodes: `code`, `callable`, `script`, `binary`, and `composite` (exact storage names to be confirmed in M0). Scientific methods bind to compatible operator implementations; the methodology layer never creates its own shadow graph. Composite nodes allow experiments and packaged preprocessing/model bundles to remain readable on the canvas.

## 10.2 Compilation stages

1. Check tenant/project permissions and referenced record ownership.
2. Resolve graph revision and all operator/method digests.
3. Validate port, schema-family, parameter and dynamic-schema compatibility.
4. Resolve data scopes, purpose permissions, secrets and environment.
5. Check pipeline compilation, DAG constraints (for normal batch graph) and composite boundaries.
6. Evaluate pre-execution invariant and resource policies.
7. Emit execution plan fingerprint and artifact destination manifest.
8. Dispatch via **existing** worker-attempt lifecycle.

## 10.3 Execution backend interface

Backends implement `submit(plan, grant)`, `observe(attempt)`, `cancel(attempt)`, `collect(attempt)` and capability discovery. One worker protocol supports local isolated processes, containerized on-prem workers, Kubernetes jobs, and distributed training adapters. **There is one Sprisk scheduler/control-plane state machine**, even if a backend has its own internal task scheduler (e.g., Ray). Backend status reconciles to the Sprisk attempt record.

## 10.4 Isolation and retries

Execution grants have tenant, project, purpose, dataset membership/scope and expiry. Certified adapters should receive only granted data; mount/credential/network restrictions must be proven in integration tests before claiming strong sandbox guarantees. Failed attempts are immutable; retries create separate attempts referencing the same immutable TrialSpec. Deterministic caching depends on input/graph/environment fingerprints and method declared determinism; never assume GPUs guarantee bitwise identical reproduction.

## 10.5 Streaming / event-driven work

Architecturally represent source triggers, microbatch boundaries, watermark/late-arrival policy and model serving events as **execution modes** of the same graph and operators. Do not force every online request to run the full scientific graph: deployed models use a **compiled serving bundle** derived from an approved graph and compatible feature contracts.

# 11. Experiments, evaluation and optimization

**Study** (ADR-0044: a TrialSpec is a cross-validate step and its attempt; SelectionDecision is the select step's output) = = comparable candidate pipelines under an explicit protocol. **TrialSpec** = immutable configuration. **TrialAttempt** = actual worker run/retry. **TrialResult** = accepted attempt's evidence. **SelectionDecision** = authorized choice, not a sorting operation. (ADR-0050: a candidate must pass a corrected test against the baseline; the recommendation is the simplest within one standard error of the best; each decision records which versions already scored the holdout.) (ADR-0052: a Study is a comparison version with search trials and a budget; a Trial is one cross-validate step, one candidate at one setting; tuning is nested inside the outer folds; a budget reached keeps partial evidence and makes no decision; guardrails stop a candidate from winning and are recorded per candidate; each decision lists the earlier looks at the same folds.)

| Contract | Required contents |
|---|---|
| EvaluationProtocol | target/unit, split and fold membership, metrics, sample/slice definition, temporal/group constraints |
| SearchSpace | typed parameters, conditional branches, algorithm/preprocessing alternatives |
| ExperimentStudy | candidates, protocol, search strategy, budget, lifecycle, comparison group |
| TrialSpec | graph digest/version, parameters, environment, seed, protocol |
| TrialAttempt | worker ID, logs, status, resources, error, timestamps |
| TrialResult | per-fold metrics, predictions ref, artifacts, checks, cost and uncertainty |
| SelectionDecision | declared objective, guardrails, comparable candidates, reasons, approvals |

**Metric objective versus business decision:** selection may depend on PR-AUC, recall at contact budget, inference cost, latency, interpretability and operational limits. Define primary selection metric and guardrails before viewing final-holdout results. Cross-study rankings without a compatible protocol must be labeled *not directly comparable*.

**Optimization:** begin with baseline + bounded grid/random search across complete pipeline parameters, not only model hyperparameters. Adaptive algorithms (e.g., Optuna/TPE) and AutoML systems (e.g., H2O.ai / H2O AutoML) are strategy adapters added later. Trial budgets cover CPU/GPU, memory, time, concurrency, retry count, artifact bytes and money estimate when billing data exists. Trial outcomes must not overwrite prior attempts.

**Final evaluation:** separate validation-driven selection from controlled final-holdout scoring. Final refit uses authorized development data; only the approved scorer reads final labels. Repeated holdout usage is logged as an evaluation limitation.

# Part III — Enterprise operational lifecycle

# 12. Model registry, packages and deployment

Deployment is a **core bounded context**, not an extra utility attached to a training node.

## 12.1 Separate artifacts, registrations and deployments

- `ModelArtifact`: immutable binaries, preprocessing state, label maps, supported inference functions and checksums.
- `ModelPackage`: portable inference contract including input/output schema, runtime dependencies, feature contracts, resource requirements, signatures and health checks.
- `RegisteredModel`: stable named model identity within a tenant/project.
- `ModelVersion`: immutable association to a ModelPackage, origin Trial/Study, metrics, reproducibility evidence and Gate B assessment.
- `ReleaseCandidate`: a model version proposed for an environment with approval and validation requirements.
- `Deployment`: desired/actual state of a model version on a serving target, including traffic strategy, auth, observability and rollback reference.

Mutable aliases such as `champion`/`candidate` may point to immutable ModelVersions, but an alias move is audited. Aliases do not rewrite the model artifact or change a previously recorded deployment revision.

## 12.2 Deployment modes

| Mode | What is deployed | Initial target | Enterprise extension |
|---|---|---|---|
| Batch inference | A versioned inference job with feature manifest | Controlled Python worker | Scheduled/distributed jobs, external object stores |
| Online REST inference | Packaged frozen pipeline behind a versioned endpoint | One authenticated container/server adapter | KServe/Seldon/custom targets, autoscaling |
| Streaming inference | Operator connected to an event stream | Contract only | Kafka/Flink or customer event adapters |
| Edge/offline | Exported model + runtime envelope | Contract only | ONNX / platform-specific deployment, device attestations |

**Never deploy a bare estimator without its preprocessing and feature contract.** The packager must include all approved fitted transforms, feature order, unknown category handling, dependency locks and environment configuration.

## 12.3 Release workflow

```text
Selected TrialResult
     -> verify evidence and promotion eligibility
     -> package + fingerprint + sign
     -> ModelVersion (registered)
     -> ReleaseCandidate (target/environment/policy)
     -> review / approval
     -> compatibility + safety + smoke checks
     -> Deployment desired state
     -> adapter rollout (dev -> staging -> prod)
     -> health / data checks / live metrics
     -> continue | canary expand | rollback
```

Promoting a model is not equivalent to pushing a container. A release can be blocked if trusted preprocessing is missing, input schema does not match, latency budgets fail, approval is missing or the package is unsigned according to org policy.

## 12.4 Reconciliation and rollout semantics

The Deployment Controller stores **desired state** separately from **observed state**. A backend adapter reconciles them and reports readiness, digest, traffic split, endpoint, failures and rollback targets. Safe operations are idempotent. Failed deployments must not silently flip the active alias or lose the prior healthy version. Rollouts support environment-specific approval, dry-run, blue/green or canary when target capabilities allow; if the target cannot guarantee a requested strategy, reject with an explicit capability error rather than silently degrading.

## 12.5 Tool interoperability

Model export/registry compatibility with MLflow and ONNX should use adapters where appropriate. Sprisk retains the canonical `ModelVersion` and deployment policy records; it does not require users to adopt an external registry. An enterprise can choose a managed registry or serving product while keeping Sprisk's approvals, lineage and UI.

# 13. Monitoring, feedback and controlled retraining

## 13.1 Four monitoring planes

1. **Operations:** endpoint availability, latency distributions, throughput, errors, CPU/GPU, cost and capacity.
2. **Data contract:** schema mismatches, missing values, unseen categories, freshness, train–serve skew and available-at issues.
3. **Statistical health:** distribution shift, slice coverage, stability of features and predictions; evidence is *drift*, not automatically accuracy loss.
4. **Outcome quality:** measured quality when ground-truth labels arrive; metric uncertainty, subgroup errors, business guardrails and label delay.

## 13.2 Data feedback lifecycle

Production logs and delayed labels form policy-approved feedback datasets with explicit timestamps, consent/retention requirements and lineage. A monitor produces a typed `MonitoringFinding` with severity, scope, comparison reference, calculation window, evidence, and confidence/limitations. Alerts route to responsible users; not every drift warning warrants immediate retraining.

## 13.3 Retraining is a controlled proposal

```text
Monitoring finding / schedule / human request
   -> RetrainingRequest + updated dataset snapshot
   -> methodology re-resolution and evidence checks
   -> replay graph or authorized revised graph
   -> Experiment Study and validation
   -> new ModelVersion
   -> approval + release gates
   -> controlled rollout
```

Default: **no autonomous production promotion**. Organizations can introduce policy-based automation only after audited release gates and rollback facilities are proven. A schedule alone cannot override feature availability checks or scientific evidence requirements.

## 13.4 Operational lessons from industry

Train–serve skew prevention and contract monitoring derive from Google's validation work; feature lifecycle and observability from DoorDash/LinkedIn patterns; immutable runs from Metaflow; release aliases and controlled environments from model registry patterns. This is the intended **operational extension** of scientific methodology, not a second universe of unlinked MLOps metadata.

# 14. Enterprise security, tenancy and governance

**Delivery stage:** these are target requirements for enterprise deployments. External providers and enterprise enforcement integrations follow the core acceptance gate; they are not prerequisites for the local M0–M4 workbench.

## 14.1 Organization hierarchy

`Organization -> Workspace/Project -> Investigation -> Pipeline/Study/Model/Deployment`. Data and model sharing across projects requires explicit grants. An organization may configure separate environments (`development`, `staging`, `production`) with distinct credentials, reviewers, compute quotas and network policies.

## 14.2 Identity and authorization

Support OIDC federation, service identities and short-lived credentials. Initial RBAC roles: `Viewer`, `Contributor`, `Maintainer`, `Approver`, `Operator`, `OrgAdmin`. Add resource/attribute conditions for regulated datasets, environments, regions and high-risk release actions. Every API enforces tenant ID from the authenticated principal, **not** from a caller-trusted request field. Data-plane grants are scoped to the runtime principal, task purpose, resources and expiry.

## 14.3 Governance policy surfaces

| Surface | Example control |
|---|---|
| Data access | Approved connection, classification, allowed region, retention |
| Scientific process | Required split integrity, verified feature availability, evaluation protocol |
| Compute | Worker class, GPU budget, outbound network, CPU/memory limits |
| Model release | Package trust, metric/latency guardrails, required approvals |
| Deployment | Allowed serving regions, endpoint auth, canary target, rollback |
| Monitoring | What may be logged, slice thresholds, alert routing, feedback retention |

**Policy decisions are records**: subject, requested action, policy version, evidence refs, allow/deny/review, approver and expiry. Use consistent policy enforcement across UI, API, scheduler and serving adapters. Do not confuse legal compliance with an automatic certificate: the platform can supply controls/evidence; customer-specific obligations still require review.

## 14.4 Security baseline

TLS, encryption at rest, secret-manager integration, audit log integrity, tenant-aware backups, least-privilege object-store access, signed container/package digests, SBOM where feasible, vulnerability scanning, runtime sandboxing/network policies, rate limits and resource isolation. Treat arbitrary code/binaries as untrusted workloads by default, with stricter egress and data access. **No customer data sent to external LLMs by default**; any later AI capability must have explicit policy and deployment choices.

## 14.5 Enterprise deployment models

Architectural targets: single-tenant on-prem/private cloud, private managed cluster and hosted multi-tenant service. Each uses the same control-plane contracts; isolation guarantees depend on verified deployment topology. Air-gapped deployments require local artifacts, pinned packages and offline licensing/update processes if commercial distribution calls for them.

# 15. Workbench and methodology visualization

The UI remains a precise, restrained, technical environment: no glowing decorative graphics, no cluttered wall of algorithms. The main **typed canvas** is infinite and supports composite nodes, code/callable/script/binary implementations and previews. The **left palette** lists deterministic scientific methods and connectors. The **right inspector** displays selected node, decision, evidence, parameters and policy. The **bottom docks** remain Code, Data, Visualizations, Console, Inputs, Parameters, Checks, Performance and History.

## 15.1 Three projection modes and enterprise surfaces

The projections describe information models, not three mandatory top-level tabs. In the core workbench, methodology first appears in the inspector of the affected execution node: current decision, applicable alternatives, evidence, reasoning, Preview and Apply. The `Checks` dock shows verification for that same rule and decision. Do not add an ad hoc decision tab or panel disconnected from node selection. A full derived Methodology Workflow view is an advanced navigation surface added only after the inline decision path is coherent.

| View | User's question | Main interaction |
|---|---|---|
| Investigation Atlas | Where are we, what do we know, what is unresolved? | Select objectives, inspect lifecycle, navigate evidence |
| Methodology Workflow | Why this technique, what alternatives exist? | Confirm assumptions, inspect rule evidence, preview effects |
| Execution Canvas | What actually runs, how is it connected? | Edit typed graph, inspect cells/outputs, start runs |
| Experiment dock | Which candidates were tried, under what protocol? | Compare folds/trials, inspect budgets, select a candidate |
| Model & Deployment dock | What's registered, live, healthy or awaiting approval? | Inspect package, stage release, rollback |
| Monitoring dock | What changed in production and what action is justified? | Inspect drift/latency/label feedback, propose retraining |

The last two can be tabs or panels in the existing workbench, **not new independent applications**.

## 15.2 Information hierarchy

- Atlas region -> methodology subgraph -> actual nodes -> execution evidence, each at an appropriate zoom level.
- Never render every CV fold and hyperparameter trial as permanent main-canvas nodes; use composite experiment nodes with expandable run tables and plots.
- Each finding answers: **observation**, **why it matters**, **evidence/scope**, **alternatives**, **what changes if applied**.
- Model/deployment statuses distinguish `TRAINED`, `VERIFIED`, `REGISTERED`, `APPROVAL_PENDING`, `DEPLOYING`, `HEALTHY`, `DEGRADED`, `ROLLED_BACK` where applicable. A favorable training metric is not a release status.

# 16. Verification, assurance and scientific claims

## 16.1 Five checkpoints

| Checkpoint | Question | Decision |
|---|---|---|
| Graph admission | Type-safe, permitted, correct scope, registered adapter? | Compile/deny |
| Runtime execution | What data and state did the operation actually use? | Evidence + pass/fail/inconclusive |
| Scientific result promotion | Was evaluation methodologically justified? | Supported/limited/blocked |
| Release admission | Is the package approved, reproducible enough and compatible with serving? | Approve/deny/review |
| Production assessment | Is current behavior within operational and quality guardrails? | Healthy/degraded/alert/retrain proposal |

**Trust classes:** `CERTIFIED_ADAPTER`, `INSTRUMENTED`, `OPAQUE`. Assurance coverage is **per check and per dependency closure**; a certified downstream model cannot sanitize a preceding opaque transformation. A structured scientific report should show exactly which claims were checked and which were not; `INCONCLUSIVE` and `NOT_RUN` are never displayed as PASS.

## 16.2 Availability, correctness and honest limits

Static graph checks can establish typed placement; runtime controls can establish permitted data access **only within a verified sandbox**. They cannot prove absence of all real-world bias, causal identification or model fairness from code alone. For opaque custom code, allow execution under enterprise policy, but record limited assurance. Deployment may require a higher trust bar than an exploratory run.

# Part IV — Implementation specification

# 17. API contracts, commands and event model

## 17.1 API principles

Use organization/project-scoped resource routes; enforce authorization server-side. Commands are idempotent; readers receive stable versions/digests and ETags. Long-running operations return work IDs and expose status/events. Errors distinguish validation, stale revision, insufficient rights, scope violation, unsupported capability, failed evidence and target-backend failure.

| Logical command | Behavior | Key protection |
|---|---|---|
| `resolve_investigation` | Applicability + missing facts + required evidence | Context revision |
| `request_profile` | Bounded read-only worker probe | Data grants, cost limits |
| `propose_decision` | Alternatives with typed graph effects | Evidence provenance |
| `preview_effects` | Full graph diff + compiler checks | Base graph revision |
| `apply_effects` | Atomic new graph version | Authorization, CAS, idempotency |
| `start_study` | Lock protocol + candidate set + budget | Tenant quota, split compatibility |
| `schedule_trial` | Bind trial to worker attempt | Immutable TrialSpec |
| `register_model` | Link selected package to model version | Evidence + artifact digest |
| `request_release` | Start environment-specific approval | Release policy, separation of duties |
| `apply_deployment` | Set desired serving state | Capability/region, CAS, idempotency |
| `assess_monitoring_window` | Produce operational findings | Window/data availability |
| `propose_retraining` | Create governed analysis proposal | No automatic model promotion |

## 17.2 Example deployment request (illustrative)

```json
{
  "model_version_ref": "model:churn/v4",
  "environment_ref": "env:production",
  "serving_target_ref": "target:eu-k8s",
  "mode": "online",
  "rollout": { "strategy": "canary", "percent": 5 },
  "resource_limits": { "cpu": "2", "memory_mb": 4096 },
  "monitoring_policy_ref": "policy:churn@3",
  "expected_model_revision": 4,
  "idempotency_key": "deploy-churn-v4-canary-1"
}
```

The deployment controller must check target capabilities and package compatibility before creating desired state. An unsupported strategy returns `UNSUPPORTED_TARGET_CAPABILITY`; do not pretend a full rollout was a canary.

## 17.3 Events and durable work

Domain events are emitted through an existing reliable bus/outbox **if one exists**; otherwise add a durable outbox transaction as part of execution/release durability. Examples: `DatasetVersionCreated`, `EvidenceProduced`, `DecisionProposed`, `GraphVersionCommitted`, `TrialCompleted`, `ModelRegistered`, `ReleaseApproved`, `DeploymentObserved`, `MonitoringFindingProduced`, `RetrainingRequested`. Event consumers must tolerate duplicates and out-of-order observations using IDs, revisions and deduplication.

# 18. Persistence, versioning and invalidation

## 18.1 Logical storage

| Storage | What it holds | Guidance |
|---|---|---|
| Relational metadata | IDs, tenancy, revisions, workflow, decisions, approval, study, registry, deployments, audit/outbox | Transactional source for control state |
| Object/artifact store | Dataset snapshots/references, fitted states, predictions, plots, logs, packages, manifests | Content-digested and access-controlled |
| Runtime cache | Non-authoritative hot views, status, probe caches | Evictable; not an audit substitute |
| External sources | Warehouses, feature stores, event streams | Access through connectors; no silent raw copies |
| Metrics/log backends | Service telemetry, distributed traces | Correlate by immutable Sprisk IDs |

## 18.2 Invalidation

Change to dataset version, parser, semantics, target, split, method digest, environment or graph invalidates **only dependency-affected** evidence/trials/findings. A methodology rule update creates a new assessment without rewriting historical execution. Production deployment remains pinned to its approved model/package digest even if an investigation changes later.

## 18.3 Reproducibility record

A `RunSnapshot` records question/context revision, graph and methods, dataset and memberships, partition manifests, code/container digests, dependency lock, seed, fitted artifacts, runtime metadata, resource usage and evaluation checks. Distinguish **traceable**, **rerunnable**, and **reproduced**. User-supplied secrets and raw sensitive values must not be dumped into snapshots or logs.

# 19. Technology plan and build-vs-integrate decisions

**Locked technology direction:** Rust control plane, Python scientific runtime, React/TypeScript scientific workspace, versioned typed graph, existing graph compiler and worker-attempt lifecycle. **Integration-dependent:** database implementation, message bus, object store, identity provider, schema generator, frontend docking/canvas components and actual sandbox.

| Domain | Build in Sprisk | Integrate/adapt | Avoid at outset |
|---|---|---|---|
| Methodology | Typed resolver, packs, decisions, assessment | Established scientific methods and docs | Generic rule scripting engine |
| Feature generation | Contracts, lineage, compilation rules | Hamilton-like patterns, SQL engines, Feast-style access | Rebuilding a complete feature store |
| Experimentation | Study/trial/compare, authorization and evidence | sklearn, Optuna / H2O.ai later, distributed train backends | Second orchestration engine |
| Registry | Identity, release policies and lineage | MLflow compatibility, ONNX export | Recreating every model format |
| Deployment | Desired state, target adapters, approvals, rollback | Container runtime, KServe/Seldon/custom endpoints | Writing a custom autoscaler |
| Monitoring | Policies, findings, links to model/investigation | Prometheus/OpenTelemetry/managed monitors | Building metrics TSDB |
| Enterprise IAM | Tenant-aware policy resources and audit | OIDC/SSO, secret manager, policy engine as needed | Home-grown identity provider |
| Compute | Worker contract, scheduling policy | Kubernetes jobs, Ray, cloud batch | Mandatory distributed stack for all users |

**When to adopt a dependency:** specific workload or operational requirement + evaluated interoperability + verified security/license + manageable lifecycle + clear adapter boundary. No technologies are mandatory solely because a reference company uses them.

# 20. Non-functional requirements and quality attributes

These are **proposed engineering targets**, not measured claims or customer SLAs. Establish baselines during M0/performance testing and revise per deployment tier.

| Quality attribute | Initial target / acceptance principle |
|---|---|
| Deterministic control | Identical input revisions and proposal key do not create duplicate changes |
| Consistency | No graph Apply or release request partially commits control state |
| Isolation | Cross-tenant resource access blocked by API, store and worker boundary tests |
| Reliability | Recover after API/worker crash without losing durable trials or deployment intent |
| Auditability | Privileged changes, release approvals and rollbacks attributable to actors and versions |
| Availability | Per-tier SLO defined separately for control API, worker queue and online serving |
| Observability | Correlation IDs link study → trial → attempt → deployed model → monitor finding |
| Security | Scanning, immutable package digests, secret redaction, policy-restricted egress |
| Scale | Horizontal backend extension without changing graph/contract definitions |
| Cost | Quotas, budgets, workload estimation and resource reporting |
| Portability | Same package and feature contracts across approved local/private/managed backends |
| Resilience | Cancel, retry and rollback are idempotent with preserved historical evidence |

Online-serving latency/uptime targets must be calibrated by task and hardware; do not hardcode a universal 100ms SLA for all models.

# 21. Milestones and implementation sequence

A *milestone* is an end-to-end product proof, not merely a module skeleton. **M0–M4 prioritize a working local core workbench.** Keep enterprise integration boundaries in the architecture, but defer external platform implementation until the core acceptance gate passes.

| Milestone | Engineering scope | Done when… |
|---|---|---|
| **M0 — Repository mapping** | Locate graph/compiler, workers, Gate B, local API/DB, artifacts and canvas; record future auth, storage, packaging and deployment boundaries without implementing integrations | Integration map and gaps signed off; no duplicate scheduler/graph introduced |
| **M1 — Scientific identity & profiling** | Investigation/data/feature contracts, identity linkage, scoped read-only evidence | An imported dataset produces traceable, versioned, locally project-scoped profiles |
| **M2 — Trusted execution slice** | Median, OHE, scaling, dummy and logistic pipeline; per-fold state; checks | Leakage tests pass, trust coverage honest, traceable outputs |
| **M3 — Decisions / Apply / UI** | Resolver, classification pack, alternatives, preview, atomic Apply | A real decision changes the canonical graph exactly once |
| **M4 — Experiments and selection** | Study/trial/attempt/results, comparison, budgets, bounded grid/random search | Fair baseline/candidate evaluation with repeatable history |
| **M5 — Registry and batch deployment** | Portable package including preprocess, registry identity, release policy, batch inference | Selected model becomes approved immutable package and runs batch predictions |
| **M6 — Online serving and controls** | One serving adapter, environments, health, endpoint auth, rollback/canary as supported | Staged approval → operational endpoint → rollback is demonstrable |
| **M7 — Monitoring and feedback** | Quality/operational telemetry, data contract monitoring, delayed labels, retrain proposal | Drift or quality finding links back to deployed model and can initiate governed retraining |
| **M8 — Enterprise hardening** | OIDC/SSO, granular authz, quotas, backup/restore, scaling adapter, security audit | Multi-user/multi-tenant and failure-recovery acceptance suites pass |

**Core acceptance gate (end of M4):** import data, inspect profiles, edit and execute the canonical graph, preview and apply methodology decisions, inspect evidence/results, compare experiments, and reopen saved work using local persistence. This must work without external auth, cloud storage or managed platform services.

**Platform sequencing:** after this gate, add external integrations as needed by M5–M8. Implement authentication and tenant enforcement before enabling shared or hosted multi-user operation, rather than making them blockers for local workbench development. Local execution boundaries and secret handling remain appropriate to the actual runtime; enterprise isolation is not claimed until implemented and tested.

## 21.1 M0 integration deliverable

Create `architecture-integration-map.md` with rows: *existing source path → service/module → actual contract → reuse/extend/new → gap → owner → tests*. Locate actual repository sources for: graph, universal nodes, compiler, worker attempts, event loop/outbox, Python execution protocol, Gate B, artifact store, permissions, model packaging and UI docks. Document any mismatch as an explicit ADR amendment before implementation.

The initial reconciliation is recorded in [`architecture-integration-map.md`](architecture-integration-map.md). It identifies a blocking product gap: Gate B checks exist, but question persistence, decision proposals/effects and the decision-to-check link do not. These foundations precede methodology UI.

## 21.2 First vertical slice

`Upload dataset -> scoped profiling -> missingness finding -> median alternative -> graph diff -> approved Apply -> fold-local fit -> evidence/check -> result`.

Then add a second slice that proves enterprise continuity:

`Selected trial -> package including fitted preprocessing -> ModelVersion -> release approval -> batch inference -> evidence and output artifact`.

These two slices prove the contract chain from scientific decision to deployable model rather than stopping at a metrics table.

# 22. Mandatory acceptance scenarios

These scenarios apply at their delivery stage. Scientific and experiment checks validate the core; deployment, monitoring and enterprise checks gate those capabilities when introduced. External-platform checks do not block the local M0–M4 workbench.

| ID | Scenario | Required outcome |
|---|---|---|
| SCI-01 | Holdout values changed | Training-fitted median unchanged |
| SCI-02 | Independent folds fitted | State is fold-local; scope evidence differs appropriately |
| SCI-03 | Unseen nominal category at inference | Declared unknown policy, stable resolved schema |
| SCI-04 | Fit requests holdout labels | Denied and auditable in certified path |
| SCI-05 | Semantic role unknown for ordinal encoder | `NEEDS_FACT` and no silent ranking |
| SCI-06 | Target/graph revised during proposal preview | Atomic Apply fails as stale |
| SCI-07 | Retry same Apply key | Exactly one new version; changed payload conflicts |
| SCI-08 | Opaque upstream Python step | Downstream pipeline cannot claim complete scope certification |
| SCI-09 | Final holdout repeatedly scored | Access logged, limitation visible; no invisible retuning |
| SCI-10 | Two candidate protocols differ | No misleading global rank as if directly comparable |
| DATA-01 | New source violates expected column type | Contract finding with policy-appropriate block/warn |
| DATA-02 | Event time before, availability after prediction time | Feature excluded in production-faithful backtest |
| DATA-03 | Feature definition changes | Only affected lineage/trials stale; deployed digest pinned |
| EXP-01 | Study budget reached / worker fails | Durable attempts, cancellation and partial evidence retained |
| EXP-02 | Model metrics disagree with business constraints | Selection decision evaluates guardrails explicitly |
| DEP-01 | Package lacks fitted scaler/encoder | Release validation fails |
| DEP-02 | Unsupported canary target requested | Explicit failure, never silently a full rollout |
| DEP-03 | Stale release/alias revision | Compare-and-swap prevents overwriting current production |
| DEP-04 | New model health check fails | Healthy prior deployment preserved or rollback initiated |
| DEP-05 | Batch/online same feature input | Compatibility test validates preprocessing and feature order |
| MON-01 | Input drift without labels | Drift finding; no unsupported assertion of accuracy decline |
| MON-02 | Delayed labels become available | Windowed quality estimates record arrival/version |
| MON-03 | Retraining triggered | New governed study; no automatic unauthorized production release |
| ENT-01 | Cross-tenant object/worker attempt access | Denied at multiple boundaries |
| ENT-02 | Unauthorized user requests prod release | Denied with audit record |
| ENT-03 | Worker crashes after successful artifact upload | Reconcile idempotently without phantom success/duplicate result |
| ENT-04 | Restored system from backup | Metadata/artifact referential integrity validated |
| ENT-05 | External tools unavailable | Degraded capability surfaced; core investigations work where dependencies permit |

# Appendix A — Example linked contracts

The schemas are **illustrative** and not asserted to be implemented. M0 must select a source-of-truth schema/code generation path for Rust, Python and TypeScript so serialization is not hand-maintained in three languages.

## A.1 Investigation and feature availability

```json
{
  "investigation_id": "inv-churn",
  "revision": 3,
  "organization_id": "org-example",
  "objective": "classification",
  "dataset_ref": "dataset:customers@8",
  "target_feature_ref": "feature:churn_30d@2",
  "entity_feature_ref": "feature:customer_id@1",
  "prediction_time_ref": "feature:as_of@1",
  "horizon": "P30D",
  "evaluation_objectives": ["average_precision", "recall_at_contact_budget"],
  "facts": [{"name": "entity_is_repeated", "value": true,
             "origin": "OBSERVED", "confirmed": false}],
  "availability_contract_ref": "feature_set:customer_snapshot@2"
}
```

## A.2 Method capability manifest

```yaml
id: sprisk.preprocess.one_hot
version: 1.0.0
adapter_ref: python.sklearn.OneHotEncoder@pinned
kind: feature_fitted
inputs:
  features:
    semantic: [nominal]
    role: feature
learning:
  data_reads: [features]
  fit_scope: cv_train_fold
  learned_state: category_vocabulary
output:
  family: dynamic_numeric_features
  representation: [sparse, dense]
  schema_binding: resolved_after_fit
unknown_categories: explicit_policy
verification:
  required: [fit_scope_integrity, stable_feature_schema]
```

## A.3 Scoped evidence envelope

```json
{
  "evidence_id": "evidence:fit-vocab-948",
  "producer": {"node": "node:encoder-4", "adapter_digest": "sha256:..."},
  "tenant_id": "org-example",
  "dataset_ref": "dataset:customers@8",
  "split_manifest_ref": "split:temporal@7",
  "partition": "cv_train_fold",
  "fold_id": "fold-02",
  "row_membership_digest": "sha256:...",
  "purpose": "fit",
  "roles": ["features"],
  "output_schema_ref": "schema:encoded@948",
  "artifact_digest": "sha256:...",
  "trust_class": "CERTIFIED_ADAPTER",
  "check_refs": ["check:fit_integrity@948"]
}
```

## A.4 Trial and deployment identity

```json
{
  "study_ref": "study:churn-benchmark@4",
  "trial_id": "trial:017",
  "trial_spec_digest": "sha256:...",
  "attempt_refs": ["attempt:122", "attempt:123"],
  "selected_result_ref": "trial-result:017@2",
  "registered_model": "model:churn",
  "model_version": "model:churn/v4",
  "package_digest": "sha256:...",
  "deployment_ref": "deployment:churn-prod@8"
}
```

# Appendix B — Worked lifecycle: from method decision to production

**Illustrative scenario:** a company predicts customer churn within 30 days. A customer snapshot table has missing `support_calls`, nominal `contract_type`, repeated customer IDs and timestamps. These are example values, not observed customer data.

1. **Context:** user selects classification, defines target, horizon and unit (`customer_month`). A profiler *observes* repeated IDs; the user confirms the entity and prediction semantics.
2. **Data design:** a split manifest respects the declared temporal or entity-generalization objective. Point-in-time availability is checked for features such as failed payments; unknown availability remains a flagged limitation.
3. **Preparation decision:** missing `support_calls` causes `preparation.missingness` to offer median, constant, missingness indicator and exclusion. The user chooses median as a candidate—not as proven optimum.
4. **Graph proposal:** `SimpleImputer(median)` is inserted inside the training/evaluation composite. One-hot is separately selected for `contract_type`. Preview shows planned dynamic schema and resource estimates.
5. **Apply and run:** after revision check and authorization, Sprisk compiles the graph. Fold-local workers learn medians and category vocabularies only on authorized train folds, record states and score validation predictions.
6. **Compare:** baseline and logistic regression produce comparable per-fold metrics and constraints. A bounded experiment uses validation outcomes to select a pipeline. Final-holdout evaluation is a separate authorized step.
7. **Package:** the approved model package includes `SimpleImputer`, `OneHotEncoder`, feature order, model, library lock, input/output schema and evidence digest. A bare logistic regression coefficient file is insufficient.
8. **Register:** model version binds package to trial/selection, training dataset, ruleset and assessments. ReleaseCandidate targets `staging`, not arbitrary production.
9. **Deploy:** smoke and compatibility checks run against staging. An approver authorizes production rollout with a declared strategy and limits. Deployment controller monitors actual state and can roll back.
10. **Operate:** telemetry detects increased unseen-contract categories. Sprisk records input shift; it **does not infer worse accuracy** until appropriate outcomes arrive. When delayed churn labels appear, a quality window is evaluated; a governed retraining study may be proposed.

**Traceability invariant:** clicking a production alert can navigate back to the deployed package, model version, selected trial, graph version, fitted-state artifact, source dataset/feature definitions, evidence and original scientific decision.

# Appendix C — Rust contract sketch

```rust
// Illustrative shapes, NOT verified repo API or implementation.
struct InvestigationRef { id: InvestigationId, revision: u64 }
struct ScopeRef { dataset: DatasetRef, split: SplitRef,
                  fold: Option<FoldId>, membership: Digest,
                  purpose: DataPurpose, roles: RoleSet }
struct MethodRef { id: MethodId, version: Version, adapter_digest: Digest }
struct TrialSpec { study: StudyRef, plan_digest: Digest,
                   protocol: EvaluationProtocolRef, seed: Option<u64> }
struct ModelVersion { model: ModelId, version: u64,
                      package_digest: Digest, origin_trial: TrialRef }
struct DeploymentIntent { model: ModelVersionRef, environment: EnvironmentRef,
                          target: ServingTargetRef, rollout: RolloutStrategy,
                          expected_revision: u64 }
enum Assessment { Pass, Warn, Fail, Inconclusive, NotRun }
```

# Appendix D — Decisions, open questions and source references

## D.1 Locked product/architecture decisions

- Sprisk targets **enterprise** full-lifecycle data science and AI/ML, including deployment and operation.
- One canonical typed graph, one Sprisk workflow identity/worker-attempt lifecycle; pluggable execution/serving backends.
- Rust control-plane ownership; Python scientific compute; TypeScript unified workbench.
- Reusable scientific semantics, explicit method capabilities, scopes and honest assurance coverage.
- Immutable experimental artifacts, governed registry/release/deployment/monitoring identities.
- Declarative scientific metadata may select trusted adapters; it is not unrestricted executable policy code.
- LLM planning is optional and must satisfy the same graph approvals, policy gates and evidence checks.

## D.2 Decisions by delivery stage

M0–M4 resolve repository contracts, local execution and local persistence. Provider selection and enterprise integration decisions below are deferred until after the core acceptance gate.

- Actual repository structure, type naming and cross-language contracts.
- Existing scheduler/queue durability, Gate B semantics, data sandbox and evidence completeness.
- Core: persisted local model/artifact formats. Later: package-signing keys and external object store capabilities.
- Core: existing local DB and worker transport. Later: OIDC provider, secrets service, managed DB, remote transport and first serving target.
- Whether deployment uses a built-in container adapter first or an existing platform deployment integration.
- Customer deployment patterns: hosted multi-tenant, on-prem/private VPC, air-gapped and region rules.
- Data connector strategy for SQL/object/warehouse/event sources; minimal scope and credential propagation.
- Quantitative per-tier SLOs and model service pricing/budget requirements.

## D.3 Primary references (industrial and platform documentation)

1. [Applied ML production case-study index](https://github.com/eugeneyan/applied-ml), Eugene Yan. Curated collection; not an executable framework.
2. [Data Validation for Machine Learning](https://research.google/pubs/data-validation-for-machine-learning/), Google, 2019. Data quality and training-serving skew.
3. [Functions & DAGs: Hamilton](https://multithreaded.stitchfix.com/blog/2021/10/14/functions-dags-hamilton/), Stitch Fix, 2021. Explicit feature dependencies.
4. [Introducing Fabricator](https://careersatdoordash.com/blog/introducing-fabricator-a-declarative-feature-engineering-framework/), DoorDash, 2022. Declarative feature generation and serving lifecycle.
5. [Typed AI Features](https://www.linkedin.com/blog/engineering/feed/feed-typed-ai-features), LinkedIn, 2020. Feature type/metadata shared across systems.
6. [Metaflow Technical Overview](https://docs.metaflow.org/internals/technical-overview), Netflix/Metaflow. Immutable code/data/dependency snapshots and execution metadata.
7. [MLflow Model Registry](https://www.mlflow.org/docs/latest/registry/), MLflow. Model versions, lineage, aliases and governance.
8. [Ray Train overview](https://docs.ray.io/en/latest/train/train.html), Ray. Distributed compute as backend capability.
9. [scikit-learn Common Pitfalls](https://scikit-learn.org/stable/common_pitfalls.html). Leakage-safe pipelines and evaluation.
10. [scikit-learn Pipelines](https://scikit-learn.org/stable/modules/compose.html). Fit/transform composition and CV.
11. [Netflix historical feature/time-travel references](https://github.com/eugeneyan/applied-ml#feature-stores), as indexed in Applied ML. Point-in-time feature availability.
12. [LinkedIn DARWIN](https://engineering.linkedin.com/blog/2022/darwin--data-science-and-artificial-intelligence-workbench-at-li), LinkedIn, 2022. Integrated workbench design.

**Evidence vs proposal:** Sections citing industrial sources identify patterns reported by those sources; contracts, boundaries, scope, milestones, and technology selections are **Sprisk design recommendations**, not claims of existing product capability or of a particular company's implementation.
