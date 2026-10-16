-- Arch §9 caching: the succeeded attempt whose outputs a cache key maps to. The first
-- success for a key wins; later equal results are not recorded again.
CREATE TABLE cache_entries (
    cache_key TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts (id)
);
