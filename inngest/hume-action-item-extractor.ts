import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getHumeSessionDetails } from '@/lib/voice/hume-native/session-details'

/**
 * HUME-NATIVE-02 Part B — post-session action-item and glitch extraction.
 *
 * Per .claude/agents/clio/requirement-docs/
 * HUME-NATIVE-02-transcript-visualization-and-action-items.md, Part B.
 *
 * Two triggers converge on the single, idempotent extractActionItemsForSession():
 *  - Fast path: `clio/hume-native-session.ended` event, sent by
 *    app/api/webhooks/hume/route.ts's chat_ended handler.
 *  - Backstop: this file's own 30-minute cron sweep, mirroring the exact
 *    push-plus-backstop-poll shape FB-HUME-GROUND-TRUTH-01-elevated.md's
 *    Decision 1 already established and got CEO approval for.
 *
 * Failure handling: any throw inside extractActionItemsForSession() (transcript
 * not yet available, a Hume API error, an Anthropic API error, or a schema
 * validation failure) is treated identically — Inngest retries the step up to
 * `retries: 3` times (configured per function below), and only once that
 * budget is exhausted does the caller (in both functions below) catch the
 * final error and write a terminal `extraction_status = 'failed'` row. This
 * keeps exactly one failure-handling code path for every failure class named
 * in the spec's Section 8, rather than reimplementing retry bookkeeping
 * per-error-type.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

const ActionItemSchema = z.object({ text: z.string() })
const GlitchSchema = z.object({
  type: z.enum(['misunderstanding', 'repetition', 'confusion_about_clio', 'derailment', 'other']),
  description: z.string(),
})
// Exported for direct unit testing of the schema-validation failure mode
// (spec Section 4 step 5 / Section 8 / Acceptance Test 7) without needing to
// mock the Anthropic SDK's module-level singleton.
export const ExtractionSchema = z.object({
  action_items: z.array(ActionItemSchema),
  glitches: z.array(GlitchSchema),
})

export type ActionItem = z.infer<typeof ActionItemSchema>
export type Glitch = z.infer<typeof GlitchSchema>
type ExtractionPayload = z.infer<typeof ExtractionSchema>

export type ExtractionResult =
  | { status: 'success'; actionItemCount: number; glitchCount: number }
  | { status: 'success_empty' }
  | { status: 'already_terminal'; priorStatus: 'success' | 'success_empty' | 'failed' }

// ─── Anthropic client + mock guard (mirrors lib/templates/generator.ts) ────

const MODEL = 'claude-sonnet-4-6'

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const EXTRACTION_SYSTEM_PROMPT = `You are reviewing a transcript of a 1:1 coaching conversation between an AI coach ("Clio") and an executive ("User"). Extract two things:
1. **Action items** — concrete next steps the User committed to, or that Clio explicitly recommended and the User acknowledged. Do not invent items the transcript does not support.
2. **Glitches** — moments where the conversation broke down: Clio misunderstood or mis-heard the User, Clio repeated herself unnecessarily, the User expressed confusion specifically about Clio (not about the subject matter), or the conversation was derailed by an off-topic interruption. Do not flag ordinary comprehension checkpoints (a user saying "I don't fully understand X" about the subject matter is normal coaching, not a glitch).

Respond with ONLY a JSON object matching this exact shape, no prose outside the JSON:
{"action_items": [{"text": string}], "glitches": [{"type": "misunderstanding" | "repetition" | "confusion_about_clio" | "derailment" | "other", "description": string}]}

If there are no action items, return an empty array for action_items. If there are no glitches, return an empty array for glitches. Both empty is a valid, expected result for a short or purely informational session — do not fabricate content to avoid an empty array.`

interface ClaudeExtractionCallResult {
  data: ExtractionPayload
  /** True when ANTHROPIC_API_KEY is a placeholder and this is mock data, not a real extraction. */
  isMock: boolean
}

/**
 * Calls Claude to extract action items/glitches from a formatted transcript.
 * Mirrors lib/templates/generator.ts's isPlaceholder mock-guard convention —
 * builds/dev never break on a missing key, and the mock result is tagged via
 * `isMock` so the caller can record it distinctly (never confused with a real
 * extraction result, per the spec's Section 8 error-state instruction).
 */
