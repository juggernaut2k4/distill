import { NextResponse } from 'next/server'
import { requireShowcaseAccess } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/channel-partner/showcase/content-source
 *
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §6.7). Idempotent —
 * registers exactly one `auth_type: 'none'` `partner_content_sources` row
 * for the caller's account and returns its id, or returns the existing one
 * if already registered. Byte-identical insert shape to
 * `POST /api/partner/v1/content-sources`'s `auth_type: 'none'` branch
 * (`app/api/partner/v1/content-sources/route.ts` lines 80-84) — inserted
 * directly here rather than via an HTTP round-trip to that endpoint, since
 * that endpoint is gated by `requirePartnerApiKey` (a partner API key), and
 * a channel_partner-kind account has no Configurator access to ever
 * generate one (`requirePartnerAdmin`'s B2B-26 §6.14 block).
 */
export async function POST() {
  const access = await requireShowcaseAccess()
  if (access.error) return access.error

  const supabase = createSupabaseAdminClient()
  const { data: content } = await supabase
    .from('partner_showcase_content')
    .select('id, content_source_id')
    .eq('partner_account_id', access.partnerAccountId)
    .maybeSingle()

  if (!content) {
    return NextResponse.json({ error: { code: 'content_required', message: 'Save some Content first.' } }, { status: 422 })
  }
  if (content.content_source_id) {
    return NextResponse.json({ content_source_id: content.content_source_id as string })
  }

  const { data: inserted, error } = await supabase
    .from('partner_content_sources')
    .insert({ partner_account_id: access.partnerAccountId, auth_type: 'none', label: 'Showcase demo' })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[channel-partner/showcase/content-source] insert failed:', error?.message)
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to register content source.' } },
      { status: 500 }
    )
  }

  await supabase.from('partner_showcase_content').update({ content_source_id: inserted.id }).eq('id', content.id)
  return NextResponse.json({ content_source_id: inserted.id as string })
}
