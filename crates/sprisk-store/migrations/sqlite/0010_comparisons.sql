-- A comparison version names the shortlist proposal it compares (ADR-0046). One per proposal;
-- every other version leaves it NULL, and NULLs never collide in a unique index.
ALTER TABLE pipeline_versions ADD COLUMN compares_proposal_id TEXT REFERENCES methodology_proposals(id);

CREATE UNIQUE INDEX pipeline_versions_compares ON pipeline_versions (compares_proposal_id);
