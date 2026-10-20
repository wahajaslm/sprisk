# ADR-0043: A methodology decision can remove a step
Status: Accepted
Date: 2026-10-20
Arch doc sections: §8.3 (decision lifecycle), §10.2 (compilation). Extends ADR-0042.

## Context
- ADR-0042 gives each alternative one action: an existing operator and its params. The only graph effect is `replace_node`.
- Some alternatives mean "this step is not needed": no scaling before models that standardise themselves, keep the values instead of clipping, leave gaps for models that fill their own.
- Today those alternatives carry no effect. Applying one records the decision but leaves the step in the flow, so the flow no longer matches the decision.

## Decision
- **New graph effect `remove_node`** in `GraphEffect`: `{ kind: "remove_node", node_id }`.
- **Rewire by port name.** Each edge out of `node.P` is reconnected to whatever fed `node.P`. Edges into the node are dropped.
- **Refuse what cannot be rewired.** If an output port has consumers but no input of the same name feeds it, Apply fails with a typed error and changes nothing.
- **Same path as every effect.** The preview is compiled before the proposal is stored, and Apply builds a new `PipelineVersion` through the normal API (rule 4). History is never edited (rule 5).
- **Declared in the rule manifest.** An alternative's `action.type: remove_node` asks for it; Rust builds the effect only for an applicable alternative. A rule still cannot name an operator or step its manifest does not declare.
- The graph rewiring is a pure function in `sprisk-methodology`, tested on its own; the API calls it.

## Alternatives considered
- **Keep the no-op alternatives as they are.** Rejected: the applied flow silently disagrees with the recorded decision.
- **Replace the step with an identity operator.** Rejected: a step that does nothing clutters the flow and its provenance.
- **Let the rule return a whole new graph.** Rejected: a private mutation path around typed effects (rules 3, 4).

## Consequences (good and bad)
- Good: after Apply, the flow is what the decision says.
- Good: one more typed effect, previewed and compiled like the first.
- Bad: only steps whose outputs mirror their inputs (train/test → train/test, data → data) can be removed. Others need their own effect later.
- Bad: the UI must show a second kind of preview.

## Validation
- Applying "no scaling" to a scale step before a random forest gives a flow without the scale step, with the forest fed by the split's train rows, and it compiles.
- Removing a step whose output has no same-named input is refused, and no version is created.
- The contract round-trips a proposal with a `remove_node` effect in Rust, Python and TS.

## Arch doc edits
- §8.3: name the effect kinds in `typed EffectPlan`: `replace_node`, `remove_node`.
