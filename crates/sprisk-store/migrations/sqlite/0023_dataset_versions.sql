-- Data registered by reference (ADR-0067): where it lives and a fingerprint of its files'
-- metadata, never the data. A version never changes; the same location with the same
-- fingerprint is one version, so registering again is idempotent.
CREATE TABLE dataset_versions (
    id          TEXT PRIMARY KEY,
    location    TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    body        TEXT NOT NULL,
    UNIQUE (location, fingerprint)
);
