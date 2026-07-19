import { Resend } from 'resend'

const isPlaceholder = !process.env.RESEND_API_KEY ||
  process.env.RESEND_API_KEY.startsWith('PLACEHOLDER_')

const resend = isPlaceholder ? null : new Resend(process.env.RESEND_API_KEY)

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'hello@distill-peach.vercel.app'
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: 'Your Clio learning plan is approved — let\'s get started',
      html: buildPlanApprovedEmailHtml(appUrl),
      text: `Your personalized AI learning journey is confirmed. Schedule your first session at ${appUrl}/dashboard/sessions`,
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
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

// ─── B2B-04 — Billing / Metering ──────────────────────────────────────────────

/**
 * Sends the low-balance alert email (Requirement Doc Section 5.B.5 — fires
 * at most once per depletion cycle, caller-side compare-and-set already
 * guarantees that; this function just sends).
 * @param toEmail - a partner_admin_users Clerk-registered email address
 * @param partnerName - partner_accounts.name, for the subject/body
 * @param balanceUsd - the wallet balance at the moment the alert fired
 * @param referenceTopupAmountUsd - the top-up amount the 80%-consumed threshold is measured against
 * @returns Success/failure result
 */
export async function sendLowBalanceAlertEmail(
  toEmail: string,
  partnerName: string,
  balanceUsd: number,
  referenceTopupAmountUsd: number
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendLowBalanceAlertEmail', { toEmail, partnerName, balanceUsd, referenceTopupAmountUsd })
    return { success: true, messageId: 'mock-low-balance-alert-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const formattedBalance = balanceUsd.toFixed(2)
  const formattedReference = referenceTopupAmountUsd.toFixed(2)

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: `Clio wallet balance running low — ${partnerName}`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">Your wallet balance is running low.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">
        ${partnerName}'s Clio wallet balance is <strong style="color:#F59E0B;">$${formattedBalance}</strong>,
        which has crossed 20% of your last top-up of $${formattedReference}.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;text-align:center;">
        <a href="${appUrl}/dashboard/admin/clients" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Top up now →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`,
      text: `${partnerName}'s Clio wallet balance is $${formattedBalance}, which has crossed 20% of your last top-up of $${formattedReference}. Top up soon at ${appUrl}/dashboard/admin/clients`,
    })

    logEmailResult('sendLowBalanceAlertEmail', toEmail, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendLowBalanceAlertEmail] EXCEPTION to=${toEmail}:`, message)
    return { success: false, error: message }
  }
}

// ─── B2B-06 — Partner Provisioning (self-serve signup) ────────────────────────

/**
 * Sends the partner-org welcome email, fired once when the first
 * (`owner`) `partner_admin_users` membership is created for a new
 * self-serve-signed-up partner account (B2B-06 —
 * docs/specs/B2B-06-requirement-document.md Section 4.B.1, architecture.md
 * §18.12). B2B-appropriate copy, not reused B2C copy.
 * @param email - the org creator's Clerk-registered email (from the
 *   organizationMembership.created event's own public_user_data)
 * @param orgName - the Clerk Organization's name (partner_accounts.name)
 * @returns Success/failure result
 */
export async function sendPartnerSignupWelcomeEmail(email: string, orgName: string): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendPartnerSignupWelcomeEmail', { email, orgName })
    return { success: true, messageId: 'mock-partner-signup-welcome-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  // B2B-29 (docs/specs/B2B-29-requirement-document.md §6.5) — company info is
  // no longer captured before signup; a fresh account's `orgName` may still
  // be the fixed placeholder 'Unnamed partner'. This function stays
  // placeholder-agnostic everywhere else — only the subject line and the
  // one inline body reference below swap in a generic phrase instead of
  // literally greeting "Unnamed partner."
  const displayName = orgName === 'Unnamed partner' ? 'your account' : orgName

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Welcome to Clio — let's get ${displayName} set up`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">Welcome to Clio, ${displayName}.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">
        Your Clio partner account is live. Head into the Configurator to generate your API credentials,
        configure outbound delivery, and finish setting up your integration.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;text-align:center;">
        <a href="${appUrl}/dashboard/configurator" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Go to the Configurator →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`,
      text: `Welcome to Clio, ${displayName}. Your partner account is live — head into the Configurator to generate your API credentials and finish setting up your integration: ${appUrl}/dashboard/configurator`,
    })

    logEmailResult('sendPartnerSignupWelcomeEmail', email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendPartnerSignupWelcomeEmail] EXCEPTION to=${email}:`, message)
    return { success: false, error: message }
  }
}

