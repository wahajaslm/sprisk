# ADR-0023: Charts are steps: Python aggregates, the browser draws
Status: Superseded by ADR-0024 (drawing) and ADR-0032 (no chart builder)
Date: 2026-10-16
Arch doc sections: §2A (views, rule 9), §7 (operators), ADR-0022

## Context
- People want a chart of any table: histogram, box, scatter, bar, line, with columns they pick.
- Rule 9: the browser never loads a full table and never computes analytics.
- Rule 2: numerics run in Python.
- An API endpoint that aggregates on request would need a numerics engine in Rust (DataFusion or hand-written kernels) or a second, synchronous path into Python.

## Decision
- A chart is a built-in step, `sprisk.profile.chart@1.0.0`: a plain function (ADR-0022).
- Settings: `kind` (histogram, box, scatter, bar, line), `x`, optional `y`, `bins`, `max_points`.
- It returns one `chart` report: the kind, the columns and only the aggregated numbers the chart needs (bin counts, quartiles, a capped seeded sample, group means).
- The UI adds a chart step after a table (right-click or the Chart button above a table) and draws its report with ECharts, lazy-loaded. Changing columns is changing the step's settings, which runs a new version.

## Alternatives considered
- **Aggregation endpoint in Rust with DataFusion.** Rejected for now: large dependency and build cost, and a second numerics engine.
- **A synchronous Python call from the API.** Rejected: a private path around the scheduler (rule 4).
- **Draw from table pages in the browser.** Rejected: rule 9.

## Consequences
- Good: charts are cached, versioned, reproducible and in History like any step; the AI planner can propose them.
- Good: one path; no new service.
- Bad: changing a chart takes a step run (about a second), not an instant redraw.
- Bad: the canvas gains a node per chart. Acceptable; charts are steps people keep.

## Validation
- No chart request ever fetches table rows into the browser.
- A chart of a 344-row table runs in about a second on a laptop.
