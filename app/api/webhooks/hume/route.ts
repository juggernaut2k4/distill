import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { writeAuditEvent } from '@/lib/session-billing'
import { inngest } from '@/inngest/client'

/**
 * HUME-WEBHOOK-01 / HUME-GROUND-TRUTH-01 — receives Hume's server-to-server
 * `chat_started` / `chat_ended` webhook events.
 *
 * No Clerk auth — Hume's servers have no Clerk session, identical posture to
 * /api/webhooks/stripe and /api/webhooks/twilio. HMAC signature verification
 * against HUME_WEBHOOK_SECRET is the only gate.
 *
 * Signature must be verified BEFORE the body is parsed as JSON — the raw
 * body text is what the signature covers. Signed string =
 * `timestamp + '.' + rawBody`, HMAC-SHA256, compared with
 * crypto.timingSafeEqual, mirroring verifyAuditToken() in
 * lib/session-billing.ts (lines ~62-69).
 *
 * NOTE (per HUME-GROUND-TRUTH-01 Section 11): the exact signed-string
 * concatenation format below (`timestamp + '.' + rawBody`) is the spec's
 * best-supported guess, matching Stripe's convention and the two-header
 * shape Hume documents. It is explicitly flagged as requiring live
 * verification against one real Hume test webhook delivery before this
 * endpoint is trusted with production traffic — see that spec's Section 11
 * for the fallback investigation path if the computed signature does not
 * match a real delivery.
 */

interface HumeWebhookEvent {
  event_type?: string
  event_name?: string
  chat_id?: string
  data?: {
    chat_id?: string
    end_reason?: string
    duration_seconds?: number
    config_id?: string
  }
  end_reason?: string
  duration_seconds?: number
  config_id?: string
}

function verifyHumeSignature(rawBody: string, timestamp: string, signature: string, secret: string): boolean {
  const signedString = `${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', secret).update(signedString).digest('hex')

  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(signature)
  if (expectedBuf.length !== providedBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}

export async function POST(request: Request) {
  const secret = process.env.HUME_WEBHOOK_SECRET
  if (!secret) {
    console.error('[hume-webhook] HUME_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 400 })
  }

  const signature = request.headers.get('X-Hume-AI-Webhook-Signature')
  const timestamp = request.headers.get('X-Hume-AI-Webhook-Timestamp')

  if (!signature || !timestamp) {
    return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 })
  }

  // Read raw body text BEFORE any JSON parsing — verification must run
  // against the exact bytes Hume signed.
  const rawBody = await request.text()

  let signatureValid: boolean
  try {
    signatureValid = verifyHumeSignature(rawBody, timestamp, signature, secret)
  } catch (err) {
    console.error('[hume-webhook] Signature verification threw:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (!signatureValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: HumeWebhookEvent
  try {
    event = JSON.parse(rawBody) as HumeWebhookEvent
  } catch (err) {
    console.error('[hume-webhook] Failed to parse body:', err instanceof Error ? err.message : 'unknown error')
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 })
  }

  const eventType = event.event_type ?? event.event_name

  if (eventType === 'chat_started') {
    return NextResponse.json({ received: true })
  }

  if (eventType !== 'chat_ended') {
    // Unknown/unsubscribed event type — accept and no-op rather than error,
    // since Hume may add new event types we haven't subscribed to logic for.
    return NextResponse.json({ received: true })
  }

  const chatId = event.chat_id ?? event.data?.chat_id
  const endReason = event.end_reason ?? event.data?.end_reason
  const durationSeconds = event.duration_seconds ?? event.data?.duration_seconds
  const configId = event.config_id ?? event.data?.config_id

  if (!chatId) {
    console.warn('[hume-webhook] chat_ended event missing chat_id — cannot resolve session')
    return NextResponse.json({ received: true })
  }

  try {
    const supabase = createSupabaseAdminClient()
    const { data: session, error } = await supabase
      .from('sessions')
      .select('id, user_id')
      .eq('hume_chat_id', chatId)
      .maybeSingle()

    if (error) {
      console.error('[hume-webhook] Failed to resolve session for chat_id:', error.message)
      return NextResponse.json({ received: true })
    }

    if (!session) {
      console.warn('[hume-webhook] No sessions row found for hume_chat_id:', chatId)
      return NextResponse.json({ received: true })
    }

    await writeAuditEvent({
      sessionId: session.id as string,
      userId: session.user_id as string,
      eventType: 'hume_webhook_chat_ended',
      metadata: {
        end_reason: endReason ?? null,
        duration_seconds: durationSeconds ?? null,
        config_id: configId ?? null,
        chat_id: chatId,
      },
    })

    // HUME-NATIVE-02 Part B — fast-path trigger for post-session action-item
    // and glitch extraction. Fires immediately after the audit-event write
    // succeeds, mirroring FB-HUME-GROUND-TRUTH-01-elevated.md's Decision 1
    // (additional, faster-arriving trigger, never the sole mechanism — a
    // 30-minute backstop cron sweep in inngest/hume-action-item-extractor.ts
    // catches any session this event never reaches). Never awaited in a way
    // that can throw out of this handler — inngest.send() failures are
    // swallowed by the outer catch below, same as every other operation here.
    await inngest.send({
      name: 'clio/hume-native-session.ended',
      data: { sessionId: session.id as string },
    })
  } catch (err) {
    // Never throw — a DB write failure here must never cause Hume to retry
    // or see a 5xx. writeAuditEvent() already logs+swallows its own errors;
    // this catch guards against any other unexpected failure in this block.
    console.error('[hume-webhook] Unexpected error processing chat_ended:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ received: true })
}
