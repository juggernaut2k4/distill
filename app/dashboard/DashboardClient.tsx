'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ScoreRing } from '@/components/dashboard/ScoreRing'
import { StreakCounter } from '@/components/dashboard/StreakCounter'
import { MessageCard } from '@/components/dashboard/MessageCard'
import { DeliveryToggle } from '@/components/dashboard/DeliveryToggle'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { MessageSquare, ArrowRight, Timer } from 'lucide-react'
import Link from 'next/link'

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
}

interface DashboardClientProps {
  user: User
  recentDeliveries: DeliveryEntry[]
  monthlyCount: number
}

export default function DashboardClient({
  user,
  recentDeliveries,
  monthlyCount,
}: DashboardClientProps) {
  const [deliveryPref, setDeliveryPref] = useState<'email' | 'sms' | 'both'>(
    (user.delivery_preference as 'email' | 'sms' | 'both') ?? 'email'
  )
  const [paused, setPaused] = useState(false)

  const score = user.ai_readiness_score ?? 0
  const streak = user.streak_days ?? 0
  const planTier = user.plan_tier ?? 'free'
  const smsEnabled = planTier === 'pro' || planTier === 'executive'
  const minutesBalance = user.minutes_balance ?? 0
  const minutesIncluded = user.minutes_included ?? 0
  const minutesPct = minutesIncluded > 0 ? Math.round((minutesBalance / minutesIncluded) * 100) : 0
  const minutesColor = minutesPct > 50 ? '#10B981' : minutesPct > 20 ? '#F59E0B' : '#EF4444'
  const planPending = !user.plan_approved && planTier !== 'free'

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

  return (
    <div className="space-y-8">
      {/* Plan pending banner */}
      {planPending && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between px-4 py-3 rounded-xl border border-amber-800/30 bg-amber-950/20"
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse flex-shrink-0" />
            <p className="text-sm text-[#FCD34D] font-medium">
              Your learning plan is ready to review
            </p>
          </div>
          <Link href="/dashboard/plan">
            <Button size="sm" className="gap-1.5 whitespace-nowrap">
              Review plan <ArrowRight size={13} />
            </Button>
          </Link>
        </motion.div>
      )}

      {/* Row 1: Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Card className="p-6 flex flex-col items-center justify-center min-h-[160px]">
            <ScoreRing score={score} />
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <Card className="p-6 flex flex-col items-center justify-center min-h-[160px]">
            <StreakCounter days={streak} />
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <Card className="p-6 flex flex-col items-center justify-center min-h-[160px]">
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={32} className="text-[#06B6D4]" />
                <span className="text-4xl font-bold text-white">{monthlyCount}</span>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">Messages</p>
                <p className="text-xs text-[#475569] mt-0.5">this month</p>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Minutes balance */}
      {minutesIncluded > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
        >
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Timer size={16} className="text-[#06B6D4]" />
                <span className="text-sm font-semibold text-white">Coaching Minutes</span>
              </div>
              <span className="text-xs text-[#475569]">{minutesBalance} / {minutesIncluded} remaining</span>
            </div>
            <div className="w-full h-2 bg-[#1A1A1A] rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${minutesPct}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{ backgroundColor: minutesColor }}
              />
            </div>
            {minutesPct <= 20 && (
              <p className="text-xs mt-2" style={{ color: minutesColor }}>
                Running low — consider topping up
              </p>
            )}
          </Card>
        </motion.div>
      )}

      {/* Row 2: Recent messages */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <h2 className="text-lg font-bold text-white mb-4">Recent Insights</h2>
        {recentDeliveries.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-[#475569]">Your first insight arrives tomorrow morning.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recentDeliveries.map((delivery) => (
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
            ))}
          </div>
        )}
      </motion.div>

      {/* Row 3: Preferences */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
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
      </motion.div>

      {/* Upgrade CTA for Starter */}
      {planTier === 'starter' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        >
          <div
            className="rounded-xl p-6 flex items-center justify-between"
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
            <Link href="/pricing">
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
