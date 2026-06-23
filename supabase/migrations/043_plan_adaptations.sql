CREATE TABLE IF NOT EXISTS plan_adaptations (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             text        NOT NULL,
  trigger_session_id  uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  insight_id          uuid        NOT NULL REFERENCES session_insights(id) ON DELETE CASCADE,
  primary_driver      text        NOT NULL,
  urgency             text        NOT NULL,
  signal_summary      text        NOT NULL,
  sessions_reordered  integer     NOT NULL,
  previous_order      jsonb       NOT NULL,
  new_order           jsonb       NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_adaptations_user ON plan_adaptations (user_id, created_at DESC);

ALTER TABLE plan_adaptations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_pa" ON plan_adaptations USING (auth.role() = 'service_role');
