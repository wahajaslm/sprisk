# sprisk

Open-source, local-first, AI-native platform for data science, ML, experimentation and decision intelligence.

**Status:** M0 (contract freeze) done. Current milestone: M1 (non-AI vertical slice).

## Start here

- [Architecture](docs/architecture/system-architecture.md)
- [Decision records](docs/adr/README.md)
- [sprisk Studio UI concept](docs/design/sprisk-studio.html)
- [All docs](docs/README.md)

## Repository layout

| Path | Contents |
| --- | --- |
| `contracts/` | Canonical wire schemas |
| `crates/` | Rust control plane |
| `python/` | AI planner, scientific validators, workers, SDK |
| `apps/web/` | sprisk Studio web workbench |
| `docs/` | Architecture, ADRs, design |
| `.claude/` | Claude Code harness: settings, hooks, agents, skills |
