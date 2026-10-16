
# sprisk Node Framework
**Architecture & Infrastructure Specification — V1**

**Status:** Proposed architecture  
**Primary languages:** Rust, Python, TypeScript  
**Design philosophy:** Open, composable, code-compatible, progressively typed, and execution-independent.

---

## 1. Fundamental design

sprisk's Node Framework is a universal computational system that allows existing code, functions, programs, and complete workflows to participate in a common execution graph.

The framework must not impose a programming style on users.

An ordinary Python cell, a callable function, a compiled executable, and a graph of interconnected operations should all be usable through the same conceptual node interface.

### Core principle

**Standardize the boundary of computation, not the computation itself.**

This produces three major architectural components:

1. **Node Model:** Describes what an operation is, what it accepts, what it produces, and how it is configured.
2. **Execution Framework:** Manages how operations are executed, monitored, isolated, and connected.
3. **Node Ecosystem:** Provides reusable operations, execution adapters, introspection, artifact handling, and extensibility.

The visual node is simply one representation of this computational model.

---

## 2. Fundamental object model

The framework must distinguish between six objects.

| Object | Responsibility |
|---|---|
| Node Definition | Reusable computational capability |
| Node Instance | Placement and configuration within a graph |
| Graph Definition | Connected computational structure |
| Node Execution | One invocation of a node |
| Graph Execution | One execution of a graph |
| Artifact | Persistent computational result |

A node definition describes an operation independently of any particular execution.

A node instance references the definition and supplies configuration.

An execution records what actually happened.

### Important distinction

Not every exploratory code cell needs a separately published, reusable node definition.

An ordinary code cell can begin as an inline node instance with an embedded implementation.

Only when it becomes reusable does sprisk need to publish it as a versioned operation in the node registry.

This avoids unnecessary registry entries and metadata management during exploration.

---

## 3. Node implementation model

A node is either a **leaf computation** or a **composite computation**.

### Leaf implementations

| Implementation | Execution mechanism |
|---|---|
| Python Cell | Execute ordinary Python statements |
| Python Callable | Invoke an imported function or method |
| Python Script | Execute a Python program |
| Native Process | Launch an executable |
| Container | Execute an isolated container workload |
| SQL Query | Execute against a supported query engine |
| Service Operation | Invoke an API or external service |
| Built-in Operation | Execute an operation supplied by sprisk |

### Composite implementations

A composite references another graph.

It exposes a selected portion of that graph's interface as its own inputs, parameters, and outputs.

This makes graphs recursively composable.

### Common representation

Conceptually:

```typescript
type NodeImplementation =
  | {
      kind: "python.cell";
      source: string;
    }
  | {
      kind: "python.callable";
      module: string;
      callable: string;
    }
  | {
      kind: "process";
      executable: string;
      arguments: string[];
    }
  | {
      kind: "container";
      image: string;
      command: string[];
    }
  | {
      kind: "graph";
      graphRef: string;
    };
```

This is an illustrative subset. Additional implementations, including SQL and service operations, extend the same union.

The execution engine selects an appropriate adapter based on the implementation kind.

**No universal function signature is imposed on user code.**

---

# 4. Universal node contract

Every node has a normalized internal contract.

The contract describes its capabilities without requiring the underlying implementation to understand sprisk.

### Contract dimensions

| Dimension | Contents |
|---|---|
| Identity | ID, implementation reference, version |
| Inputs | Named typed ports and bindings |
| Parameters | Configurable values and constraints |
| Outputs | Published computational results |
| Execution | Runtime, environment, resource policy |
| Results | Rich displays, metrics, logs, errors |
| Capabilities | Supported execution features |
| Provenance | Source, environment, artifacts, history |

These dimensions should not necessarily be stored in one large database record.

The contract is a logical model whose parts can be persisted independently.

### Example normalized instance

```json
{
  "id": "node_17",
  "implementation": {
    "kind": "python.cell",
    "source": "cleaned = df.dropna()"
  },
  "execution": {
    "mode": "session",
    "environment": "python-default"
  },
  "interface": {
    "inputs": [
      {
        "name": "df",
        "type": "table",
        "binding": "python.symbol"
      }
    ],
    "outputs": [
      {
        "name": "cleaned",
        "type": "table",
        "binding": "python.symbol"
      }
    ]
  }
}
```

The user should never need to author this JSON.

sprisk generates and maintains it through its interface-discovery and binding systems.

### Schema policy

