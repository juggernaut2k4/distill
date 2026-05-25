'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { KeyTakeawayData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

const INSIGHT_W = 260
const INSIGHT_H = 140
const GAP = 20

function TopicCenterNode({ data }: NodeProps) {
  const d = data as { topic: string; one_thing: string }
  return (
    <div className="rounded-2xl border-2 border-[#A855F7] bg-[#A855F7]/10 p-5 text-center min-w-[280px] max-w-[360px]">
      <Handle type="source" position={Position.Bottom} style={{ background: '#A855F7', border: 'none' }} />
      <div className="text-xs font-semibold text-[#A855F7] mb-2 tracking-widest uppercase">Key Takeaways</div>
      <div className="text-white font-bold text-base mb-3 leading-snug">{d.topic}</div>
      <blockquote className="text-[#A855F7] text-sm font-medium italic border-t border-[#A855F7]/20 pt-3">
        &ldquo;{d.one_thing}&rdquo;
      </blockquote>
    </div>
  )
}

function InsightNode({ data }: NodeProps) {
  const d = data as { insight: string; implication: string }
  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-4 min-w-[240px] max-w-[260px]">
      <Handle type="target" position={Position.Top} style={{ background: '#7C3AED', border: 'none' }} />
      <p className="text-white font-semibold text-xs leading-snug mb-2">{d.insight}</p>
      <div className="h-px bg-[#222222] mb-2" />
      <p className="text-[#94A3B8] text-xs leading-relaxed">{d.implication}</p>
    </div>
  )
}

function ActionNode({ data }: NodeProps) {
  const d = data as { action_for_you: string }
  return (
    <div className="rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/5 p-4 min-w-[280px] max-w-[360px]">
      <Handle type="target" position={Position.Top} style={{ background: '#F59E0B', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#F59E0B', border: 'none' }} />
      <div className="text-xs font-semibold text-[#F59E0B] mb-2 tracking-wide uppercase">⚡ Action For You</div>
      <p className="text-white text-xs">{d.action_for_you}</p>
    </div>
  )
}

function NextNode({ data }: NodeProps) {
  const d = data as { next_topic_preview: string }
  return (
    <div className="rounded-xl border border-[#475569]/40 bg-[#1A1A1A] p-3 text-center min-w-[220px]">
      <Handle type="target" position={Position.Top} style={{ background: '#475569', border: 'none' }} />
      <div className="text-xs text-[#475569] mb-1">Up next</div>
      <div className="text-[#94A3B8] text-xs">{d.next_topic_preview}</div>
    </div>
  )
}

const nodeTypes = { topicCenter: TopicCenterNode, insight: InsightNode, action: ActionNode, next: NextNode }

interface KeyTakeawayProps { data: KeyTakeawayData; isActive: boolean; onReady?: () => void }

export default function KeyTakeaway({ data, isActive, onReady }: KeyTakeawayProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const insightCount = data.insights.length
    const cols = Math.min(3, insightCount)
    const rows = Math.ceil(insightCount / cols)
    const gridW = cols * INSIGHT_W + (cols - 1) * GAP
    const centerX = gridW / 2 - 170

    const topicNode: Node = {
      id: 'topic',
      type: 'topicCenter',
      position: { x: centerX, y: 0 },
      data: { topic: data.topic, one_thing: data.one_thing_to_remember },
      width: 340,
      height: 150,
      draggable: false,
    }

    const insightGridY = 200
    const insightNodes: Node[] = data.insights.map((ins, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      return {
        id: `insight-${i}`,
        type: 'insight',
        position: { x: col * (INSIGHT_W + GAP), y: insightGridY + row * (INSIGHT_H + GAP) },
        data: ins,
        width: INSIGHT_W,
        height: INSIGHT_H,
        draggable: false,
      }
    })

    const actionY = insightGridY + rows * (INSIGHT_H + GAP) + 30
    const actionNode: Node = {
      id: 'action',
      type: 'action',
      position: { x: centerX, y: actionY },
      data: { action_for_you: data.action_for_you },
      width: 340,
      height: 96,
      draggable: false,
    }

    const nodes: Node[] = [topicNode, ...insightNodes, actionNode]
    const edges: Edge[] = [
      ...data.insights.map((_, i) => ({
        id: `e-topic-ins-${i}`,
        source: 'topic',
        target: `insight-${i}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#7C3AED' },
        style: { stroke: '#7C3AED50', strokeWidth: 1.5 },
      })),
      { id: 'e-topic-action', source: 'topic', target: 'action', markerEnd: { type: MarkerType.ArrowClosed, color: '#F59E0B' }, style: { stroke: '#F59E0B60', strokeWidth: 2 } },
    ]

    if (data.next_topic_preview) {
      nodes.push({
        id: 'next',
        type: 'next',
        position: { x: centerX, y: actionY + 120 },
        data: { next_topic_preview: data.next_topic_preview },
        width: 280,
        height: 72,
        draggable: false,
      })
      edges.push({ id: 'e-action-next', source: 'action', target: 'next', markerEnd: { type: MarkerType.ArrowClosed, color: '#475569' }, style: { stroke: '#47556960', strokeWidth: 1.5 } })
    }

    return { nodes, edges }
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">{data.topic}</h2>
          <p className="text-[#94A3B8] text-sm">Key takeaways from this session</p>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
      </motion.div>
    </div>
  )
}
