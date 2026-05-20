'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Library, Layers, Clock, Trash2, ChevronRight, Loader2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

interface KBTopic {
  topic_id: string
  topic_title: string
  section_count: number
  last_updated: string
  subtopics: Array<{ slug: string; title: string; type: string }>
}

export default function KBIndexClient() {
  const [topics, setTopics] = useState<KBTopic[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadTopics() {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/kb/topics')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to load knowledge base.')
      } else {
        setTopics(data.topics ?? [])
      }
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
      if (res.ok) {
        setTopics((prev) => prev.filter((t) => t.topic_id !== topicId))
      }
    } catch {
      // non-fatal
    } finally {
      setDeletingId(null)
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Library className="w-6 h-6 text-[#7C3AED]" />
            <h1 className="text-white text-2xl font-bold">Knowledge Base</h1>
          </div>
          <p className="text-[#94A3B8] text-sm">
            All generated infographics, organized by topic. Review, refine, and curate.
          </p>
        </div>
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
            Topics appear here automatically after a session generates visual sections. Schedule a session to get started.
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
          {topics.map((topic, i) => (
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
                {/* Topic title */}
                <div className="flex items-start justify-between gap-2 mb-4">
                  <h3 className="text-white font-semibold text-sm leading-snug group-hover:text-[#A855F7] transition-colors line-clamp-2">
                    {topic.topic_title}
                  </h3>
                  <button
                    onClick={(e) => handleDelete(topic.topic_id, e)}
                    disabled={deletingId === topic.topic_id}
                    className="shrink-0 p-1.5 text-[#475569] hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg transition-colors disabled:opacity-40"
                    title="Delete topic (regenerates fresh next session)"
                  >
                    {deletingId === topic.topic_id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>

                {/* Subtopic previews */}
                <div className="space-y-1 mb-4">
                  {topic.subtopics.slice(0, 3).map((sub) => (
                    <div key={sub.slug} className="flex items-center gap-2">
                      <div className="w-1 h-1 rounded-full bg-[#7C3AED] shrink-0" />
                      <span className="text-[#475569] text-xs truncate">{sub.title}</span>
                    </div>
                  ))}
                  {topic.subtopics.length > 3 && (
                    <p className="text-[#333333] text-xs pl-3">
                      +{topic.subtopics.length - 3} more sections
                    </p>
                  )}
                </div>

                {/* Footer meta */}
                <div className="flex items-center justify-between pt-3 border-t border-[#1a1a1a]">
                  <div className="flex items-center gap-1 text-[#475569] text-xs">
                    <Layers className="w-3 h-3" />
                    <span>{topic.section_count} {topic.section_count === 1 ? 'section' : 'sections'}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[#475569] text-xs">
                    <Clock className="w-3 h-3" />
                    <span>{formatDate(topic.last_updated)}</span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
