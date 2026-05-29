'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Library, Layers, Clock, Trash2, ChevronRight,
  Loader2, AlertTriangle, ShieldCheck, PlayCircle
} from 'lucide-react'
import Link from 'next/link'

interface KBTopic {
  topic_id: string
  topic_title: string
  section_count: number
  last_updated: string
  subtopics: Array<{ slug: string; title: string; type: string }>
  avg_qa_score?: number | null
}

type QAState = 'idle' | 'running' | 'done' | 'error'

export default function KBIndexClient() {
  const [topics, setTopics] = useState<KBTopic[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [qaState, setQaState] = useState<Record<string, QAState>>({})
  const [qaResult, setQaResult] = useState<Record<string, { avg_score: number; candidates_added: number }>>({})
  const [pendingRulesCount, setPendingRulesCount] = useState(0)

  async function loadTopics() {
    setIsLoading(true)
    setError(null)
    try {
      const [topicsRes, rulesRes] = await Promise.all([
        fetch('/api/kb/topics'),
        fetch('/api/kb/qa/rules'),
      ])
      const topicsData = await topicsRes.json()
      const rulesData = await rulesRes.json()

      if (!topicsRes.ok) {
        setError(topicsData.error ?? 'Failed to load knowledge base.')
      } else {
        setTopics(topicsData.topics ?? [])
      }

      const pending = (rulesData.rules ?? []).filter((r: { status: string }) => r.status === 'pending').length
      setPendingRulesCount(pending)
    } catch {
      setError('Connection error. Please refresh.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadTopics() }, [])

  async function handleDelete(topicId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Delete this topic? It will be regenerated fresh next time a user selects it.')) return

    setDeletingId(topicId)
    try {
      const res = await fetch(`/api/kb/topics/${encodeURIComponent(topicId)}`, { method: 'DELETE' })
      if (res.ok) setTopics((prev) => prev.filter((t) => t.topic_id !== topicId))
    } catch { /* non-fatal */ }
    finally { setDeletingId(null) }
  }

  async function runQA(topicId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setQaState((p) => ({ ...p, [topicId]: 'running' }))

    try {
      const res = await fetch('/api/kb/qa/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId }),
      })
      const data = await res.json()

      if (res.ok) {
        setQaState((p) => ({ ...p, [topicId]: 'done' }))
        setQaResult((p) => ({
          ...p,
          [topicId]: { avg_score: data.avg_score, candidates_added: data.candidates_added },
        }))
        // Update topic avg score in list
        setTopics((prev) => prev.map((t) =>
          t.topic_id === topicId ? { ...t, avg_qa_score: data.avg_score } : t
        ))
        if (data.candidates_added > 0) {
          setPendingRulesCount((n) => n + data.candidates_added)
        }
      } else {
        setQaState((p) => ({ ...p, [topicId]: 'error' }))
      }
    } catch {
      setQaState((p) => ({ ...p, [topicId]: 'error' }))
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  function scoreColor(score: number) {
    if (score >= 8) return 'text-[#10B981]'
    if (score >= 6) return 'text-[#F59E0B]'
    return 'text-[#EF4444]'
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Library className="w-6 h-6 text-[#7C3AED]" />
            <h1 className="text-white text-2xl font-bold">Knowledge Base</h1>
          </div>
          <p className="text-[#94A3B8] text-sm">
            All generated infographics, organized by topic. Run QA to review quality.
          </p>
        </div>

        <Link
          href="/dashboard/knowledge-base/rules"
          className="relative flex items-center gap-2 px-4 py-2 bg-[#111111] border border-[#333333] hover:border-[#7C3AED]/50 rounded-xl text-sm text-[#94A3B8] hover:text-white transition-colors shrink-0 self-start"
        >
          <ShieldCheck className="w-4 h-4 text-[#7C3AED]" />
          Generation Rules
          {pendingRulesCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#F59E0B] text-[#080808] text-xs font-bold flex items-center justify-center">
              {pendingRulesCount}
            </span>
          )}
        </Link>
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center justify-center py-24 text-[#94A3B8]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading knowledge base...
        </div>
      )}

      {error && (
        <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-medium">Could not load knowledge base</p>
            <p className="text-[#94A3B8] text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {!isLoading && !error && topics.length === 0 && (
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-12 text-center">
          <Library className="w-12 h-12 text-[#333333] mx-auto mb-4" />
          <p className="text-white font-semibold mb-2">No topics yet</p>
          <p className="text-[#475569] text-sm max-w-sm mx-auto">
            Topics appear here after a session generates visual sections.
          </p>
          <Link
            href="/dashboard/schedule"
            className="inline-flex items-center gap-2 mt-6 px-4 py-2 bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-medium rounded-lg transition-colors"
          >
            Schedule a session
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* Topic grid */}
      {!isLoading && !error && topics.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {topics.map((topic, i) => {
            const state = qaState[topic.topic_id] ?? 'idle'
            const result = qaResult[topic.topic_id]
            const score = result?.avg_score ?? topic.avg_qa_score

            return (
              <motion.div
                key={topic.topic_id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
              >
                <Link
                  href={`/dashboard/knowledge-base/${encodeURIComponent(topic.topic_id)}`}
                  className="block bg-[#111111] border border-[#222222] hover:border-[#7C3AED]/50 rounded-xl p-5 transition-all group"
                >
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-white font-semibold text-sm leading-snug group-hover:text-[#A855F7] transition-colors line-clamp-2">
                      {topic.topic_title}
                    </h3>
                    <button
                      onClick={(e) => handleDelete(topic.topic_id, e)}
                      disabled={deletingId === topic.topic_id}
                      className="shrink-0 p-1.5 text-[#475569] hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg transition-colors disabled:opacity-40"
                      title="Delete topic"
                    >
                      {deletingId === topic.topic_id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* QA score badge */}
                  {score != null && (
                    <div className="flex items-center gap-1.5 mb-3">
                      <span className={`text-lg font-bold ${scoreColor(score)}`}>{score}</span>
                      <span className="text-[#475569] text-xs">/10 QA score</span>
                      {result?.candidates_added > 0 && (
                        <span className="ml-auto text-xs bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30 px-1.5 py-0.5 rounded-full">
                          +{result.candidates_added} rules
                        </span>
                      )}
                    </div>
                  )}

                  {/* Subtopic previews */}
                  <div className="space-y-1 mb-4">
                    {topic.subtopics.slice(0, 3).map((sub) => (
                      <div key={sub.slug} className="flex items-center gap-2">
                        <div className="w-1 h-1 rounded-full bg-[#7C3AED] shrink-0" />
                        <span className="text-[#475569] text-xs truncate">{sub.title}</span>
                      </div>
                    ))}
                    {topic.subtopics.length > 3 && (
                      <p className="text-[#333333] text-xs pl-3">+{topic.subtopics.length - 3} more</p>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#1a1a1a]">
                    <div className="flex items-center gap-1 text-[#475569] text-xs">
                      <Layers className="w-3 h-3" />
                      <span>{topic.section_count} {topic.section_count === 1 ? 'section' : 'sections'}</span>
                    </div>

                    {/* Run QA button */}
                    <button
                      onClick={(e) => runQA(topic.topic_id, e)}
                      disabled={state === 'running'}
                      className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                        state === 'done'
                          ? 'text-[#10B981] bg-[#10B981]/10'
                          : state === 'error'
                          ? 'text-[#EF4444] bg-[#EF4444]/10'
                          : 'text-[#94A3B8] hover:text-white hover:bg-[#1a1a1a] border border-[#333333]'
                      }`}
                      title="Run QA review on this topic"
                    >
                      {state === 'running'
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Reviewing...</>
                        : state === 'done'
                        ? <><ShieldCheck className="w-3 h-3" /> Reviewed</>
                        : state === 'error'
                        ? <>Error — retry</>
                        : <><PlayCircle className="w-3 h-3" /> Run QA</>}
                    </button>
                  </div>

                  {/* Date */}
                  <div className="flex items-center gap-1 text-[#333333] text-xs mt-1.5">
                    <Clock className="w-3 h-3" />
                    <span>{formatDate(topic.last_updated)}</span>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
