import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase'
// LIVE-01 — new, isolated module for the toggle-gated live conductor path.
// Nothing below this import changes the behavior of the existing default path
// when the toggle is off; see the "LIVE-01 BRANCH POINT" comments below for
// exactly where this plugs in.
import {
  isLiveConductorEnabled,
  getLiveConductorState,
  buildLiveConductorSystemPrompt,
  handleAdvanceTab,
  LIVE_CONDUCTOR_TOOLS,
  FORCE_AT_TURN,
} from '@/lib/voice/live-conductor-bridge'
import type { UserContext } from '@/lib/content/session-content-generator'

export const maxDuration = 60

// ── In-memory context cache ────────────────────────────────────────────────
// Vercel Fluid Compute reuses function instances across requests, so this Map
// persists within an instance. First turn of a session does a full DB fetch;
// subsequent turns within the same 5-minute window skip Supabase entirely.
// Every 5 minutes we do a lightweight bot_id check to detect session rollover.

interface ContextCacheEntry {
  botId: string | null
  systemPrompt: string
  cachedAt: number
  lastValidated: number
}

const contextCache = new Map<string, ContextCacheEntry>()
const CACHE_TTL_MS = 2 * 60 * 60 * 1000     // evict after 2 hours
const VALIDATION_INTERVAL_MS = 5 * 60 * 1000 // re-check bot_id every 5 min

async function getSystemPrompt(
  userId: string,
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<{ prompt: string; cacheStatus: 'HIT' | 'VALIDATED' | 'MISS' | 'STALE_SESSION' }> {
  const DEFAULT = 'You are Clio, an expert AI business coach running a live coaching session.'
  const now = Date.now()
  const cached = contextCache.get(userId)

  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    if (now - cached.lastValidated < VALIDATION_INTERVAL_MS) {
      // Within validation window — trust the cache fully, zero DB calls
      return { prompt: cached.systemPrompt, cacheStatus: 'HIT' }
    }

    // Past validation window — lightweight bot_id check only
    const { data: lightRow } = await supabase
      .from('walkthrough_state')
      .select('bot_id')
      .eq('user_id', userId)
      .single()

    if (lightRow?.bot_id === cached.botId) {
      cached.lastValidated = now
      return { prompt: cached.systemPrompt, cacheStatus: 'VALIDATED' }
    }

    // bot_id changed → new session, fall through to full fetch
  }

  // Full fetch (cache miss or session rollover)
  const { data } = await supabase
    .from('walkthrough_state')
    .select('bot_id, session_brief, topic_context, session_script, clio_session_context')
    .eq('user_id', userId)
    .single()

  if (!data) return { prompt: DEFAULT, cacheStatus: 'MISS' }

  const { bot_id, session_brief, topic_context, session_script, clio_session_context } = data
  let systemPrompt = DEFAULT
  if (session_brief || topic_context || session_script) {
    systemPrompt = [session_brief, topic_context, session_script].filter(Boolean).join('\n\n---\n\n')
  } else if (clio_session_context) {
    systemPrompt = clio_session_context
  }

  const wasStale = !!cached
  contextCache.set(userId, { botId: bot_id, systemPrompt, cachedAt: now, lastValidated: now })
  return { prompt: systemPrompt, cacheStatus: wasStale ? 'STALE_SESSION' : 'MISS' }
}

// OpenAI-compatible message shapes sent by Hume's Custom-LLM bridge to this endpoint
interface OAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OAIToolCall[]
  tool_call_id?: string
}

