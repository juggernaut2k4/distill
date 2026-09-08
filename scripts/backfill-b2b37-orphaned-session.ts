/**
 * One-off script: B2B-37 backfill for the one orphaned partner session whose insights extraction
 * never fired (fixed on the fast path by this same brief's code changes). Hardcoded to exactly one
 * session id — not a general-purpose re-extraction tool. Run once, after the B2B-37 fix has shipped.
 * Run with: npx tsx scripts/backfill-b2b37-orphaned-session.ts
 * Reads credentials from the calling shell's environment (see scripts/reseed-failed-domains.ts for
 * the same pattern: ANTHROPIC_API_KEY, HUME_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, all pulled from production env before running).
 */
import { extractInsightsForPartnerSession } from '../inngest/partner-session-insights-extractor'

const ORPHANED_SESSION_ID = 'ab71deef-977c-40e1-bfec-d0a182d241e3'

extractInsightsForPartnerSession(ORPHANED_SESSION_ID)
  .then((result) => {
    console.log('[backfill-b2b37] Extraction result:', result)
    process.exit(0)
  })
  .catch((err) => {
    console.error('[backfill-b2b37] Extraction failed:', err)
    process.exit(1)
  })
