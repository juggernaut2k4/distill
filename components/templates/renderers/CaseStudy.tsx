'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { CaseStudyData } from '@/lib/templates/types'
import { useFlowLayout } from '@/lib/templates/useFlowLayout'
import '@xyflow/react/dist/style.css'

function CompanyNode({ data }: NodeProps) {
  const d = data as { company: string; industry: string; company_size?: string }
  return (
    <div className="rounded-2xl border-2 border-[#06B6D4] bg-[#06B6D4]/10 p-5 text-center min-w-[280px] max-w-[360px]">
      <Handle type="source" position={Position.Bottom} style={{ background: '#06B6D4', border: 'none' }} />
      <div className="text-white font-extrabold text-2xl">{d.company}</div>
      <div className="flex items-center justify-center gap-3 mt-2">
        <span className="text-xs text-[#06B6D4] border border-[#06B6D4]/30 rounded-full px-3 py-0.5">{d.industry}</span>
        {d.company_size && <span className="text-xs text-[#475569]">{d.company_size}</span>}
      </div>
    </div>
  )
}

function ChallengeNode({ data }: NodeProps) {
  const d = data as { challenge: string }
  return (
    <div className="rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/5 p-4 min-w-[240px] max-w-[320px]">
      <Handle type="target" position={Position.Top} style={{ background: '#EF4444', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#EF4444', border: 'none' }} />
      <div className="text-xs font-semibold text-[#EF4444] mb-2 tracking-wide uppercase">The Challenge</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed italic">&ldquo;{d.challenge}&rdquo;</p>
    </div>
  )
}

function SolutionNode({ data }: NodeProps) {
  const d = data as { ai_solution: string }
  return (
    <div className="rounded-xl border border-[#7C3AED]/40 bg-[#7C3AED]/5 p-4 min-w-[240px] max-w-[320px]">
      <Handle type="target" position={Position.Top} style={{ background: '#7C3AED', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="text-xs font-semibold text-[#A855F7] mb-2 tracking-wide uppercase">The AI Solution</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.ai_solution}</p>
    </div>
  )
}

function ResultsNode({ data }: NodeProps) {
  const d = data as { results: Array<{ metric: string; value: string; timeframe?: string }> }
  return (
    <div className="rounded-xl border border-[#06B6D4]/40 bg-[#06B6D4]/5 p-4 min-w-[280px] max-w-[380px]">
      <Handle type="target" position={Position.Top} style={{ background: '#06B6D4', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#06B6D4', border: 'none' }} />
      <div className="text-xs font-semibold text-[#06B6D4] mb-3 tracking-wide uppercase">Results</div>
      <div className="flex gap-4 flex-wrap justify-center">
        {d.results.map((r, i) => (
          <div key={i} className="text-center">
            <div className="text-[#06B6D4] font-bold text-lg">{r.value}</div>
            <div className="text-[#94A3B8] text-xs">{r.metric}</div>
            {r.timeframe && <div className="text-[#475569] text-xs">{r.timeframe}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function LessonNode({ data }: NodeProps) {
  const d = data as { what_they_got_right: string; what_they_got_wrong?: string }
  return (
    <div className="rounded-xl border border-[#10B981]/40 bg-[#10B981]/5 p-4 min-w-[260px] max-w-[340px]">
      <Handle type="target" position={Position.Top} style={{ background: '#10B981', border: 'none' }} />
      <div className="text-xs font-semibold text-[#10B981] mb-2 tracking-wide uppercase">Key Lesson</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.what_they_got_right}</p>
      {d.what_they_got_wrong && (
        <div className="mt-2 pt-2 border-t border-[#10B981]/20">
          <div className="text-xs font-semibold text-[#F59E0B] mb-1">What They Learned</div>
          <p className="text-[#94A3B8] text-xs">{d.what_they_got_wrong}</p>
        </div>
      )}
    </div>
  )
}

const nodeTypes = { company: CompanyNode, challenge: ChallengeNode, solution: SolutionNode, results: ResultsNode, lesson: LessonNode }

interface CaseStudyProps { data: CaseStudyData; isActive: boolean; onReady?: () => void }

export default function CaseStudy({ data, isActive, onReady }: CaseStudyProps) {
  const { rawNodes, rawEdges } = useMemo<{ rawNodes: Node[]; rawEdges: Edge[] }>(() => {
    const nodes: Node[] = [
      { id: 'company', type: 'company', position: { x: 0, y: 0 }, data: { company: data.company, industry: data.industry, company_size: data.company_size }, width: 320, height: 100, draggable: false },
      { id: 'challenge', type: 'challenge', position: { x: 0, y: 0 }, data: { challenge: data.challenge }, width: 300, height: 100, draggable: false },
      { id: 'solution', type: 'solution', position: { x: 0, y: 0 }, data: { ai_solution: data.ai_solution }, width: 300, height: 100, draggable: false },
      { id: 'results', type: 'results', position: { x: 0, y: 0 }, data: { results: data.results }, width: 340, height: 110, draggable: false },
      { id: 'lesson', type: 'lesson', position: { x: 0, y: 0 }, data: { what_they_got_right: data.what_they_got_right, what_they_got_wrong: data.what_they_got_wrong }, width: 300, height: data.what_they_got_wrong ? 140 : 100, draggable: false },
    ]
    const edgePairs = [['company', 'challenge', '#EF4444'], ['challenge', 'solution', '#7C3AED'], ['solution', 'results', '#06B6D4'], ['results', 'lesson', '#10B981']]
    const edges: Edge[] = edgePairs.map(([src, tgt, color], i) => ({
      id: `e-${i}`,
      source: src,
      target: tgt,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color + '60', strokeWidth: 2 },
    }))
    return { rawNodes: nodes, rawEdges: edges }
  }, [data])

  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout(rawNodes, rawEdges, { direction: 'TB', rankSep: 70, nodeSep: 40 })
  const [nodes, , onNodesChange] = useNodesState(layoutNodes)
  const [edges, , onEdgesChange] = useEdgesState(layoutEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-4 flex items-center gap-3">
          <div>
            <h2 className="text-3xl font-bold text-white mb-1">{data.company}</h2>
            <p className="text-[#94A3B8] text-sm">{data.industry}{data.company_size ? ` · ${data.company_size}` : ''}</p>
          </div>
          <div className="flex items-center gap-2 ml-auto text-xs text-[#475569]">
            {[['#EF4444', 'Challenge'], ['#7C3AED', 'Solution'], ['#06B6D4', 'Results'], ['#10B981', 'Lesson']].map(([c, l]) => (
              <div key={l} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: c }} />
                <span>{l}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what_for_you}</span>
      </motion.div>
    </div>
  )
}
