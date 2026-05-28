'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { CheckCircle, ArrowRight, Sparkles, Clock, BookOpen, LayoutList } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TopUpModal } from '@/components/ui/TopUpModal'
import { LearningPathView } from '@/components/plan/LearningPathView'
import { TopicTree } from '@/components/plan/TopicTree'
import { buildCurriculum, type CurriculumPlan } from '@/lib/content/curriculum'
import { buildCurriculumFromSelection } from '@/lib/content/curriculum-from-selection'

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

type Tab = 'ai-plan' | 'browse'

export default function PlanClient({ user }: { user: User }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('ai-plan')
  const [plan, setPlan] = useState<CurriculumPlan | null>(null)
  const [customPlan, setCustomPlan] = useState<CurriculumPlan | null>(null)
  const [building, setBuilding] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(user.plan_approved ?? false)
  const [topUpOpen, setTopUpOpen] = useState(false)

  useEffect(() => {
    const topics = user.topic_interests ?? []
    const maturity = user.ai_maturity ?? 'observer'
    const curriculum = buildCurriculum(topics, maturity)
    setPlan(curriculum)
  }, [user.topic_interests, user.ai_maturity])

  function handleBuildFromSelection(selectedLessonIds: string[]) {
    setBuilding(true)
    try {
      const built = buildCurriculumFromSelection(selectedLessonIds)
      setCustomPlan(built)
    } finally {
      setBuilding(false)
    }
  }

  async function handleApprove() {
    setApproving(true)
    try {
      const res = await fetch('/api/plan/approve', { method: 'POST' })
      if (!res.ok) throw new Error('API error')
      setApproved(true)
      setTimeout(() => router.push('/dashboard/schedule'), 800)
    } catch {
      alert('Something went wrong. Please try again.')
      setApproving(false)
    }
  }

  const activePlan = tab === 'browse' ? customPlan : plan
  const balance = user.minutes_balance ?? 0
  const totalMins = activePlan?.totalMinutes ?? 0
  const hasEnoughMinutes = balance >= totalMins

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'ai-plan', label: 'AI Plan', icon: <Sparkles size={14} /> },
    { id: 'browse', label: 'Browse Catalog', icon: <BookOpen size={14} /> },
  ]

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
              {activePlan
                ? `${activePlan.totalTopics} topics across ${activePlan.sessions.length} sessions`
                : 'Build your learning path'}
            </h1>
            <p className="text-[#94A3B8]">
              {tab === 'ai-plan'
                ? 'Personalized to your role and interests. Review and approve to get started.'
                : 'Browse the full catalog and select exactly what you want to learn.'}
            </p>
          </div>

          {tab === 'ai-plan' && (
            approved ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-950/30 border border-green-800/30">
                <CheckCircle size={16} className="text-[#10B981]" />
                <span className="text-sm font-semibold text-[#10B981]">Plan Approved</span>
              </div>
            ) : (
              <Button onClick={handleApprove} disabled={approving} className="gap-2 whitespace-nowrap">
                {approving ? 'Approving...' : 'Approve Plan'}
                <ArrowRight size={16} />
              </Button>
            )
          )}
        </div>

        {/* Stats row — only when a plan is visible */}
        {activePlan && tab === 'ai-plan' && (
          <div className="mt-6 grid grid-cols-3 gap-4">
            {[
              { label: 'Sessions', value: activePlan.sessions.length, color: '#7C3AED' },
              { label: 'Total Minutes', value: totalMins, color: '#06B6D4' },
              { label: 'Your Balance', value: `${balance} min`, color: hasEnoughMinutes ? '#10B981' : '#F59E0B' },
            ].map((stat) => (
              <Card key={stat.label} className="p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
                <p className="text-xs text-[#475569] mt-0.5">{stat.label}</p>
              </Card>
            ))}
          </div>
        )}

        {tab === 'ai-plan' && activePlan && !hasEnoughMinutes && (
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

      {/* Tab switcher */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex gap-1 p-1 rounded-xl bg-[#111111] border border-[#1E1E1E] w-fit"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.id
                ? 'bg-[#7C3AED] text-white'
                : 'text-[#475569] hover:text-[#94A3B8]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </motion.div>

      {/* Tab content */}
      {tab === 'ai-plan' && (
        <motion.div
          key="ai-plan"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Clock size={17} className="text-[#06B6D4]" />
              Your Learning Path
            </h2>
            <span className="text-xs text-[#475569]">Select a session to see details</span>
          </div>
          {plan && <LearningPathView plan={plan} />}
        </motion.div>
      )}

      {tab === 'browse' && (
        <motion.div
          key="browse"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Custom plan preview (after building) */}
          {customPlan && (
            <div className="rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/5 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LayoutList size={16} className="text-[#A855F7]" />
                  <h3 className="text-base font-bold text-white">
                    {customPlan.sessions.length} sessions · {customPlan.totalMinutes} min total
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#94A3B8]">{customPlan.totalTopics} lessons</span>
                  <Button size="sm" onClick={handleApprove} disabled={approving} className="gap-1">
                    {approving ? 'Approving...' : 'Approve this plan'} <ArrowRight size={13} />
                  </Button>
                </div>
              </div>
              <LearningPathView plan={customPlan} />
            </div>
          )}

          {/* Catalog tree */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <BookOpen size={16} className="text-[#06B6D4]" />
              <h2 className="text-lg font-bold text-white">Catalog</h2>
              <span className="text-xs text-[#475569] ml-1">Expand domains → check what you want to learn</span>
            </div>
            <TopicTree onBuild={handleBuildFromSelection} building={building} />
          </div>
        </motion.div>
      )}

      {/* Bottom CTAs — AI Plan tab only */}
      {tab === 'ai-plan' && (
        <>
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
        </>
      )}

      <TopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        currentBalance={user.minutes_balance ?? 0}
      />
    </div>
  )
}