Use JSON Schema for serializable contract structures and parameter validation.

Use sprisk-specific semantic types for computational objects that cannot be adequately represented by ordinary JSON Schema.

The contract must be independently understandable by Rust, Python, and TypeScript.

---

# 5. Code compatibility and interface discovery

The framework should accept normal Python without requiring decorators, imports, or manually specified schemas.

Example:

```python
import pandas as pd

df = pd.read_csv("sales.csv")

threshold = 0.15

cleaned = df[
    df["missing_ratio"] < threshold
]

print(cleaned.shape)

display(cleaned.head())
```

The discovery system analyzes code and proposes a node interface.

### 5.1 Discovery sources

**Static analysis**

Inspects code without executing it.

Can identify:

- Variable definitions
- Referenced variables
- Function parameters
- Default values
- Type annotations
- Imported modules
- Some function calls
- Candidate dependencies

**Runtime observation**

Inspects actual execution behavior.

Can identify:

- Observed Python types
- DataFrame schemas
- Generated values
- Display results
- Runtime errors
- Execution duration
- Explicitly instrumented file interactions

**User declaration**

Allows users to confirm, correct, or override the discovered interface.

### 5.2 Interface confidence

Every automatically discovered property should retain its origin.

```typescript
type PropertyOrigin =
  | "inferred"
  | "observed"
  | "declared";
```

sprisk must distinguish between:

- A variable that exists.
- A variable used as an input.
- A parameter that meaningfully controls execution.
- An output suitable for consumption by another node.

These are not equivalent.

### 5.3 Discovery limitations

Arbitrary Python is dynamic.

Static analysis cannot reliably determine every dependency, particularly when code uses mutation, dynamic attribute access, reflection, `exec()`, or external state.

Therefore, discovery produces suggestions and progressively stronger contracts.

It must never silently claim that arbitrary code is fully understood.

---

# 6. Parameter and control framework

A parameter is a named, typed value connected to a specific location in an operation.

The control system should be independent of the implementation language.

### Example

```python
n_estimators = 100
max_depth = 8

model = RandomForestClassifier(
    n_estimators=n_estimators,
    max_depth=max_depth
)
```

sprisk identifies possible controls.

The user can expose `n_estimators` and `max_depth`.

The resulting interface might be:

```text
PARAMETERS

n_estimators
  Type: integer
  Default: 100

max_depth
  Type: integer
  Default: 8
```

The frontend uses the parameter schema to generate suitable controls.

### 6.1 Binding strategies

Different implementations require different binding mechanisms.

| Implementation | Binding |
|---|---|
| Python function | Function arguments |
| Python cell | Selected expressions or assignments |
| Python script | CLI arguments, configuration files |
| Native executable | Arguments, environment variables, files |
| SQL | Query parameters |
| Composite node | Internal parameter forwarding |

For Python cells, sprisk should avoid unreliable global variable injection.

For example:

```python
threshold = 0.15
```

Injecting `threshold = 0.25` before execution is ineffective because the cell immediately overwrites it.

Instead, sprisk can associate a parameter with the appropriate source expression.

For supported constructs, it may compile a temporary parameterized version using AST transformations.

The user's original code remains unchanged.

Any transformed execution must retain source correspondence and the exact effective parameter values.

Complex or ambiguous transformations require explicit binding.

### 6.2 Parameter schema

A parameter definition should support:

- Name and description
- Type
- Default value
- Constraints
- Allowed values
- Binding target
- Validation rules
- Visibility
- Execution behavior

Presentation hints such as slider, dropdown, or numeric input remain optional.

**UI controls are generated from parameter definitions; they are not the parameters themselves.**

### 6.3 Execution reactions

A parameter change invalidates affected downstream results.

It does not necessarily execute them immediately.

Supported policies should include:

- Manual
- Reactive
- Debounced
- Scheduled

Expensive or side-effecting operations should default to explicit execution.

---

# 7. Unified output and result framework

The framework must distinguish between **computational outputs** and **execution results**.

### Computational outputs

Values intended for downstream computation.

Examples:

- DataFrame
- Array
- Model
- Dataset
- Structured report
- File artifact

### Execution results

Information emitted during execution.

Examples:

- `print()`
- `display()`
- Matplotlib figures
- Plotly visualizations
- HTML
- Tables
- Warnings
- Errors
- Progress updates
- Performance metrics

A node can emit an arbitrary sequence of results without making each result a graph port.

