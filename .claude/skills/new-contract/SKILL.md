---
name: new-contract
description: Add or change a wire schema in contracts/ and regenerate Rust/Python/TS types with roundtrip tests. Use for any new API resource, domain entity, or worker message.
---
# Add or change a contract

1. Find the entity in arch doc §4, §9 or §11. Match its name and mutability.
2. Edit `contracts/schemas/<entity>.schema.json`. ID `sprisk.<entity>/vN`.
   - Breaking change → new `vN+1` file. Keep the old one.
3. Run `just contracts-gen`. Do not touch generated output.
4. Add roundtrip fixtures in `tests/contract/<entity>/` (valid + invalid cases).
5. Run `just contracts-test`.
6. Run the `contract-guardian` agent on the diff.
7. Commit schema, generated code and tests together.
