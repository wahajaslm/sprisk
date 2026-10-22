-- The engine's walks (ADR-0060). The request is kept as sent, so a replayed idempotency key
-- is answered only when it asks for the same walk. A walk's steps never change; one per round,
-- so a restarted walk cannot record a round twice.
CREATE TABLE walks (
    id                  TEXT PRIMARY KEY,
    question_version_id TEXT NOT NULL REFERENCES question_versions(id),
    idempotency_key     TEXT NOT NULL UNIQUE,
    request             TEXT NOT NULL,
    status              TEXT NOT NULL,
    body                TEXT NOT NULL
);

CREATE TABLE walk_steps (
    walk_id TEXT NOT NULL REFERENCES walks(id),
    round   INTEGER NOT NULL,
    body    TEXT NOT NULL,
    PRIMARY KEY (walk_id, round)
);
