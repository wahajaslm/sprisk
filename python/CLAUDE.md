# python/ (scientific and AI plane)

Packages: `sprisk-ai`, `sprisk-science`, `sprisk-workers`, `sprisk-sdk`. Arch doc §2, §7, §8.

## Python owns
Profiling, transforms, feature engineering, ML/stats, experiment strategy, methodology checks, LLM calls, report analysis.

## Rules
- Use `uv`. Python 3.12+. Strict `mypy`. `ruff` for format and lint.
- Wire types are generated from `contracts/`. Pydantic models for internal use only.
- Planner and compute workers run with **different credentials**. Never share them.
- AI planner outputs typed `PipelineProposal`s only. Never executable code by default.
- LLM providers sit behind one adapter interface. External providers are off by default. Check consent policy before any outbound call.
- Treat dataset text and metadata as untrusted. Never place it in the system prompt. Never let it change tool permissions.
- Never `pickle.load`/`joblib.load` untrusted artifacts in a privileged process.
- Methodology validators return `PASS | FAIL | WARNING | NOT_ASSESSED` with version, rationale and artifact citations.
- Fit preprocessing and feature selection inside each CV fold. Never touch the sealed holdout during selection.
- Record seeds, package versions, environment digest. Report when exact replay is impossible.
- Heavy ML libs (XGBoost, LightGBM, PyTorch) are optional extras, never core deps.
- Workers talk to Rust only via the worker protocol (arch doc §11). No direct DB access.

## Checks
`uv run ruff format && uv run ruff check && uv run mypy python && uv run pytest`
