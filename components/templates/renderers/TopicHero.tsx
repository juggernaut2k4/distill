'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { TopicHeroData } from '@/lib/templates/types'
import { useFlowLayout } from '@/lib/templates/useFlowLayout'
import '@xyflow/react/dist/style.css'

function HeroNode({ data }: NodeProps) {
  const d = data as { topic_name: string; topic_number: number; total_topics: number }
  return (
    <div className="rounded-2xl border-2 border-[#7C3AED] bg-[#7C3AED]/10 p-6 text-center shadow-xl shadow-purple-900/30 min-w-[300px] max-w-[400px]">
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="text-xs font-semibold text-[#A855F7] mb-3 tracking-widest uppercase">
        Topic {d.topic_number} of {d.total_topics}
      </div>
      <div className="text-white font-extrabold text-2xl leading-tight">{d.topic_name}</div>
    </div>
  )
}

function KeyQuestionNode({ data }: NodeProps) {
  const d = data as { key_question: string }
  return (
    <div className="rounded-xl border border-[#06B6D4]/40 bg-[#06B6D4]/5 p-5 text-center min-w-[260px] max-w-[340px]">
      <Handle type="target" position={Position.Top} style={{ background: '#06B6D4', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#06B6D4', border: 'none' }} />
      <div className="text-xs font-semibold text-[#06B6D4] mb-2 tracking-wide uppercase">Key Question</div>
      <div className="text-white text-sm leading-snug">{d.key_question}</div>
    </div>
  )
}

function TimeNode({ data }: NodeProps) {
  const d = data as { estimated_minutes: number }
  return (
    <div className="rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/5 p-4 text-center min-w-[140px]">
      <Handle type="target" position={Position.Top} style={{ background: '#F59E0B', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#F59E0B', border: 'none' }} />
      <div className="text-xs font-semibold text-[#F59E0B] mb-1 tracking-wide uppercase">Est. Time</div>
      <div className="text-white text-2xl font-bold">{d.estimated_minutes}<span className="text-sm font-normal text-[#94A3B8] ml-1">min</span></div>
    </div>
  )
}

function OutcomeNode({ data }: NodeProps) {
  const d = data as { so_what_preview: string }
  return (
    <div className="rounded-xl border border-[#10B981]/40 bg-[#10B981]/5 p-5 text-center min-w-[260px] max-w-[340px]">
      <Handle type="target" position={Position.Top} style={{ background: '#10B981', border: 'none' }} />
      <div className="text-xs font-semibold text-[#10B981] mb-2 tracking-wide uppercase">You&apos;ll Be Able To</div>
      <div className="text-white text-sm leading-snug">{d.so_what_preview}</div>
    </div>
  )
}

const nodeTypes = { hero: HeroNode, keyQuestion: KeyQuestionNode, time: TimeNode, outcome: OutcomeNode }

interface TopicHeroProps { data: TopicHeroData; isActive: boolean; onReady?: () => void }

export default function TopicHero({ data, isActive, onReady }: TopicHeroProps) {
  const { rawNodes, rawEdges } = useMemo<{ rawNodes: Node[]; rawEdges: Edge[] }>(() => {
    const nodes: Node[] = [
      { id: 'hero', type: 'hero', position: { x: 0, y: 0 }, data: { topic_name: data.topic_name, topic_number: data.topic_number, total_topics: data.total_topics }, width: 360, height: 110, draggable: false },
      { id: 'question', type: 'keyQuestion', position: { x: 0, y: 0 }, data: { key_question: data.key_question }, width: 300, height: 90, draggable: false },
      { id: 'time', type: 'time', position: { x: 0, y: 0 }, data: { estimated_minutes: data.estimated_minutes }, width: 160, height: 80, draggable: false },
      { id: 'outcome', type: 'outcome', position: { x: 0, y: 0 }, data: { so_what_preview: data.so_what_preview }, width: 300, height: 90, draggable: false },
    ]
    const edges: Edge[] = [
      { id: 'e-hero-q', source: 'hero', target: 'question', markerEnd: { type: MarkerType.ArrowClosed, color: '#7C3AED' }, style: { stroke: '#7C3AED60', strokeWidth: 2 } },
      { id: 'e-q-time', source: 'question', target: 'time', markerEnd: { type: MarkerType.ArrowClosed, color: '#F59E0B' }, style: { stroke: '#F59E0B60', strokeWidth: 2 } },
      { id: 'e-q-out', source: 'question', target: 'outcome', markerEnd: { type: MarkerType.ArrowClosed, color: '#10B981' }, style: { stroke: '#10B98160', strokeWidth: 2 } },
    ]
    return { rawNodes: nodes, rawEdges: edges }
  }, [data])

  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout(rawNodes, rawEdges, { direction: 'TB', rankSep: 80, nodeSep: 60 })
  const [nodes, , onNodesChange] = useNodesState(layoutNodes)
  const [edges, , onEdgesChange] = useEdgesState(layoutEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">Session Overview</h2>
          <p className="text-[#94A3B8] text-sm">What you&apos;ll learn and why it matters</p>
        </div>
        <div className="flex-1 min-h-[480px] rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what_preview}</span>
      </motion.div>
    </div>
  )
}
