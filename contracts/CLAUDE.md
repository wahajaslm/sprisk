# contracts/

Canonical, versioned wire schemas (JSON Schema + OpenAPI). Arch doc §11.

- This is the **only** place wire entities are defined.
- Generated code goes to `crates/sprisk-contracts`, `python/*/generated`, `apps/web/src/generated`. Never edit generated files by hand. A hook blocks it.
- Schema IDs are versioned: `sprisk.<entity>/vN`. Breaking change = new version, not an edit.
- Every schema change needs a roundtrip test: TS → JSON → Rust → JSON → Python → JSON, byte-equal after normalization.
- Datasets never go inside JSON messages. Use artifact references (Arrow IPC / Parquet).
- Fields set by AI carry `origin: explicit | inferred | measured | confirmed` where the arch doc requires it.
- Use `/new-contract` to add an entity.

## Schema style
- `snake_case` fields. `PascalCase` type names. IDs are prefixed strings (`run_…`, `art_…`).
- Closed objects: `additionalProperties: false`.
- Enums for every state and kind. No free-text status fields.
- Required by default. Optional only when absence has a meaning; document it.
- Timestamps: RFC 3339 UTC. Hashes: `sha256:<hex>`.
- Write the failing roundtrip fixture first, then the schema (TDD).
