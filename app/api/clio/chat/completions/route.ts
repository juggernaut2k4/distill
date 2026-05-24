import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase'

export const maxDuration = 60

// OpenAI-compatible message shapes that ElevenLabs sends to custom LLM endpoints
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
      'Advance to the next section and display it to the participant. Call this when introducing each new topic section. The tool will return the exact coaching script to deliver for that section.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic_id: { type: 'string', description: 'The ID of the section to display' },
        topic_title: { type: 'string', description: 'The title of the section to display' },
      },
      required: ['topic_id', 'topic_title'],
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
 * Converts the OpenAI-format conversation history from ElevenLabs into
 * Anthropic MessageParam format, including tool_calls and tool_results.
 */
function toAnthropicMessages(messages: OAIMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = []

  let i = 0
  while (i < messages.length) {
    const msg = messages[i]

    if (msg.role === 'system') {
      i++
      continue
    }

    if (msg.role === 'tool') {
      // Batch consecutive tool results into one user message
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      while (i < messages.length && messages[i].role === 'tool') {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: messages[i].tool_call_id ?? `tool_${i}`,
          content: messages[i].content ?? '',
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
 * Custom LLM endpoint for ElevenLabs Conversational AI.
 * ElevenLabs calls this with an OpenAI-compatible chat completion request for every
 * conversation turn. We fetch the full session context (41k chars) from walkthrough_state
 * and call Claude Sonnet — bypassing ElevenLabs' prompt override size limit entirely.
 *
 * Configure in ElevenLabs dashboard: Agent → LLM → Custom → URL = https://hello-clio.com/api/clio/llm
 * Set Authorization header secret = ELEVENLABS_CUSTOM_LLM_SECRET env var.
 */
export async function POST(request: NextRequest) {
  console.log('[clio/llm] Request received — headers:', JSON.stringify(Object.fromEntries(request.headers.entries())).slice(0, 300))

  // Verify the request is from ElevenLabs using a shared secret
  const authHeader = request.headers.get('authorization')
  const secret = process.env.ELEVENLABS_CUSTOM_LLM_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    console.warn('[clio/llm] Unauthorized request — bad auth header')
    return new Response('Unauthorized', { status: 401 })
  }

  let body: { messages?: OAIMessage[]; stream?: boolean }
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const messages = body.messages ?? []

  // The ElevenLabs agent system prompt template contains "DISTILL_USER_ID: {{user_id}}"
  // which gets substituted when WalkthroughClient passes dynamicVariables: { user_id: userId }
  const systemMsg = messages.find((m) => m.role === 'system')
  const userIdMatch = systemMsg?.content?.match(/DISTILL_USER_ID:\s*(\S+)/)
  const userId = userIdMatch?.[1] ?? null

  // Fetch the full session context from walkthrough_state — no size limit here
  let systemPrompt = 'You are Clio, an expert AI business coach running a live coaching session.'

  if (userId) {
    try {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase
        .from('walkthrough_state')
        .select('session_brief, topic_context, session_script, clio_session_context')
        .eq('user_id', userId)
        .single()

      if (data) {
        const { session_brief, topic_context, session_script, clio_session_context } = data
        if (session_brief || topic_context || session_script) {
          systemPrompt = [session_brief, topic_context, session_script]
            .filter(Boolean)
            .join('\n\n---\n\n')
          console.log(
            `[clio/llm] user=${userId} context=${systemPrompt.length}chars ` +
            `(brief=${session_brief?.length ?? 0}, ctx=${topic_context?.length ?? 0}, script=${session_script?.length ?? 0})`
          )
        } else if (clio_session_context) {
          systemPrompt = clio_session_context
          console.log(`[clio/llm] user=${userId} fallback context=${systemPrompt.length}chars`)
        } else {
          console.warn(`[clio/llm] user=${userId} — no context in walkthrough_state`)
        }
      } else {
        console.warn(`[clio/llm] user=${userId} — no walkthrough_state row found`)
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
          tools: CLIO_TOOLS,
          tool_choice: { type: 'auto' },
        })

        let toolCallIndex = 0
        let inToolUse = false

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              inToolUse = true
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
        console.error('[clio/llm] Stream error:', err)
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