### 7.1 Standard result event model

```typescript
type ResultEvent =
  | {
      type: "stream";
      channel: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "display";
      displayId: string;
      mime: Record<string, unknown>;
    }
  | {
      type: "display.update";
      displayId: string;
      mime: Record<string, unknown>;
    }
  | {
      type: "metric";
      name: string;
      value: number;
    }
  | {
      type: "error";
      message: string;
    };
```

These events are carried in a separate envelope containing execution ID, node ID, timestamp, and sequence number.

### 7.2 Python display capture

The Python kernel adapter should reuse Jupyter-compatible messaging.

This supports:

- Standard output
- Rich display data
- Expression results
- Display updates
- Errors
- MIME-based representations

Normal Python statements remain unchanged.

### 7.3 Integration with existing sprisk visualizations

The Node Framework should not implement a competing visualization engine.

Instead, it publishes typed result objects to sprisk's existing visualization subsystem.

One execution can produce multiple figures, datasets, and reports.

The presentation layer can arrange them:

- Inline beneath code
- In an adaptive grid
- Beside an expanded node
- Inside existing dockable panels
- In an experiment comparison view

All presentations reference the same underlying results.

No recomputation is necessary when switching layouts.

### 7.4 Result persistence

Large outputs should be stored as artifacts.

Small results can be included directly in execution events.

Each result must retain its originating node and execution.

A displayed plot may be promoted to a published artifact when needed.

---

# 8. Execution architecture

The node contract and execution engine must remain separate.

A universal execution interface routes operations to runtime-specific adapters.

```text
                   GRAPH EXECUTOR
                         │
                         ▼
                  NODE SCHEDULER
                         │
                         ▼
                 EXECUTION MANAGER
                         │
           ┌─────────────┼──────────────┐
           │             │              │
           ▼             ▼              ▼
      Python Runner  Process Runner  Container Runner
           │             │              │
           ▼             ▼              ▼
      Kernel/Code      Binary          Workload
           │             │              │
           └─────────────┼──────────────┘
                         ▼
                  RESULT COLLECTOR
                         │
                         ▼
                   ARTIFACT STORE
```

### 8.1 Execution responsibilities

The Rust execution manager handles:

- Dependency resolution
- Scheduling
- Execution state
- Cancellation
- Resource allocation
- Timeouts
- Retry policy
- Failure propagation
- Result registration
- Provenance

Execution adapters handle runtime-specific behavior.

### 8.2 Adapter interface

Conceptually:

```typescript
interface ExecutionAdapter {
  prepare(request: ExecutionRequest): Promise<void>;

  execute(
    request: ExecutionRequest
  ): AsyncIterable<ExecutionEvent>;

  cancel(executionId: string): Promise<void>;

  cleanup(executionId: string): Promise<void>;
}
```

The actual interprocess protocol should be transport-independent.

A local Python runner does not need to implement this interface in TypeScript. It only needs to satisfy the equivalent runtime protocol.

### 8.3 Execution modes

**Session execution**

- Persistent Python kernel
- Shared in-memory state
- Sequential execution where required
- Notebook-style interaction
- Limited independent caching

**Isolated execution**

- Explicit inputs and outputs
- Independent execution environment
- Stronger reproducibility
- Parallel execution where dependencies permit
- Artifact-based communication

These are execution policies, not fundamentally different visual node types.

### 8.4 State and lifecycle

The execution manager should model:

```text
Created
   │
   ▼
Queued
   │
   ▼
Preparing
   │
   ▼
Running
   │
   ├── Completed
   ├── Failed
   ├── Cancelled
   └── Timed Out
```

A separate `stale` state belongs to the node's result validity, not its active execution lifecycle.

Retries must respect side effects.

A process that modifies a database cannot automatically be treated like a pure mathematical function.

---

# 9. Graph execution and composition

The computational graph is a first-class reusable object.

### 9.1 Graph structure

A graph defines:

- Node instances
- Data connections
- Dependency relationships
- Execution policies
- Exposed interfaces
- Nested graph references

Ordinary data dependencies should form an acyclic execution graph.

Iteration and feedback require explicit control structures rather than unrestricted cyclic edges.

### 9.2 Visual group versus composite node

**Visual Group**

Organizes nodes spatially.

Does not change execution.

**Composite Node**

References an executable graph with a defined public interface.

Example:

