import { Resend } from 'resend'

const isPlaceholder = !process.env.RESEND_API_KEY ||
  process.env.RESEND_API_KEY.startsWith('PLACEHOLDER_')

const resend = isPlaceholder ? null : new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'hello@hello-clio.com'
const FROM_NAME = process.env.RESEND_FROM_NAME ?? 'Clio'
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`

function logEmailResult(fnName: string, to: string, result: { data?: { id?: string } | null; error?: { message: string } | null }) {
  if (result.error) {
    console.error(`[email:${fnName}] FAILED to=${to} from=${FROM} error=${result.error.message}`)
  } else {
    console.log(`[email:${fnName}] SENT to=${to} from=${FROM} id=${result.data?.id}`)
  }
}

export interface User {
  id: string
  email: string
  role: string
  industry: string
  ai_maturity: string
}

export interface SessionSummary {
  id?: string
  sessionIndex: number
  title: string
  scheduledAt: string
  estimatedMinutes: number
}

export interface ContentItem {
  id: string
  body_text: string
  type: 'tip' | 'signal' | 'decoder' | 'lens' | 'framework'
}

export interface EmailResult {
  success: boolean
  error?: string
  messageId?: string
}

/**
 * Sends a daily personalized content email to a user.
 * @param user - The recipient user
 * @param contentItem - The content item to send
 * @returns Success/failure result
 */
export async function sendDailyEmail(
  user: User,
  contentItem: ContentItem
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendDailyEmail', { userId: user.id, contentType: contentItem.type })
    return { success: true, messageId: 'mock-message-id' }
  }

  const subjectMap: Record<string, string> = {
    tip: 'Your daily AI tip',
    signal: 'Today\'s AI signal',
    decoder: 'AI concept decoded',
    lens: 'How a leader handled AI',
    framework: 'Your AI evaluation framework',
  }

  const subject = subjectMap[contentItem.type] ?? 'Your daily AI insight from Clio'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject,
      html: buildDailyEmailHtml(user, contentItem),
      text: contentItem.body_text,
    })

    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Sends the weekly digest email (Sundays) to a user.
 * @param user - The recipient user
 * @param items - Array of up to 5 content items from the past week
 * @returns Success/failure result
 */
export async function sendWeeklyDigest(
  user: User,
  items: ContentItem[]
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendWeeklyDigest', { userId: user.id, itemCount: items.length })
    return { success: true, messageId: 'mock-digest-id' }
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'Your weekly AI digest from Clio',
      html: buildWeeklyDigestHtml(user, items),
      text: items.map((i, idx) => `${idx + 1}. ${i.body_text}`).join('\n\n'),
    })

    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Sends a payment failed alert email.
 * @param user - The user with the failed payment
 * @returns Success/failure result
 */
export async function sendPaymentFailedEmail(user: User): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendPaymentFailedEmail', { userId: user.id })
    return { success: true }
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'Action required: Update your Clio payment method',
      html: `<p>Hi there,</p><p>We couldn't process your recent Clio payment. Please update your payment method to continue receiving your daily AI insights.</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing">Update payment method</a></p>`,
      text: `We couldn't process your Clio payment. Please visit ${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing to update your payment method.`,
    })

    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Sends a trial ending soon email.
 * @param user - The user whose trial is ending
 * @param hoursLeft - Hours remaining in trial (defaults to 72 = 3 days)
 * @returns Success/failure result
 */
