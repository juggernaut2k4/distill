import { z } from 'zod'
import { ContentPageSchema, DEFAULT_EXPECTED_DURATION_MINUTES } from '@/lib/partner/session-schema'

/**
 * B2B-78 (docs/specs/B2B-78-requirement-document.md §4.A/§6.1/§6.3) — request schema for
 * POST /api/partner/v1/bot-sessions, stage 2 of the two-stage production pipeline.
 *
 * Deliberately a SEPARATE schema from `CreateWidgetSessionSchema`, not a shared/extended one: this
 * shape differs in two ways `widget-sessions` never needs to — `session_id` (new, required, links
 * to the `bot-dispatch` reservation) and `bot_id` (new, replaces `elevenlabs_agent_id` for this
 * endpoint's own vendor-hiding indirection, §6.3). `end_user_name` is deliberately absent — per
 * §6.1 Q3, it is not re-sent; it's read from the reservation row, keyed by `session_id`, avoiding
 * two sources of truth for one fact.
 *
 * Every other field is identical to `CreateWidgetSessionSchema` — same content/tracking/
 * language/reseller_id/client_id fields, carried forward unchanged per §0's headline finding.
 */

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

export const CreateBotSessionSchema = z
  .object({
    session_id: z.string().uuid('session_id must be a valid UUID'),
    content_pages: z.array(ContentPageSchema).min(1),
    content_source_id: z.string().uuid().optional(),
    content_to_explain: z.string().max(5000).optional(),
    content_title: z.string().max(200).optional(),
    content_subtitle: z.string().max(300).optional(),
    expected_duration_minutes: z.number().int().positive().max(600).optional(),
    end_user_role: z.string().trim().max(200).optional(),
    end_user_industry: z.string().trim().max(200).optional(),
    partner_end_user_ref: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    partner_reference: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    reseller_unique_id: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    language: z.string().trim().min(1).max(60).optional(),
    reseller_id: z.string().uuid('reseller_id must be a valid UUID'),
    client_id: z.string().uuid().optional(),
    // B2B-78 §6.3 — a sales-partner's own alias, resolved via bot_alias_mappings scoped to their
    // account. Free text at the schema layer (not an enum, unlike widget-sessions' own
    // elevenlabs_agent_id field) since the set of valid values is per-account, not global.
    bot_id: z.string().trim().min(1).max(100).optional(),
  })
  .refine((data) => Boolean(data.content_source_id), {
    message: 'content_source_id is required when content_pages is provided.',
    path: ['content_source_id'],
  })

export type CreateBotSessionInput = z.infer<typeof CreateBotSessionSchema>

export { DEFAULT_EXPECTED_DURATION_MINUTES }
