CREATE TABLE methodology_proposals (
    id                  TEXT PRIMARY KEY,
    pipeline_version_id TEXT NOT NULL REFERENCES pipeline_versions(id),
    question_version_id TEXT NOT NULL REFERENCES question_versions(id),
    subject_node_id     TEXT NOT NULL,
    body                TEXT NOT NULL
);

CREATE INDEX methodology_proposals_pipeline ON methodology_proposals(pipeline_version_id);

CREATE TABLE methodology_decisions (
    id                  TEXT PRIMARY KEY,
    proposal_id         TEXT NOT NULL UNIQUE REFERENCES methodology_proposals(id),
    pipeline_version_id TEXT NOT NULL UNIQUE REFERENCES pipeline_versions(id),
    idempotency_key     TEXT NOT NULL UNIQUE,
    body                TEXT NOT NULL
);

CREATE INDEX methodology_decisions_proposal ON methodology_decisions(proposal_id);