export async function sendTrialEndingEmail(
  user: { email: string; plan_tier?: string | null; id?: string },
  hoursLeft = 72
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendTrialEndingEmail', { email: user.email, hoursLeft })
    return { success: true }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
  const label = hoursLeft <= 24 ? '24 hours' : `${Math.round(hoursLeft / 24)} days`

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: `Your Clio trial ends in ${label}`,
      html: `<p>Your free trial ends in ${label}. Pay anytime to unlock your full plan minutes and continue building your AI confidence.</p><p><a href="${appUrl}/checkout">Activate your plan</a></p>`,
      text: `Your Clio trial ends in ${label}. Visit ${appUrl}/checkout to activate your plan.`,
    })

    logEmailResult('sendTrialEndingEmail', user.email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Sends a trial expired / account suspended email.
 * @param user - The user whose trial has expired
 * @returns Success/failure result
 */
export async function sendTrialExpiredEmail(
  user: { email: string; plan_tier?: string | null; id?: string }
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendTrialExpiredEmail', { email: user.email })
    return { success: true }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'Your Clio trial has ended',
      html: `<p>Your 3-day Clio trial has ended and your account has been paused. Activate your plan anytime to pick up right where you left off.</p><p><a href="${appUrl}/checkout">Reactivate my plan</a></p>`,
      text: `Your Clio trial has ended. Reactivate your plan at ${appUrl}/checkout.`,
    })

    logEmailResult('sendTrialExpiredEmail', user.email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Sends a content recalibration notice email when 5+ consecutive N responses.
 * @param user - The user whose plan is being recalibrated
 * @returns Success/failure result
 */
export async function sendRecalibrationEmail(user: User): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendRecalibrationEmail', { userId: user.id })
    return { success: true }
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'We\'re adjusting your Clio plan',
      html: `<p>We noticed your recent insights weren't hitting the mark. We're recalibrating your AI learning plan to better match your needs.</p><p>Your next insight will reflect the update.</p>`,
      text: `We're recalibrating your Clio learning plan. Your next insight will better match your needs.`,
    })

    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Sends a welcome email immediately after account creation (before plan selection).
 * @param email - The new user's email address
 * @param firstName - First name from Clerk profile (may be empty)
 * @returns Success/failure result
 */
export async function sendSignupWelcomeEmail(
  email: string,
  firstName: string
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendSignupWelcomeEmail', { email, firstName })
    return { success: true, messageId: 'mock-signup-welcome-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
  const greeting = firstName ? `Hi ${firstName}` : 'Hi there'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Welcome to Clio — you\'re in',
      html: buildSignupWelcomeEmailHtml(greeting, appUrl),
      text: `${greeting},\n\nWelcome to Clio — your personal AI coach for executives.\n\nYou're one step away. Choose your plan to start learning:\n${appUrl}/plan\n\n— The Clio team`,
    })

    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Sends a welcome email after successful subscription payment.
 * @param user - The newly subscribed user
 * @param planTier - The plan tier they subscribed to
 * @param minutesIncluded - Minutes included in their plan
 * @returns Success/failure result
 */
export async function sendWelcomeEmail(
  user: User,
  planTier: string,
  minutesIncluded: number
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendWelcomeEmail', { userId: user.id, planTier, minutesIncluded })
    return { success: true }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
  const planName = planTier.charAt(0).toUpperCase() + planTier.slice(1)

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: `Welcome to Clio ${planName} — you're all set`,
      html: buildWelcomeEmailHtml(planName, minutesIncluded, appUrl),
      text: `Welcome to Clio ${planName}! You have ${minutesIncluded} coaching minutes included. Set up your learning plan at ${appUrl}/dashboard/plan`,
    })

    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Sends a "Your plan is ready for review" email after curriculum is generated.
 * @param user - The user whose plan was generated
 * @returns Success/failure result
 */
export async function sendPlanReadyEmail(user: User): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendPlanReadyEmail', { userId: user.id })
    return { success: true }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'Your Clio learning plan is ready to review',
      html: buildPlanReadyEmailHtml(appUrl),
      text: `Your personalized AI learning plan is ready. Review and approve it at ${appUrl}/dashboard/plan`,
    })

    logEmailResult('sendPlanReadyEmail', user.email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendPlanReadyEmail] EXCEPTION to=${user.email}:`, message)
    return { success: false, error: message }
  }
}

/**
 * Sends a plan approved confirmation email with a link to schedule sessions.
 * @param user - The user whose plan was approved
 * @returns Success/failure result
 */
export async function sendPlanApprovedEmail(user: User): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendPlanApprovedEmail', { userId: user.id })
    return { success: true, messageId: 'mock-plan-approved-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'Your Clio learning plan is approved — let\'s get started',
      html: buildPlanApprovedEmailHtml(appUrl),
      text: `Your personalized AI learning journey is confirmed. Schedule your first session at ${appUrl}/dashboard/schedule`,
    })

    logEmailResult('sendPlanApprovedEmail', user.email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendPlanApprovedEmail] EXCEPTION to=${user.email}:`, message)
    return { success: false, error: message }
  }
}

