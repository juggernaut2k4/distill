-- B2B-65 (docs/specs/B2B-65-requirement-document.md §6.1/§6.2/§6.7)
-- New global singleton toggle controlling whether newly-completed demo session results get
-- appended to the Performance tab's accumulating list, plus a permanent, once-set visibility
-- flag on partner_session_insights recording that decision at extraction-completion time.

CREATE TABLE IF NOT EXISTS system_demo_performance_config (
  id             UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000002'::uuid,
  append_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE system_demo_performance_config
  ADD CONSTRAINT system_demo_performance_config_singleton_id
  CHECK (id = '00000000-0000-0000-0000-000000000002'::uuid);

CREATE TRIGGER update_system_demo_performance_config_updated_at
  BEFORE UPDATE ON system_demo_performance_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE system_demo_performance_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on system_demo_performance_config"
  ON system_demo_performance_config FOR ALL
  USING (auth.role() = 'service_role');

INSERT INTO system_demo_performance_config (id, append_enabled)
VALUES ('00000000-0000-0000-0000-000000000002', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE partner_session_insights
  ADD COLUMN IF NOT EXISTS demo_performance_visible BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_partner_session_insights_demo_performance_visible
  ON partner_session_insights(partner_session_id)
  WHERE demo_performance_visible = true;
