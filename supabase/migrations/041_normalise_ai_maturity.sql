-- Migration 041: Normalise ai_maturity to canonical vocabulary
-- Safe to run at any time — idempotent. Updates only rows with non-canonical values.
-- After this migration, users.ai_maturity will only contain:
--   beginner | intermediate | advanced | expert

UPDATE users SET ai_maturity = 'beginner'
WHERE ai_maturity IN ('observer', 'no experience');

UPDATE users SET ai_maturity = 'intermediate'
WHERE ai_maturity IN ('emerging', 'some experience', 'somewhat experience', 'evaluator', 'pilot');

UPDATE users SET ai_maturity = 'advanced'
WHERE ai_maturity IN ('practitioner', 'scaler');

UPDATE users SET ai_maturity = 'expert'
WHERE ai_maturity = 'leader';

-- Catch-all: set any remaining unknown values to 'intermediate' (safe default)
UPDATE users SET ai_maturity = 'intermediate'
WHERE ai_maturity NOT IN ('beginner', 'intermediate', 'advanced', 'expert')
  AND ai_maturity IS NOT NULL;
