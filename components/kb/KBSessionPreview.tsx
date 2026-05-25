'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import type { TemplateSection } from '@/lib/templates/types'

interface Props {
  sections: TemplateSection[]
  activeSectionIndex: number
  onSectionChange: (index: number) => void
  topicId: string
}

interface OverflowResult {
  nodeId: string
  nodeType: string
  overflowPx: number
}

interface ProgressStep {
  step: string
  msg: string
  nodes?: string[]
  strategy?: string
  templateChanged?: boolean
  fromType?: string
  toType?: string
  section?: TemplateSection
  reason?: string
}

type FixStatus = 'idle' | 'checking' | 'fixing' | 'fixed' | 'failed'

const STEP_LABELS: Record<string, string> = {
  analyzing:     '🔍 Analyzing overflow...',
  fetching:      '📦 Loading section...',
  calling_claude:'🤖 Calling Claude...',
  strategy:      '⚡ Strategy selected',
  saving:        '💾 Saving...',
  complete:      '✦ Done',
  error:         '✗ Error',
}

/**
 * KB-only preview with real-time AI layout optimization.
 *
 * When overflow is detected after rendering, the section is automatically sent
 * to the fix-overflow SSE endpoint. Progress steps stream back in real time so
 * you can see exactly what's happening: overflow analysis → Claude → strategy
 * decision → save. The fixed section is displayed immediately on completion.
 */
