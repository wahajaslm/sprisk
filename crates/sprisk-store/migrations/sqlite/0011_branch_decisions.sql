-- A shortlist proposal may be applied more than once: each choice is a branch of the flow it
-- compared (ADR-0047). A decision is still one per new version and per idempotency key.
CREATE TABLE methodology_decisions_branched (
    id                  TEXT PRIMARY KEY,
    proposal_id         TEXT NOT NULL REFERENCES methodology_proposals(id),
    pipeline_version_id TEXT NOT NULL UNIQUE REFERENCES pipeline_versions(id),
    idempotency_key     TEXT NOT NULL UNIQUE,
    body                TEXT NOT NULL
);

INSERT INTO methodology_decisions_branched (id, proposal_id, pipeline_version_id, idempotency_key, body)
    SELECT id, proposal_id, pipeline_version_id, idempotency_key, body FROM methodology_decisions;

DROP TABLE methodology_decisions;

ALTER TABLE methodology_decisions_branched RENAME TO methodology_decisions;

CREATE INDEX methodology_decisions_proposal ON methodology_decisions(proposal_id);
