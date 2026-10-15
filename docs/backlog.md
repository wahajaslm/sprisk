# Backlog

Work deliberately deferred. Each item names where it came from and the milestone it belongs to.
Remove an item when it is done; link the commit or ADR.

## Scheduler (deferred from M1 step 6)
| Item | Milestone |
| --- | --- |
| Run independent steps in parallel; more than one worker | M3 |
| Caching: `cache_hit` from a cache key with every §9 field | M3 |
| Run Gate B (methodology checks) before execution and block on FAIL | M1 step 7 (CLI) |
| User cancel of a run or attempt | M1 step 7 / API |
| Cancel a running attempt without killing the worker process | M3 |

## Methodology
| Item | Source | Milestone |
| --- | --- | --- |
| Remaining Supervised rules: chronology, baseline included, duplicates across split, target proxies, group split, imbalance metric | ADR-0015 | M3 |
| Exploration pack rules | ADR-0015 | M3 |
| `split_leakage`: detect selection across pipeline versions that reuse one split (key on split artifact hash) | methodology review | M3 |
| Mark holdout ports in manifests instead of a pack setting | methodology review | with ADR-0016 |
| Per-project pack settings (thresholds, severity, applicability) — needs an ADR | design discussion | M3 |
| Acknowledged FAIL recorded as an `Assumption`; per-rule "override permitted" | ADR-0015 | M3 |
| Custom project-scoped packs (untrusted) | design discussion | M5 |
| Column roles (`x-sprisk-column`) and `ParamChoice` | ADR-0016 (Proposed) | M2/M3 |

## Operators and worker
| Item | Source | Milestone |
| --- | --- | --- |
| Random split: `stratify_column`, `group_column` | methodology review | M3 |
| Linear model: mark integer columns as categorical | methodology review | M3 |
| Metrics: record train row count and class counts | methodology review | M3 |
| Stream splits with `scan_parquet`/`sink_parquet` (bounded memory) | simplicity review | when data size needs it |
| Unexpected operator exceptions crash the worker; retried as transient until the cap | worker design | revisit after M1 |
| Third-party plugin code: isolation before loading non-core packs | arch §12 | M5 |