async function callClaudeForExtraction(transcriptText: string): Promise<ClaudeExtractionCallResult> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK HUME-ACTION-ITEM-EXTRACTOR] ANTHROPIC_API_KEY is a placeholder — returning mock extraction')
    return {
      isMock: true,
      data: {
        action_items: [
          { text: '[MOCK] Review the AI vendor shortlist discussed in this session before the next call.' },
        ],
        glitches: [
          {
            type: 'other',
            description: '[MOCK] Placeholder glitch — ANTHROPIC_API_KEY is not configured, no real extraction ran.',
          },
        ],
      },
    }
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(cleaned)
  } catch (err) {
    throw new Error(
      `Claude extraction response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const validated = ExtractionSchema.safeParse(parsedJson)
  if (!validated.success) {
    throw new Error(`Claude extraction response failed schema validation: ${validated.error.message}`)
  }

  return { isMock: false, data: validated.data }
}

// ─── Transcript formatting ──────────────────────────────────────────────────

/**
 * Defensively extracts the spoken text from one Hume Chat History event.
 * Hume's documented shape (dev.hume.ai/docs/speech-to-speech-evi/features/
 * chat-history, confirmed in FB-HUME-GROUND-TRUTH-01-elevated.md Section 5)
 * carries the text in `message_text`. A couple of defensive fallbacks are
 * checked too, mirroring this codebase's established defensiveness toward
 * uncertain external API shapes (see lib/voice/hume-native/config-provisioner.ts's
 * own extensive handling of Hume API asymmetries).
 */
function extractMessageText(event: Record<string, unknown>): string | null {
  if (typeof event.message_text === 'string') return event.message_text
  const message = event.message as Record<string, unknown> | undefined
  if (message && typeof message.content === 'string') return message.content
  if (typeof event.text === 'string') return event.text
  return null
}

/**
 * Filters raw Hume transcript events to USER_MESSAGE/AGENT_MESSAGE only (per
 * spec Section 4 step 3) and maps them to plain "User: ..." / "Clio: ..."
 * lines, in event order. Exported for direct unit testing.
 */
export function formatTranscriptLines(transcriptEvents: unknown[]): string[] {
  const lines: string[] = []

  for (const rawEvent of transcriptEvents) {
    if (!rawEvent || typeof rawEvent !== 'object') continue
    const event = rawEvent as Record<string, unknown>
    const type = event.type

    if (type !== 'USER_MESSAGE' && type !== 'AGENT_MESSAGE') continue

    const text = extractMessageText(event)
    if (!text || text.trim().length === 0) continue

    const speaker = type === 'USER_MESSAGE' ? 'User' : 'Clio'
    lines.push(`${speaker}: ${text.trim()}`)
  }

  return lines
}

// ─── Idempotency guard ───────────────────────────────────────────────────────

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

type GuardOutcome =
  | { shortCircuit: true; result: ExtractionResult }
  | { shortCircuit: false }

/**
 * Section 4 step 1 — idempotency guard. Race-safe against the fast path and
 * the backstop sweep landing on the same session close together: the initial
 * insert uses `ignoreDuplicates` (ON CONFLICT (session_id) DO NOTHING), and
 * the loser of that race re-reads the row a concurrent attempt already wrote
 * rather than proceeding to a second Anthropic call.
 */
async function runIdempotencyGuard(
  supabase: SupabaseAdminClient,
  sessionId: string,
  userId: string,
  humeChatId: string | null
): Promise<GuardOutcome> {
  const { data: existing, error } = await supabase
    .from('session_action_items')
    .select('extraction_status, attempt_count')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to read session_action_items for session ${sessionId}: ${error.message}`)
  }

  if (existing) {
    const status = existing.extraction_status as 'pending' | 'success' | 'success_empty' | 'failed'

    if (status === 'success' || status === 'success_empty') {
      return { shortCircuit: true, result: { status: 'already_terminal', priorStatus: status } }
    }
    if (status === 'failed' && (existing.attempt_count ?? 0) >= 3) {
      return { shortCircuit: true, result: { status: 'already_terminal', priorStatus: 'failed' } }
    }
    // 'pending', or 'failed' with attempts remaining — proceed with this attempt.
    return { shortCircuit: false }
  }

  // No row yet — race-safe insert. ON CONFLICT (session_id) DO NOTHING.
  const { error: insertErr } = await supabase.from('session_action_items').upsert(
    { session_id: sessionId, user_id: userId, hume_chat_id: humeChatId, extraction_status: 'pending' },
    { onConflict: 'session_id', ignoreDuplicates: true }
  )

  if (insertErr) {
    throw new Error(
      `Failed to insert pending session_action_items row for session ${sessionId}: ${insertErr.message}`
    )
  }

  // Re-check: a concurrent attempt may have won the insert and already
  // reached a terminal state by the time we get here.
  const { data: afterInsert } = await supabase
    .from('session_action_items')
    .select('extraction_status')
    .eq('session_id', sessionId)
    .maybeSingle()

  const afterStatus = afterInsert?.extraction_status as 'pending' | 'success' | 'success_empty' | 'failed' | undefined
  if (afterStatus === 'success' || afterStatus === 'success_empty') {
    return { shortCircuit: true, result: { status: 'already_terminal', priorStatus: afterStatus } }
  }

  return { shortCircuit: false }
}

