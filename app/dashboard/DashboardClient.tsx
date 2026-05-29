'use client'

import { useState, useTransition } from 'react'
import { motion } from 'framer-motion'
import { ScoreRing } from '@/components/dashboard/ScoreRing'
import { StreakCounter } from '@/components/dashboard/StreakCounter'
import { MessageCard } from '@/components/dashboard/MessageCard'
import { DeliveryToggle } from '@/components/dashboard/DeliveryToggle'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  ArrowRight,
  RefreshCw,
  Hourglass,
  CheckCircle2,
  Clock,
  CalendarDays,
  MessageSquare,
  PlusCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, isToday } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeliveryEntry {
  id: string
  content_item_id: string
  channel: string
  sent_at: string
  feedback: string | null
  content_items: {
    id: string
    type: string
    body_text: string
  } | null
}

interface NextSession {
  id: string
  session_index: number
  session_title: string | null
  scheduled_at: string | null
  status: string
  topics: string[] | null
  duration_mins: number
}

interface User {
  id: string
  email: string | null
  plan_tier: string | null
  ai_readiness_score: number | null
  streak_days: number | null
  delivery_preference: string | null
  minutes_balance?: number | null
  minutes_included?: number | null
  plan_approved?: boolean | null
  needs_recalibration?: boolean | null
  subscription_status?: string | null
  trial_opted_in?: boolean | null
  trial_ends_at?: string | null
}

interface DashboardClientProps {
  user: User
  recentDeliveries: DeliveryEntry[]
  monthlyCount: number
  todayDelivery: DeliveryEntry | null
  nextSession: NextSession | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const typeVariantMap: Record<string, 'purple' | 'cyan' | 'amber' | 'green' | 'muted'> = {
  tip: 'purple',
  signal: 'cyan',
  decoder: 'amber',
  lens: 'green',
  framework: 'muted',
}

function formatSessionDateTime(iso: string): string {
  const d = new Date(iso)
  const datePart = format(d, 'EEEE, MMMM d')
  const timePart = format(d, 'h:mm a')
  return `${datePart} at ${timePart}`
}

function formatInsightTime(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`
  return format(d, 'MMM d, h:mm a')
}

// ─── Section animation variant ────────────────────────────────────────────────

const sectionVariant = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.1 },
  }),
}

// ─── Today's Insight card ─────────────────────────────────────────────────────

function TodayInsightCard({ delivery }: { delivery: DeliveryEntry | null }) {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(
    delivery ? (delivery.feedback as 'positive' | 'negative' | null) ?? null : null
  )
  const [saving, setSaving] = useState(false)

  async function handleFeedback(value: 'positive' | 'negative') {
    if (!delivery) return
    const next = feedback === value ? null : value
    setFeedback(next)
    if (next === null) return
    setSaving(true)
    try {
      await fetch(`/api/messages/${delivery.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: next }),
      })
    } catch {
      // silently ignore
    } finally {
      setSaving(false)
    }
  }

  if (!delivery || !delivery.content_items) {
    return (
      <Card className="p-6 flex flex-col items-center justify-center gap-3 min-h-[160px] text-center">
        <Clock size={28} className="text-[#333]" />
        <p className="text-[#94A3B8] text-sm font-medium">Your insight arrives at 7:00 AM tomorrow</p>
        <p className="text-[#475569] text-xs">Daily micro-learning, delivered fresh each morning</p>
      </Card>
    )
  }

  const { content_items } = delivery
  const badgeVariant = typeVariantMap[content_items.type] ?? 'muted'

  return (
    <Card className="p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariant}>
            {content_items.type.toUpperCase()}
          </Badge>
          <span className="text-xs text-[#475569]">
            {formatInsightTime(delivery.sent_at)}
          </span>
        </div>
        {/* Feedback buttons */}
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: saving ? 1 : 1.1 }}
            whileTap={{ scale: saving ? 1 : 0.9 }}
            onClick={() => handleFeedback('positive')}
            disabled={saving}
            aria-label="Helpful"
            className={`p-1.5 rounded-lg transition-colors ${
              feedback === 'positive'
                ? 'text-[#10B981] bg-green-950/30'
                : 'text-[#475569] hover:text-[#10B981] hover:bg-green-950/20 disabled:opacity-40'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>
          </motion.button>
          <motion.button
            whileHover={{ scale: saving ? 1 : 1.1 }}
            whileTap={{ scale: saving ? 1 : 0.9 }}
            onClick={() => handleFeedback('negative')}
            disabled={saving}
            aria-label="Not helpful"
            className={`p-1.5 rounded-lg transition-colors ${
              feedback === 'negative'
                ? 'text-[#EF4444] bg-red-950/30'
                : 'text-[#475569] hover:text-[#EF4444] hover:bg-red-950/20 disabled:opacity-40'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg>
          </motion.button>
        </div>
      </div>

      {/* Body */}
      <p className="text-[#94A3B8] text-sm leading-relaxed">
        {content_items.body_text}
      </p>
    </Card>
  )
}

