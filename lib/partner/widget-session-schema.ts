import { z } from 'zod'
import { ContentPageSchema, DEFAULT_EXPECTED_DURATION_MINUTES } from '@/lib/partner/session-schema'
import { ELEVENLABS_AGENT_IDS } from '@/lib/voice/elevenlabs-agents'

/**
 * B2B-70 v2.0 (docs/specs/B2B-70-requirement-document.md §6.2) — request schema for
 * POST /api/partner/v1/widget-sessions. Rewritten in place: v1.1's container-only shape
 * (`container_id` + end-user fields, content resolved server-side from a pre-registered row) is
 * retired per Arun's 2026-08-03 amendment — a widget session's content is now supplied by the caller
 * on every call, exactly like the existing meeting-bot flow's inline-content mode.
 *
 * `ContentPageSchema`/`DEFAULT_EXPECTED_DURATION_MINUTES` are IMPORTED from
 * lib/partner/session-schema.ts, not redefined — shared, single-sourced shapes. This is still a
 * genuinely different Zod object from `CreateSessionSchema` (no `meeting_url`, no Option-2
 * reference-mode fields, no "exactly one of inline/reference" refine — content_pages is always
 * required here), so it is not derived from that schema either.
 */

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

export const CreateWidgetSessionSchema = z
  .object({
    content_pages: z.array(ContentPageSchema).min(1),
    content_source_id: z.string().uuid().optional(),
    content_to_explain: z.string().max(5000).optional(),
    content_title: z.string().max(200).optional(),
    content_subtitle: z.string().max(300).optional(),
    expected_duration_minutes: z.number().int().positive().max(600).optional(),
    end_user_name: z.string().trim().min(1, 'end_user_name is required').max(200),
    end_user_role: z.string().trim().max(200).optional(),
    end_user_industry: z.string().trim().max(200).optional(),
    partner_end_user_ref: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    partner_reference: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    reseller_unique_id: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    language: z.string().trim().min(1).max(60).optional(),
    reseller_id: z.string().uuid('reseller_id must be a valid UUID'),
    client_id: z.string().uuid().optional(),
    // 2026-08-10 — optional per-session ElevenLabs agent override (migration 113). Validated against
    // the 3 known agent IDs rather than accepted as free text — a caller-supplied agent_id that
    // doesn't belong to Clio's ElevenLabs account would fail opaquely at token-mint time instead of
    // at request validation. Omitted/undefined falls back to the system-wide default agent.
    elevenlabs_agent_id: z.enum(ELEVENLABS_AGENT_IDS).optional(),
  })
  .refine((data) => Boolean(data.content_source_id), {
    message: 'content_source_id is required when content_pages is provided.',
    path: ['content_source_id'],
  })

export type CreateWidgetSessionInput = z.infer<typeof CreateWidgetSessionSchema>

export { DEFAULT_EXPECTED_DURATION_MINUTES }