// Tools Clio can invoke — mirrors the clientTools registered in WalkthroughClient.tsx
const CLIO_TOOLS: Anthropic.Tool[] = [
  {
    name: 'show_visual',
    description:
      'Advance to a specific section and display it to the participant. Call this when introducing each new topic section. Pass section_index as the 0-based position of the section in the agenda (0 = first, 1 = second, etc.). The tool will return the exact coaching script to deliver for that section.',
    input_schema: {
      type: 'object' as const,
      properties: {
        section_index: {
          type: 'number',
          description: '0-based index of the section to display (0 = first section, 1 = second, etc.). This is the primary lookup key — always provide it.',
        },
        topic_id: { type: 'string', description: 'The ID of the section (optional, for logging only)' },
        topic_title: { type: 'string', description: 'The title of the section (optional, for logging only)' },
      },
      required: ['section_index'],
    },
  },
  {
    name: 'end_session',
    description:
      'End the coaching session after all sections have been covered, or when the participant signals they want to stop.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
]

/**
 * Converts the OpenAI-format conversation history sent by Hume's Custom-LLM
 * bridge into Anthropic MessageParam format, including tool_calls and tool_results.
 *
 * Claude's API requires the last message to be a user message — it does not
 * support "assistant message prefill". This bridge frequently sends histories
 * where the final message is an assistant turn (e.g. the welcome message Clio
 * just delivered). We strip any trailing assistant messages before sending so
 * Claude never sees a conversation ending on an assistant role.
 */
function toAnthropicMessages(messages: OAIMessage[]): Anthropic.MessageParam[] {
  // Strip trailing system and assistant messages before conversion.
  // The bridge sends the full history including Clio's most recent utterance
  // as the last message, which causes Claude to reject with:
  // "This model does not support assistant message prefill."
  const filtered = [...messages]
  while (
    filtered.length > 0 &&
    (filtered[filtered.length - 1].role === 'assistant' ||
      filtered[filtered.length - 1].role === 'system')
  ) {
    filtered.pop()
  }

  const result: Anthropic.MessageParam[] = []

  let i = 0
  while (i < filtered.length) {
    const msg = filtered[i]

    if (msg.role === 'system') {
      i++
      continue
    }

    if (msg.role === 'tool') {
      // Batch consecutive tool results into one user message
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      while (i < filtered.length && filtered[i].role === 'tool') {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: filtered[i].tool_call_id ?? `tool_${i}`,
          content: filtered[i].content ?? '',
        })
        i++
      }
      result.push({ role: 'user', content: toolResults })
      continue
    }

    if (msg.role === 'assistant') {
      const content: Anthropic.ContentBlockParam[] = []
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(tc.function.arguments)
          } catch {}
          content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
        }
      }
      result.push({ role: 'assistant', content })
      i++
      continue
    }

    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content ?? '' })
      i++
      continue
    }

    i++
  }

  return result
}

/**
 * POST /api/clio/llm
 *
 * Custom LLM endpoint for Hume EVI's Custom-LLM (non-native) sessions.
 * Hume calls this with an OpenAI-compatible chat completion request for every
 * conversation turn. We fetch the full session context (41k chars) from
 * walkthrough_state and call Claude Sonnet — no client-side prompt size limit.
 *
 * Hume EVI userId mechanism (root-caused 2026-07-03): Hume's CLM docs confirm that for
 * SSE endpoints (this route), `custom_session_id` is sent back as a query param on this
 * callback ONLY after it has been set via a `session_settings` message sent over the EVI
 * WebSocket post-connect — the `custom_session_id` query param on the initial WS *connect*
 * URL alone is not sufficient. See lib/voice/hume-adapter.ts `onopen` handler for the fix.
 *
 * No shared-secret auth is enforced on this route — as of 2026-07-02 there is no
 * evidence Hume's EVI Custom-LLM config sends an Authorization header, so gating
 * this endpoint on one would silently 401 every Hume turn (Clio would go mute
 * mid-session). userId is instead resolved from the URL/body/message content below.
 */
