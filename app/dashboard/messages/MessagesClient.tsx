'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Mail, Smartphone, ThumbsUp, ThumbsDown, Filter } from 'lucide-react'
import { MessageCard } from '@/components/dashboard/MessageCard'
import type { MessageItem } from '@/app/api/messages/route'

type FilterKey = 'all' | 'email' | 'sms' | 'positive' | 'negative'

const FILTERS: { key: FilterKey; label: string; icon?: React.ReactNode }[] = [
  { key: 'all', label: 'All' },
  { key: 'email', label: 'Email', icon: <Mail size={12} /> },
  { key: 'sms', label: 'SMS', icon: <Smartphone size={12} /> },
  { key: 'positive', label: 'Helpful', icon: <ThumbsUp size={12} /> },
  { key: 'negative', label: 'Not helpful', icon: <ThumbsDown size={12} /> },
]

interface MessagesClientProps {
  initialMessages: MessageItem[]
}

export default function MessagesClient({ initialMessages }: MessagesClientProps) {
  const [messages, setMessages] = useState<MessageItem[]>(initialMessages)
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  /** Tracks which delivery IDs are mid-save to disable double-clicks */
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())

  const handleFeedback = useCallback(
    async (id: string, feedback: 'positive' | 'negative') => {
      // Optimistic update
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, feedback } : m))
      )
      setSavingIds((prev) => new Set(prev).add(id))

      try {
        const res = await fetch(`/api/messages/${id}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback }),
        })

        if (!res.ok) {
          // Roll back optimistic update on error
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, feedback: initialMessages.find((im) => im.id === id)?.feedback ?? null }
                : m
            )
          )
          console.error('[MessagesClient] Feedback save failed')
        }
      } catch {
        // Roll back on network error
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, feedback: initialMessages.find((im) => im.id === id)?.feedback ?? null }
              : m
          )
        )
      } finally {
        setSavingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [initialMessages]
  )

  const filtered = messages.filter((m) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'email') return m.channel === 'email'
    if (activeFilter === 'sms') return m.channel === 'sms'
    if (activeFilter === 'positive') return m.feedback === 'positive'
    if (activeFilter === 'negative') return m.feedback === 'negative'
    return true
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Message History</h1>
          <p className="text-sm text-[#475569] mt-0.5">
            {messages.length === 0
              ? 'No messages yet'
              : `${messages.length} insight${messages.length !== 1 ? 's' : ''} delivered`}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      {messages.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="text-[#475569] flex-shrink-0" />
          {FILTERS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeFilter === key
                  ? 'bg-[#7C3AED] text-white border border-[#7C3AED]'
                  : 'bg-[#111111] text-[#94A3B8] border border-[#222222] hover:border-[#333333] hover:text-white'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Empty state — no messages at all */}
      {messages.length === 0 && <EmptyState />}

      {/* Empty state — filter has no matches */}
      {messages.length > 0 && filtered.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-16 text-center"
        >
          <p className="text-[#475569] text-sm">
            No messages match &ldquo;{FILTERS.find((f) => f.key === activeFilter)?.label}&rdquo;
          </p>
          <button
            onClick={() => setActiveFilter('all')}
            className="mt-3 text-xs text-[#7C3AED] hover:text-[#A855F7] underline underline-offset-2"
          >
            Clear filter
          </button>
        </motion.div>
      )}

      {/* Message grid */}
      <AnimatePresence mode="popLayout">
        {filtered.length > 0 && (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            initial={false}
          >
            {filtered.map((message, index) => (
              <motion.div
                key={message.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.25, delay: index < 6 ? index * 0.04 : 0 }}
              >
                <MessageCard
                  id={message.id}
                  date={message.sent_at}
                  contentType={message.content?.type ?? 'tip'}
                  bodyText={message.content?.body_text ?? ''}
                  channel={message.channel}
                  initialFeedback={message.feedback}
                  onFeedback={handleFeedback}
                  saving={savingIds.has(message.id)}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center min-h-[52vh] text-center px-4"
    >
      {/* Icon */}
      <div className="relative w-20 h-20 mx-auto mb-8">
        <div className="w-20 h-20 rounded-2xl bg-purple-950/40 border border-purple-800/30 flex items-center justify-center">
          <MessageSquare size={36} className="text-[#7C3AED]" />
        </div>
        <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-[#111111] border border-[#222] flex items-center justify-center">
          <Mail size={12} className="text-[#06B6D4]" />
        </div>
        <div className="absolute -bottom-2 -left-2 w-7 h-7 rounded-full bg-[#111111] border border-[#222] flex items-center justify-center">
          <Smartphone size={12} className="text-[#F59E0B]" />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-white mb-3">Nothing here yet</h2>
      <p className="text-[#94A3B8] leading-relaxed max-w-sm">
        Your first insight will arrive tomorrow morning — sharp, concise, and calibrated to your role.
      </p>
      <p className="text-xs text-[#333333] mt-6">
        Check your email or SMS in the meantime.
      </p>
    </motion.div>
  )
}
