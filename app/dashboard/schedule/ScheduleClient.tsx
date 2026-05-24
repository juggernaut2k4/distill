'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  CalendarDays, Clock, CheckCircle, ArrowRight, Zap, FlaskConical, Loader,
  Crown, Sparkles, Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TopUpModal } from '@/components/ui/TopUpModal'
import { buildCurriculum } from '@/lib/content/curriculum'
import { scheduleSessions, totalMinutesNeeded } from '@/lib/sessions/planner'
import type { ScheduledSession } from '@/lib/sessions/planner'

const PENDING_KEY = 'clio_pending_schedule'

interface User {
  id: string
  ai_maturity: string | null
  topic_interests: string[] | null
  plan_tier: string | null
}

interface ExistingSession {
  id: string
  session_index: number
  session_title: string | null
  scheduled_at: string | null
  status: string
  topics: string[] | null
  duration_mins: number
}

interface ScheduleClientProps {
  user: User
  existingSessions: ExistingSession[]
  subscribedSuccess?: boolean
  minutesBalance?: number
}

const FREQUENCY_OPTIONS = [
  { value: 1, label: 'Daily',        description: 'One session every day' },
  { value: 2, label: 'Every 2 days', description: 'Moderate pace' },
  { value: 7, label: 'Weekly',       description: 'One session per week' },
]

const DURATION_OPTIONS = [
  { value: 15, label: '15 min', description: 'Quick focused sessions' },
  { value: 30, label: '30 min', description: 'Deep dives' },
]

const TIME_OPTIONS = [
  { value: 9,  label: 'Morning',   description: '9:00 am' },
  { value: 13, label: 'Afternoon', description: '1:00 pm' },
  { value: 18, label: 'Evening',   description: '6:00 pm' },
]

const PLANS = [
  {
    key: 'starter' as const,
    name: 'Starter',
    icon: Zap,
    color: '#06B6D4',
    monthly: 12,
    annual: 99,
    minutes: 30,
    tagline: 'Learn AI at your pace',
    description: 'Same price whatever the topic — healthcare AI, finance AI, retail AI.',
    features: [
      '30 min/mo · ~1–2 coaching sessions',
      'Clio joins your Google Meet to coach you',
      'Session notes PDF after every call',
      'Daily email insights',
      'AI Readiness Score',
    ],
    popular: false,
  },
  {
    key: 'pro' as const,
    name: 'Pro',
    icon: Sparkles,
    color: '#7C3AED',
    monthly: 25,
    annual: 199,
    minutes: 70,
    tagline: 'Learn and walk in prepared',
    description: 'Same price whatever the topic — flat rate across all technologies.',
    features: [
      '70 min/mo · ~2–4 coaching sessions',
      'Session Prep Brief the night before — what to expect, 3 key concepts, 2 questions to think about',
      'Full curriculum PDF to share with your EA',
      'Email + SMS insights',
      'Ask Clio anything via SMS',
    ],
    popular: true,
  },
  {
    key: 'executive' as const,
    name: 'Executive',
    icon: Crown,
    color: '#F59E0B',
    monthly: 49,
    annual: 399,
    minutes: 150,
    tagline: 'Learn, prepare, and apply',
    description: 'Same price whatever the topic — flat rate across all technologies.',
    features: [
      '150 min/mo · ~5–10 coaching sessions',
      'Meeting Readiness — full briefing before any AI vendor pitch or board session',
      'Executive Briefing Pack — board-ready PDF of your AI progress',
      'Dedicated Clio phone number',
      'White-glove onboarding',
    ],
    popular: false,
  },
]

type PlanKey = 'starter' | 'pro' | 'executive'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  )
}

