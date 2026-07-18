import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'

// ─── Response schema (Zod) ────────────────────────────────────────────────────

const ChannelStatsSchema = z.object({
  total: z.number(),
  /**
   * NOTE: delivery_log has no "error" column — only successful sends are written.
   * "failed" is always 0 and is included for API shape consistency.
   * A true failure metric would require writing error rows to delivery_log.
   */
  successful: z.number(),
  failed: z.number(),
})

const DeliveryHealthResponseSchema = z.object({
  period: z.literal('last_24h'),
  generatedAt: z.string(),
  schemaNote: z.string(),
  delivery: z.object({
    total: z.number(),
    successful: z.number(),
    failed: z.number(),
    byChannel: z.object({
      email: ChannelStatsSchema,
      sms: ChannelStatsSchema,
    }),
  }),
  feedbackRate: z.object({
    received: z.number(),
    positive: z.number(),
    negative: z.number(),
    ratePercent: z.number(),
  }),
  problematicUsers: z.array(
    z.object({
      /** Clerk user_id — no PII (email/phone) exposed */
      userId: z.string(),
      consecutiveFailures: z.number(),
      lastAttempt: z.string(),
      channel: z.string(),
    })
  ),
  activeUsers: z.object({
    total: z.number(),
    paused: z.number(),
    onFreeTrialOnly: z.number(),
  }),
})

type DeliveryHealthResponse = z.infer<typeof DeliveryHealthResponseSchema>

// ─── Auth helper ─────────────────────────────────────────────────────────────

/**
 * Returns true if the request is from an authorised admin.
 * Returns true if the x-admin-secret header matches ADMIN_SECRET. B2B-21
 * Requirement Doc §7 — the Clerk-userId fallback is replaced by
 * `requireSuperAdmin()`, checked separately in the route handler below.
 */
function hasAdminSecret(request: NextRequest): boolean {
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) return false
  return request.headers.get('x-admin-secret') === adminSecret
}

// ─── Query helpers ────────────────────────────────────────────────────────────

interface ChannelRow {
  channel: string
  count: string // Supabase aggregate returns string-coerced bigints
}

interface FeedbackRow {
  feedback: string | null
  count: string
}

/**
 * Fetches delivery counts grouped by channel for the last 24 hours.
 * Because delivery_log only contains successful sends, total === successful.
 */
async function fetchDeliveryStats(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  // Supabase JS client doesn't support GROUP BY natively; use RPC-style raw query
  // via the PostgREST ?select= aggregation. We fall back to a manual approach:
  // fetch all rows in the window and aggregate in JS to avoid needing a DB function.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('delivery_log')
    .select('channel')
    .gte('sent_at', cutoff)

  if (error) {
    console.error('[delivery-health] delivery_log query error:', error.message)
    return { email: 0, sms: 0, total: 0 }
  }

  const rows = (data ?? []) as Array<{ channel: string }>
  const emailCount = rows.filter((r) => r.channel === 'email').length
  const smsCount = rows.filter((r) => r.channel === 'sms').length

  return { email: emailCount, sms: smsCount, total: rows.length }
}

/**
 * Fetches feedback counts for delivery_log rows in the last 24 hours.
 */
async function fetchFeedbackStats(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('delivery_log')
    .select('feedback')
    .gte('sent_at', cutoff)
    .not('feedback', 'is', null)

  if (error) {
    console.error('[delivery-health] feedback query error:', error.message)
    return { received: 0, positive: 0, negative: 0 }
  }

  const rows = (data ?? []) as Array<{ feedback: string | null }>
  const positive = rows.filter((r) => r.feedback === 'positive').length
  const negative = rows.filter((r) => r.feedback === 'negative').length

  return { received: rows.length, positive, negative }
}

/**
 * Finds users with 3 or more consecutive missed deliveries.
 *
 * Strategy: for each distinct user_id in delivery_log, fetch their last 3
 * rows ordered by sent_at DESC. A "gap" is detected when a user has had
 * 3+ entries but none has feedback — i.e. every recent delivery went
 * unacknowledged. Since the schema has no error column we approximate
 * "failure" as: the user has rows in the 24h window but zero positive feedback
 * across all their historical last-3 entries. This is a proxy metric only.
 *
 * A more precise metric would require an `error` column in delivery_log.
 */
