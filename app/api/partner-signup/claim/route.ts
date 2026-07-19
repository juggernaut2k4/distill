import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth as clerkAuth, currentUser } from '@clerk/nextjs/server'
import { createOrClaimPartnerAccount } from '@/lib/partner/signup'

/**
 * POST /api/partner-signup/claim
 *
 * B2B-25 — write path B (docs/specs/B2B-25-requirement-document.md §6.4).
 * Serves `/partner-signup` State 2b: an already-signed-in visitor who
 * reaches `/partner-signup` (e.g. via `/sign-in`'s built-in "Sign up" link)
 * cannot usefully re-render Clerk's `<SignUp>`, so this authenticated route
 * runs the identical account-creation logic keyed off the current session's
 * userId instead of `unsafeMetadata`.
 */

const ClaimSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  // B2B-26 (docs/specs/B2B-26-requirement-document.md §6.3) — required, not
  // defaulted: this route only ever receives a request from this brief's own
  // client code, which always sends a real boolean; a malformed body here
  // indicates a client bug worth surfacing loudly via a 422, not silently
  // defaulting (unlike the webhook branch's lenient `=== true` fallback).
  managesMultipleClients: z.boolean(),
})

export async function POST(request: NextRequest) {
  const { userId } = clerkAuth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 422 })
  }

  const parsed = ClaimSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const user = await currentUser()
  const primaryEmail = user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress

  if (!primaryEmail) {
    console.error('[partner-signup/claim] No primary email for Clerk user', userId)
    return NextResponse.json({ success: false, error: 'Failed to set up your account.' }, { status: 500 })
  }

  const accountKind = parsed.data.managesMultipleClients ? 'channel_partner' : 'partner'
  const result = await createOrClaimPartnerAccount(userId, parsed.data.companyName, primaryEmail, accountKind)
  if (!result.success) {
    console.error('[partner-signup/claim] createOrClaimPartnerAccount failed:', result.error)
    return NextResponse.json({ success: false, error: 'Failed to set up your account.' }, { status: 500 })
  }

  return NextResponse.json({ success: true, alreadyMember: result.alreadyMember, accountKind: result.accountKind })
}