export default function ScheduleClient({ user, existingSessions, subscribedSuccess, minutesBalance = 0 }: ScheduleClientProps) {
  const router = useRouter()
  const autoScheduledRef = useRef(false)

  const hasPaidPlan = !!(user.plan_tier && user.plan_tier !== 'free')

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  const [firstDate, setFirstDate] = useState(tomorrowStr)
  const [frequencyDays, setFrequencyDays] = useState(2)
  const [maxDuration, setMaxDuration] = useState(30)
  const [preferredHour, setPreferredHour] = useState(9)
  const [saving, setSaving] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [showPlans, setShowPlans] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('pro')
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [autoScheduling, setAutoScheduling] = useState(false)
  const [topUpOpen, setTopUpOpen] = useState(false)

  const plan = useMemo(() => buildCurriculum(
    user.topic_interests ?? [],
    user.ai_maturity ?? 'observer'
  ), [user.topic_interests, user.ai_maturity])

  const scheduledSessions = useMemo(() =>
    scheduleSessions(plan, { firstSessionDate: firstDate, frequencyDays, maxDurationMins: maxDuration, preferredHour }),
    [plan, firstDate, frequencyDays, maxDuration, preferredHour]
  )

  const totalNeeded = totalMinutesNeeded(scheduledSessions)

  // Auto-schedule on return from successful Stripe subscription
  useEffect(() => {
    if (!subscribedSuccess || autoScheduledRef.current) return
    autoScheduledRef.current = true

    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) {
      router.push('/dashboard/sessions')
      return
    }

    let pending: ScheduledSession[]
    try {
      pending = JSON.parse(raw) as ScheduledSession[]
    } catch {
      router.push('/dashboard/sessions')
      return
    }
    sessionStorage.removeItem(PENDING_KEY)

    setAutoScheduling(true)
    fetch('/api/sessions/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions: pending }),
    })
      .then(() => router.push('/dashboard/sessions'))
      .catch(() => setAutoScheduling(false))
  }, [subscribedSuccess, router])

  async function submitSessions(sessions: ScheduledSession[]) {
    setSaving(true)
    try {
      await fetch('/api/sessions/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions }),
      })
      router.push('/dashboard/sessions')
    } catch {
      setSaving(false)
    }
  }

  async function handleConfirm() {
    await submitSessions(scheduledSessions)
  }

  async function handleSubscribeAndSchedule() {
    setSaving(true)
    setCheckoutError(null)
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(scheduledSessions))
      const returnUrl = `${window.location.origin}/dashboard/schedule?subscribed=1`
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan, billingPeriod, returnUrl }),
      })
      const data = await res.json() as { checkoutUrl?: string; error?: string }

      if (!res.ok || !data.checkoutUrl) {
        sessionStorage.removeItem(PENDING_KEY)
        setCheckoutError(data.error ?? 'Could not start checkout. Please try again.')
        setSaving(false)
        return
      }

      // Redirect to Stripe — page will unload, no further state updates needed
      window.location.href = data.checkoutUrl
    } catch {
      sessionStorage.removeItem(PENDING_KEY)
      setCheckoutError('Network error. Please check your connection and try again.')
      setSaving(false)
    }
  }

  async function handleQuickTest() {
    const first = scheduledSessions[0]
    if (!first) return
    const testSession: ScheduledSession = {
      ...first,
      scheduledAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      sessionIndex: 1,
    }
    setSaving(true)
    try {
      await fetch('/api/sessions/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: [testSession] }),
      })
      router.push('/dashboard/sessions')
    } catch {
      setSaving(false)
    }
  }

  // Spinner while auto-scheduling after subscription
  if (autoScheduling) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center gap-4">
        <Loader size={32} className="text-[#7C3AED] animate-spin" />
        <p className="text-white font-semibold">Subscription confirmed — scheduling your sessions...</p>
        <p className="text-sm text-[#475569]">You&apos;ll be redirected to your sessions in a moment</p>
      </div>
    )
  }

  // Existing sessions view (user already has scheduled sessions, not returning from Stripe)
  if (existingSessions.length > 0 && !subscribedSuccess) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Your Sessions</h1>
          <p className="text-[#94A3B8]">Your scheduled learning sessions.</p>
        </div>
        <div className="space-y-3">
          {existingSessions.map((session) => (
            <Card key={session.id} className="p-4 flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-[#A855F7]">{session.session_index}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {session.session_title ?? `Session ${session.session_index}`}
                </p>
                {session.scheduled_at && (
                  <p className="text-xs text-[#475569] mt-0.5">{formatDateTime(session.scheduled_at)}</p>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-[#475569]">
                <Clock size={12} />
                {session.duration_mins}m
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                session.status === 'completed' ? 'bg-green-950/40 text-green-400 border border-green-800/30' :
                session.status === 'active'    ? 'bg-cyan-950/40 text-cyan-400 border border-cyan-800/30' :
                'bg-[#1A1A1A] text-[#475569] border border-[#222]'
              }`}>
                {session.status}
              </span>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // Plan selection screen
  if (showPlans) {
    return (
      <div className="max-w-3xl space-y-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <button
            onClick={() => setShowPlans(false)}
            className="text-sm text-[#475569] hover:text-[#94A3B8] transition-colors mb-6 flex items-center gap-1"
          >
            ← Back to schedule
          </button>
          <h1 className="text-3xl font-bold text-white mb-2">Choose your plan</h1>
          <p className="text-[#94A3B8]">
            Select a plan to activate your sessions. All plans include a 3-day free trial.
          </p>
        </motion.div>

        {/* Billing period toggle */}
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${billingPeriod === 'monthly' ? 'text-white' : 'text-[#475569]'}`}>
            Monthly
          </span>
          <button
            onClick={() => setBillingPeriod(p => p === 'monthly' ? 'annual' : 'monthly')}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              billingPeriod === 'annual' ? 'bg-[#7C3AED]' : 'bg-[#333]'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              billingPeriod === 'annual' ? 'translate-x-5' : ''
            }`} />
          </button>
          <span className={`text-sm font-medium ${billingPeriod === 'annual' ? 'text-white' : 'text-[#475569]'}`}>
            Annual
            <span className="text-xs text-[#10B981] font-semibold ml-1.5">Save ~30%</span>
          </span>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((p, i) => {
            const Icon = p.icon
            const isSelected = selectedPlan === p.key
            const perMonth = billingPeriod === 'annual' ? Math.round(p.annual / 12) : p.monthly
            const billedAs = billingPeriod === 'annual' ? `$${p.annual}/yr` : null

            return (
              <motion.button
                key={p.key}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                onClick={() => setSelectedPlan(p.key)}
                className={`relative text-left p-5 rounded-2xl border-2 transition-all ${
                  isSelected
                    ? 'border-[#7C3AED] bg-purple-950/20'
                    : 'border-[#222] bg-[#111] hover:border-[#333]'
                }`}
              >
                {p.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold px-3 py-0.5 rounded-full bg-[#7C3AED] text-white whitespace-nowrap">
                    Most popular
                  </span>
                )}

                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Icon size={15} style={{ color: p.color }} />
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                  </div>
                  {isSelected && <CheckCircle size={15} className="text-[#7C3AED]" />}
                </div>

                <p className="text-[10px] text-[#475569] mb-2">{p.tagline}</p>

                <div className="mb-0.5">
                  <span className="text-2xl font-bold text-white">${perMonth}</span>
                  <span className="text-xs text-[#475569]">/mo</span>
                </div>
                {billedAs && (
                  <p className="text-xs text-[#94A3B8] mb-1">{billedAs} billed annually</p>
                )}
                <p className="text-[10px] text-[#10B981] mb-3">{p.description}</p>

                <ul className="space-y-1.5">
                  {p.features.map((f, fi) => (
                    <li key={f} className={`flex items-start gap-1.5 text-xs ${fi === 0 ? 'text-white font-medium' : 'text-[#94A3B8]'}`}>
                      <CheckCircle size={11} className={`mt-0.5 flex-shrink-0 ${fi === 0 ? 'text-[#06B6D4]' : 'text-[#10B981]'}`} />
                      {f}
                    </li>
                  ))}
                </ul>
              </motion.button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 text-xs text-[#475569]">
          <Building2 size={12} />
          <span>3-day free trial included. Card charged after trial. Cancel anytime.</span>
        </div>

        {checkoutError && (
          <div className="p-3 rounded-xl bg-red-950/30 border border-red-800/40 text-sm text-red-400">
            {checkoutError}
          </div>
        )}

        <Button
          onClick={handleSubscribeAndSchedule}
          disabled={saving}
          size="lg"
          className="gap-2"
        >
          {saving ? (
            <>
              <Loader size={16} className="animate-spin" />
              Redirecting to Stripe...
            </>
          ) : (
            <>
              <ArrowRight size={16} />
              Subscribe &amp; Schedule Sessions
            </>
          )}
        </Button>
      </div>
    )
  }

  // Main scheduling form
  return (
    <div className="max-w-2xl space-y-8">

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays size={18} className="text-[#06B6D4]" />
              <span className="text-xs font-semibold text-[#06B6D4] uppercase tracking-wider">Schedule</span>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Schedule your sessions</h1>
            <p className="text-[#94A3B8]">
              {plan.sessions.length} sessions planned · {totalNeeded} minutes total
            </p>
          </div>
          {/* Balance + TopUp */}
          <div className="flex items-center gap-3 mt-1">
            <div className="text-right">
              <p className="text-xs text-[#475569]">Balance</p>
              <p className={`text-lg font-bold ${minutesBalance < totalNeeded ? 'text-[#F59E0B]' : 'text-[#06B6D4]'}`}>
                {minutesBalance} min
              </p>
            </div>
            <button
              onClick={() => setTopUpOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#333333] bg-[#111111] hover:border-[#555555] hover:bg-[#1A1A1A] text-sm font-medium text-white transition-all"
            >
              <Zap size={13} className="text-[#F59E0B]" />
              Top up
            </button>
          </div>
        </div>
      </motion.div>

      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} currentBalance={minutesBalance} />

      {/* Preferences */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-6"
      >
        {/* Start date */}
        <div>
          <label className="text-sm font-semibold text-white mb-2 block">First session date</label>
          <input
            type="date"
            value={firstDate}
            min={tomorrowStr}
            onChange={(e) => setFirstDate(e.target.value)}
            className="bg-[#111111] border border-[#222222] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#7C3AED] transition-colors w-full max-w-xs"
          />
        </div>

        {/* Frequency */}
        <div>
          <label className="text-sm font-semibold text-white mb-3 block">Frequency</label>
          <div className="grid grid-cols-3 gap-3">
            {FREQUENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFrequencyDays(opt.value)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  frequencyDays === opt.value
                    ? 'bg-purple-950/40 border-[#7C3AED] text-white'
                    : 'bg-[#111111] border-[#222222] text-[#94A3B8] hover:border-[#333] hover:text-white'
                }`}
              >
                <p className="text-sm font-semibold">{opt.label}</p>
                <p className="text-xs text-[#475569] mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Preferred time */}
        <div>
          <label className="text-sm font-semibold text-white mb-3 block">Preferred time</label>
          <div className="grid grid-cols-3 gap-3">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPreferredHour(opt.value)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  preferredHour === opt.value
                    ? 'bg-purple-950/40 border-[#7C3AED] text-white'
                    : 'bg-[#111111] border-[#222222] text-[#94A3B8] hover:border-[#333] hover:text-white'
                }`}
              >
                <p className="text-sm font-semibold">{opt.label}</p>
                <p className="text-xs text-[#475569] mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Max duration */}
        <div>
          <label className="text-sm font-semibold text-white mb-3 block">Max session duration</label>
          <div className="flex gap-3">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMaxDuration(opt.value)}
                className={`flex-1 p-3 rounded-xl border text-left transition-all ${
                  maxDuration === opt.value
                    ? 'bg-purple-950/40 border-[#7C3AED] text-white'
                    : 'bg-[#111111] border-[#222222] text-[#94A3B8] hover:border-[#333] hover:text-white'
                }`}
              >
                <p className="text-sm font-semibold">{opt.label}</p>
                <p className="text-xs text-[#475569] mt-0.5">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Schedule preview */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <h3 className="text-sm font-semibold text-[#94A3B8] uppercase tracking-wider mb-3">Schedule Preview</h3>
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {scheduledSessions.map((session, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#111111] border border-[#1A1A1A]"
            >
              <div className="w-6 h-6 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-[#A855F7]">{session.sessionIndex}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{session.title}</p>
              </div>
              <div className="text-xs text-[#475569] whitespace-nowrap">
                {new Date(session.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div className="flex items-center gap-1 text-xs text-[#475569]">
                <Clock size={10} />
                {session.estimatedMinutes}m
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="space-y-3"
      >
        <div className="flex items-center gap-4 flex-wrap">
          {hasPaidPlan ? (
            <Button onClick={handleConfirm} disabled={saving} size="lg" className="gap-2">
              {saving ? 'Scheduling...' : 'Confirm Schedule'}
              {!saving && <ArrowRight size={18} />}
            </Button>
          ) : (
            <Button onClick={() => setShowPlans(true)} size="lg" className="gap-2">
              <Sparkles size={16} />
              Choose a plan to schedule
            </Button>
          )}
        </div>

        <button
          onClick={handleQuickTest}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs text-[#475569] hover:text-[#94A3B8] transition-colors"
        >
          <FlaskConical size={12} />
          Quick test: schedule first session in 2 minutes
        </button>
      </motion.div>

    </div>
  )
}
