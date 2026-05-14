-- Migration 007: Allow public (anon) read on walkthrough_state
-- The walkthrough page is intentionally public — loaded by the Recall.ai headless
-- browser with no Clerk session. The previous policy used auth.uid() which returns
-- null for unauthenticated clients, blocking Supabase Realtime events and preventing
-- pending_speech changes from reaching the WalkthroughClient.

DROP POLICY IF EXISTS "users_read_own_walkthrough" ON walkthrough_state;

CREATE POLICY "public_read_walkthrough"
  ON walkthrough_state FOR SELECT
  USING (true);
