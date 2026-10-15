---
name: adr
description: Write an Architecture Decision Record in docs/adr. Use when a change adds a dependency, service, storage engine, or contradicts/extends the architecture doc.
---
# Write an ADR

1. Next number: highest in `docs/adr/` + 1 (0001–0011 already exist). Add a row to `docs/adr/README.md`.
2. File `docs/adr/NNNN-<slug>.md`:

```markdown
# ADR-NNNN: <title>
Status: Proposed | Accepted | Superseded by ADR-XXXX
Date: <YYYY-MM-DD>
Arch doc sections: §x, §y

## Context
## Decision
## Alternatives considered
## Consequences (good and bad)
## Validation (how we will know it was right)
```

3. Keep it under one page. Plain words. One idea per bullet.
4. If it changes the arch doc, list the exact section edits needed.
