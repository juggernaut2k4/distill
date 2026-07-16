import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { fetchAllTranscriptEvents } from '@/lib/voice/hume-native/session-details' // newly exported, architecture.md §16.6
import { formatTranscriptLines } from './hume-action-item-extractor' // verbatim reuse, unmodified import
import { recordInsightsReadyEvent } from '@/lib/partner/webhooks'

/**
 * B2B-09 — Session Delivery Extraction Fix + Internal Glitch Dashboard.
 *
 * Per docs/specs/B2B-09-requirement-document.md (v1.1) and architecture.md §16.4.
 *
 * Extraction pipeline for PARTNER sessions (partner_sessions table) — a genuinely
 * separate path from inngest/hume-action-item-extractor.ts, which owns the legacy
 * sessions-table extraction and is never modified by this file. Two things are
 * reused verbatim from that file: `formatTranscriptLines()` (transcript-shape
 * logic, independent of what fields get extracted) — nothing else. The
 * EXTRACTION_SYSTEM_PROMPT/ExtractionSchema/callClaudeForExtraction() in that
 * file are NOT reused or edited; this file defines its own prompt/schema pair
 * (Requirement Doc Section 6 / Section 11 judgment call 1) so the live
 * Anthropic call made for every existing Hume-native (legacy sessions-table)
 * session stays byte-for-byte unmodified.
 *
 * Three triggers converge on partner_session_insights:
 *  - Fast path: `clio/partner-session.ended` event, sent by
 *    app/api/webhooks/hume/route.ts's chat_ended handler's partner_sessions
 *    fallback lookup.
 *  - Backstop: this file's own 30-minute cron sweep, mirroring
 *    humeActionItemBackstopSweep's exact shape against partner_sessions /
 *    partner_session_insights instead of sessions / session_action_items.
 *  - Purge: this file's own daily cron (03:00 UTC), reducing full-detail rows
 *    older than 30 days to type-only glitches / null action_items /
 *    null psychology_keywords via the `purge_partner_session_insights_full_detail`
 *    RPC (migration 078).
 *
 * test_mode threading (v1.1, CRITICAL — Requirement Doc Section 6 / Acceptance
 * Test 11): `partner_sessions.test_mode` is fetched on BOTH the success path
 * (extractInsightsForPartnerSession()'s own select) and the failure path
 * (markInsightsExtractionFailed()'s `partner_sessions!inner(test_mode)` FK
 * embed) and threaded through to every recordInsightsReadyEvent() call as
 * `testMode`. Never hardcoded to `false` — that was the exact CEO-review bug
 * this document's v1.1 closed, reproducing the bug class B2B-08 (architecture.md
 * §15.6) fixed at a different call site.
 */

// ─── NEW prompt/schema pair — deliberately NOT EXTRACTION_SYSTEM_PROMPT/ExtractionSchema from
// hume-action-item-extractor.ts. Requirement Doc Section 6 / Section 11 judgment call 1: editing that
// shared constant would change the live Anthropic call for every existing sessions-table session too.

const PartnerActionItemSchema = z.object({ text: z.string() })
const PartnerGlitchSchema = z.object({
  type: z.enum(['misunderstanding', 'repetition', 'confusion_about_clio', 'derailment', 'other']),
  description: z.string(),
})
export const PartnerInsightsExtractionSchema = z.object({
  action_items: z.array(PartnerActionItemSchema),
  glitches: z.array(PartnerGlitchSchema),
  psychology_keywords: z.array(z.string()),
})
type PartnerInsightsPayload = z.infer<typeof PartnerInsightsExtractionSchema>

const MODEL = 'claude-sonnet-4-6'
const isPlaceholder = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')
const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PARTNER_INSIGHTS_SYSTEM_PROMPT = `You are reviewing a transcript of a 1:1 AI-guided conversation between an AI assistant and a user. Extract three things:
1. **Action items** — concrete next steps the User committed to, or that the assistant explicitly recommended and the User acknowledged. Do not invent items the transcript does not support.
2. **Glitches** — moments where the conversation broke down: the assistant misunderstood or mis-heard the User, the assistant repeated itself unnecessarily, the User expressed confusion specifically about the assistant (not about the subject matter), or the conversation was derailed by an off-topic interruption. Do not flag ordinary comprehension checkpoints.
3. **Psychology keywords** — short keyword/phrase signals (1-4 words each, lowercase, hyphenated if multi-word) capturing the User's inferred psychological state or communication pattern, based on HOW they asked/responded (tone, hesitation, confidence, urgency, frustration, curiosity) — never WHAT subject matter they discussed. Examples: "hesitant", "time-pressured", "skeptical-of-ai", "highly-engaged". Never a full sentence, never a verbatim quote.

Respond with ONLY a JSON object matching this exact shape, no prose outside the JSON:
{"action_items": [{"text": string}], "glitches": [{"type": "misunderstanding" | "repetition" | "confusion_about_clio" | "derailment" | "other", "description": string}], "psychology_keywords": [string]}

Empty arrays are valid, expected results when nothing of that kind is present — never fabricate content to avoid an empty array.`

