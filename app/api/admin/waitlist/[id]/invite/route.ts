import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { issueDirectPartnerInvite } from '@/lib/internal-admin/direct-partner-invites'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendWaitlistInviteEmail } from '@/lib/delivery/email'

/**
 * POST /api/admin/waitlist/:id/invite — issue a direct-partner invite for one waitlist_signups row
 * and email it, in one click. WAITLIST-INVITE-01 (docs/specs/WAITLIST-INVITE-01-requirement-document.md
 * §6.3). `requireSuperAdmin()` only, no request body — name/email are read server-side from
 * waitlist_signups, never trusted from the client.
 */

const ParamsSchema = z.object({ id: z.string().uuid() })

interface Params {
  params: { id: string }
}

export async function POST(_request: NextRequest, { params }: Params) {
  const parsedParams = ParamsSchema.safeParse({ id: params.id })
  if (!parsedParams.success) {
    return NextResponse.json({ error: { code: 'invalid_id', message: 'Invalid id.' } }, { status: 400 })
  }

  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data: waitlistRow } = await supabase
    .from('waitlist_signups')
    .select('id, name, email')
    .eq('id', parsedParams.data.id)
    .maybeSingle()

  if (!waitlistRow) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Entry not found.' } }, { status: 404 })
  }

  const result = await issueDirectPartnerInvite(
    null,
    admin.internalAdminUserId as string,
    'partner',
    undefined,
    parsedParams.data.id
  )

  if (result.errorCode === 'duplicate_source_waitlist') {
    return NextResponse.json(
      { error: { code: 'already_invited', message: 'An invite has already been issued to this person.' } },
      { status: 409 }
    )
  }

  if (!result.success) {
    console.error('[admin/waitlist/invite] Failed to issue invite:', result.error)
    return NextResponse.json(
      { error: { code: 'internal_error', message: "Couldn't send this invite. Try again." } },
      { status: 500 }
    )
  }

  let emailSent = true
  try {
    const emailResult = await sendWaitlistInviteEmail(
      waitlistRow.email as string,
      waitlistRow.name as string,
      result.acceptUrl as string
    )
    emailSent = emailResult.success
  } catch (err) {
    console.error('[admin/waitlist/invite] sendWaitlistInviteEmail threw:', err)
    emailSent = false
  }

  return NextResponse.json(
    {
      success: true,
      invite: {
        status: 'pending',
        created_at: result.createdAt,
      },
      email_sent: emailSent,
    },
    { status: 201 }
  )
}
