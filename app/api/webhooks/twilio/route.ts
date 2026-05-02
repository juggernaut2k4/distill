import { NextRequest, NextResponse } from 'next/server'
import { verifyTwilioSignature, parseInboundSMS } from '@/lib/delivery/sms'

/**
 * POST /api/webhooks/twilio
 * Central handler for all inbound Twilio SMS messages.
 * Verifies signature, classifies intent, routes to feedback or ask handlers.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const params = new URLSearchParams(rawBody)
    const bodyRecord: Record<string, string> = {}
    params.forEach((value, key) => { bodyRecord[key] = value })

    // Verify Twilio webhook signature
    const signature = request.headers.get('x-twilio-signature') ?? ''
    const webhookUrl = process.env.TWILIO_WEBHOOK_URL ??
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://getdistill.ai'}/api/webhooks/twilio`

    if (!verifyTwilioSignature(request, bodyRecord, webhookUrl)) {
      return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 })
    }

    const messageBody = bodyRecord['Body'] ?? ''
    const intent = parseInboundSMS(messageBody)

    // Route to the appropriate handler
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://getdistill.ai'

    if (intent === 'feedback_yes' || intent === 'feedback_no') {
      // Forward to feedback handler
      const feedbackResponse = await fetch(`${appUrl}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        },
        body: rawBody,
      })
      return feedbackResponse
    }

    if (intent === 'question') {
      // Forward to Ask Anything handler
      const askResponse = await fetch(`${appUrl}/api/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        },
        body: rawBody,
      })
      return askResponse
    }

    if (intent === 'command') {
      // Handle STOP/PAUSE commands
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>You've been paused. Reply START to resume your Distill insights.</Message></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    )
  } catch (err) {
    console.error('[twilio-webhook] Error:', err)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }
}
