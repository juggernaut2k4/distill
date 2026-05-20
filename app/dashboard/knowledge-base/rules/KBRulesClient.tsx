'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Clock, XCircle, PauseCircle, PlayCircle,
  Trash2, ArrowLeft, Loader2, Wand2, ChevronDown, ChevronUp,
  CheckCircle2, Layers, FileText
} from 'lucide-react'
import Link from 'next/link'

interface QARule {
  id: string
  rule_text: string
  justification: string
  evidence: Array<{ section: string; quote: string }>
  category: 'content' | 'layout' | 'data_structure'
  status: 'pending' | 'approved' | 'rejected' | 'paused'
  user_suggestion: string | null
  refined_rule_text: string | null
  source_topic_id: string | null
  created_at: string
  approved_at: string | null
}

const STATUS_TABS = [
  { key: 'pending',  label: 'Pending Review', icon: Clock },
  { key: 'approved', label: 'Active Rules',   icon: ShieldCheck },
  { key: 'paused',   label: 'Paused',         icon: PauseCircle },
  { key: 'rejected', label: 'Rejected',       icon: XCircle },
] as const

const CATEGORY_COLORS: Record<string, string> = {
  content:        'bg-[#7C3AED]/20 text-[#A855F7] border-[#7C3AED]/30',
  layout:         'bg-[#06B6D4]/20 text-[#06B6D4] border-[#06B6D4]/30',
  data_structure: 'bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30',
}

