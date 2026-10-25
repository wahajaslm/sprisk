-- A profile asked with a label column relates the columns to it (ADR-0065), so the label is
-- part of the key; '' is the profile without one. Profiles are remade on demand, so the old
-- table is dropped rather than copied.
DROP TABLE profiles;
CREATE TABLE profiles (
    content_hash    TEXT NOT NULL,
    profiler_digest TEXT NOT NULL,
    target          TEXT NOT NULL,
    body            TEXT NOT NULL,
    PRIMARY KEY (content_hash, profiler_digest, target)
);
