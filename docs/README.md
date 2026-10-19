# sprisk documentation

| Folder | What it holds |
| --- | --- |
| [architecture/](architecture/sprisk-enterprise-platform-design-v2.md) | Enterprise v2 architecture target and core-first delivery sequence. |
| [architecture integration map](architecture/architecture-integration-map.md) | Verified repository capabilities, gaps and implementation order. |
| [adr/](adr/README.md) | Architecture decision records, one per decision. |
| [research/](research/) | Research notes behind decisions, with sources. |
| [design/](design/sprisk-studio.html) | sprisk Studio UI concept. Reference only, not a contract. |
| [design/methodology-rules.md](design/methodology-rules.md) | Design of methodology rules and checks (ADR-0040, ADR-0042). |
| [backlog.md](backlog.md) | Work deliberately deferred, with source and milestone. |

## Rules

- Architecture changes are reconciled through ADRs; the integration map records mismatches between design and implementation.
- Area-specific engineering rules live in each folder's `CLAUDE.md`.
- New docs go in the folder above that fits. Add a line here if you create a new folder.
- Anything deferred goes in `backlog.md`. No TODOs in code.
