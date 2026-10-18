# ADR-0038: The Datasets view lists the tables flows load and profiles them in Python
Status: Accepted
Date: 2026-10-18
Arch doc sections: §2A (Datasets view), §4 (`Dataset` / `DatasetVersion`), §11 (`GET /v1/datasets/{id}/profile`), §2 (Rust/Python ownership).

## Context
- The Datasets view is a placeholder. People want each dataset's columns, missing values, distributions, correlations and which flows use it.
- There is no `Dataset` entity and no ingest endpoint yet. Data enters only through a flow's source step (`file_source`), which writes a content-addressed Parquet artifact.
- Profiling is Python's job (rule 2). The browser must never load a table (rule 9).

## Decision
- **A dataset, for now, is a table a flow loads.** `GET /datasets` lists, for every flow, the latest output of each source step. Entries with the same content hash are one dataset. Each entry names its file, origin (operator and format), rows and columns, and the flows and steps that load it.
- **Rust derives the listing** from run history (pipeline versions, attempts, outputs). No new table, no new entity.
- **`GET /artifacts/{id}/profile`** returns a `DatasetProfile` of one Parquet artifact:
  - Row and column counts.
  - Per column: type, missing count, distinct count, and a histogram (numeric: 20 equal-width bins; other: top 10 values).
  - A missing-value map: missing share per column in at most 40 row bands.
  - Pearson correlation of numeric columns, at most 30 columns.
- **Python computes the profile with Polars** in one short process per request (`python -m sprisk_profile.dataset`), with a time limit and a cap on processes at once, as the cell splitter does (ADR-0031). Rust passes the artifact's local path and checks the answer against the contract.
- **The profile is descriptive only.** No step reads it. It covers the whole table as loaded, including rows a flow later holds out; flows still explore training rows only (rule 8). The page says so.

## Alternatives considered
- **A full `Dataset` entity with `POST /datasets` ingest.** Right in the long run; too much for this slice. The listing's shape (`Dataset`, keyed by content hash) leaves room for it.
- **Profile by adding profile steps to the flow.** Puts whole-table steps into flows that seal a holdout first, and changes people's flows to look at data.
- **Compute the profile in Rust with DuckDB.** Breaks the ownership split: profiling is Python.
- **Store the profile as an artifact.** Faster on repeat views; adds a cache and its invalidation. Measure first; the browser caches it per artifact already.

## Consequences (good and bad)
- Good: the view works with every flow already run, with no data migration.
- Good: one Python profile module, tested on its own, reused later by `POST /datasets`.
- Bad: a large table is re-profiled on each new page load (bounded by the time limit).
- Bad: a table no flow has loaded cannot be seen until a `Dataset` ingest exists.

## Validation (how we will know it was right)
- The diabetes, iris and penguins flows each show their dataset with the right rows, columns and users.
- A profile request never sends table rows to the browser; a 10× larger file still answers within the time limit or says it ran out of time.
- When `POST /datasets` lands, the listing and profile contracts are reused unchanged.