/**
 * Sends a sessions confirmed email with a summary of all scheduled sessions.
 * @param user - The user who scheduled sessions
 * @param sessions - Array of scheduled session summaries
 * @returns Success/failure result
 */
export async function sendSessionsConfirmedEmail(
  user: User,
  sessions: SessionSummary[]
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendSessionsConfirmedEmail', { userId: user.id, sessionCount: sessions.length })
    return { success: true, messageId: 'mock-sessions-confirmed-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'Your Clio sessions are scheduled — here\'s your calendar',
      html: buildSessionsConfirmedEmailHtml(sessions, appUrl),
      text: [
        `${sessions.length} sessions scheduled across your learning plan.`,
        '',
        ...sessions.map(
          (s) =>
            `Session ${s.sessionIndex} · ${s.title} · ${new Date(s.scheduledAt).toLocaleString()} · ${s.estimatedMinutes} min`
        ),
        '',
        `View your sessions: ${appUrl}/dashboard/sessions`,
      ].join('\n'),
    })

    logEmailResult('sendSessionsConfirmedEmail', user.email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendSessionsConfirmedEmail] EXCEPTION to=${user.email}:`, message)
    return { success: false, error: message }
  }
}

/**
 * Sends a day-before session reminder email.
 * @param user - The user to remind
 * @param session - The upcoming session details
 * @returns Success/failure result
 */
export async function sendSessionReminderEmail(
  user: User,
  session: SessionSummary
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendSessionReminderEmail', { userId: user.id, sessionIndex: session.sessionIndex })
    return { success: true, messageId: 'mock-session-reminder-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
  const sessionDate = new Date(session.scheduledAt)
  const timeString = sessionDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: `Tomorrow: ${session.title} with Clio · ${timeString}`,
      html: buildSessionReminderEmailHtml(session, appUrl),
      text: [
        `Your session is tomorrow.`,
        `Topic: ${session.title}`,
        `Date: ${sessionDate.toLocaleDateString()}`,
        `Time: ${timeString}`,
        `Duration: ${session.estimatedMinutes} minutes`,
        '',
        `View your plan: ${appUrl}/dashboard/sessions`,
      ].join('\n'),
    })

    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ─── Private HTML builders ────────────────────────────────────────────────────

function buildDailyEmailHtml(user: User, item: ContentItem): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;">
        <p style="color:#94A3B8;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;margin:0 0 16px;">${item.type.toUpperCase()}</p>
        <p style="color:#ffffff;font-size:16px;line-height:1.7;margin:0 0 32px;">${item.body_text}</p>
        <div style="border-top:1px solid #222222;padding-top:20px;display:flex;gap:12px;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/api/feedback?v=1&id=${item.id}" style="background:#10B981;color:#fff;padding:8px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">👍 Useful</a>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/api/feedback?v=0&id=${item.id}" style="background:#1A1A1A;color:#94A3B8;padding:8px 20px;border-radius:6px;text-decoration:none;font-size:14px;border:1px solid #333;">👎 Not for me</a>
        </div>
      </div>
      <p style="color:#475569;font-size:12px;margin-top:32px;text-align:center;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color:#7C3AED;">Dashboard</a> ·
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/api/unsubscribe" style="color:#475569;">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`
}

