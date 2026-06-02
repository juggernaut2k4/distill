-- Allow 'draft' status on sessions (used by session-designer-auto Inngest job)
-- Previously the CHECK constraint excluded 'draft', causing all designer inserts to fail silently
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
  CHECK (status IN ('draft', 'scheduled', 'active', 'completed', 'cancelled'));
