import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { fetchAllTranscriptEvents } from '@/lib/voice/hume-native/session-details' // newly exported, architecture.md §16.6
import { formatTranscriptLines } from './hume-action-item-extractor' // verbatim reuse, unmodified import
import { recordInsightsReadyEvent } from '@/lib/partner/webhooks'
import { getStoredTranscriptTurns, formatOpenAITranscriptLines, deleteStoredTranscript } from '@/lib/voice/openai-realtime-transcript-store'
import { getDemoPerformanceAppendEnabled } from '@/lib/demo/performance-config'

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
 *    null learner_insight (B2B-34 Piece 1 — was null psychology_keywords) via the
 *    `purge_partner_session_insights_full_detail` RPC (migration 078, updated migration 096).
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
// B2B-34 Piece 1 (docs/specs/B2B-34-requirement-document.md Part C §6.3) — replaces
// psychology_keywords: z.array(z.string()). Shape is the CEO-approved, settled shape from the brief,
// carried through unchanged per the brief's own explicit instruction not to reopen it.
const LearnerInsightSchema = z.object({
  summary: z.string().min(1),
  topics_of_interest: z.array(z.string()),
  engagement_style: z.string().min(1),
  suggested_next_topics: z.array(z.string()),
})
export const PartnerInsightsExtractionSchema = z.object({
  action_items: z.array(PartnerActionItemSchema),
  glitches: z.array(PartnerGlitchSchema),
  learner_insight: LearnerInsightSchema,
})
type PartnerInsightsPayload = z.infer<typeof PartnerInsightsExtractionSchema>

const MODEL = 'claude-sonnet-4-6'
const isPlaceholder = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')
const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PARTNER_INSIGHTS_SYSTEM_PROMPT = `You are reviewing a transcript of a 1:1 AI-guided conversation between an AI assistant and a user. Extract three things:
1. **Action items** — concrete next steps the User committed to, or that the assistant explicitly recommended and the User acknowledged. Do not invent items the transcript does not support.
2. **Glitches** — moments where the conversation broke down: the assistant misunderstood or mis-heard the User, the assistant repeated itself unnecessarily, the User expressed confusion specifically about the assistant (not about the subject matter), or the conversation was derailed by an off-topic interruption. Do not flag ordinary comprehension checkpoints.
3. **Learner insight** — a single object capturing what this specific person cares about and how they engage, so a reseller knows what to show them next:
   - \`summary\`: 1-2 sentences — what this person cares about and what to show them next. Base this only on what the transcript actually contains.
   - \`topics_of_interest\`: specific subtopics they leaned into, drawn from actual conversation content — never generic category labels.
   - \`engagement_style\`: HOW they engage, inferred from their question pattern and interaction style (e.g. "asks pointed, comparison-driven questions" or "listens fully before asking clarifying questions") — describe their *behavior*, never their emotional/psychological state. Do not use words like confused, frustrated, hesitant, skeptical, or any other tone/mood descriptor — those describe glitches (see #2), not engagement style. If you would reach for a mood word, describe the observable behavior instead (e.g. not "hesitant" but "asked to repeat the same question twice before moving on").
   - \`suggested_next_topics\`: your own inferred recommendation for what to show this learner next, based on what they engaged with.

Respond with ONLY a JSON object matching this exact shape, no prose outside the JSON:
{"action_items": [{"text": string}], "glitches": [{"type": "misunderstanding" | "repetition" | "confusion_about_clio" | "derailment" | "other", "description": string}], "learner_insight": {"summary": string, "topics_of_interest": [string], "engagement_style": string, "suggested_next_topics": [string]}}

Empty arrays are valid, expected results when nothing of that kind is present — never fabricate content to avoid an empty array. learner_insight's fields must all be present and non-fabricated — base them only on what the transcript actually contains.`

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
        learner_insight: {
          summary: '[MOCK] This learner is weighing build-vs-buy and wants concrete cost comparisons.',
          topics_of_interest: ['[mock] pricing tiers', '[mock] integration timeline'],
          engagement_style: '[MOCK] Asks pointed, comparison-driven questions.',
          suggested_next_topics: ['[mock] ROI case study', '[mock] implementation FAQ'],
        },
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

type GuardOutcome =
  | { shortCircuit: true; status: 'already_terminal' | 'claimed_by_concurrent_run' }
  | { shortCircuit: false }