async function callClaudeForPartnerInsightsExtraction(
  transcriptText: string
): Promise<{ data: PartnerInsightsPayload; isMock: boolean }> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK partner-session-insights-extractor] ANTHROPIC_API_KEY is a placeholder — returning mock extraction')
    return {
      isMock: true,
      data: {
        action_items: [{ text: '[MOCK] Review the AI vendor shortlist discussed in this session before the next call.' }],
        glitches: [{ type: 'other', description: '[MOCK] Placeholder glitch — ANTHROPIC_API_KEY is not configured.' }],
        psychology_keywords: ['[mock]-placeholder-keyword'],
      },
    }
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: PARTNER_INSIGHTS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcriptText }],
  })

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(cleaned)
  } catch (err) {
    throw new Error(
      `Partner insights extraction response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const validated = PartnerInsightsExtractionSchema.safeParse(parsedJson)
  if (!validated.success) {
    throw new Error(`Partner insights extraction response failed schema validation: ${validated.error.message}`)
  }
  return { isMock: false, data: validated.data }
}

// ─── Idempotency guard — structurally identical to runIdempotencyGuard() in
// hume-action-item-extractor.ts, against partner_session_insights instead of session_action_items.

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

type GuardOutcome = { shortCircuit: true; status: 'already_terminal' } | { shortCircuit: false }

async function runInsightsIdempotencyGuard(
  supabase: SupabaseAdminClient,
  partnerSessionId: string,
  partnerAccountId: string,
  humeChatId: string | null
): Promise<GuardOutcome> {
  const { data: existing } = await supabase
    .from('partner_session_insights')
    .select('extraction_status, attempt_count')
    .eq('partner_session_id', partnerSessionId)
    .maybeSingle()

  if (existing) {
    const status = existing.extraction_status as string
    if (status === 'success' || status === 'success_empty') return { shortCircuit: true, status: 'already_terminal' }
    if (status === 'failed' && (existing.attempt_count ?? 0) >= 3) return { shortCircuit: true, status: 'already_terminal' }
    return { shortCircuit: false }
  }

  await supabase.from('partner_session_insights').upsert(
    { partner_session_id: partnerSessionId, partner_account_id: partnerAccountId, hume_chat_id: humeChatId, extraction_status: 'pending' },
    { onConflict: 'partner_session_id', ignoreDuplicates: true }
  )

  const { data: afterInsert } = await supabase
    .from('partner_session_insights')
    .select('extraction_status')
    .eq('partner_session_id', partnerSessionId)
    .maybeSingle()

  const afterStatus = afterInsert?.extraction_status as string | undefined
  if (afterStatus === 'success' || afterStatus === 'success_empty') return { shortCircuit: true, status: 'already_terminal' }
  return { shortCircuit: false }
}

// ─── Core extraction — mirrors extractActionItemsForSession()'s shape exactly, against the new table.

/**
 * The single, idempotent extraction path both the fast-path event function
 * and the backstop cron sweep call. Throws on any retryable failure (missing
 * hume_chat_id, a Hume API error, an Anthropic API error, a schema validation
 * failure, or a DB write failure) — callers are responsible for letting
 * Inngest retry the step and, once exhausted, calling
 * markInsightsExtractionFailed().
 */
export async function extractInsightsForPartnerSession(partnerSessionId: string): Promise<{ status: string }> {
  const supabase = createSupabaseAdminClient()

  const { data: session } = await supabase
    .from('partner_sessions')
    .select('id, partner_account_id, hume_chat_id, test_mode')
    .eq('id', partnerSessionId)
    .maybeSingle()

  if (!session) throw new Error(`No partner_sessions row for id ${partnerSessionId}`)
  if (!session.hume_chat_id) throw new Error(`partner_sessions ${partnerSessionId} has no hume_chat_id`)

  const guard = await runInsightsIdempotencyGuard(
    supabase,
    partnerSessionId,
    session.partner_account_id as string,
    session.hume_chat_id as string
  )
  if (guard.shortCircuit) return { status: guard.status }

  const apiKey = process.env.HUME_API_KEY
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) throw new Error('HUME_API_KEY not configured')

  const transcriptEvents = await fetchAllTranscriptEvents(apiKey, session.hume_chat_id as string)
  const messageLines = formatTranscriptLines(transcriptEvents)

  let result: {
    status: string
    extraction_status: 'success' | 'success_empty'
    actionItems: unknown[]
    glitches: unknown[]
    psychologyKeywords: string[]
    isMock: boolean
    eventCount: number
  }

  if (messageLines.length === 0) {
    result = { status: 'success_empty', extraction_status: 'success_empty', actionItems: [], glitches: [], psychologyKeywords: [], isMock: false, eventCount: 0 }
  } else {
    const { data, isMock } = await callClaudeForPartnerInsightsExtraction(messageLines.join('\n'))
    const isEmpty = data.action_items.length === 0 && data.glitches.length === 0 && data.psychology_keywords.length === 0
    result = {
      status: isEmpty ? 'success_empty' : 'success',
      extraction_status: isEmpty ? 'success_empty' : 'success',
      actionItems: data.action_items,
      glitches: data.glitches,
      psychologyKeywords: data.psychology_keywords,
      isMock,
      eventCount: messageLines.length,
    }
  }

  const { error: writeError } = await supabase
    .from('partner_session_insights')
    .update({
      extraction_status: result.extraction_status,
      action_items: result.actionItems,
      glitches: result.glitches,
      psychology_keywords: result.psychologyKeywords,
      transcript_event_count: result.eventCount,
      error_message: result.isMock ? '[MOCK] ANTHROPIC_API_KEY not configured — mock data written' : null,
      extracted_at: new Date().toISOString(),
    })
    .eq('partner_session_id', partnerSessionId)

  if (writeError) {
    // Mirrors writeTerminalSuccess()'s convention in hume-action-item-extractor.ts — a write failure
    // here is logged and thrown so Inngest's own step-retry semantics apply, never silently swallowed.
    console.error(`[partner-session-insights-extractor] Failed to write terminal result for ${partnerSessionId}:`, writeError.message)
    throw new Error(`Failed to write terminal extraction result for partner session ${partnerSessionId}: ${writeError.message}`)
  }

  // v1.1 — testMode is the session's REAL partner_sessions.test_mode value, fetched above. Previously
  // hardcoded to false; see Requirement Doc Section 6 v1.1 correction / Acceptance Test 11.
  await recordInsightsReadyEvent({
    partnerSessionId,
    partnerAccountId: session.partner_account_id as string,
    extractionStatus: result.extraction_status,
    testMode: session.test_mode as boolean,
  })

  return { status: result.status }
}

/**
 * Writes a terminal 'failed' status after Inngest's own step-retry budget is
 * exhausted. Called by both triggers' outer catch blocks below, never from
 * inside the retryable extraction path itself. Mirrors architecture.md
 * §16.4's exact code.
 *
 * v1.1 — the select gains a `partner_sessions!inner(test_mode)` FK embed
 * (identical embed pattern to fetchDueDispatches()'s own
 * `partner_accounts!inner(...)` embed in lib/partner/webhooks.ts) so this
 * failure path can thread test_mode through too, same as the success path in
 * extractInsightsForPartnerSession() above — this function has no direct
 * `partner_sessions` read of its own otherwise.
 *
 * If no `partner_session_insights` row exists yet (the `partner_sessions`
 * lookup itself threw before the idempotency guard ever ran, e.g. a missing
 * row or missing hume_chat_id), this is a no-op — matches architecture.md
 * §16.4's exact behavior. The 30-minute backstop sweep re-attempts extraction
 * for any session in this state, since it was never marked 'failed' and thus
 * still passes the sweep's eligibility filter.
 */
export async function markInsightsExtractionFailed(partnerSessionId: string, errorMessage: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const truncatedMessage = errorMessage.slice(0, 2000)

  const { data: current } = await supabase
    .from('partner_session_insights')
    .select('attempt_count, partner_account_id, partner_sessions!inner(test_mode)')
    .eq('partner_session_id', partnerSessionId)
    .maybeSingle()

  if (!current) return

  const nextAttemptCount = (current.attempt_count ?? 0) + 1

  const { error: updateError } = await supabase
    .from('partner_session_insights')
    .update({
      extraction_status: 'failed',
      error_message: truncatedMessage,
      attempt_count: nextAttemptCount,
    })
    .eq('partner_session_id', partnerSessionId)

  if (updateError) {
    console.error(`[partner-session-insights-extractor] Failed to write 'failed' status for ${partnerSessionId}:`, updateError.message)
    return
  }

  // A permanently-failed extraction still tells the partner explicitly, once, per the Requirement
  // Doc's "extraction_status: 'failed'" webhook shape — only fired the FIRST time this row crosses
  // into 'failed' with attempt_count reaching 3 (mirrors the guard's own >= 3 exhaustion check), never
  // re-fired on every retry attempt below that.
  if (nextAttemptCount >= 3) {
    const testMode = (current.partner_sessions as unknown as { test_mode: boolean } | null)?.test_mode ?? false
    await recordInsightsReadyEvent({
      partnerSessionId,
      partnerAccountId: current.partner_account_id as string,
      extractionStatus: 'failed',
      testMode,
    })
  }
}

// ─── Fast path: event-triggered Inngest function ────────────────────────────

export const partnerSessionInsightsExtractor = inngest.createFunction(
  {
    id: 'partner-session-insights-extractor',
    name: 'Extract Partner Session Insights (Fast Path)',
    retries: 3,
    triggers: [{ event: 'clio/partner-session.ended' }],
  },
  async ({ event, step }) => {
    const { partnerSessionId } = event.data as { partnerSessionId?: string }

    if (!partnerSessionId) {
      console.warn('[partner-session-insights-extractor] clio/partner-session.ended event missing partnerSessionId — no-op')
      return { status: 'skipped', reason: 'missing_partner_session_id' }
    }

    try {
      return await step.run('extract-partner-insights', () => extractInsightsForPartnerSession(partnerSessionId))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[partner-session-insights-extractor] Extraction failed for partner session ${partnerSessionId} after retries exhausted:`,
        message
      )
      await markInsightsExtractionFailed(partnerSessionId, message)
      return { status: 'failed', reason: message }
    }
  }
)

