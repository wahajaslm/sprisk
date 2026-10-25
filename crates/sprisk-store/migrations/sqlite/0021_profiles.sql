-- A table's profile (ADR-0038, ADR-0065), made once per table content and profiler code: a
-- table never changes, so neither does its profile until the profiler does.
CREATE TABLE profiles (
    content_hash    TEXT NOT NULL,
    profiler_digest TEXT NOT NULL,
    body            TEXT NOT NULL,
    PRIMARY KEY (content_hash, profiler_digest)
);
