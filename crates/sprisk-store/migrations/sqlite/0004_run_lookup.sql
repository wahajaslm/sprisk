-- Runs are listed per pipeline version, newest first. Ids are ULIDs, so id order is time order.
ALTER TABLE runs ADD COLUMN pipeline_version_id TEXT NOT NULL DEFAULT '';
UPDATE runs SET pipeline_version_id = json_extract(body, '$.pipeline_version_id');
CREATE INDEX runs_by_pipeline_version ON runs (pipeline_version_id, id);
