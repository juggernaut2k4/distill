import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShowcaseAccess } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET/PATCH /api/channel-partner/showcase/content
 *
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §6.6). One row per
 * channel-partner account (`partner_showcase_content`, unique on
 * `partner_account_id`) — GET returns it (or nulls if none exists yet),
 * PATCH upserts on that unique constraint. `maxLength` caps mirror
 * `CreateSessionSchema`'s own `content_to_explain` cap (5000) so nothing
 * typed here can ever fail that schema check downstream.
 */

const PatchSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  subtitle: z.string().max(300).optional().nullable(),
  contentToExplain: z.string().max(5000).optional().nullable(),
})

export async function GET() {
  const access = await requireShowcaseAccess()
  if (access.error) return access.error

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_showcase_content')
    .select('title, subtitle, content_to_explain')
    .eq('partner_account_id', access.partnerAccountId)
    .maybeSingle()

  return NextResponse.json({
    title: (data?.title as string | null) ?? null,
    subtitle: (data?.subtitle as string | null) ?? null,
    content_to_explain: (data?.content_to_explain as string | null) ?? null,
    // Additive — lets the Visualization tab distinguish "no Content row saved
    // yet" (AT-7) from "a row exists but every field happens to be blank",
    // which bare null-checking on the three fields above cannot do reliably.
    exists: data != null,
  })
}

export async function PATCH(request: NextRequest) {
  const access = await requireShowcaseAccess()
  if (access.error) return access.error

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.from('partner_showcase_content').upsert(
    {
      partner_account_id: access.partnerAccountId,
      title: parsed.data.title ?? null,
      subtitle: parsed.data.subtitle ?? null,
      content_to_explain: parsed.data.contentToExplain ?? null,
    },
    { onConflict: 'partner_account_id' }
  )

  if (error) {
    console.error('[channel-partner/showcase/content] upsert failed:', error.message)
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
