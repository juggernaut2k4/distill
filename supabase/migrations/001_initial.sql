-- Distill: Initial Database Schema
-- Production-ready Supabase PostgreSQL migration

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── UPDATED_AT TRIGGER FUNCTION ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- ─── USERS ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- Clerk user ID
  email TEXT,
  phone TEXT,
  role TEXT,
  industry TEXT,
  ai_maturity TEXT DEFAULT 'observer',
  worry_tags TEXT[] DEFAULT '{}',
  plan_tier TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT DEFAULT 'inactive',
  delivery_preference TEXT DEFAULT 'email',
  twilio_number_assigned TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  onboarded_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  delivery_paused BOOLEAN DEFAULT FALSE,
  paused_until TIMESTAMPTZ,
  needs_recalibration BOOLEAN DEFAULT FALSE,
  ai_readiness_score INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  last_delivery_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_plan_tier ON users(plan_tier);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status);

-- Updated_at trigger
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own record
CREATE POLICY "Users can view own record"
  ON users FOR SELECT
  USING (auth.uid()::text = id);

CREATE POLICY "Users can update own record"
  ON users FOR UPDATE
  USING (auth.uid()::text = id);

-- Service role can do everything
CREATE POLICY "Service role full access on users"
  ON users FOR ALL
  USING (auth.role() = 'service_role');

-- ─── CONTENT_ITEMS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL CHECK (type IN ('tip', 'signal', 'decoder', 'lens', 'framework')),
  body_text TEXT NOT NULL,
  role_tags TEXT[] DEFAULT '{}',
  industry_tags TEXT[] DEFAULT '{}',
  maturity_tags TEXT[] DEFAULT '{}',
  worry_tags TEXT[] DEFAULT '{}',
  source_url TEXT,
  generated_by TEXT DEFAULT 'claude',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_content_items_type ON content_items(type);
CREATE INDEX IF NOT EXISTS idx_content_items_created_at ON content_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_items_source_url ON content_items(source_url);

-- Updated_at trigger
CREATE TRIGGER update_content_items_updated_at
  BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- RLS — content items are readable by all authenticated users
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read content"
  ON content_items FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

CREATE POLICY "Service role can manage content"
  ON content_items FOR ALL
  USING (auth.role() = 'service_role');

-- ─── DELIVERY_LOG ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS delivery_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES content_items(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  feedback TEXT CHECK (feedback IN ('positive', 'negative', NULL)),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_log_user_id ON delivery_log(user_id);
CREATE INDEX IF NOT EXISTS idx_delivery_log_sent_at ON delivery_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_log_user_sent ON delivery_log(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_log_content ON delivery_log(content_item_id);

-- RLS
ALTER TABLE delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own delivery log"
  ON delivery_log FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Service role full access on delivery_log"
  ON delivery_log FOR ALL
  USING (auth.role() = 'service_role');

-- ─── USER_LEARNING_PLANS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_learning_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  plan_json JSONB,
  active_track TEXT,
  next_content_type TEXT,
  cadence_days INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ulp_user_id ON user_learning_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_ulp_generated_at ON user_learning_plans(generated_at DESC);

-- Updated_at trigger
CREATE TRIGGER update_ulp_updated_at
  BEFORE UPDATE ON user_learning_plans
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- RLS
ALTER TABLE user_learning_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own learning plans"
  ON user_learning_plans FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Service role full access on learning plans"
  ON user_learning_plans FOR ALL
  USING (auth.role() = 'service_role');

-- ─── SMS_CONVERSATIONS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sms_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  twilio_number TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT NOT NULL,
  intent TEXT CHECK (intent IN ('feedback', 'question', 'command')),
  received_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sms_user_id ON sms_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_created_at ON sms_conversations(created_at DESC);

-- RLS
ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own SMS conversations"
  ON sms_conversations FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Service role full access on SMS conversations"
  ON sms_conversations FOR ALL
  USING (auth.role() = 'service_role');

-- ─── FEEDBACK_WEIGHTS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feedback_weights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  weight FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tag)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fw_user_id ON feedback_weights(user_id);

-- Updated_at trigger
CREATE TRIGGER update_fw_updated_at
  BEFORE UPDATE ON feedback_weights
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- RLS
ALTER TABLE feedback_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feedback weights"
  ON feedback_weights FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Service role full access on feedback weights"
  ON feedback_weights FOR ALL
  USING (auth.role() = 'service_role');

-- ─── HELPER FUNCTION: INCREMENT FEEDBACK WEIGHT ──────────────────────────────

CREATE OR REPLACE FUNCTION increment_feedback_weight(
  p_user_id TEXT,
  p_tag TEXT,
  p_delta FLOAT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO feedback_weights (user_id, tag, weight)
  VALUES (p_user_id, p_tag, p_delta)
  ON CONFLICT (user_id, tag)
  DO UPDATE SET weight = feedback_weights.weight + p_delta,
                updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── HELPER FUNCTION: INCREMENT STREAK DAYS ──────────────────────────────────
-- Called by the daily delivery job each time a user receives a delivery.
-- Atomically increments streak_days to avoid read-modify-write race conditions.

CREATE OR REPLACE FUNCTION increment_streak_days(
  p_user_id TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET streak_days = COALESCE(streak_days, 0) + 1,
      updated_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
