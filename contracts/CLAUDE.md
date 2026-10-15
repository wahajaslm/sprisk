# contracts/

Canonical, versioned wire schemas (JSON Schema + OpenAPI). Arch doc §11.

- This is the **only** place wire entities are defined.
- Generated code: Rust via `typify` at build time (`crates/sprisk-contracts`); Python in `python/sprisk-contracts/src/sprisk_contracts/generated`; TS in `contracts/ts/src/generated`. Never edit generated files. A hook blocks it. Run `just contracts-gen`.
- Schema IDs are versioned: `sprisk.<entity>/vN`. Breaking change = new version, not an edit.
- Every schema has fixtures in `tests/contract/<entity>/{valid,invalid}`. Each language must round-trip every valid fixture unchanged and reject every invalid one. One fixture set, three test runners.
- Datasets never go inside JSON messages. Use artifact references (Arrow IPC / Parquet).
- Fields set by AI carry `origin: explicit | inferred | measured | confirmed` where the arch doc requires it.
- Use `/new-contract` to add an entity.

## Schema style
- `snake_case` fields. `PascalCase` type names. IDs are prefixed strings (`run_…`, `art_…`).
- Closed objects: `additionalProperties: false`. Open maps (params, nested JSON Schema) must say `additionalProperties: true` explicitly, or the Python codegen forbids every key.
- Enums for every state and kind. No free-text status fields.
- Required by default. Optional only when absence has a meaning; document it.
- No `const`: typify ignores it. Use a single-value `enum`.
- No `minItems`/`maxItems`: typify ignores them. Array-size rules are structural checks for the Rust compiler.
- Integer bounds: only `minimum: 0` (→ `u64`) or none (→ `i64`). typify ignores other bounds. Values above 2^53 lose precision in JS; avoid them in wire data.
- No `null` anywhere on the wire, including inside `params`. Optional means omitted. Always parse through the contract entry point: Rust `sprisk_contracts::parse`, Python `Model.model_validate_json`, TS `parse(entity, json)`. Never raw `serde_json`/`JSON.parse` into a contract type.
- Patterns use `[0-9]`, never `\\d` (Python's `\\d` matches non-ASCII digits).
- Open maps (`params`) are not number-safe in TypeScript (floats and ints above 2^53 change). Identity and cache hashes are computed only in Rust, from canonical JSON (RFC 8785).
- Python models are strict (`StrictModel`). Validate wire input with `model_validate_json`, never coerce.
- Keep `$defs` local to each schema until typify cross-file `$ref` support is proven.
- Timestamps: use `$defs/Timestamp` (UTC, whole seconds, `Z`). Pattern only, no `format`, so all three languages enforce it. Hashes: `sha256:<hex>`.
- Write the failing roundtrip fixture first, then the schema (TDD).
