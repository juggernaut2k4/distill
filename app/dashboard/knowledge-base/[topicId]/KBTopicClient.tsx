'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Loader2, AlertTriangle, RotateCcw,
  SendHorizonal, CheckCircle, Layers, ShieldCheck,
  RefreshCw, RotateCw, ChevronDown, Zap,
} from 'lucide-react'
import Link from 'next/link'
import KBSessionPreview from '@/components/kb/KBSessionPreview'
import VisualizationTabPanel from '@/components/kb/VisualizationTabPanel'
import type { TemplateSection, TemplateName, TabManifest } from '@/lib/templates/types'

// ── All available template types with display labels ──────────────────────────
const TEMPLATE_OPTIONS: { value: TemplateName; label: string }[] = [
  { value: 'TopicHero',         label: 'Topic Hero' },
  { value: 'ConceptDefinition', label: 'Concept Definition' },
  { value: 'StepFlow',          label: 'Step Flow' },
  { value: 'ComparisonTable',   label: 'Comparison Table' },
  { value: 'TwoByTwoMatrix',    label: '2×2 Matrix' },
  { value: 'FrameworkCard',     label: 'Framework Card' },
  { value: 'ProsCons',          label: 'Pros & Cons' },
  { value: 'CaseStudy',         label: 'Case Study' },
  { value: 'StatCallout',       label: 'Stat Callout' },
  { value: 'Timeline',          label: 'Timeline' },
  { value: 'ConceptMap',        label: 'Concept Map' },
  { value: 'QuoteCallout',      label: 'Quote Callout' },
  { value: 'KeyTakeaway',       label: 'Key Takeaway' },
  { value: 'QuestionAnswer',    label: 'Q&A' },
  { value: 'ActionPlan',        label: 'Action Plan' },
  { value: 'Funnel',            label: 'Funnel' },
  { value: 'Flowchart',         label: 'Flowchart' },
  { value: 'Hierarchy',         label: 'Hierarchy' },
]

interface QAResult {
  overall_score: number
  summary: string
  content_issues: Array<{ field: string; issue: string; severity: string; fix: string }>
  layout_issues: Array<{ location: string; issue: string; severity: string; data_fix: string; component_fix: string | null }>
}

interface ScriptSegment {
  type: string
  content: string
  duration_seconds?: number
}

interface TrainingScript {
  subtopic_title: string
  subtopic_slug: string
  segments: ScriptSegment[]
  total_duration_seconds: number
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
  training_script: TrainingScript | null
  content_outline: Record<string, unknown> | null
  tab_manifest: TabManifest | null
}

interface SectionState {
  row: CacheRow
  feedback: string
  pendingTemplateType: TemplateName
  isApplying: boolean
  isReverting: boolean
  isRegenerating: boolean
  justSaved: boolean
  error: string | null
  showQA: boolean
}

interface ContentOutline {
  content_summary?: string
  key_concepts?: string[]
  coaching_narrative?: string
  checkpoint_question?: string
  visual_spec?: { headline?: string; items?: string[]; so_what?: string; template_hint?: string }
  // metadata — not rendered
  position?: string
  new_to_user?: boolean
  subtopic_slug?: string
  subtopic_title?: string
  builds_on?: string[]
}

interface ArcSession {
  session_id: string
  title: string
  session_index: number
  subtopic_count: number
  status: string
}

interface Arc {
  title: string
  focus: string | null
  sessions: ArcSession[]
  total_sub_sessions: number
  total_sessions: number
  completed_sessions: number
}

interface Props { topicId: string }

