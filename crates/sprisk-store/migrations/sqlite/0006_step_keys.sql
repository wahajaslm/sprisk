-- Each finished attempt's step definition key (operator, code digest, params, input hashes).
-- A run started from an edit reuses an earlier run's result for any step whose key is the
-- same there, including steps that are never globally cached (ADR-0026).
CREATE TABLE step_keys (
    attempt_id TEXT PRIMARY KEY REFERENCES attempts (id),
    step_key TEXT NOT NULL
);
