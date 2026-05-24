'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { QuestionAnswerData } from '@/lib/templates/types'
import { useFlowLayout } from '@/lib/templates/useFlowLayout'
import '@xyflow/react/dist/style.css'

function QuestionNode({ data }: NodeProps) {
  const d = data as { question: string }
  return (
    <div className="rounded-2xl border-l-4 border-[#7C3AED] bg-[#111111] border-y border-r border-[#222222] p-5 min-w-[300px] max-w-[420px]">
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="text-xs font-semibold text-[#A855F7] mb-2 tracking-wide uppercase">Question</div>
      <p className="text-[#94A3B8] text-base italic leading-relaxed">&ldquo;{d.question}&rdquo;</p>
    </div>
  )
}

function AnswerNode({ data }: NodeProps) {
  const d = data as { direct_answer: string }
  return (
    <div className="rounded-xl border-2 border-[#7C3AED] bg-[#7C3AED]/10 p-5 min-w-[300px] max-w-[420px]">
      <Handle type="target" position={Position.Top} style={{ background: '#7C3AED', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="text-xs font-semibold text-[#A855F7] mb-2 tracking-wide uppercase">Direct Answer</div>
      <p className="text-white text-sm font-medium leading-relaxed">{d.direct_answer}</p>
    </div>
  )
}

function AnalogyNode({ data }: NodeProps) {
  const d = data as { analogy: string }
  return (
    <div className="rounded-xl border border-[#06B6D4]/40 bg-[#06B6D4]/5 p-4 min-w-[260px] max-w-[360px]">
      <Handle type="target" position={Position.Top} style={{ background: '#06B6D4', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#06B6D4', border: 'none' }} />
      <div className="text-xs font-semibold text-[#06B6D4] mb-2 tracking-wide uppercase">Think of it like this</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.analogy}</p>
    </div>
  )
}

function ExampleNode({ data }: NodeProps) {
  const d = data as { example: string }
  return (
    <div className="rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/5 p-4 min-w-[260px] max-w-[360px]">
      <Handle type="target" position={Position.Top} style={{ background: '#F59E0B', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#F59E0B', border: 'none' }} />
      <div className="text-xs font-semibold text-[#F59E0B] mb-2 tracking-wide uppercase">For example</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.example}</p>
    </div>
  )
}

function NuanceNode({ data }: NodeProps) {
  const d = data as { important_nuance: string }
  return (
    <div className="rounded-xl border border-[#A855F7]/40 bg-[#A855F7]/5 p-4 min-w-[260px] max-w-[360px]">
      <Handle type="target" position={Position.Top} style={{ background: '#A855F7', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#A855F7', border: 'none' }} />
      <div className="text-xs font-semibold text-[#A855F7] mb-2 tracking-wide uppercase">Important Nuance</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.important_nuance}</p>
    </div>
  )
}

function ReturningNode({ data }: NodeProps) {
  const d = data as { returning_to: string }
  return (
    <div className="rounded-xl border border-[#333333] bg-[#1A1A1A] p-4 text-center min-w-[220px] max-w-[320px]">
      <Handle type="target" position={Position.Top} style={{ background: '#475569', border: 'none' }} />
      <div className="text-xs text-[#475569] mb-1">← Returning to</div>
      <div className="text-[#94A3B8] text-xs">{d.returning_to}</div>
    </div>
  )
}

const nodeTypes = { question: QuestionNode, answer: AnswerNode, analogy: AnalogyNode, example: ExampleNode, nuance: NuanceNode, returning: ReturningNode }

interface QuestionAnswerProps { data: QuestionAnswerData; isActive: boolean; onReady?: () => void }

export default function QuestionAnswer({ data, isActive, onReady }: QuestionAnswerProps) {
  const { rawNodes, rawEdges } = useMemo<{ rawNodes: Node[]; rawEdges: Edge[] }>(() => {
    const chain: Array<{ id: string; type: string; nodeData: Record<string, unknown>; h: number }> = [
      { id: 'question', type: 'question', nodeData: { question: data.question }, h: 100 },
      { id: 'answer', type: 'answer', nodeData: { direct_answer: data.direct_answer }, h: 100 },
    ]
    if (data.analogy) chain.push({ id: 'analogy', type: 'analogy', nodeData: { analogy: data.analogy }, h: 90 })
    if (data.example) chain.push({ id: 'example', type: 'example', nodeData: { example: data.example }, h: 90 })
    if (data.important_nuance) chain.push({ id: 'nuance', type: 'nuance', nodeData: { important_nuance: data.important_nuance }, h: 90 })
    chain.push({ id: 'returning', type: 'returning', nodeData: { returning_to: data.returning_to }, h: 70 })

    const nodes: Node[] = chain.map((item) => ({
      id: item.id,
      type: item.type,
      position: { x: 0, y: 0 },
      data: item.nodeData,
      width: 380,
      height: item.h,
      draggable: false,
    }))

    const colors: Record<string, string> = { question: '#7C3AED', answer: '#7C3AED', analogy: '#06B6D4', example: '#F59E0B', nuance: '#A855F7', returning: '#475569' }
    const edges: Edge[] = chain.slice(0, -1).map((item, i) => ({
      id: `e-${i}`,
      source: item.id,
      target: chain[i + 1].id,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: colors[chain[i + 1].id] ?? '#475569' },
      style: { stroke: (colors[chain[i + 1].id] ?? '#475569') + '60', strokeWidth: 2 },
    }))

    return { rawNodes: nodes, rawEdges: edges }
  }, [data])

  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout(rawNodes, rawEdges, { direction: 'TB', rankSep: 60, nodeSep: 30 })
  const [nodes, , onNodesChange] = useNodesState(layoutNodes)
  const [edges, , onEdgesChange] = useEdgesState(layoutEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">Q&A</h2>
          <p className="text-[#94A3B8] text-sm truncate max-w-xl">&ldquo;{data.question}&rdquo;</p>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
