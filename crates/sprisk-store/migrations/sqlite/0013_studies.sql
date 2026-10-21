-- One row per study (ADR-0051). The request is kept as sent, so a replayed idempotency key
-- is answered only when it asks for the same study. Trials are not stored: they are the
-- comparison's cross-validate steps and their attempts.
CREATE TABLE studies (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL,
    pipeline_version_id TEXT NOT NULL REFERENCES pipeline_versions(id),
    node_id             TEXT NOT NULL,
    comparison_id       TEXT NOT NULL UNIQUE REFERENCES pipeline_versions(id),
    run_id              TEXT NOT NULL UNIQUE REFERENCES runs(id),
    idempotency_key     TEXT NOT NULL UNIQUE,
    request             TEXT NOT NULL,
    status              TEXT NOT NULL,
    body                TEXT NOT NULL
);

CREATE INDEX studies_of_version ON studies (pipeline_version_id, id);
