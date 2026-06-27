-- Cache for /api/topics/recommendations responses.
-- Key: SHA-256 hash of (tier + role + primaryDomain + subDomain + aiMaturity + learningGoal).
-- Same profile combination always returns the same sections without an LLM call.

CREATE TABLE IF NOT EXISTS topic_recommendations_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_hash  TEXT NOT NULL UNIQUE,  -- hex SHA-256 of canonical profile fields
  tier          TEXT NOT NULL,         -- executive | technical | manager
  sections      JSONB NOT NULL,        -- the full sections array returned to the client
  hit_count     INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topic_rec_cache_hash ON topic_recommendations_cache (profile_hash);
