-- Migration 038: Clean up duplicate topic_content_cache rows
-- Keeps the most recently generated row per (topic_id, subtopic_slug, industry, role).
-- Safe to run as a one-time operation — idempotent.
DELETE FROM topic_content_cache
WHERE id NOT IN (
  SELECT DISTINCT ON (topic_id, subtopic_slug, industry, role) id
  FROM topic_content_cache
  ORDER BY topic_id, subtopic_slug, industry, role, generated_at DESC
);
