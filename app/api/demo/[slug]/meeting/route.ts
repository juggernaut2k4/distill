import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDemoTopicBySlug } from '@/app/demo/_content'
import { resolveDemoPasscodeToAccount } from '@/lib/demo/passcode-accounts'

/**
 * GET/POST /api/demo/[slug]/meeting
 *
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.1/§6.2). Reads/writes the Google Meet URL
 * Arun wants Clio's real bot to join for a given public demo topic. GET is unauthenticated
 * (page-viewing-equivalent — the "Currently saved" summary line and the Learn with AI button's
 * enabled/disabled state both depend on it). POST is passcode-gated (write-only gate, §0 Known
 * Constraints) — since /demo/* stays fully public.
 *
 * B2B-42 (docs/specs/B2B-42-requirement-document.md §6.1) — the passcode check now resolves,
 * per-account, via `resolveDemoPasscodeToAccount()` (lib/demo/passcode-accounts.ts), the same
 * mechanism and the exact same call pattern `app/api/demo/[slug]/dispatch/route.ts` already uses —
 * no longer the single shared `DEMO_MEETING_PASSCODE` env var (lib/demo/passcode.ts, deleted as part
 * of this brief once this was its only functional caller). Save is a gate-only consumer: unlike
 * dispatch, it never reads `resolved.partnerAccountId` or `resolved.passcodeId` — saving a meeting
 * URL/name has no billing or attribution consequence (that lives solely in `demo_dispatches`,
 * written by the dispatch route at dispatch time). A passcode issued/regenerated for any
 * `channel_partner` account or the admin sentinel account now unlocks both Save and dispatch
 * uniformly.
 */

const SaveMeetingUrlSchema = z.object({
  meeting_url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'meeting_url must be an https:// URL' }),
  // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.7) — required. Mirrors
  // end_user_name's own .min(1) at the partner-API layer (§6.2) — the demo path enforces the
  // same "required everywhere" rule via its own schema.
  end_user_name: z.string().trim().min(1, 'Name is required').max(200),
  passcode: z.string().min(1),
})

export async function GET(_request: NextRequest, { params }: { params: { slug: string } }) {
  if (!getDemoTopicBySlug(params.slug)) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Unknown demo topic.' } }, { status: 404 })
  }

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('demo_meeting_urls')
    .select('meeting_url, end_user_name, updated_at')
    .eq('slug', params.slug)
    .maybeSingle()

  return NextResponse.json({
    meeting_url: data?.meeting_url ?? null,
    end_user_name: data?.end_user_name ?? null,
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
      {
        error: {
          code: 'validation_failed',
          // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.7) — updated: the schema now
          // validates two required fields, so this message should not silently mislead a caller
          // whose name field failed instead of their URL.
          message: 'Enter a name and a valid https:// meeting URL.',
          details: parsed.error.flatten(),
        },
      },
      { status: 422 }
    )
  }

  // B2B-42 (docs/specs/B2B-42-requirement-document.md §6.1) — replaces the single
  // verifyDemoPasscode() call. Same error shape/code as before — visitor-facing behavior is
  // unchanged; only the server-side resolution mechanism changed (one shared secret -> a
  // per-account hashed-passcode lookup), mirroring dispatch/route.ts's own B2B-39 integration.
  const resolved = await resolveDemoPasscodeToAccount(parsed.data.passcode)
  if (!resolved) {
    return NextResponse.json({ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }, { status: 401 })
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('demo_meeting_urls')
    .upsert(
      { slug: params.slug, meeting_url: parsed.data.meeting_url, end_user_name: parsed.data.end_user_name },
      { onConflict: 'slug' }
    )
    .select('meeting_url, end_user_name, updated_at')
    .single()

  if (error || !data) {
    console.error('[demo/meeting] Failed to upsert demo_meeting_urls:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: "Couldn't save — try again." } }, { status: 500 })
  }

  return NextResponse.json({ meeting_url: data.meeting_url, end_user_name: data.end_user_name, updated_at: data.updated_at })
}