async function fetchProblematicUsers(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  // Fetch all distinct user_ids who received a delivery in the last 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: recentRows, error: recentErr } = await supabase
    .from('delivery_log')
    .select('user_id, channel, sent_at')
    .gte('sent_at', cutoff)

  if (recentErr || !recentRows || recentRows.length === 0) {
    return []
  }

  // Get unique user_ids from recent deliveries
  const seen = new Set<string>()
  const userIds: string[] = []
  for (const r of recentRows) {
    const uid = r.user_id as string
    if (!seen.has(uid)) {
      seen.add(uid)
      userIds.push(uid)
    }
  }

  // For each user fetch their last 3 delivery_log entries to check for
  // consecutive no-feedback streaks
  const problematic: Array<{
    userId: string
    consecutiveFailures: number
    lastAttempt: string
    channel: string
  }> = []

  for (const userId of userIds) {
    const { data: history, error: histErr } = await supabase
      .from('delivery_log')
      .select('user_id, channel, sent_at, feedback')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(5)

    if (histErr || !history || history.length < 3) {
      continue
    }

    // Count leading nulls (no feedback) from the most recent entry
    let consecutiveNulls = 0
    for (const row of history) {
      if (row.feedback === null) {
        consecutiveNulls++
      } else {
        break
      }
    }

    if (consecutiveNulls >= 3) {
      const mostRecent = history[0]
      problematic.push({
        userId,
        consecutiveFailures: consecutiveNulls,
        lastAttempt: mostRecent.sent_at as string,
        channel: mostRecent.channel as string,
      })
    }
  }

  return problematic
}

/**
 * Fetches aggregate counts from the users table.
 */
async function fetchUserStats(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  // Total active (paid) users
  const { count: activeCount, error: activeErr } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('subscription_status', 'active')

  // Paused users
  const { count: pausedCount, error: pausedErr } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('delivery_paused', true)

  // Free-plan only users (never converted)
  const { count: freeCount, error: freeErr } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('plan_tier', 'free')

  if (activeErr) console.error('[delivery-health] activeUsers query error:', activeErr.message)
  if (pausedErr) console.error('[delivery-health] pausedUsers query error:', pausedErr.message)
  if (freeErr) console.error('[delivery-health] freeUsers query error:', freeErr.message)

  return {
    total: activeCount ?? 0,
    paused: pausedCount ?? 0,
    onFreeTrialOnly: freeCount ?? 0,
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/delivery-health
 *
 * Returns delivery stats for the last 24 hours.
 * Auth: x-admin-secret header (preferred) OR `requireSuperAdmin()`.
 *
 * Schema note: delivery_log has no "error" column. Only successful sends are
 * written to the table, so "failed" counts are always 0 in this response.
 * The "problematicUsers" list uses consecutive no-feedback deliveries as a
 * proxy for delivery issues.
 */
export async function GET(request: NextRequest) {
  if (!hasAdminSecret(request)) {
    const admin = await requireSuperAdmin()
    if (admin.error) return admin.error
  }

  const supabase = createSupabaseAdminClient()

  try {
    // Run all queries in parallel
    const [deliveryStats, feedbackStats, problematicUsers, userStats] = await Promise.all([
      fetchDeliveryStats(supabase),
      fetchFeedbackStats(supabase),
      fetchProblematicUsers(supabase),
      fetchUserStats(supabase),
    ])

    const totalDeliveries = deliveryStats.total
    const feedbackRatePercent =
      totalDeliveries > 0
        ? Math.round((feedbackStats.received / totalDeliveries) * 1000) / 10
        : 0

    const responsePayload: DeliveryHealthResponse = {
      period: 'last_24h',
      generatedAt: new Date().toISOString(),
      schemaNote:
        'delivery_log has no error column — only successful sends are recorded. ' +
        '"failed" is always 0. "problematicUsers" uses consecutive no-feedback entries as a proxy.',
      delivery: {
        total: totalDeliveries,
        successful: totalDeliveries, // all rows in delivery_log are successful sends
        failed: 0, // no error column in schema
        byChannel: {
          email: {
            total: deliveryStats.email,
            successful: deliveryStats.email,
            failed: 0,
          },
          sms: {
            total: deliveryStats.sms,
            successful: deliveryStats.sms,
            failed: 0,
          },
        },
      },
      feedbackRate: {
        received: feedbackStats.received,
        positive: feedbackStats.positive,
        negative: feedbackStats.negative,
        ratePercent: feedbackRatePercent,
      },
      problematicUsers,
      activeUsers: userStats,
    }

    // Validate response shape before returning
    const parsed = DeliveryHealthResponseSchema.safeParse(responsePayload)
    if (!parsed.success) {
      console.error('[delivery-health] Response validation failed:', parsed.error.flatten())
      return NextResponse.json(
        { error: 'Internal response shape error', details: parsed.error.flatten() },
        { status: 500 }
      )
    }

    return NextResponse.json(parsed.data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[delivery-health] Unexpected error:', message)
    return NextResponse.json({ error: 'Internal server error', detail: message }, { status: 500 })
  }
}
