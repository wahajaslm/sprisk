---
name: new-operator
description: Scaffold a new registered sprisk operator (manifest, Python implementation, contract test). Use when adding a pipeline operator such as a transform, estimator, or evaluator.
---
# Add an operator

Follow arch doc §5 and §6. Ask for the operator ID and capability class if not given.

1. Manifest in `plugins/<pack>/operators/<name>/manifest.yaml`, validated against `contracts/operator`. Declare:
   - ID `sprisk.<domain>.<name>@<semver>`, capability class, entrypoint.
   - Typed input/output ports.
   - Data semantics: column roles, fitted state, train/inference context.
   - Params with defaults and constraints.
   - Resources, network/sandbox permissions.
   - Purity, side effects, nondeterminism, cache eligibility.
   - Preconditions and methodology checks.
2. Implementation in the same pack: `plugins/<pack>/src/sprisk_<pack>/` (pack names use `_`, e.g. `sprisk_ml`), tests in `plugins/<pack>/tests/`. New packs must be added to `TRUSTED_PACKAGES` in `sprisk_workers/manifests.py`. Use existing libraries. No new numerics.
3. Contract test: manifest validates; ports match schema; outputs carry provenance.
4. Behavior test on a small fixture. If stateful, test fit-in-fold behavior.
5. Confirm the Rust compiler needs **no change** (acceptance test §15.1).
6. Run `methodology-reviewer` if the operator fits, splits, or evaluates.