async function runInsightsIdempotencyGuard(
  supabase: SupabaseAdminClient,
  partnerSessionId: string,
  partnerAccountId: string,
  humeChatId: string | null,
  // B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.5) — resolved from
  // extractInsightsForPartnerSession()'s own SELECT (already extended to include it), threaded
  // through to the initial upsert below.
  endClientId: string | null,
  // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.9) — resolved from
  // extractInsightsForPartnerSession()'s own SELECT, threaded through to the initial upsert below
  // exactly as endClientId already is.
  resellerUniqueId: string | null,
  humeConfigId: string | null
): Promise<GuardOutcome> {
  // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project (root cause doc
  // comment in app/api/demo/[slug]/performance/route.ts); replaced with array fetch + [0]. This is
  // the extraction idempotency guard, so this was prioritized alongside the other billing/guard
  // call sites.
  const { data: existingRows } = await supabase
    .from('partner_session_insights')
    .select('extraction_status, attempt_count')
    .eq('partner_session_id', partnerSessionId)
    .limit(1)
  const existing = existingRows?.[0] ?? null

  if (existing) {
    const status = existing.extraction_status as string
    if (status === 'success' || status === 'success_empty') return { shortCircuit: true, status: 'already_terminal' }
    if (status === 'failed' && (existing.attempt_count ?? 0) >= 3) return { shortCircuit: true, status: 'already_terminal' }
    return { shortCircuit: false }
  }

  const { data: insertedRows } = await supabase.from('partner_session_insights').upsert(
    {
      partner_session_id: partnerSessionId,
      partner_account_id: partnerAccountId,
      hume_chat_id: humeChatId,
      extraction_status: 'pending',
      end_client_id: endClientId,
      // B2B-38 §6.9 — additive.
      reseller_unique_id: resellerUniqueId,
      hume_config_id: humeConfigId,
    },
    { onConflict: 'partner_session_id', ignoreDuplicates: true }
  ).select('extraction_status')

  // B2B-37 — atomic claim: with ignoreDuplicates:true this is INSERT ... ON CONFLICT DO NOTHING,
  // and .select() on the upsert returns only rows THIS call actually inserted. An empty array means
  // a concurrent invocation (e.g. the fast-path emission and the legacy Hume-webhook fallback
  // emission landing in the same window) already won the insert race — short-circuit immediately
  // rather than re-reading and treating 'pending' as retryable. Deliberately narrower than the
  // `if (existing)` branch above: this only closes the same-moment concurrent-insert race and does
  // not change the backstop sweep's intentional "pending is retryable" crash-recovery behavior for
  // a row genuinely stuck 30+ minutes from an earlier run.
  if (!insertedRows || insertedRows.length === 0) {
    return { shortCircuit: true, status: 'claimed_by_concurrent_run' }
  }
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

  // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project; array fetch + [0].
  const { data: sessionRows } = await supabase
    .from('partner_sessions')
    // B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.3) — extended to include
    // partner_reference/end_client_id, threaded through to recordInsightsReadyEvent() below.
    // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.9) — extended further to include
    // reseller_unique_id/hume_config_id.
    // 2026-08-01 — extended further to include voice_provider (migration 106), so this function
    // can tell which vendor a given session actually used instead of blindly calling Hume's API
    // for every session regardless of provider.
    .select('id, partner_account_id, hume_chat_id, test_mode, partner_reference, end_client_id, reseller_unique_id, hume_config_id, voice_provider')
    .eq('id', partnerSessionId)
    .limit(1)

  const session = sessionRows?.[0] ?? null

  if (!session) throw new Error(`No partner_sessions row for id ${partnerSessionId}`)
  if (!session.hume_chat_id) throw new Error(`partner_sessions ${partnerSessionId} has no hume_chat_id`)

  const guard = await runInsightsIdempotencyGuard(
    supabase,
    partnerSessionId,
    session.partner_account_id as string,
    session.hume_chat_id as string,
    (session.end_client_id as string | null) ?? null,
    (session.reseller_unique_id as string | null) ?? null,
    (session.hume_config_id as string | null) ?? null
  )
  if (guard.shortCircuit) return { status: guard.status }

  // B2B-63 (docs/specs/B2B-63-requirement-document.md §6) — replaces the prior unconditional throw
  // for openai_realtime sessions. `voice_provider` (NULL/'hume' vs 'openai_realtime') is captured
  // once per session at render time (app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx)
  // from the same system_voice_config toggle the admin dashboard controls — never re-derived from
  // the CURRENT global toggle, which can differ from what this specific session actually used.
  // OpenAI Realtime has no post-hoc transcript-fetch API at all, so for that provider the
  // transcript is read back from Redis (captured live, client-side, during the session — see
  // lib/voice/openai-realtime-transcript-store.ts) instead of calling Hume's API. The Hume branch
  // below is completely unchanged. Deliberately branches AFTER the idempotency guard above (not
  // before): the guard must run first so a real partner_session_insights row exists for any
  // downstream failure to record against.
  let messageLines: string[]
  if (session.voice_provider === 'openai_realtime') {
    const turns = await getStoredTranscriptTurns(partnerSessionId) // partnerSessionId === clio_session_ref
    messageLines = formatOpenAITranscriptLines(turns)
  } else {
    const apiKey = process.env.HUME_API_KEY
    if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) throw new Error('HUME_API_KEY not configured')
    const transcriptEvents = await fetchAllTranscriptEvents(apiKey, session.hume_chat_id as string)
    messageLines = formatTranscriptLines(transcriptEvents)
  }

  let result: {
    status: string
    extraction_status: 'success' | 'success_empty'
    actionItems: unknown[]
    glitches: unknown[]
    // B2B-34 Piece 1 (docs/specs/B2B-34-requirement-document.md Part C §6.3/§6.4) — replaces
    // psychologyKeywords: string[]. null only for the zero-transcript short-circuit branch below
    // (§6.4's success_empty case) — never a fabricated object.
    learnerInsight: z.infer<typeof LearnerInsightSchema> | null
    isMock: boolean
    eventCount: number
  }

  if (messageLines.length === 0) {
    // B2B-34 Piece 1 §6.4 — zero transcript content means there is nothing to base a learner_insight
    // on; forcing a non-null object here would fabricate content, directly against this same system
    // prompt's "never fabricate content to avoid an empty array/result" instruction. learner_insight
    // stores SQL NULL for this case, not an empty-but-present object.
    result = { status: 'success_empty', extraction_status: 'success_empty', actionItems: [], glitches: [], learnerInsight: null, isMock: false, eventCount: 0 }
  } else {
    const { data, isMock } = await callClaudeForPartnerInsightsExtraction(messageLines.join('\n'))
    // B2B-34 Piece 1 §6.4 — exact check given in the spec, redefined to NOT include learner_insight in
    // the emptiness check (the old check was action_items.length===0 && glitches.length===0 &&
    // psychology_keywords.length===0). Note: taken literally, this still yields 'success_empty' when
    // action_items and glitches are both empty even though the Claude-call branch always produces a
    // non-null learner_insight — the spec's own prose ("the Claude-call branch always produces
    // extraction_status: 'success'") appears inconsistent with this exact code snippet; implemented
    // literally per the spec's explicit code block, flagged to the orchestrator rather than
    // reinterpreted.
    const isEmpty = data.action_items.length === 0 && data.glitches.length === 0
    result = {
      status: isEmpty ? 'success_empty' : 'success',
      extraction_status: isEmpty ? 'success_empty' : 'success',
      actionItems: data.action_items,
      glitches: data.glitches,
      learnerInsight: data.learner_insight,
      isMock,
      eventCount: messageLines.length,
    }
  }

  // B2B-65 (docs/specs/B2B-65-requirement-document.md §6.3) — demo_performance_visible is set
  // once, permanently, at this exact write, based on the demo-performance toggle's state at this
  // exact moment. Real (non-demo) sessions always get `false` since their partner_account_id
  // never equals DEMO_PARTNER_ACCOUNT_ID — zero behavior change for any real-partner session, and
  // extraction itself is never gated by this toggle (only whether the result gets appended to the
  // public Performance tab's list is).
  const isDemoSession = session.partner_account_id === process.env.DEMO_PARTNER_ACCOUNT_ID
  const shouldMakeVisible =
    isDemoSession &&
    (result.extraction_status === 'success' || result.extraction_status === 'success_empty') &&
    (await getDemoPerformanceAppendEnabled())

  const { error: writeError } = await supabase
    .from('partner_session_insights')
    .update({
      extraction_status: result.extraction_status,
      action_items: result.actionItems,
      glitches: result.glitches,
      learner_insight: result.learnerInsight,
      transcript_event_count: result.eventCount,
      error_message: result.isMock ? '[MOCK] ANTHROPIC_API_KEY not configured — mock data written' : null,
      extracted_at: new Date().toISOString(),
      demo_performance_visible: shouldMakeVisible,
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
  // B2B-34 Piece 2 — partnerReference/endClientId are the session's REAL values, fetched above.
  await recordInsightsReadyEvent({
    partnerSessionId,
    partnerAccountId: session.partner_account_id as string,
    extractionStatus: result.extraction_status,
    testMode: session.test_mode as boolean,
    partnerReference: (session.partner_reference as string | null) ?? null,
    endClientId: (session.end_client_id as string | null) ?? null,
    // B2B-38 §6.8 — the session's REAL values, fetched above.
    resellerUniqueId: (session.reseller_unique_id as string | null) ?? null,
  })

  // B2B-63 §4.2/§11 Q3 — best-effort cleanup now that extraction succeeded (terminal 'success' or
  // 'success_empty'); never throws. Deliberately NOT called from markInsightsExtractionFailed() —
  // on permanent failure the key is left in place, relying only on its 24h TTL, so a human can
  // still inspect the raw transcript while troubleshooting.
  //
  // TEMPORARILY DISABLED — 2026-08-01, per Arun: while the OpenAI Realtime conversation-quality
  // issues (missing icebreaker, garbled goodbye) are being diagnosed, transcripts need to survive
  // past a successful extraction so they can actually be read afterward — deleting immediately on
  // success defeated that. The transcript-store's own TTL (temporarily shortened to 30 minutes, see
  // lib/voice/openai-realtime-transcript-store.ts) is the only cleanup mechanism during this window.
  // Restore this call once these issues are resolved and transcript review is no longer needed.
  //
  // if (session.voice_provider === 'openai_realtime') {
  //   await deleteStoredTranscript(partnerSessionId)
  // }

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
 * B2B-34 Piece 2 (docs/specs/B2B-34-requirement-document.md Part B §6.3) — the same FK embed
 * extends further to `partner_sessions!inner(test_mode, partner_reference, end_client_id)` so this
 * failure path can thread the real partner_reference/end_client_id through too, same as the success
 * path above.
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

  // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project (root cause doc
  // comment in app/api/demo/[slug]/performance/route.ts); replaced with array fetch + [0]. The
  // partner_sessions!inner(...) embed itself is a plain SELECT (no filter on its columns), unlike
  // the entries-query bug in performance/route.ts — not touched here.
  const { data: currentRows } = await supabase
    .from('partner_session_insights')
    // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.9) — FK embed extended to also carry
    // reseller_unique_id/hume_config_id through to the recordInsightsReadyEvent() call below.
    .select(
      'attempt_count, partner_account_id, partner_sessions!inner(test_mode, partner_reference, end_client_id, reseller_unique_id, hume_config_id)'
    )
    .eq('partner_session_id', partnerSessionId)
    .limit(1)

  const current = currentRows?.[0] ?? null

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
    const embeddedSession = current.partner_sessions as unknown as {
      test_mode: boolean
      partner_reference: string | null
      end_client_id: string | null
      reseller_unique_id: string | null
      hume_config_id: string | null
    } | null
    await recordInsightsReadyEvent({
      partnerSessionId,
      partnerAccountId: current.partner_account_id as string,
      extractionStatus: 'failed',
      testMode: embeddedSession?.test_mode ?? false,
      partnerReference: embeddedSession?.partner_reference ?? null,
      endClientId: embeddedSession?.end_client_id ?? null,
      // B2B-38 §6.9 — threaded through same as endClientId immediately above.
      resellerUniqueId: embeddedSession?.reseller_unique_id ?? null,
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

      const { data: candidates, error: candidatesError } = await supabase
        .from('partner_sessions')
        .select('id')
        .eq('status', 'completed')
        .not('ended_at', 'is', null)
        .lt('ended_at', cutoff)
        .not('hume_chat_id', 'is', null)

      if (candidatesError) {
        console.error('[partner-session-insights-backstop] Failed to query eligible candidates:', candidatesError.message)
        throw new Error(`Backstop sweep candidate query failed: ${candidatesError.message}`)
      }

      const candidateIds = (candidates ?? []).map((s) => s.id as string)
      if (candidateIds.length === 0) return [] as string[]

      const { data: existing, error: existingError } = await supabase
        .from('partner_session_insights')
        .select('partner_session_id, extraction_status, attempt_count')
        .in('partner_session_id', candidateIds)

      if (existingError) {
        console.error('[partner-session-insights-backstop] Failed to query existing extraction rows:', existingError.message)
        throw new Error(`Backstop sweep existing-rows query failed: ${existingError.message}`)
      }

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
