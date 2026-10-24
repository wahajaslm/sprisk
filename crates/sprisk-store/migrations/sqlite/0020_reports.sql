-- What a completed walk found (ADR-0064): one report per walk, never changed.
CREATE TABLE reports (
    id      TEXT PRIMARY KEY,
    walk_id TEXT NOT NULL UNIQUE REFERENCES walks(id),
    body    TEXT NOT NULL
);
