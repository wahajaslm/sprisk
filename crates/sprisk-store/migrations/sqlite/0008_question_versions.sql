CREATE TABLE question_versions (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL,
    body TEXT NOT NULL
);

CREATE INDEX question_versions_by_investigation
    ON question_versions (investigation_id, id);
