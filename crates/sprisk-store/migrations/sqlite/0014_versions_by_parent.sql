-- A flow's family of versions is walked down by parent (ADR-0059: looks at the same folds).
CREATE INDEX pipeline_versions_by_parent ON pipeline_versions (json_extract(body, '$.parent_id'));