/**
 * Sends the abandoned-signup reminder, fired exactly once (T+24h, via
 * `inngest/partner-signup-reminder.ts`) if a self-serve-signed-up partner
 * account has not completed the Configurator onboarding wizard
 * (`partner_accounts.onboarding_completed_at IS NULL`). B2B-06 —
 * docs/specs/B2B-06-requirement-document.md Section 4.B.6/5.B.6.
 * @param email - the account owner's Clerk-registered email
 * @param orgName - the Clerk Organization's name (partner_accounts.name)
 * @returns Success/failure result
 */
export async function sendPartnerSignupReminderEmail(email: string, orgName: string): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendPartnerSignupReminderEmail', { email, orgName })
    return { success: true, messageId: 'mock-partner-signup-reminder-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `Finish setting up ${orgName} on Clio`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">Pick up where you left off.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">
        ${orgName}'s Clio setup isn't finished yet. It only takes a few minutes to complete the
        Configurator wizard and start integrating.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;text-align:center;">
        <a href="${appUrl}/dashboard/configurator" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Finish setup →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`,
      text: `${orgName}'s Clio setup isn't finished yet. Finish setting up at ${appUrl}/dashboard/configurator`,
    })

    logEmailResult('sendPartnerSignupReminderEmail', email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendPartnerSignupReminderEmail] EXCEPTION to=${email}:`, message)
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
        <a href="${appUrl}/dashboard/sessions" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Schedule Your Sessions →</a>
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

// AgendaEmailSubSession: one tab/sub-session in the agenda email
// (stored as sessions.subtopics in DB — column rename pending TERM-01)
export interface AgendaEmailSubSession {
  title: string
  skipped?: boolean
}

export async function sendSessionAgendaEmail(
  user: User,
  session: SessionSummary,
  subSessions: AgendaEmailSubSession[],
  meetUrl: string
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendSessionAgendaEmail', { userId: user.id, sessionIndex: session.sessionIndex, meetUrl })
    return { success: true, messageId: 'mock-agenda-email-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
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
      html: buildAgendaEmailHtml(session, subSessions, meetUrl, dateString, timeString, appUrl),
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
        ...subSessions.filter((s) => !s.skipped).map((s, i) => `  ${i + 1}. ${s.title}`),
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
    process.env.ADMIN_ALERT_EMAIL ?? process.env.RESEND_FROM_EMAIL ?? 'hello@distill-peach.vercel.app'

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

/**
 * B2B-21 Requirement Doc §6.6 — sales-partner invite email. Non-blocking
 * best-effort send, following the exact `EmailResult`-returning, Resend-based
 * pattern already used by `sendPartnerSignupWelcomeEmail` — a failed send
 * never blocks the underlying `internal_admin_users` row/token write; the
 * caller surfaces `email_sent: false` so the UI can offer "Resend invite."
 * @param email - the invitee's email address
 * @param inviterName - the inviting super-admin's display name/email
 * @param partnerAccountNames - the partner account(s) this sales-partner is tagged to
 * @param acceptUrl - the full `/invite/accept?token=...` URL
 */
export async function sendSalesPartnerInviteEmail(
  email: string,
  inviterName: string,
  partnerAccountNames: string[],
  acceptUrl: string
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendSalesPartnerInviteEmail', { email, inviterName, partnerAccountNames, acceptUrl })
    return { success: true, messageId: 'mock-sales-partner-invite-id' }
  }

  const accountsList = partnerAccountNames.join(', ')

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `You've been invited to Clio as a sales partner`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">You've been invited to Clio.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 8px;">
        ${inviterName} has invited you as a sales partner, scoped to: <strong style="color:#ffffff;">${accountsList}</strong>.
      </p>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">
        This invite expires in 7 days.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;text-align:center;">
        <a href="${acceptUrl}" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Accept invite →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`,
      text: `${inviterName} has invited you to Clio as a sales partner, scoped to: ${accountsList}. Accept your invite (expires in 7 days): ${acceptUrl}`,
    })

    logEmailResult('sendSalesPartnerInviteEmail', email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendSalesPartnerInviteEmail] EXCEPTION to=${email}:`, message)
    return { success: false, error: message }
  }
}

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.11) — a sales-partner's
 * own team invite email. Same dark-void/#7C3AED-CTA HTML skeleton as
 * `sendSalesPartnerInviteEmail`, different copy and no partner-account-tagging
 * list (this invite is scoped to one account only). Non-blocking best-effort
 * send, same `EmailResult`-returning pattern as every other function here.
 * @param email - the invitee's email address
 * @param inviterEmail - the inviting sales-partner admin's email
 * @param companyName - the sales-partner's own account name
 * @param acceptUrl - the full `/team-invite/accept?token=...` URL
 */
