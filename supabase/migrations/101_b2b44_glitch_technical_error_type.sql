-- B2B-44 — adds 'technical_error' as a valid glitch_instances.glitch_type value.
--
-- Per docs/.claude/agents/clio/feature-briefs/B2B-44-hume-transcript-endpoint-and-glitch-capture-fixes.md
-- Fix 3. Confirmed by direct inspection of 082_b2b17_glitch_issue_tracker.sql (lines 54-59):
-- glitch_type is a plain TEXT column with an unnamed inline CHECK constraint, which Postgres
-- auto-names using its standard `{table}_{column}_check` convention since no CONSTRAINT name was
-- given in the original CREATE TABLE. That yields `glitch_instances_glitch_type_check`, which is
-- what this migration drops and recreates — same pattern as
-- 062_hume_webhook_chat_ended_event_type.sql. If this name is ever wrong (e.g. an intervening
-- migration renamed it), this statement fails outright with a clear Postgres error rather than
-- silently doing nothing.
--
-- 'technical_error' is written by app/api/partner/render/client-error/route.ts directly
-- (application-level insert, bypassing fanout_glitch_instances() — that trigger only fires off
-- partner_session_insights, which this path never touches, since a client-side crash report has
-- no upstream JSONB column for a trigger to fan out from). Every other existing glitch_type value
-- continues to arrive exclusively via the trigger, unchanged.

ALTER TABLE glitch_instances DROP CONSTRAINT glitch_instances_glitch_type_check;

ALTER TABLE glitch_instances ADD CONSTRAINT glitch_instances_glitch_type_check
  CHECK (glitch_type IN (
    'misunderstanding',
    'repetition',
    'confusion_about_clio',
    'derailment',
    'other',
    'technical_error'
  ));
