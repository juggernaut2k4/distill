'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { ProsConsData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

const COL_W = 300
const COL_GAP = 120
const ROW_H = 100
const ROW_GAP = 20
const CENTER_X = (COL_W * 2 + COL_GAP) / 2

function TopicNode({ data }: NodeProps) {
  const d = data as { topic: string; context: string }
  return (
    <div className="rounded-2xl border-2 border-[#7C3AED] bg-[#7C3AED]/10 p-4 text-center min-w-[260px] max-w-[320px]">
      <Handle type="source" position={Position.Left} id="left" style={{ background: '#10B981', border: 'none' }} />
      <Handle type="source" position={Position.Right} id="right" style={{ background: '#EF4444', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="text-xs font-semibold text-[#A855F7] mb-1 tracking-widest uppercase">Evaluating</div>
      <div className="text-white font-bold text-base">{d.topic}</div>
      <div className="text-[#94A3B8] text-xs mt-1">{d.context}</div>
    </div>
  )
}

function ProNode({ data }: NodeProps) {
  const d = data as { title: string; description: string; evidence?: string }
  return (
    <div className="rounded-lg border-l-2 border-[#10B981] bg-[#111111] border-y border-r border-[#222222] p-4 min-w-[240px] max-w-[300px]">
      <Handle type="target" position={Position.Right} style={{ background: '#10B981', border: 'none' }} />
      <div className="text-[#10B981] font-semibold text-xs mb-1">✓ {d.title}</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.description}</p>
      {d.evidence && <p className="text-[#475569] text-xs mt-1 italic">{d.evidence}</p>}
    </div>
  )
}

function ConNode({ data }: NodeProps) {
  const d = data as { title: string; description: string; mitigation?: string }
  return (
    <div className="rounded-lg border-l-2 border-[#EF4444] bg-[#111111] border-y border-r border-[#222222] p-4 min-w-[240px] max-w-[300px]">
      <Handle type="target" position={Position.Left} style={{ background: '#EF4444', border: 'none' }} />
      <div className="text-[#EF4444] font-semibold text-xs mb-1">✗ {d.title}</div>
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.description}</p>
      {d.mitigation && <p className="text-[#06B6D4] text-xs mt-1">Mitigate: {d.mitigation}</p>}
    </div>
  )
}

function VerdictNode({ data }: NodeProps) {
  const d = data as { verdict: string }
  return (
    <div className="rounded-xl border border-[#333333] bg-[#111111] p-4 text-center min-w-[280px] max-w-[360px]">
      <Handle type="target" position={Position.Top} style={{ background: '#A855F7', border: 'none' }} />
      <div className="text-xs font-semibold text-[#A855F7] mb-2 tracking-wide uppercase">Verdict</div>
      <p className="text-white text-sm">{d.verdict}</p>
    </div>
  )
}

const nodeTypes = { topic: TopicNode, pro: ProNode, con: ConNode, verdict: VerdictNode }

interface ProsConsProps { data: ProsConsData; isActive: boolean; onReady?: () => void }

export default function ProsCons({ data, isActive, onReady }: ProsConsProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const topicH = 90
    const topicY = 0

    const proCount = data.pros.length
    const conCount = data.cons.length
    const maxSide = Math.max(proCount, conCount)
    const totalSideH = maxSide * ROW_H + (maxSide - 1) * ROW_GAP
    const topicX = CENTER_X - 160

    const prosX = 0
    const consX = COL_W + COL_GAP
    const sidesStartY = topicY + topicH + 60

    const proNodes: Node[] = data.pros.map((pro, i) => ({
      id: `pro-${i}`,
      type: 'pro',
      position: { x: prosX, y: sidesStartY + i * (ROW_H + ROW_GAP) },
      data: pro,
      width: COL_W,
      height: pro.evidence ? 110 : ROW_H,
      draggable: false,
    }))

    const conNodes: Node[] = data.cons.map((con, i) => ({
      id: `con-${i}`,
      type: 'con',
      position: { x: consX, y: sidesStartY + i * (ROW_H + ROW_GAP) },
      data: con,
      width: COL_W,
      height: con.mitigation ? 110 : ROW_H,
      draggable: false,
    }))

    const verdictY = sidesStartY + totalSideH + 60
    const verdictNode: Node = {
      id: 'verdict',
      type: 'verdict',
      position: { x: topicX, y: verdictY },
      data: { verdict: data.verdict },
      width: 320,
      height: 80,
      draggable: false,
    }

    const topicNode: Node = {
      id: 'topic',
      type: 'topic',
      position: { x: topicX, y: topicY },
      data: { topic: data.topic, context: data.context },
      width: 300,
      height: topicH,
      draggable: false,
    }

    const nodes = [topicNode, ...proNodes, ...conNodes, verdictNode]

    const edges: Edge[] = [
      ...data.pros.map((_, i) => ({
        id: `e-topic-pro-${i}`,
        source: 'topic',
        sourceHandle: 'left',
        target: `pro-${i}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10B981' },
        style: { stroke: '#10B98160', strokeWidth: 2 },
      })),
      ...data.cons.map((_, i) => ({
        id: `e-topic-con-${i}`,
        source: 'topic',
        sourceHandle: 'right',
        target: `con-${i}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#EF4444' },
        style: { stroke: '#EF444460', strokeWidth: 2 },
      })),
      {
        id: 'e-topic-verdict',
        source: 'topic',
        target: 'verdict',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#A855F7' },
        style: { stroke: '#A855F760', strokeWidth: 2 },
      },
    ]

    return { nodes, edges }
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
            <p className="text-[#94A3B8] text-sm">{data.context}</p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {[['#10B981', 'Advantages'], ['#EF4444', 'Risks']].map(([color, label]) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                <span className="text-xs text-[#475569]">{label}</span>
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
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