export default function KBTopicClient({ topicId }: Props) {
  const [sections, setSections] = useState<SectionState[]>([])
  const [arc, setArc] = useState<Arc | null>(null)
  const [topicTitle, setTopicTitle] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeSectionIndex, setActiveSectionIndex] = useState(0)
  const [activeTabIndex, setActiveTabIndex] = useState(0)
  const [isPortrait, setIsPortrait] = useState(false)
  const [isRegeneratingAll, setIsRegeneratingAll] = useState(false)
  const [regenerateAllResult, setRegenerateAllResult] = useState<string | null>(null)
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  // ── Portrait detection ────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => {
      setIsPortrait(window.innerHeight > window.innerWidth && window.innerWidth < 1024)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── Data loading ──────────────────────────────────────────────────────────
  async function loadSections() {
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/kb/topics/${encodeURIComponent(topicId)}`)
      const data = await res.json()
      if (!res.ok) { setLoadError(data.error ?? 'Failed to load topic.'); return }

      const rows: CacheRow[] = data.sections ?? []
      setSections(rows.map((row) => ({
        row,
        feedback: '',
        pendingTemplateType: row.section_data.type as TemplateName,
        isApplying: false,
        isReverting: false,
        isRegenerating: false,
        justSaved: false,
        error: null,
        showQA: false,
      })))
      const first = rows[0]
      setTopicTitle(first?.section_data?.meta?.sessionTitle ?? topicId)
      setArc((data.arc as Arc) ?? null)
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

  // ── Apply feedback ────────────────────────────────────────────────────────
  async function applyFeedback(s: SectionState) {
    if (!s.feedback.trim()) return
    updateSection(s.row.subtopic_slug, { isApplying: true, error: null })
    try {
      const res = await fetch(
        `/api/kb/topics/${encodeURIComponent(topicId)}/sections/${encodeURIComponent(s.row.subtopic_slug)}/feedback`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback: s.feedback }) }
      )
      const data = await res.json()
      if (!res.ok) { updateSection(s.row.subtopic_slug, { isApplying: false, error: data.error ?? 'Regeneration failed.' }); return }

      const updatedSection: TemplateSection = data.section
      updateSection(s.row.subtopic_slug, {
        row: { ...s.row, section_data: updatedSection, previous_section_data: s.row.section_data, kb_feedback: s.feedback },
        feedback: '',
        pendingTemplateType: updatedSection.type as TemplateName,
        isApplying: false,
        justSaved: true,
        error: null,
      })
      setTimeout(() => updateSection(s.row.subtopic_slug, { justSaved: false }), 2500)
    } catch {
      updateSection(s.row.subtopic_slug, { isApplying: false, error: 'Request failed. Try again.' })
    }
  }

  // ── Regenerate (fresh or new template) ────────────────────────────────────
  async function regenerateSection(s: SectionState) {
    updateSection(s.row.subtopic_slug, { isRegenerating: true, error: null })
    try {
      const res = await fetch(
        `/api/kb/topics/${encodeURIComponent(topicId)}/sections/${encodeURIComponent(s.row.subtopic_slug)}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateType: s.pendingTemplateType }),
        }
      )
      const data = await res.json()
      if (!res.ok) { updateSection(s.row.subtopic_slug, { isRegenerating: false, error: data.error ?? 'Regeneration failed.' }); return }

      const updatedSection: TemplateSection = data.section
      updateSection(s.row.subtopic_slug, {
        row: {
          ...s.row,
          section_data: updatedSection,
          previous_section_data: s.row.section_data,
          template_type: data.templateType,
          kb_feedback: null,
        },
        pendingTemplateType: updatedSection.type as TemplateName,
        isRegenerating: false,
        justSaved: true,
        error: null,
      })
      setTimeout(() => updateSection(s.row.subtopic_slug, { justSaved: false }), 2500)
    } catch {
      updateSection(s.row.subtopic_slug, { isRegenerating: false, error: 'Request failed. Try again.' })
    }
  }

  // ── Revert ────────────────────────────────────────────────────────────────
  async function revertSection(s: SectionState) {
    if (!s.row.previous_section_data) return
    updateSection(s.row.subtopic_slug, { isReverting: true, error: null })
    try {
      const res = await fetch(
        `/api/kb/topics/${encodeURIComponent(topicId)}/sections/${encodeURIComponent(s.row.subtopic_slug)}/revert`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) { updateSection(s.row.subtopic_slug, { isReverting: false, error: data.error ?? 'Revert failed.' }); return }

      const revertedSection: TemplateSection = data.section
      updateSection(s.row.subtopic_slug, {
        row: { ...s.row, section_data: revertedSection, previous_section_data: s.row.section_data, kb_feedback: null },
        pendingTemplateType: revertedSection.type as TemplateName,
        isReverting: false,
        error: null,
      })
    } catch {
      updateSection(s.row.subtopic_slug, { isReverting: false, error: 'Request failed. Try again.' })
    }
  }

  // ── Regenerate all sections ───────────────────────────────────────────────
  async function regenerateAll() {
    setIsRegeneratingAll(true)
    setRegenerateAllResult(null)
    try {
      const res = await fetch(
        `/api/kb/topics/${encodeURIComponent(topicId)}/regenerate-all`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        setRegenerateAllResult(`Failed: ${data.error ?? 'Unknown error'}`)
      } else {
        setRegenerateAllResult(`Done — ${data.succeeded}/${data.total} sections regenerated`)
        await loadSections()
      }
    } catch {
      setRegenerateAllResult('Request failed. Try again.')
    } finally {
      setIsRegeneratingAll(false)
    }
  }

  const handleSectionChange = useCallback((index: number) => {
    setActiveSectionIndex(index)
    setActiveTabIndex(0)
  }, [])

  // ── Derived: TemplateSection[] for preview ────────────────────────────────
  const previewSections = sections.map((s) => ({
    ...s.row.section_data,
    status: 'active' as const,
  }))

  const activeSection = sections[activeSectionIndex]

  // ── Loading / error states ────────────────────────────────────────────────
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

  // ── Portrait rotation prompt ──────────────────────────────────────────────
  if (isPortrait) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#080808] gap-6 px-8">
        <motion.div
          animate={{ rotate: [0, 90, 90, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 1.5 }}
        >
          <RotateCw className="w-14 h-14 text-[#7C3AED]" />
        </motion.div>
        <div className="text-center space-y-2">
          <p className="text-white text-lg font-semibold">Rotate to landscape</p>
          <p className="text-[#475569] text-sm">
            The session preview is designed for landscape orientation. Rotate your device for the full view.
          </p>
        </div>
      </div>
    )
  }

  const isBusy = activeSection && (activeSection.isApplying || activeSection.isReverting || activeSection.isRegenerating)
  const templateChanged = activeSection && activeSection.pendingTemplateType !== activeSection.row.section_data.type

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-4">
        <Link
          href="/dashboard/knowledge-base"
          className="inline-flex items-center gap-1.5 text-[#475569] hover:text-[#94A3B8] text-sm transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Knowledge Base
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-white text-xl font-bold">{topicTitle}</h1>
            <div className="flex items-center gap-1.5 text-[#475569] text-xs shrink-0">
              <Layers className="w-3.5 h-3.5" />
              <span>{sections.length} {sections.length === 1 ? 'section' : 'sections'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {regenerateAllResult && (
              <span className="text-xs text-[#94A3B8]">{regenerateAllResult}</span>
            )}
            <button
              onClick={regenerateAll}
              disabled={isRegeneratingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7C3AED]/15 border border-[#7C3AED]/40 hover:bg-[#7C3AED]/25 hover:border-[#7C3AED]/60 disabled:opacity-40 disabled:cursor-not-allowed text-[#A855F7] text-xs font-medium rounded-lg transition-colors"
              title="Regenerate all sections with current word count constraints"
            >
              {isRegeneratingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {isRegeneratingAll ? `Regenerating all…` : 'Regenerate All'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Overview card (KB-03) ── */}
      {arc && (
        <div className="bg-[#111111] border border-[#222222] rounded-2xl p-6 mb-6">
          <p className="text-xl font-bold text-white">{arc.title}</p>
          {arc.focus && (
            <p className="text-sm text-[#94A3B8] mt-1 leading-relaxed">{arc.focus}</p>
          )}

          <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider mt-4 mb-2">
            What you&apos;ll cover
          </p>

          <div className="space-y-0.5">
            {arc.sessions.map((session, i) => {
              const isCompleted = session.status === 'completed'
              const isNext = !isCompleted && arc.sessions.slice(0, i).every((s) => s.status === 'completed')
              const statusLabel = isCompleted ? 'Completed' : isNext ? 'Next up' : 'Upcoming'

              return (
                <div key={session.session_id} className="flex items-center gap-3 py-1.5">
                  {isCompleted ? (
                    <span className="text-base shrink-0" aria-label="Completed">✅</span>
                  ) : isNext ? (
                    <span className="text-[#06B6D4] text-sm font-bold shrink-0 w-4 text-center">→</span>
                  ) : (
                    <span className="text-[#475569] text-sm shrink-0 w-4 text-center">○</span>
                  )}
                  <span className={`text-sm ${isCompleted || isNext ? 'text-white' : 'text-[#475569]'}`}>
                    {session.title}
                  </span>
                  <span className="text-xs text-[#475569] ml-auto shrink-0">
                    {session.subtopic_count} {session.subtopic_count === 1 ? 'subtopic' : 'subtopics'} · {statusLabel}
                  </span>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-[#475569] mt-4 pt-4 border-t border-[#222222]">
            {arc.total_sub_sessions} sub-sessions · {arc.total_sessions} {arc.total_sessions === 1 ? 'session' : 'sessions'} · {arc.completed_sessions} of {arc.total_sessions} completed
          </p>
        </div>
      )}

      {/* ── Session Preview (tab-aware) ── */}
      <div style={{ height: '70vh' }}>
        {activeSection?.row.tab_manifest && activeSection.row.tab_manifest.tabs.length >= 2 ? (
          <VisualizationTabPanel
            tabs={activeSection.row.tab_manifest.tabs}
            activeIndex={activeTabIndex}
            onTabChange={setActiveTabIndex}
            topicId={topicId}
          />
        ) : (
          <KBSessionPreview
            sections={previewSections}
            activeSectionIndex={activeSectionIndex}
            onSectionChange={handleSectionChange}
            topicId={topicId}
          />
        )}
      </div>

      {/* ── Feedback Panel ── */}
      {activeSection && (
        <div className="mt-5 bg-[#111111] border border-[#222222] rounded-xl overflow-hidden">

          {/* Panel header — section identity */}
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-[#1a1a1a]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-5 h-5 rounded-full bg-[#7C3AED]/20 border border-[#7C3AED]/40 flex items-center justify-center shrink-0">
                <span className="text-[#A855F7] text-[10px] font-bold">{activeSectionIndex + 1}</span>
              </div>
              <p className="text-white text-sm font-medium truncate">{activeSection.row.subtopic_title}</p>
            </div>

            {/* QA score */}
            {activeSection.row.qa_score != null && (
              <div className="flex items-center gap-1.5 shrink-0">
                <ShieldCheck className={`w-3.5 h-3.5 ${activeSection.row.qa_score >= 8 ? 'text-[#10B981]' : activeSection.row.qa_score >= 6 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`} />
                <span className={`text-sm font-bold ${activeSection.row.qa_score >= 8 ? 'text-[#10B981]' : activeSection.row.qa_score >= 6 ? 'text-[#F59E0B]' : 'text-[#EF4444]'}`}>
                  {activeSection.row.qa_score}
                </span>
                <span className="text-[#475569] text-xs">/10</span>
              </div>
            )}
          </div>

          <div className="p-5 space-y-4">

            {/* Template selector + Regenerate */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-[#475569] text-xs font-medium whitespace-nowrap">Template</label>
                <div className="relative">
                  <select
                    value={activeSection.pendingTemplateType}
                    onChange={(e) => updateSection(activeSection.row.subtopic_slug, {
                      pendingTemplateType: e.target.value as TemplateName
                    })}
                    disabled={!!isBusy}
                    className="appearance-none bg-[#0d0d0d] border border-[#333333] focus:border-[#7C3AED] outline-none rounded-lg pl-3 pr-8 py-2 text-white text-sm disabled:opacity-40 cursor-pointer transition-colors"
                  >
                    {TEMPLATE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#475569] pointer-events-none" />
                </div>
                {templateChanged && (
                  <span className="text-[10px] text-[#F59E0B] font-medium px-1.5 py-0.5 rounded bg-[#F59E0B]/10 border border-[#F59E0B]/20">
                    changed
                  </span>
                )}
              </div>

              <button
                onClick={() => regenerateSection(activeSection)}
                disabled={!!isBusy}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#1a1a1a] border border-[#333333] hover:border-[#555555] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white text-sm font-medium rounded-lg transition-colors"
                title={templateChanged ? `Switch to ${activeSection.pendingTemplateType} and regenerate` : 'Regenerate fresh with same template'}
              >
                {activeSection.isRegenerating
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />
                }
                {activeSection.isRegenerating
                  ? 'Regenerating...'
                  : templateChanged
                  ? `Switch & regenerate`
                  : 'Regenerate'
                }
              </button>
            </div>

            {/* Last feedback applied */}
            {activeSection.row.kb_feedback && (
              <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-3 py-2">
                <p className="text-[#475569] text-xs mb-0.5">Last feedback applied:</p>
                <p className="text-[#94A3B8] text-xs italic">&ldquo;{activeSection.row.kb_feedback}&rdquo;</p>
              </div>
            )}

            {/* Feedback textarea + actions */}
            <div>
              <p className="text-[#475569] text-xs font-medium mb-2">Suggest specific changes</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <textarea
                  ref={(el) => { textareaRefs.current[activeSection.row.subtopic_slug] = el }}
                  value={activeSection.feedback}
                  onChange={(e) => updateSection(activeSection.row.subtopic_slug, { feedback: e.target.value })}
                  placeholder="e.g. Make the example more specific to retail, add a cost comparison row..."
                  rows={2}
                  disabled={!!isBusy}
                  className="flex-1 bg-[#0d0d0d] border border-[#333333] focus:border-[#7C3AED] outline-none rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-[#475569] resize-none transition-colors disabled:opacity-40"
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyFeedback(activeSection) }}
                />
                <div className="flex sm:flex-col gap-2">
                  <button
                    onClick={() => applyFeedback(activeSection)}
                    disabled={!activeSection.feedback.trim() || !!isBusy}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                    title="Apply feedback (⌘↵)"
                  >
                    {activeSection.isApplying
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : activeSection.justSaved
                      ? <CheckCircle className="w-3.5 h-3.5 text-[#10B981]" />
                      : <SendHorizonal className="w-3.5 h-3.5" />
                    }
                    {activeSection.isApplying ? 'Updating...' : activeSection.justSaved ? 'Updated' : 'Apply'}
                  </button>

                  {activeSection.row.previous_section_data && (
                    <button
                      onClick={() => revertSection(activeSection)}
                      disabled={!!isBusy}
                      className="flex items-center gap-1.5 px-3 py-2.5 bg-transparent border border-[#333333] hover:border-[#555555] disabled:opacity-40 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                      title="Revert to previous version"
                    >
                      {activeSection.isReverting
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RotateCcw className="w-3.5 h-3.5" />
                      }
                      Revert
                    </button>
                  )}
                </div>
              </div>
            </div>

            {activeSection.error && (
              <p className="text-[#EF4444] text-xs">{activeSection.error}</p>
            )}

            {/* QA issues expanded */}
            {activeSection.row.qa_score != null && (
              <div className="border-t border-[#1a1a1a] pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-[#475569] text-xs">{activeSection.row.qa_result?.summary}</p>
                  {((activeSection.row.qa_result?.content_issues?.length ?? 0) + (activeSection.row.qa_result?.layout_issues?.length ?? 0)) > 0 && (
                    <button
                      onClick={() => updateSection(activeSection.row.subtopic_slug, { showQA: !activeSection.showQA })}
                      className="text-xs text-[#7C3AED] hover:text-[#A855F7] shrink-0 transition-colors ml-4"
                    >
                      {activeSection.showQA ? 'Hide issues' : `View ${(activeSection.row.qa_result?.content_issues?.length ?? 0) + (activeSection.row.qa_result?.layout_issues?.length ?? 0)} issues`}
                    </button>
                  )}
                </div>

                <AnimatePresence>
                  {activeSection.showQA && activeSection.row.qa_result && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 space-y-3">
                        {activeSection.row.qa_result.content_issues.length > 0 && (
                          <div>
                            <p className="text-[#475569] text-xs font-medium uppercase tracking-wider mb-2">Content issues</p>
                            <div className="space-y-2">
                              {activeSection.row.qa_result.content_issues.map((issue, i) => (
                                <div key={i} className="bg-[#0d0d0d] rounded-lg p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${issue.severity === 'high' ? 'bg-[#EF4444]/10 text-[#EF4444]' : issue.severity === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#475569]/10 text-[#475569]'}`}>{issue.severity}</span>
                                    <span className="text-[#94A3B8] text-xs font-medium">{issue.field}</span>
                                  </div>
                                  <p className="text-[#94A3B8] text-xs">{issue.issue}</p>
                                  {issue.fix && <p className="text-[#7C3AED] text-xs mt-1">Fix: {issue.fix}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {activeSection.row.qa_result.layout_issues.length > 0 && (
                          <div>
                            <p className="text-[#475569] text-xs font-medium uppercase tracking-wider mb-2">Layout issues</p>
                            <div className="space-y-2">
                              {activeSection.row.qa_result.layout_issues.map((issue, i) => (
                                <div key={i} className="bg-[#0d0d0d] rounded-lg p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${issue.severity === 'high' ? 'bg-[#EF4444]/10 text-[#EF4444]' : issue.severity === 'medium' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#475569]/10 text-[#475569]'}`}>{issue.severity}</span>
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Content / Visualization / Script boxes ── */}
      {activeSection && (
        <div className="mt-4 space-y-4">

          {/* Box 1 — Content (content_outline: Step 1 pipeline output) */}
          {activeSection.row.content_outline && (() => {
            const outline = activeSection.row.content_outline as ContentOutline
            const soWhat = outline.visual_spec?.so_what

            return (
              <div className="bg-[#111111] border border-[#222222] rounded-xl p-5">
                <p className="text-[#475569] text-xs font-medium uppercase tracking-wider mb-4">Content</p>
                <div className="space-y-4">

                  {/* content_summary — intro paragraph */}
                  {outline.content_summary && (
                    <p className="text-[#94A3B8] text-sm leading-relaxed italic mb-4">
                      {outline.content_summary}
                    </p>
                  )}

                  {/* coaching_narrative — flowing paragraphs, strip screen-direction phrases */}
                  {outline.coaching_narrative && (
                    <div className="space-y-2">
                      {outline.coaching_narrative
                        .split(/\n+/)
                        .map((para) =>
                          para
                            .replace(/[Ll]ook at the screen[^.]*\./g, '')
                            .replace(/[Ll]ook at the diagram on screen[^.]*\./g, '')
                            .trim()
                        )
                        .filter((para) => para.length > 0)
                        .map((para, i) => (
                          <p key={i} className="text-[#94A3B8] text-sm leading-relaxed">
                            {para}
                          </p>
                        ))
                      }
                    </div>
                  )}

                  {/* key_concepts — bullet list */}
                  {outline.key_concepts && outline.key_concepts.length > 0 && (
                    <div>
                      <p className="text-[#475569] text-xs font-semibold uppercase tracking-wider mb-2">
                        Key Concepts
                      </p>
                      <ul className="space-y-1">
                        {outline.key_concepts.map((concept, i) => (
                          <li key={i} className="text-[#94A3B8] text-sm flex gap-2">
                            <span className="text-[#7C3AED] shrink-0 mt-0.5">•</span>
                            <span>{concept}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* visual_spec.so_what — purple callout */}
                  {soWhat && (
                    <div className="bg-[#7C3AED]/10 border border-[#7C3AED]/25 rounded-xl px-4 py-3">
                      <p className="text-[#475569] text-xs font-semibold uppercase tracking-wider mb-1.5">
                        So What
                      </p>
                      <p className="text-[#A855F7] text-sm leading-relaxed">{soWhat}</p>
                    </div>
                  )}

                  {/* checkpoint_question — cyan callout */}
                  {outline.checkpoint_question && (
                    <div className="bg-[#06B6D4]/10 border border-[#06B6D4]/25 rounded-xl px-4 py-3">
                      <p className="text-[#475569] text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Check Your Understanding
                      </p>
                      <p className="text-[#06B6D4] text-sm leading-relaxed italic">
                        &ldquo;{outline.checkpoint_question}&rdquo;
                      </p>
                    </div>
                  )}

                </div>
              </div>
            )
          })()}

          {/* Box 2 — Visualization content (section_data: Step 2 pipeline output) */}
          <div className="bg-[#111111] border border-[#222222] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <p className="text-[#475569] text-xs font-medium uppercase tracking-wider">Visualization content</p>
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-[#7C3AED]/15 border border-[#7C3AED]/30 text-[#A855F7]">
                {activeSection.row.section_data.type}
              </span>
            </div>
            <div className="space-y-4">
              {Object.entries(activeSection.row.section_data.data as unknown as Record<string, unknown>)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([key, value]) => (
                  <div key={key}>
                    <p className="text-[#475569] text-xs font-medium mb-1.5 capitalize">{key.replace(/_/g, ' ')}</p>
                    {Array.isArray(value) ? (
                      <div className="space-y-1.5">
                        {(value as unknown[]).map((item, i) => (
                          <div key={i} className="text-[#94A3B8] text-sm bg-[#0d0d0d] rounded-lg px-3 py-2">
                            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                          </div>
                        ))}
                      </div>
                    ) : typeof value === 'object' ? (
                      <pre className="text-[#94A3B8] text-xs bg-[#0d0d0d] rounded-lg px-3 py-2 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-[#94A3B8] text-sm leading-relaxed">{String(value)}</p>
                    )}
                  </div>
                ))
              }
            </div>
          </div>

          {/* Box 3 — Script for explanation (training_script: Step 3 pipeline output) */}
          {activeSection.row.training_script ? (
            <div className="bg-[#111111] border border-[#222222] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[#475569] text-xs font-medium uppercase tracking-wider">Script for explanation</p>
                <span className="text-[#475569] text-xs">
                  {Math.round((activeSection.row.training_script.total_duration_seconds ?? 0) / 60)} min
                </span>
              </div>
              <div className="space-y-3">
                {activeSection.row.training_script.segments.map((seg, i) => {
                  const segColor: Record<string, string> = {
                    TEACH:      'bg-[#7C3AED]/10 border-[#7C3AED]/30 text-[#A855F7]',
                    CHECKPOINT: 'bg-[#06B6D4]/10 border-[#06B6D4]/30 text-[#06B6D4]',
                    PROBE:      'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]',
                    CONTINUE:   'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]',
                    CLOSE:      'bg-[#475569]/10 border-[#475569]/30 text-[#94A3B8]',
                  }
                  return (
                    <div key={i} className="border border-[#222222] rounded-lg overflow-hidden">
                      <div className="px-3 py-1.5 bg-[#0d0d0d] border-b border-[#222222] flex items-center justify-between">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${segColor[seg.type] ?? 'text-[#94A3B8] border-[#333333]'}`}>
                          {seg.type}
                        </span>
                        {seg.duration_seconds != null && (
                          <span className="text-[#475569] text-xs">{seg.duration_seconds}s</span>
                        )}
                      </div>
                      <p className="text-[#94A3B8] text-sm px-3 py-3 leading-relaxed">{seg.content}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="bg-[#111111] border border-[#222222] rounded-xl p-5">
              <p className="text-[#475569] text-xs font-medium uppercase tracking-wider mb-2">Script for explanation</p>
              <p className="text-[#475569] text-sm">No script generated yet for this section.</p>
            </div>
          )}

        </div>
      )}

      {/* Bottom spacer so panel doesn't feel jammed against page end */}
      <div className="h-12" />
    </div>
  )
}
