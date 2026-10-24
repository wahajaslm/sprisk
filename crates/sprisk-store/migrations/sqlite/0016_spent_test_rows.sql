-- Source files whose test rows a walk scored (ADR-0060), by content hash. A file is spent once:
-- a later walk reading it, alone or with other files, scores nothing. The key is the claim.
-- Rows are never updated or deleted.
CREATE TABLE spent_test_rows (
    source_hash TEXT PRIMARY KEY,
    walk_id     TEXT NOT NULL REFERENCES walks(id),
    run_id      TEXT NOT NULL REFERENCES runs(id)
);
