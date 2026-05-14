'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { CheckCircle, ArrowRight, Sparkles, Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TopUpModal } from '@/components/ui/TopUpModal'
import { LearningPathView } from '@/components/plan/LearningPathView'
import { buildCurriculum, type CurriculumPlan } from '@/lib/content/curriculum'

interface User {
  id: string
  email: string | null
  plan_tier: string | null
  ai_maturity: string | null
  topic_interests: string[] | null
  curriculum_plan: unknown
  plan_approved: boolean | null
  minutes_balance: number | null
  minutes_included: number | null
}


export default function PlanClient({ user }: { user: User }) {
  const router = useRouter()
  const [plan, setPlan] = useState<CurriculumPlan | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(user.plan_approved ?? false)
  const [topUpOpen, setTopUpOpen] = useState(false)

  useEffect(() => {
    const topics = user.topic_interests ?? []
    const maturity = user.ai_maturity ?? 'observer'
    const curriculum = buildCurriculum(topics, maturity)
    setPlan(curriculum)
  }, [user.topic_interests, user.ai_maturity])

  async function handleApprove() {
    setApproving(true)
    try {
      const res = await fetch('/api/plan/approve', { method: 'POST' })
      if (!res.ok) throw new Error('API error')
      setApproved(true)
      // Short delay so the success state is visible, then navigate
      setTimeout(() => router.push('/dashboard/schedule'), 800)
    } catch {
      alert('Something went wrong. Please try again.')
      setApproving(false)
    }
  }

  if (!plan) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
              className="w-2 h-2 rounded-full bg-[#7C3AED]"
            />
          ))}
        </div>
      </div>
    )
  }

  const totalMins = plan.totalMinutes
  const balance = user.minutes_balance ?? 0
  const hasEnoughMinutes = balance >= totalMins

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={18} className="text-[#7C3AED]" />
              <span className="text-xs font-semibold text-[#7C3AED] uppercase tracking-wider">
                Your Learning Plan
              </span>
            </div>
            <h1 className="text-3xl font-bold text-white mb-1">
              {plan.totalTopics} topics across {plan.sessions.length} sessions
            </h1>
            <p className="text-[#94A3B8]">
              Personalized to your role and interests. Review and approve to get started.
            </p>
          </div>

          {approved ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-950/30 border border-green-800/30">
              <CheckCircle size={16} className="text-[#10B981]" />
              <span className="text-sm font-semibold text-[#10B981]">Plan Approved</span>
            </div>
          ) : (
            <Button onClick={handleApprove} disabled={approving} className="gap-2 whitespace-nowrap">
              {approving ? 'Approving...' : 'Approve Plan'}
              <ArrowRight size={16} />
            </Button>
          )}
        </div>

        {/* Stats row */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          {[
            { label: 'Sessions', value: plan.sessions.length, color: '#7C3AED' },
            { label: 'Total Minutes', value: totalMins, color: '#06B6D4' },
            { label: 'Your Balance', value: `${balance} min`, color: hasEnoughMinutes ? '#10B981' : '#F59E0B' },
          ].map((stat) => (
            <Card key={stat.label} className="p-4 text-center">
              <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
              <p className="text-xs text-[#475569] mt-0.5">{stat.label}</p>
            </Card>
          ))}
        </div>

        {!hasEnoughMinutes && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 flex items-center justify-between px-4 py-3 rounded-xl border border-amber-800/30 bg-amber-950/20"
          >
            <p className="text-sm text-[#FCD34D]">
              You need {totalMins - balance} more minutes to complete this plan.
            </p>
            <Button variant="secondary" size="sm" className="gap-1 whitespace-nowrap" onClick={() => setTopUpOpen(true)}>
              Top up minutes <ArrowRight size={14} />
            </Button>
          </motion.div>
        )}
      </motion.div>

      {/* Learning Path — all sessions + sub-topics, static layout */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Clock size={17} className="text-[#06B6D4]" />
            Your Learning Path
          </h2>
          <span className="text-xs text-[#475569]">Select a session to see details</span>
        </div>
        <LearningPathView plan={plan} />
      </motion.div>

      {/* Approve CTA at bottom */}
      {!approved && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex gap-4 items-center"
        >
          <Button onClick={handleApprove} disabled={approving} size="lg" className="gap-2">
            {approving ? 'Approving...' : 'Approve & Schedule Sessions'}
            <ArrowRight size={18} />
          </Button>
          <button
            className="text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
            onClick={() => router.push('/topics')}
          >
            Change topics →
          </button>
        </motion.div>
      )}

      {approved && !approving && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center gap-4 flex-wrap"
        >
          <Button onClick={() => router.push('/dashboard/schedule')} size="lg" className="gap-2">
            Go to Schedule
            <ArrowRight size={18} />
          </Button>
          <button
            className="text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
            onClick={() => router.push('/topics')}
          >
            Change topics →
          </button>
        </motion.div>
      )}

      {approving && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 p-4 rounded-xl bg-green-950/20 border border-green-800/30"
        >
          <CheckCircle size={20} className="text-[#10B981]" />
          <div>
            <p className="text-sm font-semibold text-[#10B981]">Plan approved!</p>
            <p className="text-xs text-[#475569]">Redirecting to scheduling...</p>
          </div>
        </motion.div>
      )}

      <TopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        currentBalance={user.minutes_balance ?? 0}
      />
    </div>
  )
}
