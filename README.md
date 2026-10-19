# sprisk

Open-source, local-first, AI-native platform for data science, ML, experimentation and decision intelligence.

**Status:** M0 repository reconciliation against the enterprise v2 target. Current delivery priority: the local core workbench.

## Start here

- [Architecture v2](docs/architecture/sprisk-enterprise-platform-design-v2.md)
- [Core integration map](docs/architecture/architecture-integration-map.md)
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
