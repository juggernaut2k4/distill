import twilio from 'twilio'
import { type NextRequest } from 'next/server'

const isPlaceholder =
  !process.env.TWILIO_ACCOUNT_SID ||
  process.env.TWILIO_ACCOUNT_SID.startsWith('PLACEHOLDER_')

const twilioClient =
  isPlaceholder
    ? null
    : twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)

/** Parse comma-separated pool from env */
function getPhonePool(): string[] {
  return (process.env.TWILIO_PHONE_POOL ?? '').split(',').filter(Boolean)
}

export type SMSIntent =
  | 'feedback_yes'
  | 'feedback_no'
  | 'question'
  | 'command'

/**
 * Sends an outbound SMS message via Twilio.
 * @param toNumber - Recipient phone number (E.164 format)
 * @param fromNumber - Twilio sender number (E.164 format)
 * @param body - SMS body text (max 160 chars recommended)
 * @returns Success/failure result
 */
export async function sendSMS(
  toNumber: string,
  fromNumber: string,
  body: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  if (isPlaceholder || !twilioClient) {
    console.log('[MOCK] sendSMS', { to: toNumber, from: fromNumber, body })
    return { success: true, sid: 'MOCK_SID' }
  }

  try {
    const message = await twilioClient.messages.create({
      to: toNumber,
      from: fromNumber,
      body,
    })
    return { success: true, sid: message.sid }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: msg }
  }
}

/**
 * Assigns a Twilio phone number to a user based on their plan.
 * Pro/Starter: shared pool. Executive: dedicated number (first available).
 * @param userId - User ID (used for future dedicated number lookup)
 * @param plan - User's subscription plan tier
 * @returns Assigned phone number in E.164 format
 */
export function assignPhoneNumber(
  userId: string,
  plan: 'starter' | 'pro' | 'executive' | 'free'
): string {
  const pool = getPhonePool()

  if (pool.length === 0) {
    console.log('[MOCK] assignPhoneNumber — pool empty, using mock number')
    return '+15550000001'
  }

  if (plan === 'executive') {
    // For Executive: assign first pool number as "dedicated"
    // In production, buy a dedicated number per user via Twilio API
    return pool[0]
  }

  // For Starter/Pro: round-robin across pool
  const hash = userId
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return pool[hash % pool.length]
}

/**
 * Verifies the authenticity of an inbound Twilio webhook request.
 * @param request - Incoming Next.js request
 * @param body - Parsed request body as key-value record
 * @param url - Full URL of the webhook endpoint
 * @returns true if signature is valid
 */
export function verifyTwilioSignature(
  request: NextRequest,
  body: Record<string, string>,
  url: string
): boolean {
  if (isPlaceholder) {
    console.log('[MOCK] verifyTwilioSignature — skipping in mock mode')
    return true
  }

  const signature = request.headers.get('x-twilio-signature') ?? ''
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  return twilio.validateRequest(authToken, signature, url, body)
}

/**
 * Classifies the intent of an inbound SMS message.
 * @param body - The raw SMS body text from the user
 * @returns Classified intent type
 */
export function parseInboundSMS(body: string): SMSIntent {
  const normalized = body.trim().toUpperCase()

  if (normalized === 'Y' || normalized === 'YES') {
    return 'feedback_yes'
  }

  if (normalized === 'N' || normalized === 'NO') {
    return 'feedback_no'
  }

  if (normalized === 'STOP' || normalized === 'PAUSE' || normalized === 'UNSUBSCRIBE') {
    return 'command'
  }

  // Anything else is treated as a question for Ask Anything
  return 'question'
}
