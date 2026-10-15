# crates/ (Rust control plane)

One Cargo workspace, one binary. Crates are modules, not services. Arch doc §2, §9, §11.

## Rust owns
Identity, permissions, registry resolution, graph typing, scheduling, leases, retry, cancellation, cache policy, artifact commits, run history, approval gates, API, events.

## Rules
- Wire types come from `sprisk-contracts` (generated). Never redefine them.
- Metadata lives in `sprisk-store` (concrete SQLite today). Extract a repository trait when Postgres lands, not before. Domain code never names a dialect.
- Migrations: separate per dialect, both tested.
- Attempt states change only via `sprisk_core::attempt::transition` (ADR-0013). Retries create new `Attempt` rows.
- Completion is idempotent by attempt ID. A late worker result must never overwrite a newer success.
- Artifact commit: worker writes to staging → verify hash → promote (atomic rename, `sprisk-artifacts`) → DB commit. A crash leaves at worst an unreferenced object, which GC removes; never a DB row pointing at missing bytes. No fake cross-store transactions.
- Never auto-retry side-effecting nodes.
- Cache key must include every field in arch doc §9 "Caching". Never cache nondeterministic or secret-bearing steps.
- Workers never touch metadata tables.
- No `unwrap()`/`expect()` outside tests. Use `thiserror` in libs, `anyhow` only in the binary.
- Telemetry (`tracing`) is separate from scientific run records.

## Checks
`cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`

## Code style
- Errors: one `thiserror` enum per crate. Variants carry context (IDs, paths). Use `?`. Map to HTTP status in `sprisk-api` only.
- Newtypes for IDs (`RunId(Uuid)`), enums for states. No stringly-typed state.
- Plain structs and functions first. Traits only at real seams: repositories, artifact store, worker transport.
- No `async` in pure logic. Graph compile, cache keys, state transitions are sync and pure.
- Avoid `Arc<Mutex<_>>` sprawl. Own data; pass references.
- No `unsafe`. No custom macros.

## Tests
- Unit tests in the same file (`#[cfg(test)] mod tests`). Integration tests in `crates/<crate>/tests/`.
- Repositories tested against in-memory SQLite. Postgres tests behind a feature flag in CI.
- State machine: test every allowed and every forbidden transition.
- Test crash recovery: kill between staging and commit, then reconcile.

## Crate dependency direction
```
sprisk-api ─→ sprisk-store ─→ sprisk-core
sprisk-api ─→ sprisk-runtime ─→ sprisk-scheduler ─→ sprisk-graph ─→ sprisk-registry ─→ sprisk-core
                     │                  └──────────→ sprisk-policy ──────────────────→ sprisk-core
                     └─→ sprisk-artifacts ───────────────────────────────────────────→ sprisk-core
all crates may use sprisk-contracts
```
- Never add an edge that points the other way. Check with `cargo tree -e normal -p <crate>`.
- `sprisk-core` holds domain types and repository traits. No I/O, no Axum, no SQLx.
- Adapters (SQLite, Postgres, filesystem, S3) implement core traits in their own modules.
