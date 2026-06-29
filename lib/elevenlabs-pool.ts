/**
 * AGENT-POOL-01: ElevenLabs agent pool management.
 * Toggle: AGENT_POOL_MODE=true — when false (default) every function is a no-op.
 *
 * Flow:
 *   session-meeting-setup calls ensurePoolCapacity() to top up if needed
 *   session-meeting-setup calls reserveAgent(sessionId) to grab one
 *   → attachKbDocs(agentId, kbDocIds) loads pre-built KB onto the agent
 *   → agent_id stored in walkthrough_state so WalkthroughClient uses it
 *   → session end calls releaseAgent(agentId) to detach KB and return to pool
 *
 * Auto-scaling:
 *   cloneAgent() reads the source agent config from ElevenLabs and creates a
 *   new agent with the same settings — no manual cloning needed.
 *   ensurePoolCapacity() is called by the Inngest cron (every 30 min) to keep
 *   at least MIN_POOL_AGENTS available before any session starts.
 */

import { createSupabaseAdminClient } from '@/lib/supabase'

const EL_API_KEY = process.env.ELEVENLABS_API_KEY ?? ''
const EL_BASE = 'https://api.elevenlabs.io/v1'

// Source agent to clone from — the original Clio agent with base persona + procedures
const SOURCE_AGENT_ID =
  process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? 'agent_0701krp1ta48fswrff17ctb0520m'

// Minimum available agents to maintain in the pool
const MIN_POOL_AGENTS = parseInt(process.env.AGENT_POOL_MIN_SIZE ?? '5', 10)

/** Returns true when agent pool mode is active. */
export function isPoolModeEnabled(): boolean {
  return process.env.AGENT_POOL_MODE === 'true'
}

/**
 * Reads the source agent config from ElevenLabs and creates a new agent with
 * identical settings. Registers it in the pool table as 'available'.
 * Returns the new agent_id, or null if creation failed.
 */
export async function cloneAgent(): Promise<string | null> {
  if (!EL_API_KEY) return null

  // Fetch source agent config
  const getRes = await fetch(`${EL_BASE}/convai/agents/${SOURCE_AGENT_ID}`, {
    headers: { 'xi-api-key': EL_API_KEY },
  })
  if (!getRes.ok) {
    console.error('[agent-pool] fetch source agent failed:', getRes.status, await getRes.text())
    return null
  }

  const sourceConfig = await getRes.json() as Record<string, unknown>

  // Create new agent from source config (strip read-only fields ElevenLabs rejects)
  const { agent_id: _id, ...createBody } = sourceConfig as { agent_id?: string } & Record<string, unknown>

  const createRes = await fetch(`${EL_BASE}/convai/agents`, {
    method: 'POST',
    headers: { 'xi-api-key': EL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  })

  if (!createRes.ok) {
    console.error('[agent-pool] create agent failed:', createRes.status, await createRes.text())
    return null
  }

  const { agent_id: newAgentId } = await createRes.json() as { agent_id: string }

  // Register in pool
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('elevenlabs_agent_pool')
    .insert({ agent_id: newAgentId, status: 'available' })

  if (error) {
    console.error('[agent-pool] failed to register cloned agent in DB:', error.message)
    return null
  }

  console.log(`[agent-pool] cloned agent ${newAgentId} from ${SOURCE_AGENT_ID}`)
  return newAgentId
}

/**
 * Checks current pool capacity and clones agents until we have at least
 * MIN_POOL_AGENTS available. Called by the Inngest cron every 30 min so the
 * pool is always warm before sessions start — not in the hot path.
 */
export async function ensurePoolCapacity(): Promise<void> {
  if (!isPoolModeEnabled()) return

  const supabase = createSupabaseAdminClient()
  const { count } = await supabase
    .from('elevenlabs_agent_pool')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'available')

  const available = count ?? 0
  const needed = Math.max(0, MIN_POOL_AGENTS - available)

  if (needed === 0) {
    console.log(`[agent-pool] pool healthy: ${available} available`)
    return
  }

  console.log(`[agent-pool] pool low (${available} available, need ${MIN_POOL_AGENTS}) — cloning ${needed}`)

  // Clone sequentially to avoid hammering ElevenLabs API
  for (let i = 0; i < needed; i++) {
    const newId = await cloneAgent()
    if (!newId) {
      console.error(`[agent-pool] clone ${i + 1}/${needed} failed — stopping`)
      break
    }
  }
}

/**
 * Atomically grabs the first available agent from the pool and marks it in_session.
 * Uses SELECT FOR UPDATE SKIP LOCKED so concurrent calls never grab the same agent.
 * Returns null if pool mode is disabled, pool is empty, or reservation fails.
 */
export async function reserveAgent(sessionId: string): Promise<string | null> {
  if (!isPoolModeEnabled()) return null

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase.rpc('reserve_elevenlabs_agent', {
    p_session_id: sessionId,
  })

  if (error) {
    console.error('[agent-pool] reserve failed:', error.message)
    return null
  }

  return (data as string | null) ?? null
}

/**
 * Returns an agent to the pool and strips its KB docs.
 * Safe to call even if pool mode is disabled (will just release from DB).
 */
export async function releaseAgent(agentId: string): Promise<void> {
  const supabase = createSupabaseAdminClient()

  await Promise.all([
    supabase
      .from('elevenlabs_agent_pool')
      .update({ status: 'available', session_id: null, leased_at: null })
      .eq('agent_id', agentId),
    detachKbDocs(agentId).catch((err) =>
      console.error('[agent-pool] KB detach on release failed:', err)
    ),
  ])
}

/**
 * Attaches pre-indexed KB documents to an ElevenLabs agent.
 * kbDocIds come from topic_content_cache.elevenlabs_kb_doc_id — created at
 * content-generation time so indexing delay is zero at session start.
 */
export async function attachKbDocs(agentId: string, kbDocIds: string[]): Promise<void> {
  if (!EL_API_KEY || kbDocIds.length === 0) return

  const res = await fetch(`${EL_BASE}/convai/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'xi-api-key': EL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_config: {
        agent: {
          prompt: {
            knowledge_base: kbDocIds.map((id) => ({ type: 'file', id, usage_mode: 'auto' })),
          },
        },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`[agent-pool] attachKbDocs failed for ${agentId}: ${res.status} ${body}`)
  }

  console.log(`[agent-pool] attached ${kbDocIds.length} KB docs to agent ${agentId}`)
}

/**
 * Clears all KB documents from an ElevenLabs agent, returning it to a clean state.
 */
export async function detachKbDocs(agentId: string): Promise<void> {
  if (!EL_API_KEY) return

  await fetch(`${EL_BASE}/convai/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'xi-api-key': EL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_config: {
        agent: { prompt: { knowledge_base: [] } },
      },
    }),
  })
}