// ─── Backstop — mirrors humeActionItemBackstopSweep exactly, against partner_sessions/partner_session_insights.

const BACKSTOP_ELIGIBILITY_DELAY_MS = 30 * 60 * 1000

export const partnerSessionInsightsBackstopSweep = inngest.createFunction(
  {
    id: 'partner-session-insights-backstop-sweep',
    name: 'Partner Session Insights — Backstop Sweep',
    retries: 3,
    triggers: [{ cron: '*/30 * * * *' }],
  },
  async ({ step }) => {
    const supabase = createSupabaseAdminClient()

    const eligibleIds = await step.run('find-eligible-sessions', async () => {
      const cutoff = new Date(Date.now() - BACKSTOP_ELIGIBILITY_DELAY_MS).toISOString()

      const { data: candidates } = await supabase
        .from('partner_sessions')
        .select('id')
        .eq('status', 'completed')
        .not('ended_at', 'is', null)
        .lt('ended_at', cutoff)
        .not('hume_chat_id', 'is', null)

      const candidateIds = (candidates ?? []).map((s) => s.id as string)
      if (candidateIds.length === 0) return [] as string[]

      const { data: existing } = await supabase
        .from('partner_session_insights')
        .select('partner_session_id, extraction_status, attempt_count')
        .in('partner_session_id', candidateIds)

      const existingMap = new Map(
        (existing ?? []).map((r) => [r.partner_session_id as string, r as { extraction_status: string; attempt_count: number }])
      )

      return candidateIds.filter((id) => {
        const row = existingMap.get(id)
        if (!row) return true // never attempted
        if (row.extraction_status === 'success' || row.extraction_status === 'success_empty') return false
        if (row.extraction_status === 'failed') return (row.attempt_count ?? 0) < 3
        return true // 'pending' — allow retry
      })
    })

    console.log(`[partner-session-insights-backstop] Sessions eligible for extraction: ${eligibleIds.length}`)

    let extracted = 0
    let failed = 0

    for (const id of eligibleIds) {
      try {
        await step.run(`extract-partner-insights-${id}`, () => extractInsightsForPartnerSession(id))
        extracted++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[partner-session-insights-backstop] Extraction failed for partner session ${id} after retries exhausted:`, message)
        await markInsightsExtractionFailed(id, message)
        failed++
      }
    }

    return { checked: eligibleIds.length, extracted, failed }
  }
)

// ─── Purge — new daily cron. 30-day window, reasoning: Requirement Doc Section 9.

const PURGE_WINDOW_DAYS = 30

export const partnerSessionInsightsPurge = inngest.createFunction(
  {
    id: 'partner-session-insights-purge',
    name: 'Partner Session Insights — 30-Day Full-Detail Purge',
    retries: 3,
    triggers: [{ cron: '0 3 * * *' }],
  },
  async ({ step }) => {
    const purged = await step.run('purge-expired-full-detail', async () => {
      const supabase = createSupabaseAdminClient()
      const cutoffIso = new Date(Date.now() - PURGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.rpc('purge_partner_session_insights_full_detail', { p_cutoff: cutoffIso })
      if (error) throw new Error(`Purge RPC failed: ${error.message}`)
      return (data as number) ?? 0
    })
    console.log(`[partner-session-insights-purge] Purged full-detail text from ${purged} row(s)`)
    return { purged }
  }
)