export async function sendPartnerTeamInviteEmail(
  email: string,
  inviterEmail: string,
  companyName: string,
  acceptUrl: string
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendPartnerTeamInviteEmail', { email, inviterEmail, companyName, acceptUrl })
    return { success: true, messageId: 'mock-partner-team-invite-id' }
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `You've been invited to join ${companyName}'s team on Clio`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">You've been invited to join ${companyName}'s team.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">
        ${inviterEmail} has invited you to join ${companyName}'s team on Clio. This invite expires in 7 days.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;text-align:center;">
        <a href="${acceptUrl}" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Accept invite →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`,
      text: `${inviterEmail} has invited you to join ${companyName}'s team on Clio. This invite expires in 7 days. Accept your invite: ${acceptUrl}`,
    })

    logEmailResult('sendPartnerTeamInviteEmail', email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendPartnerTeamInviteEmail] EXCEPTION to=${email}:`, message)
    return { success: false, error: message }
  }
}

/**
 * B2B-21 Requirement Doc §6.6 — courtesy notification when a super-admin
 * adds another super-admin email. Non-blocking best-effort send, same
 * pattern as `sendSalesPartnerInviteEmail`. No token/accept step is needed
 * for a super-admin — Clerk's own email verification during that person's
 * sign-up/sign-in is sufficient proof of ownership, picked up by the
 * lazy-bind in `resolveInternalAdmin()` on their next authenticated request.
 * @param email - the newly-added super-admin's email address
 * @param inviterName - the adding super-admin's display name/email
 */
export async function sendSuperAdminAddedEmail(email: string, inviterName: string): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendSuperAdminAddedEmail', { email, inviterName })
    return { success: true, messageId: 'mock-super-admin-added-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: `You've been added as a Clio super-admin`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">You're a Clio super-admin.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">
        ${inviterName} added you as a super-admin — you now have full cross-partner access. Sign in
        with this email address to activate your access.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;text-align:center;">
        <a href="${appUrl}/sign-in" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Sign in →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`,
      text: `${inviterName} added you as a Clio super-admin. Sign in with this email address to activate your access: ${appUrl}/sign-in`,
    })

    logEmailResult('sendSuperAdminAddedEmail', email, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendSuperAdminAddedEmail] EXCEPTION to=${email}:`, message)
    return { success: false, error: message }
  }
}

function buildAgendaEmailHtml(
  session: SessionSummary,
  subSessions: AgendaEmailSubSession[],
  meetUrl: string,
  dateString: string,
  timeString: string,
  appUrl: string
): string {
  const activeSubSessions = subSessions.filter((s) => !s.skipped)
  const agendaRows = activeSubSessions.map((s, i) => `
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
      ${activeSubSessions.length > 0 ? `
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
