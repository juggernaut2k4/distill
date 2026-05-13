'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { CheckCircle, Clock, ChevronDown, ChevronUp, ArrowRight, Sparkles, BookOpen, Tag } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TopUpModal } from '@/components/ui/TopUpModal'
import { FlowDiagram } from '@/components/diagrams/FlowDiagram'
import { buildCurriculum, type CurriculumPlan } from '@/lib/content/curriculum'
import type { FlowNode, FlowEdge, FlowGroup } from '@/components/diagrams/FlowDiagram'

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

const DIFFICULTY_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  beginner:     { label: 'Beginner',     color: '#67E8F9', bg: 'rgba(6,182,212,0.15)' },
  intermediate: { label: 'Intermediate', color: '#FCD34D', bg: 'rgba(245,158,11,0.15)' },
  advanced:     { label: 'Advanced',     color: '#C4B5FD', bg: 'rgba(124,58,237,0.15)' },
}

export default function PlanClient({ user }: { user: User }) {
  const router = useRouter()
  const [plan, setPlan] = useState<CurriculumPlan | null>(null)
  const [expandedSession, setExpandedSession] = useState<number | null>(0)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(user.plan_approved ?? false)
  const [showDiagram, setShowDiagram] = useState(false)
  const [topUpOpen, setTopUpOpen] = useState(false)

  useEffect(() => {
    const topics = user.topic_interests ?? []
    const maturity = user.ai_maturity ?? 'observer'
    const curriculum = buildCurriculum(topics, maturity)
    setPlan(curriculum)
    // Show diagram after slight delay for animation
    setTimeout(() => setShowDiagram(true), 300)
  }, [user.topic_interests, user.ai_maturity])

  async function handleApprove() {
    setApproving(true)
    try {
      await fetch('/api/plan/approve', { method: 'POST' })
      setApproved(true)
      setTimeout(() => router.push('/dashboard/schedule'), 1200)
    } catch {
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

  // Build diagram data from plan — 1 node per session (1 topic per session)
  const diagramNodes: FlowNode[] = []
  const diagramEdges: FlowEdge[] = []
  const diagramGroups: FlowGroup[] = []
  let prevNodeId: string | null = null

  for (const session of plan.sessions) {
    const topic = session.topics[0]
    const nodeId = `s${session.index}`
    diagramNodes.push({
      id: nodeId,
      label: topic.title,
      sublabel: `~${topic.estimatedMinutes}m`,
      type: 'action',
      status: session.index === 1 ? 'pending' : 'locked',
    })

    if (prevNodeId) {
      diagramEdges.push({
        from: prevNodeId,
        to: nodeId,
        animated: session.index === 2,
      })
    }

    diagramGroups.push({
      id: `session_${session.index}`,
      label: `Session ${session.index}`,
      nodeIds: [nodeId],
    })

    prevNodeId = nodeId
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

      {/* Flow Diagram */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: showDiagram ? 1 : 0, y: showDiagram ? 0 : 20 }}
        transition={{ duration: 0.6 }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <BookOpen size={18} className="text-[#06B6D4]" />
            Learning Path
          </h2>
          <span className="text-xs text-[#475569]">Scroll to explore →</span>
        </div>
        <FlowDiagram
          nodes={diagramNodes}
          edges={diagramEdges}
          groups={diagramGroups}
          layout="vertical"
          className="min-h-[320px]"
        />
      </motion.div>

      {/* Session list */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <h2 className="text-lg font-bold text-white mb-4">Sessions</h2>
        <div className="space-y-3">
          {plan.sessions.map((session, i) => (
            <Card
              key={session.index}
              className={`overflow-hidden cursor-pointer transition-colors ${
                expandedSession === i ? 'border-[#333]' : ''
              }`}
              onClick={() => setExpandedSession(expandedSession === i ? null : i)}
            >
              {(() => {
                const topic = session.topics[0]
                const badge = DIFFICULTY_BADGE[topic.difficulty] ?? DIFFICULTY_BADGE.beginner
                return (
                  <>
                    <div className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-950/50 border border-purple-800/40 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-[#A855F7]">{session.index}</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{session.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ color: badge.color, background: badge.bg }}
                            >
                              {badge.label}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-xs text-[#475569]">
                          <Clock size={12} />
                          ~{session.estimatedMinutes}m
                        </div>
                        {expandedSession === i ? (
                          <ChevronUp size={16} className="text-[#475569]" />
                        ) : (
                          <ChevronDown size={16} className="text-[#475569]" />
                        )}
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedSession === i && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 border-t border-[#1A1A1A] pt-3">
                            <div className="flex items-center gap-3">
                              <Tag size={14} className="text-[#7C3AED] flex-shrink-0" />
                              <span className="text-sm text-[#94A3B8]">{topic.title}</span>
                              <span className="ml-auto text-xs text-[#475569]">~{topic.estimatedMinutes}m</span>
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                                style={{ color: badge.color, background: badge.bg }}
                              >
                                {badge.label}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )
              })()}
            </Card>
          ))}
        </div>
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
