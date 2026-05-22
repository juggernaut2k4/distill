-- Add trial opt-in tracking columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_opted_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Index for the daily trial-expiry job
CREATE INDEX IF NOT EXISTS idx_users_trial_ends_at
  ON users (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;
