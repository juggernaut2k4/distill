import { NextRequest, NextResponse } from 'next/server'
import { verifyTwilioSignature, parseInboundSMS } from '@/lib/delivery/sms'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/feedback?v=1&id=<delivery_log_id>
 * Handles one-click email feedback links (thumbs up/down in email body).
 * v=1 → positive, v=0 → negative. The delivery_log UUID is the access token.
 * Redirects to dashboard after recording — no auth required (UUID is the secret).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const v = searchParams.get('v')
  const id = searchParams.get('id')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  if (!id || (v !== '0' && v !== '1')) {
    return NextResponse.redirect(`${appUrl}/dashboard`)
  }

  const feedbackValue = v === '1' ? 'positive' : 'negative'
  const supabase = createSupabaseAdminClient()

  try {
    // Fetch the delivery log row to get user_id and content_item_id
    const { data: delivery } = await supabase
      .from('delivery_log')
      .select('id, user_id, content_item_id')
      .eq('id', id)
      .single()

    if (delivery) {
      await supabase
        .from('delivery_log')
        .update({ feedback: feedbackValue })
        .eq('id', id)

      try {
        const { inngest } = await import('@/inngest/client')
        await inngest.send({
          name: 'clio/feedback.received',
          data: {
            userId: delivery.user_id,
            contentItemId: delivery.content_item_id,
            deliveryLogId: delivery.id,
            feedback: feedbackValue,
          },
        })
      } catch {
        // Mock mode — event not sent
      }
    }
  } catch (err) {
    console.error('[feedback GET] Error:', err)
  }

  // Redirect to dashboard messages page regardless of outcome
  return NextResponse.redirect(`${appUrl}/dashboard/messages`)
}

/**
 * POST /api/feedback
 * Handles Twilio inbound SMS webhook for Y/N feedback responses.
 * Verifies Twilio signature, logs feedback, emits Inngest event.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const params = new URLSearchParams(rawBody)
    const bodyRecord: Record<string, string> = {}
    params.forEach((value, key) => { bodyRecord[key] = value })

    // Verify Twilio webhook signature
    const signature = request.headers.get('x-twilio-signature') ?? ''
    const webhookUrl = process.env.TWILIO_WEBHOOK_URL ?? `${process.env.NEXT_PUBLIC_APP_URL}/api/feedback`

    if (!verifyTwilioSignature(request, bodyRecord, webhookUrl)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const messageBody = bodyRecord['Body'] ?? ''
    const fromNumber = bodyRecord['From'] ?? ''

    const intent = parseInboundSMS(messageBody)

    if (intent !== 'feedback_yes' && intent !== 'feedback_no') {
      // Not a feedback response — return early (handled by /api/ask)
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    const supabase = createSupabaseAdminClient()

    // Look up user by phone number
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('phone', fromNumber)
      .single()

    if (user) {
      // Find most recent delivery log entry that hasn't received feedback
      // Select content_item_id too so it can be included in the Inngest event payload
      const { data: latestDelivery } = await supabase
        .from('delivery_log')
        .select('id, content_item_id')
        .eq('user_id', user.id)
        .is('feedback', null)
        .order('sent_at', { ascending: false })
        .limit(1)
        .single()

      if (latestDelivery) {
        const feedbackValue = intent === 'feedback_yes' ? 'positive' : 'negative'

        await supabase
          .from('delivery_log')
          .update({ feedback: feedbackValue })
          .eq('id', latestDelivery.id)

        // Emit Inngest event for feedback processor
        // Dynamically import to avoid build errors if INNGEST_EVENT_KEY is placeholder
        try {
          const { inngest } = await import('@/inngest/client')
          await inngest.send({
            name: 'clio/feedback.received',
            data: {
              userId: user.id,
              contentItemId: latestDelivery.content_item_id,
              deliveryLogId: latestDelivery.id,
              feedback: feedbackValue,
            },
          })
        } catch {
          console.log('[feedback] Inngest event not sent (mock mode)')
        }
      }
    }

    // Return TwiML response acknowledging receipt
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thanks for your feedback! It helps us sharpen your daily insights. — Clio</Message>
</Response>`

    return new Response(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (err) {
    console.error('[feedback] Error:', err)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }
}
