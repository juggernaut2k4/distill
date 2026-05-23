-- Add training_scripts to walkthrough_state so Clio can deliver pre-written
-- coaching scripts aligned with the visual sections shown on screen.
ALTER TABLE walkthrough_state
  ADD COLUMN IF NOT EXISTS training_scripts jsonb DEFAULT NULL;
