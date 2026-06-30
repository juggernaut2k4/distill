import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSignupWelcomeEmail } from '@/lib/delivery/email'
import { inngest } from '@/inngest/client'

interface ClerkEmailAddress {
  email_address: string
  id: string
}

interface ClerkPhoneNumber {
  phone_number: string
  id: string
}

interface ClerkUserCreatedEvent {
  data: {
    id: string
    email_addresses: ClerkEmailAddress[]
    primary_email_address_id: string
    phone_numbers?: ClerkPhoneNumber[]
    primary_phone_number_id?: string | null
    first_name: string | null
    last_name: string | null
  }
  type: 'user.created'
}

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) {
    console.error('[clerk-webhook] CLERK_WEBHOOK_SECRET not set')
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

  let event: ClerkUserCreatedEvent
  try {
    const wh = new Webhook(secret)
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkUserCreatedEvent
  } catch (err) {
    console.error('[clerk-webhook] Signature verification failed:', err)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  if (event.type !== 'user.created') {
    return NextResponse.json({ received: true })
  }

  const { id, email_addresses, primary_email_address_id, phone_numbers, primary_phone_number_id, first_name } = event.data

  const primaryEmail = email_addresses.find(
    (e) => e.id === primary_email_address_id
  )?.email_address

  if (!primaryEmail) {
    console.error('[clerk-webhook] No primary email for user', id)
    return NextResponse.json({ received: true })
  }

  // Extract primary phone number if Clerk has one (e.g. from phone-based sign-up)
  const primaryPhone = primary_phone_number_id
    ? (phone_numbers ?? []).find((p) => p.id === primary_phone_number_id)?.phone_number ?? null
    : null

  // Upsert user row in Supabase so email + phone are always captured at sign-up,
  // regardless of whether the user completes the onboarding form immediately.
  const supabase = createSupabaseAdminClient()
  const { error: upsertError } = await supabase
    .from('users')
    .upsert(
      { id, email: primaryEmail, phone: primaryPhone },
      { onConflict: 'id', ignoreDuplicates: false }
    )

  if (upsertError) {
    console.error('[clerk-webhook] Failed to upsert user in Supabase:', upsertError.message)
  } else {
    console.log('[clerk-webhook] User upserted in Supabase:', id, primaryEmail, primaryPhone ?? 'no phone')
    // Start 75-minute abandoned-onboarding cleanup timer
    inngest.send({
      name: 'clio/user.created',
      data: { userId: id, email: primaryEmail, createdAt: new Date().toISOString() },
    }).catch((err: unknown) => console.error('[clerk-webhook] Failed to emit clio/user.created:', err))
  }

  // Send welcome email
  const result = await sendSignupWelcomeEmail(primaryEmail, first_name ?? '')
  if (!result.success) {
    console.error('[clerk-webhook] Failed to send welcome email to', primaryEmail, result.error)
  }

  return NextResponse.json({ received: true })
}
