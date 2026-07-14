import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import { dispatchMeetingBot } from '@/lib/partner/session-init'

/**
 * POST /api/partner/v1/sessions
 *
 * Session-initiation contract. See
 * docs/specs/B2B-02-requirement-document.md Section 4.1 and
 * architecture.md Section 4 for the full sequence. Authenticated by a
 * partner API key (never a Clerk session — see lib/partner/auth.ts's "Two
 * Auth Systems" note).
 */

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

const CreateSessionSchema = z
  .object({
    meeting_url: z.string().url(),
    partner_topic_ref: z.string().min(1).max(512).regex(PRINTABLE_ASCII).optional(),
    content_ref: z.string().uuid().optional(),
    partner_end_user_ref: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
    partner_reference: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
  })
  .refine((data) => Boolean(data.partner_topic_ref || data.content_ref), {
    message: 'At least one of partner_topic_ref or content_ref is required.',
    path: ['partner_topic_ref'],
  })

export async function POST(request: NextRequest) {
  const auth = await requirePartnerApiKey(request, 'sessions_create')
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null)
  const parsed = CreateSessionSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const { meeting_url, partner_topic_ref, content_ref, partner_end_user_ref, partner_reference } = parsed.data

  const supabase = createSupabaseAdminClient()
  const { data: inserted, error: insertError } = await supabase
    .from('partner_sessions')
    .insert({
      partner_account_id: auth.partnerAccountId,
      partner_api_key_id: auth.apiKeyId,
      test_mode: auth.mode === 'test',
      meeting_url,
      partner_topic_ref: partner_topic_ref ?? null,
      content_ref: content_ref ?? null,
      partner_end_user_ref: partner_end_user_ref ?? null,
      partner_reference: partner_reference ?? null,
      status: 'requested',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('[partner/sessions] Failed to insert partner_sessions row:', insertError?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create session.' } }, { status: 500 })
  }

  const clioSessionRef = inserted.id as string
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const renderUrl = `${appUrl}/partner-render/${clioSessionRef}`

  const dispatchResult = await dispatchMeetingBot({ clioSessionRef, meetingUrl: meeting_url, renderUrl })

  return NextResponse.json(
    {
      clio_session_ref: clioSessionRef,
      status: dispatchResult.status,
      render_url: renderUrl,
      ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
    },
    { status: 201 }
  )
}
