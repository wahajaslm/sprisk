-- Immutable once inserted (rule 5). A save is a new version (ADR-0036).
CREATE TABLE notebook_versions (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    body TEXT NOT NULL
);

CREATE INDEX notebook_versions_notebook ON notebook_versions (notebook_id, id);
