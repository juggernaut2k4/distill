import { z } from 'zod'

/**
 * B2B-19 — session-initiation request schema, extracted from the route so it is
 * unit-testable (Next.js route files may only export HTTP-method handlers).
 *
 * The refine rule is "exactly one of {inline content, content reference}"; every
 * existing Option 2 (`content_ref`/`partner_topic_ref`) request validates
 * unchanged (AT-BC-1).
 */

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

export const DEFAULT_EXPECTED_DURATION_MINUTES = 30

/**
 * B2B-64 (docs/specs/B2B-64-requirement-document.md §6) — Option 2 (partner_topic_ref/content_ref)
 * session-creation guard. Defaults to disabled (rejects Option 2 session creation) per Arun's
 * 2026-08-01 commitment to inline-only going forward. Strict `=== 'true'` check, matching this
 * repo's existing `_ENABLED`-flag-family convention (RTV_MARKER_GENERATION_ENABLED,
 * HUME_NATIVE_PACING_GUIDANCE_ENABLED) — no truthy-string leniency. A guard, not a deletion:
 * CreateSessionSchema's Option-2 fields/refine logic below are untouched, so re-enabling this is a
 * one-line env var flip, no code change.
 */
export function isTemplateModeEnabled(): boolean {
  return process.env.TEMPLATE_MODE_SESSIONS_ENABLED === 'true'
}

export const ContentPageSchema = z.object({
  url: z.string().url(),
  media_type: z.enum(['html', 'image']),
  title: z.string().max(200).optional(),
  subtitle: z.string().max(300).optional(),
  transition_trigger: z.string().min(1).max(500),
  // B2B-35 F1 — optional per-page narration content ("the actual teaching material for this
  // page"), threaded through to Hume so Clio narrates the real content instead of just the
  // page title. Deliberately no `.min(1)` — an explicitly-empty string is accepted and treated
  // identically to the field being absent (docs/specs/B2B-35-requirement-document.md §9).
  content_text: z.string().max(6000).optional(),
})

export const CreateSessionSchema = z
  .object({
    meeting_url: z.string().url(),
    // Option 2 (reference mode) — unchanged.
    partner_topic_ref: z.string().min(1).max(512).regex(PRINTABLE_ASCII).optional(),
    content_ref: z.string().uuid().optional(),
    // Option 1 (inline content mode) — B2B-19, additive.
    content_pages: z.array(ContentPageSchema).min(1).optional(),
    content_source_id: z.string().uuid().optional(),
    content_to_explain: z.string().max(5000).optional(),
    title: z.string().max(200).optional(),
    subtitle: z.string().max(300).optional(),
    expected_duration_minutes: z.number().int().positive().max(600).optional(),
    // Shared, unchanged.
    partner_end_user_ref: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    partner_reference: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    // B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.1/§6.5) — wire field name
    // stays `client_id` (matches the product's established vocabulary); the DB column / TS identifier
    // is `end_client_id` (avoids a code-level collision with the unrelated
    // partner_oauth_clients.client_id). Optional at the Zod layer — conditionally required only for
    // account_kind='channel_partner' callers, enforced imperatively in the route (§6.5) since Zod has
    // no access to the resolved auth context at parse time.
    client_id: z.string().uuid().optional(),
    // B2B-35 F3 — optional, session-wide description of who the actual end user is (e.g. "a
    // first-year sales associate"), threaded through to the assembled Hume prompt as the
    // audience persona in place of the hardcoded "a senior executive" default. Applies to both
    // Option 1 (inline) and Option 2 (reference) sessions — top-level, not inside
    // ContentPageSchema (docs/specs/B2B-35-requirement-document.md §6.8).
    end_user_role: z.string().trim().max(200).optional(),
    // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.2) — required, session-wide
    // participant name. Unlike end_user_role/end_user_industry, this has no .optional() — every
    // new session must supply it. Safe: zero real (non-test-mode) partner_sessions rows exist as
    // of 2026-07-26.
    end_user_name: z.string().trim().min(1, 'end_user_name is required').max(200),
    // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.2) — optional, session-wide
    // industry description (e.g. "healthcare"), extending the end_user_role audience clause. No
    // default when absent — the industry clause is omitted entirely, never replaced with a
    // placeholder.
    end_user_industry: z.string().trim().max(200).optional(),
    // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.2) — mandatory for every account_kind
    // (Open Item 3), validated against auth.partnerAccountId imperatively in the route (Zod has no
    // access to the resolved auth context at parse time — same reason client_id's channel_partner
    // requirement is enforced in the route, not here). UUID because it must be directly comparable to
    // auth.partnerAccountId, which is itself a partner_accounts.id UUID.
    reseller_id: z.string().uuid('reseller_id must be a valid UUID'),
    // B2B-38 §6.2 — optional. Idempotent-replay key (Open Item 2), scoped per-reseller. Same
    // printable-ASCII/length convention as partner_reference/partner_end_user_ref immediately above.
    reseller_unique_id: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    // B2B-62 — optional, free-text language Clio should CONDUCT the conversation in (e.g.
    // "french", "Spanish"). Source content stays English regardless — the model translates and
    // explains it live. Absent/omitted means English, byte-identical to every pre-B2B-62 session
    // (docs/b2b-pivot-status.md's B2B-62 backlog entry). Not an enum — Claude/gpt-realtime both
    // already understand plain-language names without a fixed vocabulary to maintain here.
    language: z.string().trim().min(1).max(60).optional(),
  })
  .refine(
    (data) => {
      const inline = Boolean(data.content_pages)
      const reference = Boolean(data.partner_topic_ref || data.content_ref)
      return inline !== reference // exactly one
    },
    {
      message:
        'Provide exactly one of: inline content (content_pages) or a content reference (content_ref/partner_topic_ref).',
      path: ['content_pages'],
    }
  )
  .refine((data) => !data.content_pages || Boolean(data.content_source_id), {
    message: 'content_source_id is required when content_pages is provided.',
    path: ['content_source_id'],
  })
