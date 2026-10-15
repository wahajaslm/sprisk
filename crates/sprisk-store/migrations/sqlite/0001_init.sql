-- Each row keeps the full contract JSON in `body`; other columns exist for lookup and constraints.

CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    body TEXT NOT NULL
);

CREATE TABLE attempts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs (id),
    node_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    state TEXT NOT NULL,
    body TEXT NOT NULL,
    UNIQUE (run_id, node_id, number)
);

CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    body TEXT NOT NULL
);

-- Append-only. Never UPDATE or DELETE.
CREATE TABLE audit_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event TEXT NOT NULL
);

CREATE INDEX audit_events_entity ON audit_events (entity_id, seq);
