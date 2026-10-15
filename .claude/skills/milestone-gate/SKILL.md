---
name: milestone-gate
description: Check whether the current milestone's exit gate (arch doc §16) and acceptance tests (§15) are met. Use when the user asks for project status or whether a milestone is done.
---
# Milestone gate check

1. Read the current milestone from root `CLAUDE.md`.
2. Read its exit gate in arch doc §16.
3. For each criterion and each relevant §15 acceptance test, find the automated test that proves it. Run it.
4. Output a table: criterion | test | status (pass / fail / missing).
5. Bottom line first: "M<n> gate: met" or "not met: <count> gaps".
6. If met, offer to update the milestone in `CLAUDE.md`.
