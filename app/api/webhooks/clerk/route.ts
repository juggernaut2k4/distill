import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSignupWelcomeEmail } from '@/lib/delivery/email'
import { inngest } from '@/inngest/client'
import { OnboardingSchema, saveOnboardingProfile } from '@/lib/onboarding'
import { createOrClaimPartnerAccount } from '@/lib/partner/signup'

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
    // ONBOARD-DATA-01: answers attached via <SignUp unsafeMetadata={...}> so
    // the full profile can be saved here, atomically with account creation —
    // no longer dependent on browser localStorage surviving the sign-up trip.
    unsafe_metadata?: Record<string, unknown>
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

  // B2B-25: partner self-serve signup — new branch, sibling to the existing
  // ONBOARD-DATA-01 unsafeMetadata branch below, checked first since the two
  // are mutually exclusive by signup_intent. Replaces the retired
  // Clerk-Organizations flow (docs/specs/B2B-25-requirement-document.md §6.3).
  if (event.data.unsafe_metadata?.signup_intent === 'partner') {
    const companyName = typeof event.data.unsafe_metadata.company_name === 'string'
      ? event.data.unsafe_metadata.company_name.trim()
      : ''
    if (!companyName) {
      console.error('[clerk-webhook] partner signup_intent with missing/empty company_name for', id)
      // No partner_accounts row is created — see B2B-25 §8 Edge Cases for why
      // this is treated as a hard-stop rather than a fallback name.
    } else {
      const result = await createOrClaimPartnerAccount(id, companyName, primaryEmail)
      if (!result.success) {
        console.error('[clerk-webhook] createOrClaimPartnerAccount failed:', result.error)
      }
    }
    return NextResponse.json({ received: true })
  }

  // ONBOARD-DATA-01: if onboarding answers were attached to the sign-up via
  // unsafeMetadata, save the full profile now — atomically with account
  // creation, before this webhook returns. This is the primary save path;
  // the client's own POST /api/onboarding (localStorage-driven) remains as
  // a fallback for any account created without metadata attached.
  if (event.data.unsafe_metadata && Object.keys(event.data.unsafe_metadata).length > 0) {
    const parsed = OnboardingSchema.safeParse({ ...event.data.unsafe_metadata, email: primaryEmail, phone: primaryPhone ?? undefined })
    if (parsed.success) {
      const result = await saveOnboardingProfile(id, parsed.data)
      if (!result.success) {
        console.error('[clerk-webhook] Failed to save onboarding profile from unsafeMetadata:', result.error)
      } else {
        console.log('[clerk-webhook] Onboarding profile saved from unsafeMetadata for', id)
      }
    } else {
      console.error('[clerk-webhook] unsafeMetadata present but failed validation:', parsed.error.flatten())
    }
  }

  // Send welcome email
  const result = await sendSignupWelcomeEmail(primaryEmail, first_name ?? '')
  if (!result.success) {
    console.error('[clerk-webhook] Failed to send welcome email to', primaryEmail, result.error)
  }

  return NextResponse.json({ received: true })
}
