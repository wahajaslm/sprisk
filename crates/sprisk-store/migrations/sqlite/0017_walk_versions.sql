-- The walk that made a version is found by the steps' made version (ADR-0063 slice 5: what
-- decided a flow), without reading every step.
CREATE INDEX walk_steps_by_made_version
    ON walk_steps (json_extract(body, '$.made_pipeline_version_id'));