// ─── Terminal writes ─────────────────────────────────────────────────────────

async function writeTerminalSuccess(
  supabase: SupabaseAdminClient,
  sessionId: string,
  fields: {
    extractionStatus: 'success' | 'success_empty'
    actionItems: ActionItem[]
    glitches: Glitch[]
    transcriptEventCount: number
    /** Non-null only when this write used mock data (ANTHROPIC_API_KEY placeholder) — see spec Section 8. */
    mockNote: string | null
  }
): Promise<void> {
  const { error } = await supabase
    .from('session_action_items')
    .update({
      extraction_status: fields.extractionStatus,
      action_items: fields.actionItems,
      glitches: fields.glitches,
      transcript_event_count: fields.transcriptEventCount,
      error_message: fields.mockNote,
      extracted_at: new Date().toISOString(),
    })
    .eq('session_id', sessionId)

  if (error) {
    // Per spec Section 8: a write failure here is logged and, by throwing,
    // left to Inngest's own step-retry semantics rather than silently
    // swallowed — never crashes the caller (webhook handler / cron sweep).
    console.error(`[hume-action-item-extractor] Failed to write terminal result for session ${sessionId}:`, error.message)
    throw new Error(`Failed to write terminal extraction result for session ${sessionId}: ${error.message}`)
  }
}

/**
 * Writes a terminal 'failed' status after Inngest's own step-retry budget is
 * exhausted (Section 4 step 2 / Section 8). Called by both triggers' outer
 * catch blocks below, never from inside the retryable extraction path itself.
 */
async function markExtractionFailed(sessionId: string, errorMessage: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const truncatedMessage = errorMessage.slice(0, 2000)

  const { data: current } = await supabase
    .from('session_action_items')
    .select('attempt_count')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (current) {
    const { error } = await supabase
      .from('session_action_items')
      .update({
        extraction_status: 'failed',
        error_message: truncatedMessage,
        attempt_count: (current.attempt_count ?? 0) + 1,
      })
      .eq('session_id', sessionId)

    if (error) {
      console.error(`[hume-action-item-extractor] Failed to write 'failed' status for session ${sessionId}:`, error.message)
    }
    return
  }

  // No row exists yet — e.g. the session lookup itself failed before the
  // idempotency guard ever ran. Best-effort upsert so this failure is still
  // recorded rather than silently lost.
  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('user_id, hume_chat_id')
    .eq('id', sessionId)
    .maybeSingle()

  const { error } = await supabase.from('session_action_items').upsert(
    {
      session_id: sessionId,
      user_id: sessionRow?.user_id ?? 'unknown',
      hume_chat_id: sessionRow?.hume_chat_id ?? null,
      extraction_status: 'failed',
      error_message: truncatedMessage,
      attempt_count: 1,
    },
    { onConflict: 'session_id' }
  )

  if (error) {
    console.error(
      `[hume-action-item-extractor] Failed to write 'failed' status for session ${sessionId} (no prior row):`,
      error.message
    )
  }
}

