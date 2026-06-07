import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAuth } from '@/lib/clerk'

/**
 * GET /api/admin/test-email?to=you@example.com
 * Sends a test email via Resend. Logs the full result so you can diagnose delivery issues.
 * Remove before production.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'hello@distill-peach.vercel.app'
  const fromName = process.env.RESEND_FROM_NAME ?? 'Clio'

  const isPlaceholder = !apiKey || apiKey.startsWith('PLACEHOLDER_')

  const diagnostics = {
    userId,
    resend_key_set: !!apiKey,
    resend_key_placeholder: isPlaceholder,
    resend_key_prefix: apiKey ? apiKey.slice(0, 6) + '...' : null,
    from_email: fromEmail,
    from_name: fromName,
    node_env: process.env.NODE_ENV,
  }

  if (isPlaceholder) {
    return NextResponse.json({ ok: false, reason: 'RESEND_API_KEY is a placeholder', diagnostics })
  }

  const to = request.nextUrl.searchParams.get('to')
  if (!to) {
    return NextResponse.json({ ok: false, reason: 'Pass ?to=your@email.com', diagnostics })
  }

  const resend = new Resend(apiKey)

  try {
    const result = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: 'Clio email test — delivery check',
      html: `<p>This is a test email from Clio. Sent at ${new Date().toISOString()}.</p><p>If you received this, Resend is configured correctly.</p>`,
      text: `Clio email test. Sent at ${new Date().toISOString()}. If you received this, Resend is configured correctly.`,
    })

    console.log('[test-email] Resend result:', JSON.stringify(result))

    if (result.error) {
      return NextResponse.json({ ok: false, resend_error: result.error, diagnostics })
    }

    return NextResponse.json({ ok: true, message_id: result.data?.id, to, diagnostics })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[test-email] Exception:', message)
    return NextResponse.json({ ok: false, exception: message, diagnostics })
  }
}