```text
                 DATA PREPARATION
    ┌────────────────────────────────┐
    │                                │
    │  Profile                       │
    │     │                          │
    │     ▼                          │
    │  Imputation                    │
    │     │                          │
    │     ▼                          │
    │  Encoding                      │
    │     │                          │
    │     ▼                          │
    │  Validation                    │
    │                                │
    └────────────────────────────────┘
```

At the parent level:

```text
Dataset
   │
   ▼
[ Data Preparation ]
   │
   ├── Prepared Dataset
   └── Quality Report
```

### 9.3 Composite interface

A composite exposes selected:

- Inputs
- Outputs
- Parameters
- Result collections
- Execution settings

Internal implementation details remain encapsulated.

One composite parameter can bind to several internal node parameters, provided their contracts are compatible.

### 9.4 Nested execution

The graph executor should execute composites through the same scheduling model as ordinary graphs.

A composite execution maintains:

- Parent execution ID
- Internal graph execution ID
- Child node execution records
- Published outputs
- Aggregated diagnostics

Users must be able to inspect the internal execution history.

### 9.5 Reusability and versioning

Published composites require versioned definitions.

Existing workflows should reference pinned versions unless the user explicitly upgrades.

Recursive graph references must be rejected.

An exploratory group that depends on hidden kernel state may be collapsed visually, but it should not be marked independently reusable until those dependencies are properly represented.

---

# 10. Data interfaces and artifacts

Computational outputs should not be restricted to JSON.

Data science workloads involve potentially enormous arrays, tables, models, and binary objects.

The framework needs a common artifact abstraction.

### 10.1 Artifact categories

| Category | Preferred representation |
|---|---|
| Scalar | JSON-compatible value |
| Configuration | JSON |
| Tabular data | Arrow / Parquet |
| Arrays | NumPy-compatible or specialized array formats |
| Model | Registered model format or managed runtime object |
| Image | PNG, SVG, or compatible format |
| Figure | MIME representation or supported structured specification |
| Binary | File artifact |
| Report | Structured document artifact |

The artifact interface should be extensible.

### 10.2 Data transfer

**Within one Python kernel**

Objects may remain in memory and be referenced directly.

**Across execution boundaries**

Values must be materialized using an appropriate serializer or shared transport.

For tables, Apache Arrow provides a strong cross-language foundation.

For general Python objects, serialization should be type-specific.

Arbitrary Python pickle loading must not be treated as a safe universal interchange mechanism.

### 10.3 Artifact metadata

Every persistent artifact should carry:

- Artifact ID
- Media or semantic type
- Storage reference
- Size
- Content hash
- Producing execution
- Source lineage
- Serializer information

Large data must not be embedded in the graph definition.

---

# 11. Node Framework extension ecosystem

This is the part I would design carefully to avoid creating a closed proprietary system.

sprisk should support extensions at several independent levels.

| Extension | Purpose | Example |
|---|---|---|
| Execution Adapter | Execute another runtime | R, Julia, external binaries |
| Operation Provider | Supply reusable operations | scikit-learn algorithms |
| Introspection Provider | Discover interfaces | Python AST analyzer |
| Artifact Codec | Serialize computational objects | Arrow, model serializer |
| Result Renderer | Display supported results | Plotly, specialized charts |
| Environment Provider | Resolve execution environments | Python virtual environments |
| Composite Library | Publish reusable workflows | Feature engineering pipeline |
| Planning Integration | Expose capabilities to AI | AI-generated workflows |

Extensions should implement narrow, versioned interfaces.

They should not depend on internal workbench components.

### 11.1 Three levels of node authorship

**Level 1 — Ordinary code**

Users write Python or import existing programs.

No sprisk SDK required.

**Level 2 — Reusable operation**

Users confirm inputs, outputs, and controls, then publish a node.

sprisk generates the required metadata.

**Level 3 — Native extension**

Developers use an optional sprisk SDK to provide rich descriptions, custom serializers, sophisticated controls, or additional execution capabilities.

This level is for extension authors—not ordinary notebook users.

### 11.2 Node registry

The registry stores reusable definitions.

It should support:

- Capability discovery
- Semantic search
- Input/output compatibility
- Implementation versioning
- Runtime requirements
- Dependency metadata
- Source and trust information
- Documentation
- Examples

The registry must distinguish installed executable capabilities from remotely advertised or untrusted definitions.

A catalog entry does not automatically grant permission to execute arbitrary code.

### 11.3 AI interoperability

The AI planner should consume the same registry and contracts as the human-facing workbench.

