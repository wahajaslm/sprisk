-- One model selection per version and step (ADR-0047): its comparison and the run that
-- compares, each claimed in one transaction, so concurrent requests share them.
CREATE TABLE model_selections (
    pipeline_version_id TEXT NOT NULL REFERENCES pipeline_versions(id),
    node_id             TEXT NOT NULL,
    comparison_id       TEXT NOT NULL UNIQUE REFERENCES pipeline_versions(id),
    run_id              TEXT REFERENCES runs(id),
    PRIMARY KEY (pipeline_version_id, node_id)
);