// ─── Core extraction (shared by both triggers) ──────────────────────────────

/**
 * The single, idempotent extraction path both the fast-path event function
 * and the backstop cron sweep call. Throws on any retryable failure
 * (transcript not yet available, a Hume API error, an Anthropic API error, a
 * schema validation failure, or a DB write failure) — callers are responsible
 * for letting Inngest retry the step and, once exhausted, calling
 * markExtractionFailed().
 */
export async function extractActionItemsForSession(sessionId: string): Promise<ExtractionResult> {
  const supabase = createSupabaseAdminClient()

  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, user_id, hume_chat_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (sessionErr) {
    throw new Error(`Failed to look up session ${sessionId}: ${sessionErr.message}`)
  }
  if (!session) {
    throw new Error(`No session found for id ${sessionId}`)
  }

  const guardOutcome = await runIdempotencyGuard(supabase, sessionId, session.user_id, session.hume_chat_id)
  if (guardOutcome.shortCircuit) {
    return guardOutcome.result
  }

  // Section 4 step 2 — getHumeSessionDetails() reused verbatim. Its own
  // throws (session_not_found / not_eligible_no_hume_ids / live_fetch_failed /
  // live_fetch_config_deleted) propagate unmodified — that IS this function's
  // "throw so Inngest retries this step" behavior for those failure modes.
  const details = await getHumeSessionDetails(sessionId)

  if (details.transcriptEvents.length === 0 && details.transcriptFetchError) {
    // Config fetch succeeded but the transcript fetch failed non-fatally
    // (e.g. not yet available) — mirrors fetchRecallTranscript's 404 pattern
    // in inngest/session-quality-evaluator.ts: throw so Inngest retries.
    throw new Error(
      `Transcript fetch failed for session ${sessionId}: ${details.transcriptFetchError}`
    )
  }

  const messageLines = formatTranscriptLines(details.transcriptEvents)

  if (messageLines.length === 0) {
    // Genuinely empty conversation (or only tool-call/metadata events) — skip
    // the Claude call entirely, per spec Section 4 step 3.
    await writeTerminalSuccess(supabase, sessionId, {
      extractionStatus: 'success_empty',
      actionItems: [],
      glitches: [],
      transcriptEventCount: 0,
      mockNote: null,
    })
    return { status: 'success_empty' }
  }

  const { data: extraction, isMock } = await callClaudeForExtraction(messageLines.join('\n'))
  const isEmpty = extraction.action_items.length === 0 && extraction.glitches.length === 0

  await writeTerminalSuccess(supabase, sessionId, {
    extractionStatus: isEmpty ? 'success_empty' : 'success',
    actionItems: extraction.action_items,
    glitches: extraction.glitches,
    transcriptEventCount: messageLines.length,
    mockNote: isMock
      ? '[MOCK] ANTHROPIC_API_KEY not configured — mock extraction data written, not a real result'
      : null,
  })

  return isEmpty
    ? { status: 'success_empty' }
    : { status: 'success', actionItemCount: extraction.action_items.length, glitchCount: extraction.glitches.length }
}

// ─── Fast path: event-triggered Inngest function ────────────────────────────

/**
 * Fast path — triggered by `clio/hume-native-session.ended`, sent from
 * app/api/webhooks/hume/route.ts's chat_ended handler immediately after its
 * audit-event write succeeds.
 */
