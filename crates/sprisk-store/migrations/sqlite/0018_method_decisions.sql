-- A method's decision is a methodology decision too, made through the same Apply (ADR-0064).
-- It comes from no proposal, and an option that changes no step makes no version.
CREATE TABLE methodology_decisions_any (
    id                  TEXT PRIMARY KEY,
    proposal_id         TEXT REFERENCES methodology_proposals(id),
    pipeline_version_id TEXT UNIQUE REFERENCES pipeline_versions(id),
    idempotency_key     TEXT NOT NULL UNIQUE,
    body                TEXT NOT NULL
);

INSERT INTO methodology_decisions_any (id, proposal_id, pipeline_version_id, idempotency_key, body)
    SELECT id, proposal_id, pipeline_version_id, idempotency_key, body FROM methodology_decisions;

DROP TABLE methodology_decisions;

ALTER TABLE methodology_decisions_any RENAME TO methodology_decisions;

CREATE INDEX methodology_decisions_proposal ON methodology_decisions(proposal_id);
