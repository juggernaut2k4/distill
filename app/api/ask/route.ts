import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { verifyTwilioSignature, parseInboundSMS, sendSMS, assignPhoneNumber } from '@/lib/delivery/sms'
import { createSupabaseAdminClient } from '@/lib/supabase'

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_')

const anthropic = isPlaceholder ? null : new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const ASK_SYSTEM_PROMPT = `You are a concise AI advisor for senior business executives. You answer questions about AI in business contexts. Keep answers under 150 characters for SMS. Write like a trusted peer. No jargon. No fluff. Be direct and immediately useful.`

/**
 * POST /api/ask
 * Handles Twilio inbound SMS webhook for Ask Anything questions.
 * Classifies intent, calls Claude, replies via SMS.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()

    if (!rawBody) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400 })
    }

    const params = new URLSearchParams(rawBody)
    const bodyRecord: Record<string, string> = {}
    params.forEach((value, key) => { bodyRecord[key] = value })

    // Verify Twilio webhook signature
    const signature = request.headers.get('x-twilio-signature') ?? ''
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'}/api/ask`

    if (!verifyTwilioSignature(request, bodyRecord, webhookUrl)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const messageBody = bodyRecord['Body'] ?? ''
    const fromNumber = bodyRecord['From'] ?? ''
    const toNumber = bodyRecord['To'] ?? ''

    const intent = parseInboundSMS(messageBody)

    if (intent !== 'question') {
      // Not a question — return empty TwiML
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      )
    }

    const supabase = createSupabaseAdminClient()

    // Look up user by phone number
    const { data: user } = await supabase
      .from('users')
      .select('id, role, industry')
      .eq('phone', fromNumber)
      .single()

    let answerText = ''

    if (isPlaceholder || !anthropic) {
      answerText = '[MOCK] AI answer: That\'s a great question about AI. The short answer is: start with one measurable problem, prove value fast, then scale. So what? Define success before you start.'
    } else {
      const userContext = user
        ? `The user is a ${user.role} in the ${user.industry} industry.`
        : 'The user is a senior business executive.'

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        system: `${ASK_SYSTEM_PROMPT} ${userContext}`,
        messages: [{ role: 'user', content: messageBody }],
      })

      answerText =
        response.content[0].type === 'text'
          ? response.content[0].text.substring(0, 155)
          : 'Sorry, I could not generate an answer right now.'
    }

    // Log to sms_conversations
    if (user) {
      await supabase.from('sms_conversations').insert({
        user_id: user.id,
        twilio_number: toNumber,
        direction: 'in',
        body: messageBody,
        received_at: new Date().toISOString(),
        intent: 'question',
      })

      await supabase.from('sms_conversations').insert({
        user_id: user.id,
        twilio_number: toNumber,
        direction: 'out',
        body: answerText,
        sent_at: new Date().toISOString(),
        intent: 'question',
      })
    }

    // Reply via TwiML
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${answerText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`

    return new Response(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (err) {
    console.error('[ask] Error:', err)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Sorry, something went wrong. Please try again.</Message></Response>`,
      { headers: { 'Content-Type': 'text/xml' } }
    )
  }
}
