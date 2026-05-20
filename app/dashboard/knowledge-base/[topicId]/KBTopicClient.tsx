'use client'

import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Loader2, AlertTriangle, RotateCcw,
  SendHorizonal, CheckCircle, Layers, PlayCircle, ShieldCheck
} from 'lucide-react'
import Link from 'next/link'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import type { TemplateSection } from '@/lib/templates/types'

interface QAResult {
  overall_score: number
  summary: string
  content_issues: Array<{ field: string; issue: string; severity: string; fix: string }>
  layout_issues: Array<{ location: string; issue: string; severity: string; data_fix: string; component_fix: string | null }>
}

interface CacheRow {
  id: string
  subtopic_slug: string
  subtopic_title: string
  template_type: string
  section_data: TemplateSection
  previous_section_data: TemplateSection | null
  kb_feedback: string | null
  generated_at: string
  qa_score: number | null
  qa_result: QAResult | null
  qa_run_at: string | null
}

interface SectionState {
  row: CacheRow
  feedback: string
  isApplying: boolean
  isReverting: boolean
  justSaved: boolean
  error: string | null
  showQA: boolean
}

interface Props { topicId: string }

export default function KBTopicClient({ topicId }: Props) {
  const [sections, setSections] = useState<SectionState[]>([])
  const [topicTitle, setTopicTitle] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  async function loadSections() {
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/kb/topics/${encodeURIComponent(topicId)}`)
      const data = await res.json()
      if (!res.ok) {
        setLoadError(data.error ?? 'Failed to load topic.')
        return
      }
      const rows: CacheRow[] = data.sections ?? []
      setSections(rows.map((row) => ({
        row,
        feedback: '',
        isApplying: false,
        isReverting: false,
        justSaved: false,
        error: null,
        showQA: false,
      })))
      // Derive topic title from first section's subtopicTitle metadata
      const first = rows[0]
      setTopicTitle(first?.section_data?.meta?.sessionTitle ?? topicId)
    } catch {
      setLoadError('Connection error. Please refresh.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { loadSections() }, [topicId]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateSection(slug: string, updates: Partial<SectionState>) {
    setSections((prev) =>
      prev.map((s) => s.row.subtopic_slug === slug ? { ...s, ...updates } : s)
    )
  }

  async function applyFeedback(s: SectionState) {
    if (!s.feedback.trim()) return
    updateSection(s.row.subtopic_slug, { isApplying: true, error: null })

    try {
      const res = await fetch(
        `/api/kb/topics/${encodeURIComponent(topicId)}/sections/${encodeURIComponent(s.row.subtopic_slug)}/feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: s.feedback }),
        }
      )
      const data = await res.json()
      if (!res.ok) {
        updateSection(s.row.subtopic_slug, { isApplying: false, error: data.error ?? 'Regeneration failed.' })
        return
      }

      const updatedSection: TemplateSection = data.section
      updateSection(s.row.subtopic_slug, {
        row: {
          ...s.row,
          section_data: updatedSection,
          previous_section_data: s.row.section_data,
          kb_feedback: s.feedback,
        },
        feedback: '',
        isApplying: false,
        justSaved: true,
        error: null,
      })
      setTimeout(() => updateSection(s.row.subtopic_slug, { justSaved: false }), 2500)
    } catch {
      updateSection(s.row.subtopic_slug, { isApplying: false, error: 'Request failed. Try again.' })
    }
  }

  async function revertSection(s: SectionState) {
    if (!s.row.previous_section_data) return
    updateSection(s.row.subtopic_slug, { isReverting: true, error: null })

    try {
      const res = await fetch(
        `/api/kb/topics/${encodeURIComponent(topicId)}/sections/${encodeURIComponent(s.row.subtopic_slug)}/revert`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        updateSection(s.row.subtopic_slug, { isReverting: false, error: data.error ?? 'Revert failed.' })
        return
      }

      const revertedSection: TemplateSection = data.section
      updateSection(s.row.subtopic_slug, {
        row: {
          ...s.row,
          section_data: revertedSection,
          previous_section_data: s.row.section_data,
          kb_feedback: null,
        },
        isReverting: false,
        error: null,
      })
    } catch {
      updateSection(s.row.subtopic_slug, { isReverting: false, error: 'Request failed. Try again.' })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-[#94A3B8]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading topic...
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-[#EF4444] shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-medium">Could not load topic</p>
            <p className="text-[#94A3B8] text-sm mt-1">{loadError}</p>
          </div>
        </div>
        <Link href="/dashboard/knowledge-base" className="inline-flex items-center gap-2 mt-4 text-[#7C3AED] hover:text-[#A855F7] text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Knowledge Base
        </Link>
      </div>
    )
  }

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
            <h1 className="text-white text-2xl font-bold mb-1">{topicTitle}</h1>
            <div className="flex items-center gap-1.5 text-[#475569] text-sm">
              <Layers className="w-3.5 h-3.5" />
              <span>{sections.length} {sections.length === 1 ? 'section' : 'sections'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-12">
        {sections.map((s, idx) => (
          <div key={s.row.subtopic_slug} className="space-y-4">
            {/* Section label */}
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-[#7C3AED]/20 border border-[#7C3AED]/40 flex items-center justify-center shrink-0">
                <span className="text-[#A855F7] text-xs font-bold">{idx + 1}</span>
              </div>
              <div>
                <p className="text-white text-sm font-semibold">{s.row.subtopic_title}</p>
                <p className="text-[#475569] text-xs">{s.row.template_type}</p>
              </div>
            </div>

            {/* Visual render — fixed 16:9 aspect ratio */}
            <AnimatePresence mode="wait">
              <motion.div
                key={JSON.stringify(s.row.section_data)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="relative w-full rounded-xl overflow-hidden border border-[#222222] bg-[#080808]"
                style={{ aspectRatio: '16 / 9' }}
              >
                <TemplateRenderer
                  section={s.row.section_data}
                  isActive={true}
                />
              </motion.div>
            </AnimatePresence>

            {/* QA score panel */}
            {s.row.qa_score != null && (
              <div className="bg-[#111111] border border-[#222222] rounded-xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className={`w-4 h-4 shrink-0 ${s.row.qa_score >= 8 ? 'text-[#10B981]' : s.row.qa_score >= 6 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`} />
                    <span className={`text-lg font-bold ${s.row.qa_score >= 8 ? 'text-[#10B981]' : s.row.qa_score >= 6 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                      {s.row.qa_score}
                    </span>
                    <span className="text-[#475569] text-xs">/10 QA score</span>
                    {s.row.qa_result?.summary && (
                      <p className="text-[#94A3B8] text-xs hidden sm:block truncate max-w-xs">{s.row.qa_result.summary}</p>
                    )}
                  </div>
                  {((s.row.qa_result?.content_issues?.length ?? 0) + (s.row.qa_result?.layout_issues?.length ?? 0)) > 0 && (
                    <button
                      onClick={() => updateSection(s.row.subtopic_slug, { showQA: !s.showQA })}
                      className="text-xs text-[#7C3AED] hover:text-[#A855F7] shrink-0 transition-colors"
                    >
                      {s.showQA ? 'Hide issues' : `View ${(s.row.qa_result?.content_issues?.length ?? 0) + (s.row.qa_result?.layout_issues?.length ?? 0)} issues`}
                    </button>
                  )}
                </div>

                {s.showQA && s.row.qa_result && (
                  <div className="mt-4 space-y-3 border-t border-[#1a1a1a] pt-4">
                    {s.row.qa_result.summary && (
                      <p className="text-[#94A3B8] text-xs sm:hidden">{s.row.qa_result.summary}</p>
                    )}

                    {s.row.qa_result.content_issues.length > 0 && (
                      <div>
                        <p className="text-[#475569] text-xs font-medium uppercase tracking-wider mb-2">Content issues</p>
                        <div className="space-y-2">
                          {s.row.qa_result.content_issues.map((issue, i) => (
                            <div key={i} className="bg-[#0d0d0d] rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                  issue.severity === 'high' ? 'bg-[#EF4444]/10 text-[#EF4444]'
                                  : issue.severity === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]'
                                  : 'bg-[#475569]/10 text-[#475569]'
                                }`}>{issue.severity}</span>
                                <span className="text-[#94A3B8] text-xs font-medium">{issue.field}</span>
                              </div>
                              <p className="text-[#94A3B8] text-xs">{issue.issue}</p>
                              {issue.fix && <p className="text-[#7C3AED] text-xs mt-1">Fix: {issue.fix}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {s.row.qa_result.layout_issues.length > 0 && (
                      <div>
                        <p className="text-[#475569] text-xs font-medium uppercase tracking-wider mb-2">Layout issues</p>
                        <div className="space-y-2">
                          {s.row.qa_result.layout_issues.map((issue, i) => (
                            <div key={i} className="bg-[#0d0d0d] rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                  issue.severity === 'high' ? 'bg-[#EF4444]/10 text-[#EF4444]'
                                  : issue.severity === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]'
                                  : 'bg-[#475569]/10 text-[#475569]'
                                }`}>{issue.severity}</span>
                                <span className="text-[#94A3B8] text-xs font-medium">{issue.location}</span>
                              </div>
                              <p className="text-[#94A3B8] text-xs">{issue.issue}</p>
                              {issue.data_fix && <p className="text-[#7C3AED] text-xs mt-1">Data fix: {issue.data_fix}</p>}
                              {issue.component_fix && <p className="text-[#06B6D4] text-xs mt-0.5">Component fix: {issue.component_fix}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Feedback area */}
            <div className="bg-[#111111] border border-[#222222] rounded-xl p-5">
              <p className="text-[#94A3B8] text-sm font-medium mb-3">Suggest changes</p>

              {s.row.kb_feedback && (
                <div className="bg-[#1a1a1a] border border-[#333333] rounded-lg px-3 py-2 mb-3">
                  <p className="text-[#475569] text-xs mb-0.5">Last feedback applied:</p>
                  <p className="text-[#94A3B8] text-xs italic">&ldquo;{s.row.kb_feedback}&rdquo;</p>
                </div>
              )}

              <div className="flex gap-2">
                <textarea
                  ref={(el) => { textareaRefs.current[s.row.subtopic_slug] = el }}
                  value={s.feedback}
                  onChange={(e) => updateSection(s.row.subtopic_slug, { feedback: e.target.value })}
                  placeholder="e.g. Make the example more specific to retail, add a cost comparison row..."
                  rows={2}
                  className="flex-1 bg-[#0d0d0d] border border-[#333333] focus:border-[#7C3AED] outline-none rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-[#475569] resize-none transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyFeedback(s)
                  }}
                />
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => applyFeedback(s)}
                    disabled={!s.feedback.trim() || s.isApplying || s.isReverting}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                    title="Apply feedback (⌘↵)"
                  >
                    {s.isApplying
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : s.justSaved
                      ? <CheckCircle className="w-3.5 h-3.5 text-[#10B981]" />
                      : <SendHorizonal className="w-3.5 h-3.5" />
                    }
                    {s.isApplying ? 'Updating...' : s.justSaved ? 'Updated' : 'Apply'}
                  </button>

                  {s.row.previous_section_data && (
                    <button
                      onClick={() => revertSection(s)}
                      disabled={s.isApplying || s.isReverting}
                      className="flex items-center gap-1.5 px-3 py-2.5 bg-transparent border border-[#333333] hover:border-[#555555] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                      title="Revert to version before last feedback"
                    >
                      {s.isReverting
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RotateCcw className="w-3.5 h-3.5" />
                      }
                      Revert
                    </button>
                  )}
                </div>
              </div>

              {s.error && (
                <p className="text-[#EF4444] text-xs mt-2">{s.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
