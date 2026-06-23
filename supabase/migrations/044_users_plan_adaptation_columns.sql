ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_adapted_at               timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_adaptation_acknowledged_at timestamptz DEFAULT NULL;
