import { Resend } from 'resend'

const isPlaceholder = !process.env.RESEND_API_KEY ||
  process.env.RESEND_API_KEY.startsWith('PLACEHOLDER_')

const resend = isPlaceholder ? null : new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'hello@hello-clio.com'
const FROM_NAME = process.env.RESEND_FROM_NAME ?? 'Clio'
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`

export interface User {
  id: string
  email: string
  role: string
  industry: string
  ai_maturity: string
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
 * Sends a trial ending soon email (3 days before trial ends).
 * @param user - The user whose trial is ending
 * @returns Success/failure result
 */
export async function sendTrialEndingEmail(user: User): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendTrialEndingEmail', { userId: user.id })
    return { success: true }
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'Your Clio trial ends in 3 days',
      html: `<p>Your free trial ends in 3 days. Continue building your AI confidence with a Clio subscription.</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL}/pricing">Choose your plan</a></p>`,
      text: `Your Clio trial ends in 3 days. Visit ${process.env.NEXT_PUBLIC_APP_URL}/pricing to subscribe.`,
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
