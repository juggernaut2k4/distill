'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { ActionPlanData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

const DIFFICULTY_STYLE = { easy: { color: '#10B981', label: 'Easy' }, medium: { color: '#F59E0B', label: 'Medium' }, hard: { color: '#EF4444', label: 'Hard' } }

function TakeawayNode({ data }: NodeProps) {
  const d = data as { takeaway: string; why_it_matters: string }
  return (
    <div className="w-[220px] rounded-xl border border-[#7C3AED]/40 bg-[#7C3AED]/10 p-4">
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <p className="text-white font-semibold text-sm mb-1 leading-tight">{d.takeaway}</p>
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.why_it_matters}</p>
    </div>
  )
}

function ActionNode({ data }: NodeProps) {
  const d = data as { action: string; timeline: string; difficulty: 'easy' | 'medium' | 'hard' }
  const style = DIFFICULTY_STYLE[d.difficulty]
  return (
    <div style={{ borderColor: style.color + '50' }} className="w-[220px] rounded-xl border bg-[#111111] p-4">
      <Handle type="target" position={Position.Top} style={{ background: style.color, border: 'none' }} />
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: style.color, background: style.color + '20' }}>{style.label}</span>
        <span className="text-xs text-[#475569]">{d.timeline}</span>
      </div>
      <p className="text-white text-sm leading-snug">{d.action}</p>
    </div>
  )
}

function QuestionNode({ data }: NodeProps) {
  const d = data as { question: string; index: number }
  return (
    <div className="w-[200px] rounded-lg border border-[#06B6D4]/30 bg-[#06B6D4]/5 p-3">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="text-xs font-bold text-[#06B6D4] mb-1">Q{d.index + 1}</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed italic">&ldquo;{d.question}&rdquo;</p>
    </div>
  )
}

const nodeTypes = { takeaway: TakeawayNode, action: ActionNode, question: QuestionNode }

interface ActionPlanProps { data: ActionPlanData; isActive: boolean; onReady?: () => void }

export default function ActionPlan({ data, isActive, onReady }: ActionPlanProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    // Row 1: Key takeaways
    const tkSpacing = 250
    const tkStart = -((data.key_takeaways.length - 1) * tkSpacing) / 2
    data.key_takeaways.forEach((tk, i) => {
      nodes.push({ id: `tk${i}`, type: 'takeaway', position: { x: tkStart + i * tkSpacing, y: 0 }, data: tk, width: 220, height: 100, draggable: false })
    })

    // Row 2: Actions
    const actSpacing = 250
    const actStart = -((data.immediate_actions.length - 1) * actSpacing) / 2
    data.immediate_actions.forEach((a, i) => {
      nodes.push({ id: `act${i}`, type: 'action', position: { x: actStart + i * actSpacing, y: 180 }, data: a, width: 220, height: 110, draggable: false })
      // Connect nearest takeaway to each action
      const tkIdx = Math.min(i, data.key_takeaways.length - 1)
      edges.push({ id: `e-ta${i}`, source: `tk${tkIdx}`, target: `act${i}`, style: { stroke: '#7C3AED40', strokeWidth: 1.5, strokeDasharray: '4 3' } })
    })

    // Row 3: Questions to ask
    const qSpacing = 230
    const qStart = -((data.questions_to_ask_your_team.length - 1) * qSpacing) / 2
    data.questions_to_ask_your_team.slice(0, 4).forEach((q, i) => {
      nodes.push({ id: `q${i}`, type: 'question', position: { x: qStart + i * qSpacing, y: 380 }, data: { question: q, index: i }, width: 200, height: 90, draggable: false })
      edges.push({ id: `e-qa${i}`, source: `act${Math.min(i, data.immediate_actions.length - 1)}`, target: `q${i}`, style: { stroke: '#06B6D430', strokeWidth: 1 } })
    })

    return { initialNodes: nodes, initialEdges: edges }
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <h2 className="text-3xl font-bold text-white mb-6">Your Action Plan — {data.session_topic}</h2>
        <div className="flex-1 min-h-[520px] rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.12 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
        {data.watch_out_for.length > 0 && (
          <div className="mt-4 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B] mb-2">Watch out for</p>
            <div className="flex flex-wrap gap-2">
              {data.watch_out_for.map((w, i) => <span key={i} className="text-sm text-white bg-[#111] border border-[#F59E0B]/20 rounded-full px-3 py-1">{w}</span>)}
            </div>
          </div>
        )}
      </motion.div>
      {data.next_session_preview && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
          <span className="text-sm font-semibold text-[#A855F7] shrink-0">Next session</span>
          <span className="text-sm text-white">{data.next_session_preview}</span>
        </motion.div>
      )}
    </div>
  )
}