export async function POST(request: NextRequest) {
  // Diagnostic logging — kept to confirm the userId mechanism holds in production.
  const allHeaders = Object.fromEntries(request.headers.entries())
  console.log('[clio/llm] URL:', request.url)

  let rawBody: string
  let body: { messages?: OAIMessage[]; stream?: boolean; user?: string; [key: string]: unknown }
  try {
    rawBody = await request.text()
    console.log('[clio/llm] RAW BODY (first 800 chars):', rawBody.slice(0, 800))
    body = JSON.parse(rawBody) as typeof body
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const messages = body.messages ?? []

  // Hume EVI passes userId as ?custom_session_id= in the URL (set at WS connection time).
  // Check URL param first, then body.user (some LLM proxy formats use this), then
  // fall back to scanning message content for a DISTILL_USER_ID marker (defensive
  // fallback — kept in case a future caller embeds it in the message body instead).
  const { searchParams } = new URL(request.url)
  const userIdFromUrl = searchParams.get('custom_session_id')
  const userIdFromBody = typeof body.user === 'string' ? body.user : null
  const userIdFromMessages = messages
    .map((m) => m.content ?? '')
    .join('\n')
    .match(/DISTILL_USER_ID:\s*(\S+)/)?.[1] ?? null
  const userId = userIdFromUrl ?? userIdFromBody ?? userIdFromMessages ?? null
  console.log(`[clio/llm] userId extracted: ${userId ?? '(none)'} from ${messages.length} messages (source: ${userIdFromUrl ? 'hume-url' : userIdFromBody ? 'body-user' : userIdFromMessages ? 'message-scan' : 'none'})`)
  console.log('[clio/llm] body keys:', Object.keys(body).join(', '))

  // Resolve session context — cached after first turn, validated every 5 min
  let systemPrompt = 'You are Clio, an expert AI business coach running a live coaching session.'
  let toolsForThisTurn: Anthropic.Tool[] = CLIO_TOOLS
  // LIVE-01 — set only when the toggle is on AND this session has
  // live-conductor content available; used below to route advance_tab tool
  // calls to handleAdvanceTab instead of the default path's client-side tools.
  let liveConductorCtx: {
    supabase: ReturnType<typeof createSupabaseAdminClient>
    content: NonNullable<Awaited<ReturnType<typeof getLiveConductorState>>>['content']
    tabIndex: number
    userContext: UserContext
  } | null = null

  if (userId) {
    try {
      const supabase = createSupabaseAdminClient()

      // ── LIVE-01 BRANCH POINT ─────────────────────────────────────────────
      // Only branches when the toggle is on. Does not restructure or replace
      // the default getSystemPrompt() call below — if live-conductor content
      // isn't available for this session (toggle on but content not yet
      // generated, or an old-path session), we fall straight through to the
      // existing default system prompt / CLIO_TOOLS unchanged.
      if (isLiveConductorEnabled()) {
        // Fetched up-front (rather than after getLiveConductorState, as
        // before) so it can be passed into getLiveConductorState — needed
        // there to proactively generate tab 1's visual on session start (see
        // that function's "Proactive tab-1 visual generation" block).
        const { data: userRow } = await supabase
          .from('users')
          .select('role, industry, ai_maturity, role_level')
          .eq('id', userId)
          .single()

        const userContext: UserContext = {
          role: (userRow as { role?: string } | null)?.role ?? 'executive',
          industry: (userRow as { industry?: string } | null)?.industry ?? 'business',
          maturity: (userRow as { ai_maturity?: string } | null)?.ai_maturity ?? 'beginner',
          roleLevel: (userRow as { role_level?: string } | null)?.role_level ?? 'c-suite',
        }

        const liveState = await getLiveConductorState(userId, supabase, userContext)
        if (liveState) {
          // ── Tab-stuck backstop: server-forced advance ──────────────────────
          // The live-conductor path has no pre-scripted [NAV:tab_id] markers
          // (see script-generator.ts) — its only trigger is the model calling
          // `advance_tab` voluntarily. Confirmed in production it can get stuck
          // on a tab indefinitely. If we've been on this tab for FORCE_AT_TURN+
          // turns (the soft nudge in buildLiveConductorSystemPrompt already
          // fired at NUDGE_AT_TURN and didn't work), force the advance
          // server-side instead of waiting on the model any longer — this is
          // the deterministic mirror of the old NAV-marker system.
          const isLastTab = liveState.tabIndex >= liveState.content.tabs.length - 1
          if (liveState.tabTurnCount >= FORCE_AT_TURN && !isLastTab) {
            console.warn(
              `[clio/llm][LIVE-01] user=${userId} FORCING advance from tab ${liveState.tabIndex + 1} ` +
              `after ${liveState.tabTurnCount} turns stuck`
            )
            const forced = await handleAdvanceTab(userId, liveState.content, liveState.tabIndex, userContext, supabase, true)
            const newTabIndex = liveState.tabIndex + 1
            const firstName: string | null = null
            systemPrompt =
              buildLiveConductorSystemPrompt(liveState.content, newTabIndex, { ...userContext, firstName }) +
              `\n\n${forced.resultText}`
            toolsForThisTurn = LIVE_CONDUCTOR_TOOLS
            liveConductorCtx = { supabase, content: liveState.content, tabIndex: newTabIndex, userContext }
          } else {
            // No first-name column exists on `users` (name comes from Clerk, not
            // this table — see app/dashboard/walkthrough/page.tsx). Participant
            // greeting-by-name is a separate, not-yet-built feature (see
            // project memory: "Participant Greeting") — out of scope here.
            const firstName: string | null = null

            systemPrompt = buildLiveConductorSystemPrompt(liveState.content, liveState.tabIndex, {
              ...userContext,
              firstName,
            }, liveState.tabTurnCount)
            toolsForThisTurn = LIVE_CONDUCTOR_TOOLS
            liveConductorCtx = { supabase, content: liveState.content, tabIndex: liveState.tabIndex, userContext }
            console.log(`[clio/llm][LIVE-01] user=${userId} tab=${liveState.tabIndex + 1}/${liveState.content.tabs.length} turn=${liveState.tabTurnCount} context=${systemPrompt.length}chars`)
          }
        }
      }
      // ── END LIVE-01 BRANCH POINT ─────────────────────────────────────────

      if (!liveConductorCtx) {
        const { prompt, cacheStatus } = await getSystemPrompt(userId, supabase)
        systemPrompt = prompt
        console.log(`[clio/llm] user=${userId} cache=${cacheStatus} context=${systemPrompt.length}chars`)
      }
    } catch (err) {
      console.error('[clio/llm] Failed to fetch context:', err)
    }
  } else {
    console.warn('[clio/llm] No DISTILL_USER_ID found in system message')
  }

  const anthropicMessages = toAnthropicMessages(messages)
  if (anthropicMessages.length === 0) {
    anthropicMessages.push({ role: 'user', content: 'Hello' })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) =>
        controller.enqueue(encoder.encode(`data: ${data}\n\n`))

      let tokensSent = 0
      try {
        const responseId = `chatcmpl-clio-${Date.now()}`
        const created = Math.floor(Date.now() / 1000)

        // Send role header chunk
        send(JSON.stringify({
          id: responseId, object: 'chat.completion.chunk', created, model: 'claude-sonnet-4-6',
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        }))

        const anthropicStream = anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          messages: anthropicMessages,
          tools: toolsForThisTurn,
          tool_choice: { type: 'auto' },
        })

        let toolCallIndex = 0
        let inToolUse = false
        // LIVE-01 — tracks the tool name of the block currently streaming so we
        // know, at content_block_stop, whether it was advance_tab (only
        // meaningful when liveConductorCtx is set — the default path never
        // populates this or reads it).
        let currentToolName: string | null = null

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              inToolUse = true
              currentToolName = event.content_block.name
              // Emit the tool call start with name and empty args
              send(JSON.stringify({
                id: responseId, object: 'chat.completion.chunk', created, model: 'claude-sonnet-4-6',
                choices: [{
                  index: 0,
                  delta: {
                    content: null,
                    tool_calls: [{
                      index: toolCallIndex,
                      id: event.content_block.id,
                      type: 'function',
                      function: { name: event.content_block.name, arguments: '' },
                    }],
                  },
                  finish_reason: null,
                }],
              }))
            }
          }

          if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              tokensSent++
              send(JSON.stringify({
                id: responseId, object: 'chat.completion.chunk', created, model: 'claude-sonnet-4-6',
                choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }],
              }))
            } else if (event.delta.type === 'input_json_delta') {
              send(JSON.stringify({
                id: responseId, object: 'chat.completion.chunk', created, model: 'claude-sonnet-4-6',
                choices: [{
                  index: 0,
                  delta: { tool_calls: [{ index: toolCallIndex, function: { arguments: event.delta.partial_json } }] },
                  finish_reason: null,
                }],
              }))
            }
          }

          if (event.type === 'content_block_stop' && inToolUse) {
            inToolUse = false
            toolCallIndex++

            // ── LIVE-01 BRANCH POINT ────────────────────────────────────────
            // advance_tab has no input args (empty schema), so there's nothing
            // to parse — just fire the side effect. Only reachable when
            // liveConductorCtx was populated above (toggle on + content
            // available), and only for this specific tool name, so the default
            // path's show_visual/end_session tool_use blocks are completely
            // unaffected.
            if (currentToolName === 'advance_tab' && liveConductorCtx) {
              const ctx = liveConductorCtx
              void handleAdvanceTab(userId!, ctx.content, ctx.tabIndex, ctx.userContext, ctx.supabase).catch((err: unknown) => {
                console.error('[clio/llm][LIVE-01] handleAdvanceTab failed:', err)
              })
            }
            currentToolName = null
            // ── END LIVE-01 BRANCH POINT ────────────────────────────────────
          }

          if (event.type === 'message_delta') {
            const finishReason = event.delta.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'
            send(JSON.stringify({
              id: responseId, object: 'chat.completion.chunk', created, model: 'claude-sonnet-4-6',
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
            }))
          }
        }

        send('[DONE]')
      } catch (err) {
        console.error('[clio/llm] Stream error causing early [DONE]:', err instanceof Error ? err.message : String(err), '| tokens sent before error:', tokensSent)
        send('[DONE]')
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
