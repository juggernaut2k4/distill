-- 031_user_learning_profile_dimensions.sql
-- Adds intellectual, psychological, and business focus dimensions to user_learning_profiles.
-- Updated by Inngest post-session job via Claude classification of questions_raised.
-- Profile confidence progresses: low (0-2 sessions) → medium (3-6) → high (7+).

-- Intellectual profile dimensions
ALTER TABLE user_learning_profiles
  ADD COLUMN IF NOT EXISTS reasoning_style        TEXT    DEFAULT 'sequential',   -- systems | sequential | analogical
  ADD COLUMN IF NOT EXISTS abstraction_comfort     TEXT    DEFAULT 'mixed',        -- abstract | concrete | mixed
  ADD COLUMN IF NOT EXISTS question_depth_pattern  TEXT    DEFAULT 'basic',        -- basic | intermediate | advanced (rolling avg)
  ADD COLUMN IF NOT EXISTS sessions_ended_early    INTEGER DEFAULT 0,              -- attention proxy: user ended before planned time
  ADD COLUMN IF NOT EXISTS sessions_ran_long       INTEGER DEFAULT 0,              -- attention proxy: user went over planned time
  ADD COLUMN IF NOT EXISTS sessions_on_time        INTEGER DEFAULT 0;              -- attention proxy: completed as planned

-- Psychological / motivation profile
ALTER TABLE user_learning_profiles
  ADD COLUMN IF NOT EXISTS learning_motivation     TEXT    DEFAULT 'opportunity_driven', -- fear_driven | opportunity_driven | compliance_driven
  ADD COLUMN IF NOT EXISTS risk_tolerance          TEXT    DEFAULT 'balanced';           -- conservative | aggressive | balanced

-- Business focus lens — single TEXT value, not array
-- Drives the "So what?" angle of every script and visualization
ALTER TABLE user_learning_profiles
  ADD COLUMN IF NOT EXISTS business_focus_lens     TEXT    DEFAULT 'capability_building'; -- cost_reduction | productivity | capability_building | risk_compliance | competitive_edge | team_enablement

-- Vocabulary fingerprint: domain_terms the user uses in questions (capped at 30),
-- detected_register (finance | technical | operations | legal | general),
-- example_preference (quantitative | narrative | mixed)
ALTER TABLE user_learning_profiles
  ADD COLUMN IF NOT EXISTS vocab_fingerprint       JSONB   DEFAULT '{"domain_terms":[],"detected_register":"general","example_preference":"mixed"}';

-- Profile confidence tier and usage tracking
ALTER TABLE user_learning_profiles
  ADD COLUMN IF NOT EXISTS profile_confidence      TEXT    DEFAULT 'low',   -- low | medium | high
  ADD COLUMN IF NOT EXISTS sessions_used_for_profile INTEGER DEFAULT 0;     -- increments each time profile is updated post-session