function buildWeeklyDigestHtml(user: User, items: ContentItem[]): string {
  const itemsHtml = items
    .map(
      (item, idx) => `
    <div style="border-bottom:1px solid #222222;padding:20px 0;">
      <p style="color:#7C3AED;font-size:11px;font-weight:700;text-transform:uppercase;margin:0 0 8px;">${idx + 1}. ${item.type.toUpperCase()}</p>
      <p style="color:#ffffff;font-size:15px;line-height:1.6;margin:0;">${item.body_text}</p>
    </div>`
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:700;margin:0 0 8px;">Your weekly AI digest</h1>
      <p style="color:#94A3B8;margin:0 0 32px;">Your top insights from the week</p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;">
        ${itemsHtml}
      </div>
      <p style="color:#475569;font-size:12px;margin-top:32px;text-align:center;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color:#7C3AED;">View dashboard</a> ·
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/api/unsubscribe" style="color:#475569;">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`
}

function buildSignupWelcomeEmailHtml(greeting: string, appUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:32px;font-weight:800;margin:0 0 12px;">${greeting}, welcome to Clio.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">Your personal AI coach for executives is ready. One step left — choose a plan to start building your AI confidence.</p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;margin-bottom:32px;">
        <p style="color:#94A3B8;font-size:14px;margin:0 0 20px;">What you'll get with Clio:</p>
        <div style="margin-bottom:12px;display:flex;align-items:flex-start;gap:12px;">
          <span style="color:#7C3AED;font-size:16px;line-height:1;flex-shrink:0;">✓</span>
          <p style="color:#ffffff;font-size:14px;margin:0;">Personalized AI insights — 15 seconds a day, calibrated to your role</p>
        </div>
        <div style="margin-bottom:12px;display:flex;align-items:flex-start;gap:12px;">
          <span style="color:#7C3AED;font-size:16px;line-height:1;flex-shrink:0;">✓</span>
          <p style="color:#ffffff;font-size:14px;margin:0;">Live AI coaching sessions via Google Meet</p>
        </div>
        <div style="margin-bottom:24px;display:flex;align-items:flex-start;gap:12px;">
          <span style="color:#7C3AED;font-size:16px;line-height:1;flex-shrink:0;">✓</span>
          <p style="color:#ffffff;font-size:14px;margin:0;">Your AI Readiness Score — track your progress week by week</p>
        </div>
        <a href="${appUrl}/plan" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Choose your plan →</a>
      </div>
      <p style="color:#475569;font-size:12px;text-align:center;">Paid plans include a 3-day free trial. Cancel anytime.</p>
    </td></tr>
  </table>
</body>
</html>`
}

function buildWelcomeEmailHtml(planName: string, minutesIncluded: number, appUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:32px;font-weight:800;margin:0 0 12px;">Welcome to Clio ${planName}.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">Your AI learning journey starts now. Here's what's included in your plan:</p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;margin-bottom:32px;">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
          <div style="width:48px;height:48px;border-radius:50%;background:rgba(124,58,237,0.2);border:1px solid #7C3AED;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#7C3AED;font-weight:800;font-size:20px;">C</span>
          </div>
          <div>
            <p style="color:#ffffff;font-weight:700;margin:0 0 4px;">${planName} Plan Active</p>
            <p style="color:#94A3B8;font-size:14px;margin:0;">${minutesIncluded} coaching minutes included per month</p>
          </div>
        </div>
        <div style="border-top:1px solid #222222;padding-top:20px;">
          <p style="color:#94A3B8;font-size:14px;margin:0 0 12px;">Next steps:</p>
          <p style="color:#ffffff;font-size:14px;margin:0 0 8px;">1. Select your topic interests</p>
          <p style="color:#ffffff;font-size:14px;margin:0 0 8px;">2. Review your personalized learning plan</p>
          <p style="color:#ffffff;font-size:14px;margin:0 0 24px;">3. Schedule your first coaching session</p>
          <a href="${appUrl}/dashboard/plan" style="background:#7C3AED;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">Review your plan →</a>
        </div>
      </div>
      <p style="color:#475569;font-size:12px;text-align:center;">
        <a href="${appUrl}/dashboard" style="color:#7C3AED;">Go to dashboard</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`
}

function buildPlanReadyEmailHtml(appUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">Your learning plan is ready.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">We've built a personalized AI learning path based on your profile and topic interests. Review it and approve to get started.</p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;margin-bottom:32px;text-align:center;">
        <p style="color:#94A3B8;font-size:14px;margin:0 0 24px;">Your plan includes a visual flow diagram showing your learning journey, grouped sessions, and scheduled dates.</p>
        <a href="${appUrl}/dashboard/plan" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">View &amp; Approve Plan →</a>
      </div>
      <p style="color:#475569;font-size:12px;text-align:center;">
        <a href="${appUrl}/dashboard" style="color:#7C3AED;">Dashboard</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`
}

function buildPlanApprovedEmailHtml(appUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:32px;font-weight:800;margin:0 0 12px;">Your plan is approved.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">Your personalized AI learning journey is confirmed. Next step: schedule your first coaching session.</p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;margin-bottom:32px;text-align:center;">
        <div style="width:56px;height:56px;border-radius:50%;background:rgba(16,185,129,0.15);border:2px solid #10B981;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#10B981;font-size:24px;font-weight:800;">✓</span>
        </div>
        <p style="color:#ffffff;font-size:16px;font-weight:600;margin:0 0 8px;">Plan confirmed</p>
        <p style="color:#94A3B8;font-size:14px;margin:0 0 24px;">Choose your session times to lock in your learning schedule.</p>
        <a href="${appUrl}/dashboard/schedule" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Schedule Your Sessions →</a>
      </div>
      <p style="color:#475569;font-size:12px;text-align:center;">
        <a href="${appUrl}/dashboard" style="color:#7C3AED;">Dashboard</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`
}

function buildSessionsConfirmedEmailHtml(sessions: SessionSummary[], appUrl: string): string {
  const sessionsHtml = sessions
    .map((s) => {
      const d = new Date(s.scheduledAt)
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #222222;">
          <p style="color:#7C3AED;font-size:11px;font-weight:700;text-transform:uppercase;margin:0 0 4px;">Session ${s.sessionIndex}</p>
          <p style="color:#ffffff;font-size:14px;font-weight:600;margin:0 0 4px;">${s.title}</p>
          <p style="color:#94A3B8;font-size:13px;margin:0;">${dateStr} at ${timeStr} &middot; ${s.estimatedMinutes} min</p>
          <p style="margin:6px 0 0;"><a href="${appUrl}/api/sessions/${s.id ?? s.sessionIndex}/calendar" style="color:#06B6D4;font-size:12px;text-decoration:none;">+ Add to calendar</a></p>
        </td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:32px;font-weight:800;margin:0 0 12px;">Sessions confirmed.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 16px;">${sessions.length} session${sessions.length !== 1 ? 's' : ''} scheduled across your learning plan.</p>
      <p style="color:#94A3B8;font-size:15px;line-height:1.7;margin:0 0 32px;">Your sessions are confirmed. Add your Google Meet link in your dashboard before your first session.</p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;margin-bottom:24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${sessionsHtml}
        </table>
      </div>
      <div style="text-align:center;margin-bottom:32px;">
        <a href="${appUrl}/api/sessions/calendar" style="display:inline-block;padding:10px 24px;border:1px solid #333333;border-radius:8px;color:#94A3B8;font-size:13px;text-decoration:none;margin-bottom:16px;">Download all sessions (.ics)</a>
        <br>
        <a href="${appUrl}/dashboard/sessions" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">View My Sessions →</a>
      </div>
      <p style="color:#475569;font-size:12px;text-align:center;">You'll receive a reminder the day before each session.</p>
      <p style="color:#475569;font-size:12px;text-align:center;margin-top:8px;">Add your meeting link in your Clio dashboard before your first session: <a href="${appUrl}/dashboard/sessions" style="color:#06B6D4;text-decoration:none;">${appUrl}/dashboard/sessions</a></p>
    </td></tr>
  </table>
</body>
</html>`
}

function buildSessionReminderEmailHtml(session: SessionSummary, appUrl: string): string {
  const d = new Date(session.scheduledAt)
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:32px;font-weight:800;margin:0 0 12px;">Your session is tomorrow.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">Here are the details for your upcoming Clio session.</p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;margin-bottom:32px;">
        <p style="color:#7C3AED;font-size:11px;font-weight:700;text-transform:uppercase;margin:0 0 16px;">Session ${session.sessionIndex}</p>
        <p style="color:#ffffff;font-size:20px;font-weight:700;margin:0 0 20px;">${session.title}</p>
        <div style="display:grid;gap:8px;">
          <p style="color:#94A3B8;font-size:14px;margin:0;"><span style="color:#ffffff;font-weight:600;">Date:</span> ${dateStr}</p>
          <p style="color:#94A3B8;font-size:14px;margin:0;"><span style="color:#ffffff;font-weight:600;">Time:</span> ${timeStr}</p>
          <p style="color:#94A3B8;font-size:14px;margin:0;"><span style="color:#ffffff;font-weight:600;">Duration:</span> ${session.estimatedMinutes} minutes</p>
        </div>
        <div style="margin-top:24px;padding:16px;background:#1A1A1A;border-radius:8px;border:1px solid #333333;">
          <p style="color:#F59E0B;font-size:13px;font-weight:600;margin:0 0 4px;">[Phase 2 placeholder]</p>
          <p style="color:#94A3B8;font-size:13px;margin:0;">Join link will be available when sessions go live.</p>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:16px;">
        ${session.id
          ? `<a href="${appUrl}/api/sessions/${session.id}/calendar" style="display:inline-block;padding:10px 24px;border:1px solid #333333;border-radius:8px;color:#94A3B8;font-size:13px;text-decoration:none;margin-bottom:16px;">+ Add to Calendar</a><br>`
          : ''}
        <a href="${appUrl}/dashboard/sessions" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">View My Sessions →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`
}

// ─── Session Agenda Email ─────────────────────────────────────────────────────

export interface AgendaEmailSubtopic {
  title: string
  skipped?: boolean
}

export async function sendSessionAgendaEmail(
  user: User,
  session: SessionSummary,
  subtopics: AgendaEmailSubtopic[],
  meetUrl: string
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendSessionAgendaEmail', { userId: user.id, sessionIndex: session.sessionIndex, meetUrl })
    return { success: true, messageId: 'mock-agenda-email-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
  const sessionDate = new Date(session.scheduledAt)
  const timeString = sessionDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  const dateString = sessionDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: `Starting in 30 min: ${session.title} · ${timeString}`,
      html: buildAgendaEmailHtml(session, subtopics, meetUrl, dateString, timeString, appUrl),
      text: [
        `Your session starts in 30 minutes.`,
        ``,
        `Topic: ${session.title}`,
        `Date: ${dateString} at ${timeString}`,
        `Duration: ~${session.estimatedMinutes} minutes`,
        ``,
        `Join Google Meet: ${meetUrl}`,
        ``,
        `Agenda:`,
        ...subtopics.filter((s) => !s.skipped).map((s, i) => `  ${i + 1}. ${s.title}`),
        ``,
        `View session: ${appUrl}/dashboard/sessions/${session.id}`,
      ].join('\n'),
    })

    if (result.error) {
      return { success: false, error: result.error.message }
    }
    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ─── Admin Alert Email ────────────────────────────────────────────────────────

/**
 * Sends a system alert email to the admin when a critical Inngest job fails.
 * Recipient: ADMIN_ALERT_EMAIL env var, falling back to RESEND_FROM_EMAIL.
 * @param params.subject - Alert subject line
 * @param params.body - Human-readable description of the failure
 * @param params.context - Optional structured context (rendered as <pre> block)
 * @returns Success/failure result
 */
export async function sendAdminAlert(params: {
  subject: string
  body: string
  context?: Record<string, unknown>
}): Promise<EmailResult> {
  const { subject, body, context } = params
  const recipient =
    process.env.ADMIN_ALERT_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? 'hello@hello-clio.com'

  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendAdminAlert', { subject, recipient, context })
    return { success: true, messageId: 'mock-admin-alert-id' }
  }

  const timestamp = new Date().toISOString()
  const contextBlock =
    context !== undefined
      ? `<div style="background:#0A0A0A;border:1px solid #333333;border-radius:8px;padding:16px;margin-top:16px;">
           <p style="color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">Context</p>
           <pre style="color:#94A3B8;font-size:12px;margin:0;white-space:pre-wrap;word-break:break-all;">${JSON.stringify(context, null, 2)}</pre>
         </div>`
      : ''

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <!-- Red alert header -->
      <div style="background:#EF4444;border-radius:8px 8px 0 0;padding:16px 24px;">
        <p style="color:#ffffff;font-size:14px;font-weight:700;margin:0;">&#9888;&#65039; Clio System Alert</p>
      </div>
      <!-- Alert body -->
      <div style="background:#111111;border:1px solid #333333;border-top:none;border-radius:0 0 8px 8px;padding:32px;">
        <h2 style="color:#ffffff;font-size:20px;font-weight:700;margin:0 0 16px;">${subject}</h2>
        <p style="color:#94A3B8;font-size:15px;line-height:1.7;margin:0 0 8px;white-space:pre-wrap;">${body}</p>
        ${contextBlock}
        <p style="color:#475569;font-size:12px;margin-top:24px;border-top:1px solid #222222;padding-top:16px;">
          Sent: ${timestamp}
        </p>
      </div>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    `[Clio System Alert] ${subject}`,
    '',
    body,
    '',
    context !== undefined ? JSON.stringify(context, null, 2) : '',
    '',
    `Timestamp: ${timestamp}`,
  ]
    .filter((line) => line !== undefined)
    .join('\n')

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: recipient,
      subject: `[Clio Alert] ${subject}`,
      html,
      text,
    })

    if (result.error) {
      console.error(`[email:sendAdminAlert] FAILED subject="${subject}" error=${result.error.message}`)
      return { success: false, error: result.error.message }
    }

    console.log(`[email:sendAdminAlert] SENT to=${recipient} subject="${subject}" id=${result.data?.id}`)
    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendAdminAlert] EXCEPTION subject="${subject}":`, message)
    return { success: false, error: message }
  }
}

function buildAgendaEmailHtml(
  session: SessionSummary,
  subtopics: AgendaEmailSubtopic[],
  meetUrl: string,
  dateString: string,
  timeString: string,
  appUrl: string
): string {
  const activeSubtopics = subtopics.filter((s) => !s.skipped)
  const agendaRows = activeSubtopics.map((s, i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #1A1A1A;vertical-align:top;">
        <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#1A1A1A;border:1px solid #7C3AED;color:#A855F7;font-size:10px;font-weight:700;text-align:center;line-height:22px;margin-right:12px;flex-shrink:0;">${i + 1}</span>
        <span style="color:#94A3B8;font-size:14px;line-height:1.6;">${s.title}</span>
      </td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>

      <!-- Header -->
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;margin-bottom:16px;">
        <p style="color:#06B6D4;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 12px;">Starting in 30 minutes</p>
        <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0 0 8px;line-height:1.3;">${session.title}</h1>
        <p style="color:#475569;font-size:14px;margin:0 0 24px;">${dateString} · ${timeString} · ~${session.estimatedMinutes} min</p>

        <!-- Join button -->
        <a href="${meetUrl}" style="display:inline-block;background:#7C3AED;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.01em;">
          Join Google Meet →
        </a>
      </div>

      <!-- Agenda -->
      ${activeSubtopics.length > 0 ? `
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:24px 32px;margin-bottom:16px;">
        <p style="color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 16px;">Today's Agenda</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${agendaRows}
        </table>
      </div>` : ''}

      <!-- Footer -->
      <p style="color:#475569;font-size:12px;text-align:center;margin:24px 0 0;">
        <a href="${appUrl}/dashboard/sessions/${session.id}" style="color:#7C3AED;text-decoration:none;">View full session details</a>
        &nbsp;·&nbsp; Clio AI
      </p>
    </td></tr>
  </table>
</body>
</html>`
}