export default function KBRulesClient() {
  const [rules, setRules] = useState<QARule[]>([])
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'paused' | 'rejected'>('pending')
  const [isLoading, setIsLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [suggestionText, setSuggestionText] = useState<Record<string, string>>({})
  const [refining, setRefining] = useState<Record<string, boolean>>({})
  const [actioning, setActioning] = useState<Record<string, boolean>>({})

  async function loadRules() {
    setIsLoading(true)
    try {
      const res = await fetch('/api/kb/qa/rules')
      const data = await res.json()
      setRules(data.rules ?? [])
    } catch { /* non-fatal */ }
    finally { setIsLoading(false) }
  }

  useEffect(() => { loadRules() }, [])

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function action(ruleId: string, act: 'approve' | 'reject' | 'pause' | 'unpause') {
    setActioning((p) => ({ ...p, [ruleId]: true }))
    try {
      const rule = rules.find((r) => r.id === ruleId)
      // When approving, use refined_rule_text if it exists
      const useRefined = act === 'approve' && rule?.refined_rule_text

      if (useRefined) {
        // Patch the rule_text to the refined version first
        await fetch(`/api/kb/qa/rules/${ruleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve' }),
        })
        // Then update rule_text to refined
        setRules((prev) => prev.map((r) =>
          r.id === ruleId
            ? { ...r, rule_text: r.refined_rule_text ?? r.rule_text, status: 'approved', approved_at: new Date().toISOString() }
            : r
        ))
      } else {
        const res = await fetch(`/api/kb/qa/rules/${ruleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: act }),
        })
        const data = await res.json()
        if (data.rule) {
          setRules((prev) => prev.map((r) => r.id === ruleId ? data.rule : r))
        }
      }
    } catch { /* non-fatal */ }
    finally { setActioning((p) => ({ ...p, [ruleId]: false })) }
  }

  async function refine(ruleId: string) {
    const suggestion = suggestionText[ruleId]?.trim()
    if (!suggestion) return
    setRefining((p) => ({ ...p, [ruleId]: true }))
    try {
      const res = await fetch(`/api/kb/qa/rules/${ruleId}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion }),
      })
      const data = await res.json()
      if (data.refined_rule_text) {
        setRules((prev) => prev.map((r) =>
          r.id === ruleId ? { ...r, refined_rule_text: data.refined_rule_text, user_suggestion: suggestion } : r
        ))
      }
    } catch { /* non-fatal */ }
    finally { setRefining((p) => ({ ...p, [ruleId]: false })) }
  }

  async function deleteRule(ruleId: string) {
    if (!confirm('Delete this rule permanently?')) return
    await fetch(`/api/kb/qa/rules/${ruleId}`, { method: 'DELETE' })
    setRules((prev) => prev.filter((r) => r.id !== ruleId))
  }

  const filteredRules = rules.filter((r) => r.status === activeTab)
  const pendingCount = rules.filter((r) => r.status === 'pending').length

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/dashboard/knowledge-base"
          className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Knowledge Base
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <ShieldCheck className="w-6 h-6 text-[#7C3AED]" />
              <h1 className="text-white text-2xl font-bold">Generation Rules</h1>
            </div>
            <p className="text-[#94A3B8] text-sm">
              Rules approved here are permanently injected into the AI generation prompt.
              Pending rules were identified by the QA agent and need your review.
            </p>
          </div>
          <div className="flex items-center gap-1.5 bg-[#111111] border border-[#333333] rounded-lg px-3 py-1.5">
            <Layers className="w-3.5 h-3.5 text-[#94A3B8]" />
            <span className="text-white text-sm font-medium">{rules.filter(r => r.status === 'approved').length} active</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#111111] border border-[#222222] rounded-xl p-1">
        {STATUS_TABS.map(({ key, label, icon: Icon }) => {
          const count = rules.filter((r) => r.status === key).length
          const isActive = activeTab === key
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-[#1a1a1a] text-white border border-[#333333]'
                  : 'text-[#475569] hover:text-[#94A3B8]'
              }`}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
              {count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  key === 'pending' ? 'bg-[#F59E0B]/20 text-[#F59E0B]' : 'bg-[#333333] text-[#94A3B8]'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-[#94A3B8]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading rules...
        </div>
      )}

      {!isLoading && filteredRules.length === 0 && (
        <div className="bg-[#111111] border border-[#222222] rounded-xl p-12 text-center">
          <FileText className="w-10 h-10 text-[#333333] mx-auto mb-3" />
          <p className="text-[#94A3B8] text-sm">
            {activeTab === 'pending'
              ? 'No pending rules. Run QA on a topic to generate candidates.'
              : `No ${activeTab} rules.`}
          </p>
          {activeTab === 'pending' && (
            <Link href="/dashboard/knowledge-base" className="inline-flex items-center gap-1.5 mt-4 text-[#7C3AED] hover:text-[#A855F7] text-sm transition-colors">
              Go to Knowledge Base →
            </Link>
          )}
        </div>
      )}

      {/* Rule cards */}
      <div className="space-y-4">
        <AnimatePresence>
          {filteredRules.map((rule, i) => {
            const isExpanded = expandedIds.has(rule.id)
            const isActioning = actioning[rule.id]
            const isRefining = refining[rule.id]
            const suggestion = suggestionText[rule.id] ?? ''

            return (
              <motion.div
                key={rule.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden"
              >
                {/* Card header */}
                <div className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[rule.category] ?? CATEGORY_COLORS.content}`}>
                      {rule.category.replace('_', ' ')}
                    </span>
                    {rule.refined_rule_text && (
                      <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30">
                        refined
                      </span>
                    )}
                  </div>

                  {/* Active rule text (refined if available) */}
                  <p className="text-white text-sm font-medium leading-relaxed mb-2">
                    {rule.refined_rule_text ?? rule.rule_text}
                  </p>

                  {/* Show original if refined */}
                  {rule.refined_rule_text && (
                    <p className="text-[#475569] text-xs line-through mb-2">{rule.rule_text}</p>
                  )}

                  {/* Expand toggle */}
                  <button
                    onClick={() => toggleExpand(rule.id)}
                    className="flex items-center gap-1 text-[#475569] hover:text-[#94A3B8] text-xs transition-colors mt-2"
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {isExpanded ? 'Hide details' : 'Show justification & evidence'}
                  </button>
                </div>

                {/* Expanded details */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 space-y-4 border-t border-[#1a1a1a] pt-4">
                        {/* Justification */}
                        <div>
                          <p className="text-[#475569] text-xs uppercase tracking-wider font-medium mb-1.5">Why this rule matters</p>
                          <p className="text-[#94A3B8] text-sm leading-relaxed">{rule.justification}</p>
                        </div>

                        {/* Evidence */}
                        {rule.evidence?.length > 0 && (
                          <div>
                            <p className="text-[#475569] text-xs uppercase tracking-wider font-medium mb-2">Evidence from sections</p>
                            <div className="space-y-2">
                              {rule.evidence.map((e, idx) => (
                                <div key={idx} className="bg-[#0d0d0d] border border-[#222222] rounded-lg px-3 py-2">
                                  <p className="text-[#475569] text-xs mb-0.5">{e.section}</p>
                                  <p className="text-[#94A3B8] text-xs italic">&ldquo;{e.quote}&rdquo;</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* User suggestion area (pending/paused only) */}
                        {(rule.status === 'pending' || rule.status === 'paused') && (
                          <div>
                            <p className="text-[#475569] text-xs uppercase tracking-wider font-medium mb-2">Suggest an improvement</p>
                            <div className="flex gap-2">
                              <textarea
                                value={suggestion}
                                onChange={(e) => setSuggestionText((p) => ({ ...p, [rule.id]: e.target.value }))}
                                placeholder="e.g. Make it even more specific — require the company name AND the industry..."
                                rows={2}
                                className="flex-1 bg-[#0d0d0d] border border-[#333333] focus:border-[#7C3AED] outline-none rounded-lg px-3 py-2 text-white text-sm placeholder:text-[#333333] resize-none transition-colors"
                              />
                              <button
                                onClick={() => refine(rule.id)}
                                disabled={!suggestion.trim() || isRefining}
                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-[#1a1a1a] border border-[#333333] hover:border-[#7C3AED] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white text-sm rounded-lg transition-colors"
                              >
                                {isRefining
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Wand2 className="w-3.5 h-3.5" />
                                }
                                Refine
                              </button>
                            </div>
                            {rule.user_suggestion && (
                              <p className="text-[#333333] text-xs mt-1.5 italic">
                                Your suggestion: &ldquo;{rule.user_suggestion}&rdquo;
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Actions footer */}
                <div className="px-5 pb-5 flex flex-wrap items-center gap-2">
                  {rule.status === 'pending' && (
                    <>
                      <button
                        onClick={() => action(rule.id, 'approve')}
                        disabled={isActioning}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#10B981] hover:bg-[#059669] disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        {isActioning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {rule.refined_rule_text ? 'Approve refined' : 'Approve'}
                      </button>
                      <button
                        onClick={() => action(rule.id, 'reject')}
                        disabled={isActioning}
                        className="flex items-center gap-1.5 px-4 py-2 bg-transparent border border-[#333333] hover:border-[#EF4444] hover:text-[#EF4444] disabled:opacity-40 text-[#94A3B8] text-sm font-medium rounded-lg transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Reject
                      </button>
                    </>
                  )}

                  {rule.status === 'approved' && (
                    <button
                      onClick={() => action(rule.id, 'pause')}
                      disabled={isActioning}
                      className="flex items-center gap-1.5 px-4 py-2 bg-transparent border border-[#333333] hover:border-[#F59E0B] hover:text-[#F59E0B] disabled:opacity-40 text-[#94A3B8] text-sm font-medium rounded-lg transition-colors"
                    >
                      <PauseCircle className="w-3.5 h-3.5" />
                      Pause
                    </button>
                  )}

                  {rule.status === 'paused' && (
                    <button
                      onClick={() => action(rule.id, 'unpause')}
                      disabled={isActioning}
                      className="flex items-center gap-1.5 px-4 py-2 bg-[#10B981]/10 border border-[#10B981]/30 hover:bg-[#10B981]/20 disabled:opacity-40 text-[#10B981] text-sm font-medium rounded-lg transition-colors"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      Reactivate
                    </button>
                  )}

                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="ml-auto flex items-center gap-1.5 px-3 py-2 text-[#333333] hover:text-[#EF4444] transition-colors text-sm"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Active rule notice */}
      {activeTab === 'approved' && filteredRules.length > 0 && (
        <p className="text-[#475569] text-xs text-center mt-6">
          These rules are injected into every AI generation prompt. Pausing a rule removes it from future generations without deleting it.
        </p>
      )}
    </div>
  )
}
