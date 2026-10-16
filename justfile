# Run `just` to list recipes.
default:
    @just --list

# Bundle schemas, then regenerate Python and TypeScript types (Rust generates at build time).
contracts-gen:
    uv run python contracts/tools/bundle.py
    uv run datamodel-codegen --input contracts/bundle.schema.json --input-file-type jsonschema \
        --output python/sprisk-contracts/src/sprisk_contracts/generated/models.py \
        --output-model-type pydantic_v2.BaseModel \
        --enum-field-as-literal one --use-annotated --field-constraints --target-python-version 3.12 \
        --disable-timestamp --formatters ruff-format \
        --base-class sprisk_contracts.base.StrictModel \
        --custom-file-header '# Generated from contracts/schemas. Do not edit.'
    pnpm -C contracts/ts gen

# Fail if generated code is stale.
contracts-check: contracts-gen
    test -z "$(git status --porcelain -- contracts/bundle.schema.json python/sprisk-contracts/src/sprisk_contracts/generated contracts/ts/src/generated)" \
        || (echo "Generated code is stale or uncommitted. Commit the output of 'just contracts-gen'." && exit 1)

# Round-trip every contract fixture through Rust, Python and TypeScript.
contracts-test:
    cargo test -q -p sprisk-contracts
    uv run pytest -q python/sprisk-contracts
    pnpm -C contracts/ts test

# Format, lint, typecheck and test everything.
check:
    cargo fmt --all --check
    cargo clippy -q --workspace --all-targets -- -D warnings
    cargo test -q --workspace
    uv run ruff format --check python plugins methodology
    uv run ruff check python plugins methodology
    uv run mypy python/sprisk-contracts/src python/sprisk-contracts/tests
    uv run mypy python/sprisk-workers/src
    uv run mypy python/sprisk-workers/tests
    uv run mypy plugins
    uv run mypy methodology
    uv run pytest -q python plugins methodology
    pnpm -C contracts/ts typecheck
    pnpm -C contracts/ts test
    pnpm -C apps/web typecheck
    pnpm -C apps/web test
    just contracts-check