// ─── Next Session card ────────────────────────────────────────────────────────

function NextSessionCard({ session }: { session: NextSession | null }) {
  if (!session) {
    return (
      <Card className="p-6 flex flex-col items-center justify-center gap-3 min-h-[160px] text-center">
        <PlusCircle size={28} className="text-[#333]" />
        <p className="text-[#94A3B8] text-sm font-medium">No upcoming Clio sessions</p>
        <Link
          href="/dashboard/schedule"
          className="text-sm text-[#7C3AED] hover:text-[#A855F7] transition-colors font-semibold"
        >
          Schedule a session →
        </Link>
      </Card>
    )
  }

  const title = session.session_title ?? `Session ${session.session_index}`
  const dateStr = session.scheduled_at ? formatSessionDateTime(session.scheduled_at) : 'Time TBD'

  return (
    <Card className="p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-[#A855F7]">{session.session_index}</span>
        </span>
        <Badge variant="muted">CLIO SESSION</Badge>
      </div>

      {/* Title */}
      <div>
        <p className="text-white font-semibold text-base leading-snug">{title}</p>
        {session.topics && session.topics.length > 0 && (
          <p className="text-xs text-[#475569] mt-1">{session.topics.join(', ')}</p>
        )}
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#475569]">
        <span className="flex items-center gap-1">
          <CalendarDays size={12} />
          {dateStr}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={12} />
          ~{session.duration_mins} min
        </span>
      </div>

      {/* Action */}
      <Link href={`/dashboard/sessions/${session.id}`}>
        <Button size="sm" className="gap-1.5 w-full sm:w-auto">
          Join session <ArrowRight size={13} />
        </Button>
      </Link>
    </Card>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardClient({
  user,
  recentDeliveries,
  monthlyCount,
  todayDelivery,
  nextSession,
}: DashboardClientProps) {
  const [deliveryPref, setDeliveryPref] = useState<'email' | 'sms' | 'both'>(
    (user.delivery_preference as 'email' | 'sms' | 'both') ?? 'email'
  )
  const [paused, setPaused] = useState(false)
  const [activating, setActivating] = useState(false)
  const [activated, setActivated] = useState(false)
  const [activateError, setActivateError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const score = user.ai_readiness_score ?? 0
  const streak = user.streak_days ?? 0
  const planTier = user.plan_tier ?? 'free'
  const smsEnabled = planTier === 'pro' || planTier === 'executive'
  const minutesBalance = user.minutes_balance ?? 0
  const minutesIncluded = user.minutes_included ?? 0
  const minutesPct = minutesIncluded > 0 ? Math.round((minutesBalance / minutesIncluded) * 100) : 0
  const minutesColor = minutesPct > 50 ? '#10B981' : minutesPct > 20 ? '#F59E0B' : '#EF4444'
  const planPending = !user.plan_approved && planTier !== 'free'
  const needsRecalibration = user.needs_recalibration ?? false

  const isTrialing = user.subscription_status === 'trialing' && user.trial_opted_in
  const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at) : null
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0
  const trialHoursLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60)))
    : 0
  const trialLabel = trialHoursLeft < 24
    ? `${trialHoursLeft} hour${trialHoursLeft !== 1 ? 's' : ''}`
    : `${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''}`
  const trialUrgent = trialHoursLeft < 24

  async function handleDeliveryChange(pref: 'email' | 'sms' | 'both') {
    setDeliveryPref(pref)
    await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryPreference: pref }),
    }).catch(() => {})
  }

  async function handlePauseToggle() {
    setPaused(!paused)
    await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryPaused: !paused }),
    }).catch(() => {})
  }

  async function handleActivatePlan() {
    setActivating(true)
    setActivateError(null)
    try {
      const res = await fetch('/api/checkout/activate', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setActivateError(data.error ?? 'Something went wrong. Please try again.')
        return
      }
      setActivated(true)
      startTransition(() => {
        router.refresh()
      })
    } catch {
      setActivateError('Network error. Please try again.')
    } finally {
      setActivating(false)
    }
  }

  return (
    <div className="space-y-8">

      {/* ── Status Banners ── */}

      {needsRecalibration && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl border border-cyan-800/30 bg-cyan-950/20"
        >
          <div className="flex items-start gap-3">
            <RefreshCw size={16} className="text-[#06B6D4] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[#67E8F9] font-medium">
              We&apos;re adjusting your plan based on your feedback — your next insights will be even better calibrated.
            </p>
          </div>
          <Link href="/topics" className="self-start sm:self-auto">
            <Button variant="secondary" size="sm" className="gap-1.5 whitespace-nowrap">
              Update topics <ArrowRight size={13} />
            </Button>
          </Link>
        </motion.div>
      )}

      {isTrialing && trialEndsAt && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl border ${
            trialUrgent
              ? 'border-red-800/40 bg-red-950/20'
              : 'border-amber-800/30 bg-amber-950/20'
          }`}
        >
          <div className="flex items-start gap-3">
            <Hourglass
              size={16}
              className={trialUrgent ? 'text-[#EF4444] flex-shrink-0 mt-0.5' : 'text-[#F59E0B] flex-shrink-0 mt-0.5'}
            />
            <div>
              {activated ? (
                <p className="text-sm font-semibold text-green-300 flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> Plan activated — full access unlocked
                </p>
              ) : (
                <>
                  <p className={`text-sm font-semibold ${trialUrgent ? 'text-red-300' : 'text-amber-300'}`}>
                    {trialUrgent
                      ? `Trial ending in ${trialLabel} — activate now to keep access`
                      : `${trialLabel} left in your free trial`}
                  </p>
                  <p className="text-xs text-[#475569] mt-0.5">
                    You have {minutesBalance} min of coaching time. Activate to unlock your full {minutesIncluded} min/month.
                  </p>
                  {activateError && (
                    <p className="text-xs text-[#EF4444] mt-0.5">{activateError}</p>
                  )}
                </>
              )}
            </div>
          </div>
          {!activated && (
            <Button
              size="sm"
              onClick={handleActivatePlan}
              disabled={activating}
              className={`gap-1.5 whitespace-nowrap self-start sm:self-auto ${trialUrgent ? 'bg-[#EF4444] hover:bg-red-600' : ''}`}
            >
              {activating ? 'Activating…' : <>Activate plan <ArrowRight size={13} /></>}
            </Button>
          )}
        </motion.div>
      )}

      {planPending && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl border border-amber-800/30 bg-amber-950/20"
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse flex-shrink-0" />
            <p className="text-sm text-[#FCD34D] font-medium">
              Your learning plan is ready to review
            </p>
          </div>
          <Link href="/dashboard/plan" className="self-start sm:self-auto">
            <Button size="sm" className="gap-1.5 whitespace-nowrap">
              Review plan <ArrowRight size={13} />
            </Button>
          </Link>
        </motion.div>
      )}

      {/* ── Section 1: Your Learning Today ── */}

      <motion.section
        custom={0}
        initial="hidden"
        animate="visible"
        variants={sectionVariant}
        aria-label="Your learning today"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#475569] mb-4">
          Your Learning Today
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

          {/* AI Readiness Score */}
          <Card className="p-6 flex flex-col items-center justify-center min-h-[160px]">
            <ScoreRing score={score} />
          </Card>

          {/* Day Streak */}
          <Card className="p-6 flex flex-col items-center justify-center min-h-[160px]">
            <StreakCounter days={streak} />
          </Card>

          {/* Insights This Month */}
          <Card className="p-6 flex flex-col justify-center min-h-[160px]">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={16} className="text-[#06B6D4]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[#475569]">Insights Delivered</span>
            </div>
            <div className="flex items-end gap-2 mb-1">
              <span className="text-4xl font-bold text-white">{monthlyCount}</span>
              <span className="text-sm text-[#475569] mb-1">this month</span>
            </div>
            <p className="text-xs text-[#475569]">
              {minutesIncluded > 0
                ? `${minutesBalance} / ${minutesIncluded} coaching min remaining`
                : 'Daily micro-learning'}
            </p>
            {minutesIncluded > 0 && (
              <div className="w-full h-1.5 bg-[#1A1A1A] rounded-full overflow-hidden mt-2">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${minutesPct}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: minutesColor }}
                />
              </div>
            )}
            {minutesIncluded > 0 && minutesPct <= 20 && (
              <p className="text-xs mt-1.5" style={{ color: minutesColor }}>
                Running low
              </p>
            )}
          </Card>
        </div>
      </motion.section>

      {/* ── Section 2 + 3: Today's Insight & Next Session (side-by-side on desktop) ── */}

      <motion.section
        custom={1}
        initial="hidden"
        animate="visible"
        variants={sectionVariant}
        aria-label="Today's insight and next session"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Today's Insight */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
                Today&apos;s Insight
              </h2>
            </div>
            <TodayInsightCard delivery={todayDelivery} />
          </div>

          {/* Next Clio Session */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#475569]">
                Your Next Clio Session
              </h2>
              <Link
                href="/dashboard/sessions"
                className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors"
              >
                View all →
              </Link>
            </div>
            <NextSessionCard session={nextSession} />
          </div>
        </div>
      </motion.section>

      {/* ── Section 4: Recent Insights ── */}

      <motion.section
        custom={2}
        initial="hidden"
        animate="visible"
        variants={sectionVariant}
        aria-label="Recent insights"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Recent Insights</h2>
          <Link
            href="/dashboard/messages"
            className="text-sm text-[#475569] hover:text-[#94A3B8] transition-colors font-medium"
          >
            View all →
          </Link>
        </div>
        {recentDeliveries.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-[#475569]">Your first insight arrives tomorrow morning.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recentDeliveries.map((delivery) =>
              delivery.content_items ? (
                <MessageCard
                  key={delivery.id}
                  id={delivery.id}
                  date={delivery.sent_at}
                  contentType={delivery.content_items.type}
                  bodyText={delivery.content_items.body_text}
                  initialFeedback={
                    (delivery.feedback as 'positive' | 'negative' | null) ?? null
                  }
                />
              ) : null
            )}
          </div>
        )}
      </motion.section>

      {/* ── Section 5: Delivery Preferences ── */}

      <motion.section
        custom={3}
        initial="hidden"
        animate="visible"
        variants={sectionVariant}
        aria-label="Delivery preferences"
      >
        <h2 className="text-lg font-bold text-white mb-4">Delivery Preferences</h2>
        <Card className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <p className="text-sm font-semibold text-white mb-1">How should we reach you?</p>
              {!smsEnabled && (
                <p className="text-xs text-[#F59E0B]">
                  SMS requires Pro or Executive plan
                </p>
              )}
              <div className="mt-3 max-w-xs">
                <DeliveryToggle
                  value={deliveryPref}
                  onChange={handleDeliveryChange}
                  smsEnabled={smsEnabled}
                />
              </div>
            </div>
            <Button
              variant={paused ? 'primary' : 'secondary'}
              size="sm"
              onClick={handlePauseToggle}
            >
              {paused ? 'Resume delivery' : 'Pause delivery'}
            </Button>
          </div>
        </Card>
      </motion.section>

      {/* ── Upgrade CTA for Starter ── */}

      {planTier === 'starter' && (
        <motion.div
          custom={4}
          initial="hidden"
          animate="visible"
          variants={sectionVariant}
        >
          <div
            className="rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            style={{
              background: 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(6,182,212,0.1) 100%), #111111',
              border: '1px solid rgba(124,58,237,0.3)',
            }}
          >
            <div>
              <p className="font-bold text-white mb-1">Unlock SMS delivery with Pro</p>
              <p className="text-sm text-[#94A3B8]">
                Get daily insights on your phone + Ask Anything via SMS
              </p>
            </div>
            <Link href="/dashboard/upgrade" className="self-start sm:self-auto">
              <Button size="sm" className="gap-1 whitespace-nowrap">
                Upgrade <ArrowRight size={14} />
              </Button>
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  )
}
