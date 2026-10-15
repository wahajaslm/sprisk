-- Which artifact an attempt committed on each output port. Not on the wire: the
-- Artifact contract has no port. Downstream steps resolve their inputs here.
CREATE TABLE attempt_outputs (
    attempt_id TEXT NOT NULL REFERENCES attempts (id),
    port TEXT NOT NULL,
    artifact_id TEXT NOT NULL REFERENCES artifacts (id),
    PRIMARY KEY (attempt_id, port)
);
