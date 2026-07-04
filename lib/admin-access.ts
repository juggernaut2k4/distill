/**
 * Admin/dev-only route access control.
 *
 * Same pattern as lib/kb-access.ts's isKBEnabled(): a server-only env var
 * (no NEXT_PUBLIC_ prefix) so the flag can never be read or gated
 * client-side only.
 */

/**
 * Gates /api/admin/test-session — a dev-only shortcut that bypasses the
 * 25-35 min cron dispatch window so Arun can manually trigger a live
 * session for testing. Defaults to enabled (true) since it's actively used
 * today; set ADMIN_TEST_SESSION_ENABLED=false in Vercel env to disable
 * ahead of real clients — no code change required. Tracked in BACKLOG.md
 * under the pre-launch cleanup checklist for dev-only shortcuts.
 */
export function isTestSessionEnabled(): boolean {
  return process.env.ADMIN_TEST_SESSION_ENABLED !== 'false'
}
