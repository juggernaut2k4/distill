-- Migration 046: Add tab_manifests column to walkthrough_state
-- tab_manifests is a JSONB map keyed by section index (as string, e.g. "0", "1")
-- containing the TabManifest for that section (tabs array + trigger phrases).
-- Written by the session-content-pipeline Inngest job (write-tab-manifests step)
-- and read by WalkthroughClient to drive tab navigation during live sessions.

ALTER TABLE walkthrough_state
  ADD COLUMN IF NOT EXISTS tab_manifests JSONB;