export const humeActionItemExtractor = inngest.createFunction(
  {
    id: 'hume-action-item-extractor',
    name: 'Extract Hume Session Action Items (Fast Path)',
    retries: 3,
    triggers: [{ event: 'clio/hume-native-session.ended' }],
  },
  async ({ event, step }) => {
    const { sessionId } = event.data as { sessionId?: string }

    if (!sessionId) {
      console.warn('[hume-action-item-extractor] clio/hume-native-session.ended event missing sessionId — no-op')
      return { status: 'skipped', reason: 'missing_session_id' }
    }

    try {
      return await step.run('extract-action-items', () => extractActionItemsForSession(sessionId))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[hume-action-item-extractor] Extraction failed for session ${sessionId} after retries exhausted:`,
        message
      )
      await markExtractionFailed(sessionId, message)
      return { status: 'failed', reason: message }
    }
  }
)

// ─── Backstop: 30-minute cron sweep ──────────────────────────────────────────

const BACKSTOP_ELIGIBILITY_DELAY_MS = 30 * 60 * 1000

/**
 * Backstop — finds Hume-native sessions that ended more than 30 minutes ago
 * with no terminal session_action_items row yet (webhook never fired, was
 * delayed, or its Inngest event failed before enqueueing), and runs
 * extraction for each. Mirrors the exact cron pattern
 * inngest/session-quality-evaluator.ts already establishes for its own
 * 15-minute cron, and the additive, never-sole-mechanism shape
 * FB-HUME-GROUND-TRUTH-01-elevated.md's Decision 1 established.
 *
 * Each session is processed inside its own try/catch around a per-session
 * step.run() call so one permanently-failing session (after its own Inngest
 * step-retry budget is exhausted) never aborts processing of the remaining
 * sessions in the same sweep (spec Section 8: "never crashes... the cron
 * sweep's processing of other sessions in the same run").
 */
export const humeActionItemBackstopSweep = inngest.createFunction(
  {
    id: 'hume-action-item-backstop-sweep',
    name: 'Hume Action Item Extraction — Backstop Sweep',
    retries: 3,
    triggers: [{ cron: '*/30 * * * *' }],
  },
  async ({ step }) => {
    const supabase = createSupabaseAdminClient()

    const eligibleSessionIds = await step.run('find-eligible-sessions', async () => {
      const cutoff = new Date(Date.now() - BACKSTOP_ELIGIBILITY_DELAY_MS).toISOString()

      const { data: candidateSessions, error } = await supabase
        .from('sessions')
        .select('id')
        .eq('hume_native_enabled', true)
        .not('ended_at', 'is', null)
        .lt('ended_at', cutoff)

      if (error) {
        throw new Error(`Failed to fetch candidate sessions: ${error.message}`)
      }

      const candidateIds = (candidateSessions ?? []).map((s) => s.id as string)
      if (candidateIds.length === 0) return [] as string[]

      const { data: existingRows, error: existingErr } = await supabase
        .from('session_action_items')
        .select('session_id, extraction_status, attempt_count')
        .in('session_id', candidateIds)

      if (existingErr) {
        throw new Error(`Failed to fetch existing session_action_items rows: ${existingErr.message}`)
      }

      const existingMap = new Map(
        (existingRows ?? []).map((r) => [r.session_id as string, r as { extraction_status: string; attempt_count: number }])
      )

      return candidateIds.filter((id) => {
        const row = existingMap.get(id)
        if (!row) return true // never attempted
        if (row.extraction_status === 'success' || row.extraction_status === 'success_empty') return false
        if (row.extraction_status === 'failed') return (row.attempt_count ?? 0) < 3
        return true // 'pending' — e.g. crashed before ever reaching a terminal write; allow retry
      })
    })

    console.log(`[hume-action-item-backstop] Sessions eligible for extraction: ${eligibleSessionIds.length}`)

    let extracted = 0
    let failed = 0
    let alreadyTerminal = 0

    for (const sessionId of eligibleSessionIds) {
      try {
        const result = await step.run(`extract-action-items-${sessionId}`, () =>
          extractActionItemsForSession(sessionId)
        )
        if (result.status === 'already_terminal') {
          alreadyTerminal++
        } else {
          extracted++
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(
          `[hume-action-item-backstop] Extraction failed for session ${sessionId} after retries exhausted:`,
          message
        )
        await markExtractionFailed(sessionId, message)
        failed++
      }
    }

    return { checked: eligibleSessionIds.length, extracted, failed, already_terminal: alreadyTerminal }
  }
)
