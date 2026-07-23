import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDemoTopicBySlug } from '@/app/demo/_content'
import { verifyDemoPasscode } from '@/lib/demo/passcode'

/**
 * GET/POST /api/demo/[slug]/meeting
 *
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.1/§6.2). Reads/writes the Google Meet URL
 * Arun wants Clio's real bot to join for a given public demo topic. GET is unauthenticated
 * (page-viewing-equivalent — the "Currently saved" summary line and the Learn with AI button's
 * enabled/disabled state both depend on it). POST is passcode-gated (write-only gate, §0 Known
 * Constraints) — a shared secret check, not a login/session, since /demo/* stays fully public.
 */

const SaveMeetingUrlSchema = z.object({
  meeting_url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'meeting_url must be an https:// URL' }),
  passcode: z.string().min(1),
})

export async function GET(_request: NextRequest, { params }: { params: { slug: string } }) {
  if (!getDemoTopicBySlug(params.slug)) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Unknown demo topic.' } }, { status: 404 })
  }

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('demo_meeting_urls')
    .select('meeting_url, updated_at')
    .eq('slug', params.slug)
    .maybeSingle()

  return NextResponse.json({
    meeting_url: data?.meeting_url ?? null,
    updated_at: data?.updated_at ?? null,
  })
}

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  if (!getDemoTopicBySlug(params.slug)) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Unknown demo topic.' } }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = SaveMeetingUrlSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Enter a valid https:// meeting URL.', details: parsed.error.flatten() } },
      { status: 422 }
    )
  }

  if (!verifyDemoPasscode(parsed.data.passcode)) {
    return NextResponse.json({ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }, { status: 401 })
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('demo_meeting_urls')
    .upsert({ slug: params.slug, meeting_url: parsed.data.meeting_url }, { onConflict: 'slug' })
    .select('meeting_url, updated_at')
    .single()

  if (error || !data) {
    console.error('[demo/meeting] Failed to upsert demo_meeting_urls:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: "Couldn't save — try again." } }, { status: 500 })
  }

  return NextResponse.json({ meeting_url: data.meeting_url, updated_at: data.updated_at })
}
