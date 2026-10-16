-- Immutable once inserted (rule 5). A change is a new version.
CREATE TABLE pipeline_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    body TEXT NOT NULL
);