export default function KBSessionPreview({ sections, activeSectionIndex, onSectionChange, topicId }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const fixingRef = useRef(false)

  const [overflowResults, setOverflowResults] = useState<OverflowResult[]>([])
  const [fixStatus, setFixStatus] = useState<FixStatus>('idle')
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([])
  const [currentStep, setCurrentStep] = useState<ProgressStep | null>(null)
  const [sectionOverrides, setSectionOverrides] = useState<Map<string, TemplateSection>>(new Map())

  // Reset when section changes
  useEffect(() => {
    setFixStatus('idle')
    setProgressSteps([])
    setCurrentStep(null)
    setOverflowResults([])
    fixingRef.current = false
  }, [activeSectionIndex])

  const triggerAutoFix = useCallback(async (report: OverflowResult[], sectionId: string) => {
    if (fixingRef.current) return
    fixingRef.current = true
    setFixStatus('fixing')
    setProgressSteps([])

    try {
      const res = await fetch(
        `/api/kb/topics/${encodeURIComponent(topicId)}/sections/${encodeURIComponent(sectionId)}/fix-overflow`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overflowReport: report }),
        }
      )

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as ProgressStep
            setCurrentStep(event)
            setProgressSteps((prev) => [...prev, event])

            if (event.step === 'complete' && event.section) {
              setSectionOverrides((prev) => new Map(prev).set(sectionId, event.section!))
              setOverflowResults([])
              setFixStatus('fixed')
            } else if (event.step === 'error') {
              setFixStatus('failed')
            }
          } catch {
            // malformed SSE line, skip
          }
        }
      }
    } catch (err) {
      console.error('[KBSessionPreview] Auto-fix failed:', err)
      setFixStatus('failed')
      setCurrentStep({ step: 'error', msg: err instanceof Error ? err.message : 'Connection failed' })
    } finally {
      fixingRef.current = false
    }
  }, [topicId])

  const runOverflowCheck = useCallback((sectionId: string) => {
    if (!canvasRef.current) return
    setFixStatus('checking')
    setOverflowResults([])

    setTimeout(() => {
      const rfNodes = canvasRef.current?.querySelectorAll('.react-flow__node') ?? []
      const results: OverflowResult[] = []

      rfNodes.forEach((rfNode) => {
        const el = rfNode as HTMLElement
        const nodeRect = el.getBoundingClientRect()
        if (nodeRect.height === 0) return

        const nodeId = el.getAttribute('data-id') ?? 'unknown'
        const nodeType = Array.from(el.classList)
          .find((c) => c.startsWith('react-flow__node-') && c !== 'react-flow__node')
          ?.replace('react-flow__node-', '') ?? 'unknown'

        let maxChildBottom = nodeRect.bottom
        el.querySelectorAll('*').forEach((child) => {
          const r = child.getBoundingClientRect()
          if (r.bottom > maxChildBottom) maxChildBottom = r.bottom
        })

        const overflowPx = Math.round(maxChildBottom - nodeRect.bottom)
        if (overflowPx > 2) results.push({ nodeId, nodeType, overflowPx })
      })

      setOverflowResults(results)

      if (results.length > 0) {
        triggerAutoFix(results, sectionId)
      } else {
        setFixStatus('idle')
      }
    }, 900)
  }, [triggerAutoFix])

  // Stable ref for sectionId so the callback closure doesn't stale-capture
  const activeSectionIdRef = useRef<string>('')
  useEffect(() => {
    const section = sections[activeSectionIndex]
    if (section) {
      activeSectionIdRef.current = section.id
      runOverflowCheck(section.id)
    }
  }, [activeSectionIndex, sections, runOverflowCheck])

  const handleManualRecheck = useCallback(() => {
    setFixStatus('idle')
    setProgressSteps([])
    setCurrentStep(null)
    fixingRef.current = false
    const section = sections[activeSectionIndex]
    if (section) runOverflowCheck(section.id)
  }, [sections, activeSectionIndex, runOverflowCheck])

  if (sections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-[#080808] rounded-xl border border-[#1a1a1a]">
        <p className="text-[#475569] text-sm">No sections available.</p>
      </div>
    )
  }

  const rawSection = sections[activeSectionIndex]
  const activeSection = sectionOverrides.get(rawSection.id) ?? rawSection

  const isWorking = fixStatus === 'checking' || fixStatus === 'fixing'
  const lastStep = progressSteps[progressSteps.length - 1]

  return (
    <div className="flex flex-col h-full rounded-xl border border-[#1a1a1a] overflow-hidden">

      {/* ── Preview canvas ── */}
      <div className="flex flex-1 overflow-hidden bg-[#080808]" ref={canvasRef}>

        {/* Sidebar */}
        <aside className="w-[180px] shrink-0 bg-[#0D0D0D] border-r border-[#1A1A1A] overflow-y-auto py-5 px-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[#333333] mb-3 px-1.5">
            Sections
          </div>
          <nav className="flex flex-col gap-0.5">
            {sections.map((section, i) => {
              const isActive = i === activeSectionIndex
              const isDone = i < activeSectionIndex
              const isOverridden = sectionOverrides.has(section.id)
              return (
                <button
                  key={section.id}
                  onClick={() => onSectionChange(i)}
                  className={`flex items-center gap-2 rounded-lg px-1.5 py-2 text-left transition-colors w-full ${
                    isActive ? 'bg-[#1A1A1A]' : 'hover:bg-[#111111]'
                  }`}
                >
                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                    isActive ? 'bg-[#06B6D4]' : isDone ? 'bg-[#10B981]' : 'bg-[#333333]'
                  }`} />
                  <span className={`text-[11px] leading-snug line-clamp-2 ${
                    isActive ? 'text-white font-medium' : 'text-[#475569]'
                  }`}>
                    {section.meta.subtopicTitle}
                    {isOverridden && <span className="ml-1 text-[#A855F7]">✦</span>}
                  </span>
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Main content */}
        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection.id + activeSection.type}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-0"
            >
              <TemplateRenderer section={activeSection} isActive={true} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ── Progress strip ── */}
      <div className="shrink-0 bg-[#0A0A0A] border-t border-[#1A1A1A]">

        {/* Step pipeline — shown while fixing */}
        {progressSteps.length > 0 && (
          <div className="px-4 pt-2 pb-1 flex items-center gap-2 overflow-x-auto">
            {progressSteps.map((s, i) => {
              const isLast = i === progressSteps.length - 1
              const isDone = !isLast || fixStatus === 'fixed' || fixStatus === 'failed'
              const color =
                s.step === 'error'    ? 'text-[#EF4444]' :
                s.step === 'complete' ? 'text-[#10B981]' :
                s.step === 'strategy' ? 'text-[#A855F7]' :
                isDone                ? 'text-[#475569]' :
                'text-[#94A3B8]'

              return (
                <div key={i} className="flex items-center gap-1.5 shrink-0">
                  {i > 0 && <span className="text-[#222] text-[10px]">→</span>}
                  <span className={`text-[10px] ${color} ${isLast && isWorking ? 'animate-pulse' : ''}`}>
                    {STEP_LABELS[s.step] ?? s.step}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Status bar */}
        <div className="px-4 py-1.5 flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#333]">
              Layout
            </span>
            <span className="text-[10px] text-[#333]">·</span>
            <span className="text-[10px] text-[#475569]">
              {rawSection.type}
              {fixStatus === 'fixed' && lastStep?.templateChanged && (
                <span className="text-[#A855F7]"> → {lastStep.toType}</span>
              )}
            </span>
            <button
              onClick={handleManualRecheck}
              disabled={isWorking}
              title="Re-run overflow check"
              className="ml-1 text-[#333] hover:text-[#94A3B8] transition-colors disabled:opacity-30"
            >
              <RefreshCw size={10} className={isWorking ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 flex items-center gap-3 overflow-x-auto min-w-0">
            {fixStatus === 'checking' ? (
              <span className="text-[11px] text-[#475569] animate-pulse">Checking overflow…</span>
            ) : fixStatus === 'fixing' && currentStep ? (
              <span className="text-[11px] text-[#94A3B8] truncate">{currentStep.msg}</span>
            ) : fixStatus === 'fixed' && lastStep ? (
              <span className="text-[11px] text-[#10B981] truncate">
                ✦ {lastStep.msg}
              </span>
            ) : fixStatus === 'failed' && currentStep ? (
              <span className="text-[11px] text-[#EF4444] truncate">
                ✗ {currentStep.msg} — use manual feedback below
              </span>
            ) : overflowResults.length === 0 ? (
              <span className="text-[11px] text-[#10B981]">✓ all nodes fit</span>
            ) : (
              overflowResults.map((r) => (
                <span key={r.nodeId} className="shrink-0 text-[11px]">
                  <span className="text-[#EF4444]">⚠ </span>
                  <span className="text-[#94A3B8]">{r.nodeId}</span>
                  <span className="text-[#475569]"> ({r.nodeType})</span>
                  <span className="text-[#F59E0B] font-mono"> +{r.overflowPx}px</span>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
