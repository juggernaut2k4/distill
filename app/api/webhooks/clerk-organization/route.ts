import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPartnerSignupWelcomeEmail } from '@/lib/delivery/email'
import { inngest } from '@/inngest/client'

/**
 * POST /api/webhooks/clerk-organization
 *
 * B2B-06 — self-serve partner signup (docs/specs/B2B-06-requirement-document.md
 * Section 4.B.1, architecture.md §18.6). Handles Clerk's `organization.created`
 * and `organizationMembership.created` events. Structurally identical to
 * `app/api/webhooks/clerk/route.ts` (svix verify → switch on event type) but a
 * genuinely separate route — that file is never touched by this brief.
 */

interface ClerkOrgCreatedEvent {
  type: 'organization.created'
  data: { id: string; name: string; created_by: string }
}
interface ClerkOrgMembershipCreatedEvent {
  type: 'organizationMembership.created'
  data: { organization: { id: string }; public_user_data: { user_id: string; identifier: string } }
}
type ClerkOrgEvent = ClerkOrgCreatedEvent | ClerkOrgMembershipCreatedEvent | { type: string; data: unknown }

export async function POST(request: Request) {
  const secret = process.env.CLERK_ORGANIZATION_WEBHOOK_SECRET
  if (!secret) {
    console.error('[clerk-org-webhook] CLERK_ORGANIZATION_WEBHOOK_SECRET not set')
    return new NextResponse('Webhook secret not configured', { status: 500 })
  }

  const headersList = headers()
  const svixId = headersList.get('svix-id')
  const svixTimestamp = headersList.get('svix-timestamp')
  const svixSignature = headersList.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse('Missing svix headers', { status: 400 })
  }

  const body = await request.text()
  let event: ClerkOrgEvent
  try {
    const wh = new Webhook(secret)
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkOrgEvent
  } catch (err) {
    console.error('[clerk-org-webhook] Signature verification failed:', err)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  if (event.type === 'organization.created') {
    const data = event.data as ClerkOrgCreatedEvent['data']

    const { data: account, error } = await supabase
      .from('partner_accounts')
      .upsert(
        { clerk_org_id: data.id, name: data.name, archetype: 'unspecified', status: 'active' },
        { onConflict: 'clerk_org_id', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle()

    // ignoreDuplicates: true returns no row on a conflict (Clerk redelivery) — resolve the
    // already-existing row instead so the Inngest emit below still fires with a valid id.
    const partnerAccountId =
      account?.id ?? (await supabase.from('partner_accounts').select('id').eq('clerk_org_id', data.id).single()).data?.id

    if (!error && partnerAccountId) {
      inngest
        .send({ name: 'clio/partner-org.created', data: { partnerAccountId, orgName: data.name, createdAt: new Date().toISOString() } })
        .catch((err: unknown) => console.error('[clerk-org-webhook] Failed to emit clio/partner-org.created:', err))
    } else if (error) {
      console.error('[clerk-org-webhook] Failed to upsert partner_accounts:', error.message)
    }

    return NextResponse.json({ received: true })
  }

  if (event.type === 'organizationMembership.created') {
    const data = event.data as ClerkOrgMembershipCreatedEvent['data']

    const { data: account } = await supabase
      .from('partner_accounts')
      .select('id')
      .eq('clerk_org_id', data.organization.id)
      .maybeSingle()

    if (!account) {
      // organization.created hasn't landed yet (a genuine Clerk delivery-ordering race) —
      // non-2xx so Clerk's own webhook retry mechanism redelivers later. Never silently dropped,
      // never a partner_admin_users row inserted with a dangling/null partner_account_id.
      return new NextResponse('Organization not yet provisioned', { status: 409 })
    }

    const { count } = await supabase
      .from('partner_admin_users')
      .select('id', { count: 'exact', head: true })
      .eq('partner_account_id', account.id)

    const role = (count ?? 0) === 0 ? 'owner' : 'admin'

    const { error: insertError } = await supabase
      .from('partner_admin_users')
      .upsert(
        { clerk_user_id: data.public_user_data.user_id, partner_account_id: account.id, role },
        { onConflict: 'clerk_user_id,partner_account_id', ignoreDuplicates: true }
      )

    if (insertError) {
      console.error('[clerk-org-webhook] Failed to upsert partner_admin_users:', insertError.message)
    } else if (role === 'owner') {
      const { data: orgRow } = await supabase.from('partner_accounts').select('name').eq('id', account.id).single()
      await sendPartnerSignupWelcomeEmail(data.public_user_data.identifier, orgRow?.name ?? 'your organization').catch(
        (err: unknown) => console.error('[clerk-org-webhook] sendPartnerSignupWelcomeEmail failed:', err)
      )
    }

    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}