It can:

- Discover available operations
- Generate ordinary code nodes
- Propose parameter values
- Compose workflows
- Validate candidate connections
- Interpret execution results
- Suggest revisions

AI is not a special execution runtime.

AI-generated code executes through the normal framework, with the same permission and resource controls.

---

# 12. Infrastructure boundaries

I recommend dividing the implementation into a small set of independently testable subsystems.

```text
sprisk/
│
├── contracts/
│   ├── node
│   ├── graph
│   ├── execution
│   ├── parameter
│   ├── artifact
│   └── result
│
├── runtime/
│   ├── graph
│   ├── scheduler
│   ├── execution
│   ├── state
│   └── provenance
│
├── executors/
│   ├── python
│   ├── process
│   └── container
│
├── discovery/
│   ├── python
│   ├── callable
│   └── process
│
├── artifacts/
│   ├── storage
│   ├── serializers
│   └── metadata
│
├── registry/
│   ├── definitions
│   ├── capabilities
│   └── versions
│
└── integrations/
    ├── workbench
    ├── visualization
    └── ai
```

This is a **logical subsystem organization**, not a requirement to create a separate package or service for every directory.

For V1, several of these can live in one Rust workspace and one Python runner package.

Avoid distributed microservices until the deployment requirements justify them.

---

# 13. Recommended technology foundation

| Concern | Recommended foundation | Reason |
|---|---|---|
| Core node contracts | JSON Schema + Rust types | Language-neutral definitions |
| Graph engine | Rust | Deterministic validation and orchestration |
| Async runtime | Tokio | Rust asynchronous execution |
| Local API | Axum | Integration with the TypeScript workbench |
| Python execution | IPython / ipykernel | Notebook compatibility |
| Kernel management | jupyter_client in Python runner | Avoid rebuilding kernel management |
| Python discovery | Python AST + inspect | Interface inference |
| Process execution | Rust subprocess management | External programs |
| Tabular interchange | Apache Arrow / Parquet | Efficient interoperability |
| Local metadata | SQLite | Simple local deployment |
| Remote metadata | PostgreSQL | Multi-user deployment |
| Artifact storage | Filesystem, later S3-compatible | Separate data from metadata |
| Graph presentation | React Flow | Node and edge interactions |
| Docked results | Existing Dockview integration | Reuse the workbench layout |
| Code editor | Monaco | Mature code-editing infrastructure |
| Rich Python results | Jupyter MIME messaging | Existing output protocol |

### Important implementation decisions

**Do not build a new Python interpreter.**

Use the existing Python runtime.

**Do not implement the complete Jupyter protocol directly in Rust for V1.**

Use a Python runner that manages kernels and translates their messages into sprisk's execution protocol.

**Do not embed a second workflow orchestrator without a demonstrated requirement.**

The initial Rust executor only needs a well-defined local scheduler and execution state machine.

**Do not make the frontend responsible for computational semantics.**

React Flow controls presentation and interaction. The actual graph belongs to sprisk's framework.

**Do not couple the node model to a particular cloud platform.**

Local execution is a first-class deployment mode.

---

# 14. Execution security and reproducibility

Running arbitrary code is fundamentally different from invoking a predefined analytical operation.

The framework must acknowledge that distinction.

### Execution isolation

For local trusted development, users may explicitly permit execution with local permissions.

For remote or multi-user deployments, executable workloads require appropriate process or container isolation.

Resource policies should cover:

- CPU
- Memory
- Execution time
- Filesystem access
- Network access
- Environment variables
- Secrets
- GPU access

A Python kernel is not a security sandbox.

### Reproducibility

Execution records should retain:

- Code or implementation revision
- Input artifact identities
- Effective parameters
- Runtime environment
- Dependency versions
- Random seed where controlled
- Generated artifacts
- Logs and errors

Caching is enabled only when dependencies are sufficiently understood and the execution policy permits it.

A declared deterministic node is not automatically safe to cache if it depends on mutable files, external services, time, or other untracked state.

---

# 15. Node interaction and presentation contract

Although sprisk already owns the workbench UI, the Node Framework must expose enough presentation information to support consistent interactions.

A node should support these conceptual presentation states:

**Compact**

Shows identity, status, essential ports, and result indicators.

**Expanded**

Exposes code or configuration, controls, and selected results.

**Inspection**

Provides detailed properties, interfaces, execution history, and diagnostics through the existing inspector.

**Composite**

