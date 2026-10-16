# ADR-0021: Adopt the Node Framework V1 on top of the existing engine

Status: Accepted
Date: 2026-10-16
Spec: docs/architecture/node-framework.md
Arch doc sections: §4, §5, §9, §11, §15
Related: ADR-0017, ADR-0019, ADR-0020

## Context

The Node Framework spec describes a universal node model: ordinary code, functions,
programs and graphs behind one boundary, with interfaces discovered progressively.
Most of its object model already exists in sprisk under other names. The rest must
be added without forking concepts or breaking the hard rules.

## Decision

1. **One name per concept.** Code and contracts keep the arch doc §4 names. The
   spec's names are used in docs and UI text only.

   | Spec | sprisk |
   | --- | --- |
   | Node Definition | `Operator` |
   | Node Instance | node in a `PipelineVersion` |
   | Graph Definition | `PipelineVersion` |
   | Node Execution | `Attempt` |
   | Graph Execution | `Run` |
   | Artifact | `Artifact` |

2. **Inline code stays an operator with its source as a param** (`sprisk.code.python`).
   This is the spec's "inline node instance with an embedded implementation" without a
   new field on every node. A general `implementation` union is added with the
   external-program node (Scenario C), under its own ADR.

3. **Property origins reuse the contract enum**: spec `inferred` = `inferred`,
   `observed` = `measured`, `declared` = `confirmed`.

4. **Discovery runs in Python, in the worker** (rule 2). A code step's run emits a
   `CodeInterface` artifact: inputs read, candidate parameters, output candidates, and
   the effective parameter values. Discovery suggests; it never claims to understand
   arbitrary code.

5. **Parameters bind to source by AST rewrite.** An exposed parameter is a top-level
   assignment of a literal. Its value lives in the node's params; the worker compiles a
   rewritten copy. The saved source never changes. Anything else needs explicit binding.

6. **Order of work** follows the spec's validation scenarios: B (discovery and
   controls), A+F (display, many results), H (cancel), C (external program, ADR),
   D+E (composites, ADR: compiler change), visual groups, then session mode (ADR).

## Consequences

- Good: no second object model; every existing run, cache and UI keeps working.
- Good: users write ordinary Python; structure is added only when they accept it.
- Cost: code steps keep fixed ports (`data`, `display`, `interface`) until composites
  and named outputs land.
- Risk: AST binding covers simple literal assignments only; ambiguous code needs the
  user to bind explicitly.
