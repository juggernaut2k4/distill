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