Can be opened to inspect or edit its internal graph.

### Results

Multiple outputs should be displayed naturally.

The framework supplies a result collection, while sprisk's existing visualization system determines the layout.

Default behavior:

- Small textual results: inline.
- Multiple figures: compact preview gallery with expandable grid.
- Tables: preview with full data inspection.
- Errors: inline status with detailed diagnostics.
- Large analytical results: expandable or dockable.

The node should not become an enormous canvas element because it produced many plots.

Result presentation preferences are stored separately from computational definitions.

**Presentation changes must not change execution semantics.**

---

# 16. V1 implementation boundaries

The first implementation should deliberately exclude several advanced capabilities.

### Required for V1

| Capability | Priority |
|---|---|
| Universal node contract | Essential |
| Python cell execution | Essential |
| Function execution | Essential |
| Native command execution | Essential |
| Automatic interface suggestions | Essential |
| Manual input/output confirmation | Essential |
| Parameter exposure | Essential |
| Rich display capture | Essential |
| Typed artifact references | Essential |
| Visual groups | Essential |
| Executable composites | Essential |
| Local graph scheduling | Essential |
| Execution history | Essential |

### Subsequent extensions

- Remote and distributed execution
- Container orchestration
- GPU scheduling
- Additional language kernels
- Automatic environment provisioning
- Advanced artifact caching
- Published extension marketplace
- Collaborative execution
- Cross-machine workflow deployment

The contracts should allow these capabilities without requiring their complete implementation in V1.

---

# 17. Architectural validation

Before building a large node library, the framework must prove several scenarios.

### Scenario A — Notebook compatibility

Import ordinary Python cells and execute them without modifying their code.

Capture variables, `print()`, `display()`, and plots.

### Scenario B — Automatic controls

Discover a configurable value in existing Python code.

Expose it as a parameter.

Changing the parameter must correctly affect execution without modifying the user's saved source.

### Scenario C — External program

Execute an existing command-line application.

Bind an input artifact and command arguments.

Collect its output files and logs.

### Scenario D — Composition

Combine three computational nodes into a composite.

Expose selected inputs, outputs, and parameters.

Execute it as one operation while retaining internal execution history.

### Scenario E — Reuse

Publish the composite as a reusable operation.

Instantiate it in a different workflow with different parameters.

### Scenario F — Multiple visual results

Execute a node that produces a table and multiple figures.

Display those results inline or as a grid using the existing visualization subsystem.

No additional graph nodes should be required merely to render them.

### Scenario G — Reproducibility

Promote an exploratory operation into isolated execution.

Demonstrate that its inputs, environment, parameters, outputs, and history are traceable.

### Scenario H — Failure handling

Cancel a running operation, inspect the failure, and retry safely.

Preserve completed artifacts where applicable without falsely reporting partial execution as successful.

---

# 18. Final architecture decisions

The following decisions form the proposed Node Framework V1 foundation.

| Decision | Direction |
|---|---|
| Fundamental abstraction | Executable graph |
| Node representation | Leaf operation or composite graph |
| User programming style | Unrestricted ordinary code |
| Wrapper strategy | Internal execution adapters |
| Node interface | Progressive typed contracts |
| Parameter exposure | Explicit bindings with automated suggestions |
| Output model | Computational artifacts + display events |
| Visualization | Existing unified sprisk visualization system |
| Python runtime | Notebook-compatible kernel |
| Orchestration | Rust |
| Data interchange | Typed artifact references |
| Extension model | Providers, adapters, codecs, renderers |
| Reusability | Versioned node and graph definitions |
| AI integration | Shared node registry and execution contract |
| Initial deployment | Local-first |
| Advanced execution | Opt-in isolated and distributed modes |

## Architectural conclusion

sprisk's Node Framework should not become a Python wrapper library, a collection of predefined operators, or a conventional visual programming engine.

It should provide a **standard computational interface over heterogeneous operations**.

A node can contain ordinary code, a function, an executable, or another graph.

The system automatically discovers what it can, observes what actually happens, and lets users explicitly define the remaining interface.

The execution engine coordinates operations independently of their programming language.

The artifact and result systems make computational outputs, displays, and provenance available throughout the workbench.

The extension ecosystem allows third-party functionality without requiring changes to the core engine.

**The governing design rule is simple:**

> Any computation can begin as a node. Structure and metadata are progressively added to make that computation reusable, composable, inspectable, and reproducible—without forcing users to rewrite their code.