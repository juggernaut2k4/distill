/**
 * LIVE-01 — live conductor bridge logic for the custom-LLM route
 * (app/api/clio/chat/completions/route.ts).
 *
 * This is a NEW, isolated module the bridge route imports and branches into
 * conditionally — it does not restructure or share state with the existing
 * default (script-based) path in that route. See the toggle-branch comment at
 * the route's call site for exactly where this plugs in.
 *
 * Responsibilities:
 *  - Build the live-conductor system prompt: common behavior (Part 3) + fixed
 *    topic background + current tab content (swapped, not appended) + user
 *    profile.
 *  - Define the live-conductor tool list: `advance_tab` (new) alongside
 *    `show_visual`/`end_session`, in a SEPARATE Anthropic.Tool[] array from the
 *    old path's shared CLIO_TOOLS — this array is never mutated by, or shared
 *    with, the old path.
 *  - Handle `advance_tab` tool calls: persist the new current tab index to
 *    walkthrough_state, and kick off async (non-blocking) live-visual
 *    generation for the new tab.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { CLIO_LIVE_CONDUCTOR_BEHAVIOR, LIVE_CONDUCTOR_VISUAL_ATTEMPT_TIMEOUT_MS } from '@/lib/content/live-conductor-prompt'
import { formatTabContentForPrompt, type LiveConductorContent, type LiveConductorTab } from '@/lib/content/live-conductor-content'
import { generateLiveVisualWithTimeout, buildAgendaVisual, type LiveConductorVisualData } from '@/lib/content/live-conductor-visual'
import type { UserContext } from '@/lib/content/session-content-generator'

// ─── TOGGLE ───────────────────────────────────────────────────────────────────

/**
 * Section 11, Resolved Question 1 — matches the existing
 * NEXT_PUBLIC_TOPIC01_ENABLED / NEXT_PUBLIC_VOICE_PROVIDER convention. Default
 * false/unset. Read once per call — cheap, and keeps this module free of
 * module-level state that could get stale across the toggle changing.
 */
export function isLiveConductorEnabled(): boolean {
  return process.env.NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED === 'true'
}

// ─── TOOLS — separate array, never shared with / mutated by the old path ────

/**
 * Section 11, Resolved Question 2 — new `advance_tab` tool, defined in its own
 * array alongside `show_visual`/`end_session` reproduced here (NOT imported
 * from the route's shared CLIO_TOOLS constant, and this array is never passed
 * to the old path). `show_visual` is kept for parity/logging purposes only in
 * this path — the live conductor's real visual-swap mechanism is `advance_tab`,
 * since visuals here are generated live per tab rather than pre-built per
 * section.
 */
export const LIVE_CONDUCTOR_TOOLS: Anthropic.Tool[] = [
  {
    name: 'advance_tab',
    description:
      "Call this when you are done teaching the current tab's content and are ready to move to the " +
      'next tab. This triggers the next tab\'s visual to start generating in the background — it is ' +
      'not instant. Immediately after calling this, keep speaking naturally (a genuine spoken ' +
      "conclusion or segue for the tab you just finished) until you naturally transition into the " +
      'next tab\'s content. Do not go silent and do not say you are waiting.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'end_session',
    description:
      'End the coaching session now — either all tabs have been covered, or the participant clearly ' +
      'signals they want to stop. This is the primary, authoritative signal that the session is over; ' +
      'call it explicitly rather than relying on your spoken words alone.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
]

// ─── TAB-STUCK BACKSTOP ───────────────────────────────────────────────────────

/**
 * The live-conductor path has no pre-scripted [NAV:tab_id] markers the way the
 * old script-generator/WalkthroughClient path did (see script-generator.ts —
 * markers were embedded inline in the TEACH text at write-time, so the client
 * just parsed and executed a deterministic instruction). Here the model
 * decides live, at speak-time, when a tab is "done" by calling `advance_tab` —
 * confirmed in production that it can simply never do so once past the intro,
 * getting stuck on a tab for the rest of the session.
 *
 * This is the backstop, tracked via live_conductor_tab_turn_count (turns spent
 * on the CURRENT tab, reset by handleAdvanceTab):
 *   - turn >= NUDGE_AT_TURN: inject a stronger "wrap up now" instruction into
 *     the system prompt on the next turn (still model-discretionary)
 *   - turn >= FORCE_AT_TURN: bypass the model and force the advance
 *     server-side — deterministic, mirrors the old NAV-marker system exactly
 *
 * Turn count (not wall-clock time) is the unit here because this bridge only
 * sees discrete conversational turns (no session timer is plumbed through this
 * route) and each tab is scripted for a small, bounded number of exchanges —
 * TEACH + CHECKPOINT + (PROBE) + CONTINUE is ~3-4 turns of canonical pacing
 * per script-generator.ts's segment durations. Thresholds are generous relative
 * to that so normal back-and-forth is never cut off.
 */
export const NUDGE_AT_TURN = 5
export const FORCE_AT_TURN = 8

// ─── STATE SHAPE ──────────────────────────────────────────────────────────────

/**
 * In-memory guard against firing tab-1 visual generation more than once
 * concurrently for the same session while the DB write is still in flight
 * (chat-completion turns can arrive faster than one Supabase round-trip).
 * Not persisted — fine, since a duplicate fire after a cold start is harmless
 * (both calls just regenerate the same visual), but this keeps the common
 * case (several turns landing within the same second on tab 1) to one call.
 */
const tab1GenerationInFlight = new Set<string>()

interface LiveConductorRow {
  live_conductor_content: LiveConductorContent | null
  live_conductor_tab_index: number | null
  user_id: string
}

/**
 * Fetches this user's live-conductor content + current tab index from
 * walkthrough_state/sessions. Returns null if the toggle is on but this
 * session has no live-conductor content available (e.g. it was generated
 * under the old path, or generation hasn't completed yet) — the route falls
 * back to the default path in that case per the spec's branch-point
 * requirement ("toggle on AND this session has live-conductor content
 * available").
 */
export async function getLiveConductorState(
  userId: string,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  userContext?: UserContext
): Promise<{ content: LiveConductorContent; tabIndex: number; tabTurnCount: number } | null> {
  const { data: wsRow } = await supabase
    .from('walkthrough_state')
    .select('live_conductor_tab_index, live_conductor_visual, live_conductor_tab_turn_count, session_id')
    .eq('user_id', userId)
    .single()

  // walkthrough_state doesn't carry a session_id column in all deployments —
  // fall back to looking up the most recent session for this user directly.
  const sessionIdFromState = (wsRow as { session_id?: string } | null)?.session_id ?? null

  let sessionId = sessionIdFromState
  if (!sessionId) {
    const { data: sessionRow } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    sessionId = (sessionRow as { id?: string } | null)?.id ?? null
  }

  if (!sessionId) return null

  const { data: contentRow } = await supabase
    .from('sessions')
    .select('live_conductor_content')
    .eq('id', sessionId)
    .single()

  const content = (contentRow as { live_conductor_content?: LiveConductorContent | null } | null)
    ?.live_conductor_content ?? null

  if (!content || !content.tabs || content.tabs.length === 0) return null

  const tabIndex = (wsRow as { live_conductor_tab_index?: number | null } | null)?.live_conductor_tab_index ?? 0
  const clampedTabIndex = Math.max(0, Math.min(tabIndex, content.tabs.length - 1))

  // ── Tab-1 = session AGENDA (Item 2, 2026-07-04 — Arun's product direction) ──
  // Supersedes the earlier "proactive tab-1 visual generation" LLM fix: tab 1
  // no longer shows per-topic content at all — it shows a deterministic agenda
  // (the list of tabs to be covered this session). No LLM call, no timeout, no
  // race — this is synchronous static data already known the moment
  // getLiveConductorState is called, so it's written on the very first read
  // instead of being kicked off async like tabs 2+ (handleAdvanceTab).
  //
  // Guard: only fire once (existingVisual === null) and not concurrently
  // (tab1GenerationInFlight) — same duplicate-fire guard as before, kept even
  // though this path can't time out, since several turns can still land on tab
  // 1 within the same second before the DB write below has landed.
  const existingVisual = (wsRow as { live_conductor_visual?: LiveConductorVisualData | null } | null)
    ?.live_conductor_visual ?? null

  if (clampedTabIndex === 0 && existingVisual === null && !tab1GenerationInFlight.has(userId)) {
    tab1GenerationInFlight.add(userId)
    const agenda = buildAgendaVisual(content)
    console.log(`[live-conductor-bridge] Writing tab-1 agenda visual for user=${userId}: ${agenda.items.join(' | ')}`)
    void (async () => {
      try {
        await supabase
          .from('walkthrough_state')
          .update({ live_conductor_visual: agenda })
          .eq('user_id', userId)
        console.log(`[live-conductor-bridge] Tab-1 agenda visual write completed for user=${userId}`)
      } catch (err) {
        console.error('[live-conductor-bridge] Failed to write tab-1 agenda visual:', err)
      } finally {
        tab1GenerationInFlight.delete(userId)
      }
    })()
  }

  // ── Tab-stuck backstop: increment the per-tab turn counter ──────────────────
  // Fire-and-forget, same pattern as the tab-1 agenda write above — never
  // blocks the response, and a lost increment on rare failure just delays the
  // nudge/force by one turn, which is harmless.
  const priorTurnCount = (wsRow as { live_conductor_tab_turn_count?: number | null } | null)
    ?.live_conductor_tab_turn_count ?? 0
  const nextTurnCount = priorTurnCount + 1
  void supabase
    .from('walkthrough_state')
    .update({ live_conductor_tab_turn_count: nextTurnCount })
    .eq('user_id', userId)
    .then(undefined, (err: unknown) => {
      console.error('[live-conductor-bridge] Failed to increment tab turn count:', err)
    })

  return { content, tabIndex: clampedTabIndex, tabTurnCount: priorTurnCount }
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

/**
 * Builds the live-conductor system prompt:
 *   common behavior (fixed) + topic background (fixed all session) +
 *   current tab content (swapped, not appended) + user profile.
 */
export function buildLiveConductorSystemPrompt(
  content: LiveConductorContent,
  tabIndex: number,
  userContext: UserContext & { firstName?: string | null },
  tabTurnCount: number = 0
): string {
  const currentTab = content.tabs[tabIndex]
  const isLastTab = tabIndex >= content.tabs.length - 1

  // Tab-stuck backstop (nudge stage) — see NUDGE_AT_TURN/FORCE_AT_TURN above.
  // Escalates the instruction's urgency the longer we've sat on one tab; if it
  // still doesn't work, handleAdvanceTab's caller forces the advance instead of
  // waiting on this instruction indefinitely (see route.ts FORCE_AT_TURN check).
  const nudgeLine =
    tabTurnCount >= NUDGE_AT_TURN
      ? isLastTab
        ? "\n\n⚠️ You have spent significant time on this tab. Wrap up the session now — deliver your closing thought and call `end_session` within your next 1-2 responses."
        : `\n\n⚠️ You have spent significant time on this tab (${tabTurnCount} exchanges). Wrap up now: deliver a brief closing thought and call \`advance_tab\` in your NEXT response — do not start any new sub-topic on this tab.`
      : ''

  return [
    CLIO_LIVE_CONDUCTOR_BEHAVIOR,
    '',
    '─── PARTICIPANT PROFILE ───',
    `Name: ${userContext.firstName ?? '(unknown)'}`,
    `Role: ${userContext.role}`,
    `Industry: ${userContext.industry}`,
    `AI Maturity: ${userContext.maturity}`,
    '',
    '─── TOPIC BACKGROUND (fixed for the whole session — use this to answer any question) ───',
    content.topic_background,
    '',
    `─── CURRENT TAB CONTENT (tab ${tabIndex + 1} of ${content.tabs.length}) ───`,
    formatTabContentForPrompt(currentTab),
    '',
    isLastTab
      ? 'This is the LAST tab. When you finish teaching it, wrap up the session and call `end_session` — do not call `advance_tab` again.'
      : `When you are done teaching this tab, call \`advance_tab\` to move to tab ${tabIndex + 2} of ${content.tabs.length}.`,
    nudgeLine,
  ].join('\n')
}

// ─── advance_tab HANDLING ─────────────────────────────────────────────────────

/**
 * Handles an `advance_tab` tool call: advances and persists the current tab
 * index in walkthrough_state, then kicks off (async, non-blocking) live-visual
 * generation for the new tab. The generation result is written to
 * walkthrough_state.live_conductor_visual once ready (or left null on
 * failure/timeout — WalkthroughClient's poll picks up whichever state exists
 * next tick; there is no blocking wait here).
 *
 * Also called directly by route.ts's tab-stuck backstop (FORCE_AT_TURN) to
 * force an advance the model didn't initiate — same function, same DB writes,
 * only the caller (model tool-call vs. server timeout) differs. This is the
 * deterministic mirror of the old NAV-marker system: when the soft nudge
 * doesn't produce a call within the grace period, the server just advances.
 *
 * @param forced - true when this call is the server-forced backstop rather
 *   than a genuine advance_tab tool call from the model. Only changes the
 *   returned resultText's framing (so a forced call, if it were ever echoed
 *   back to the model, reads as an environment event, not the model's own
 *   decision) — the DB writes and visual-generation kickoff are identical.
 * @returns the tool result text to send back to the model for this turn, and
 *          the new tab (or null if already on the last tab).
 */
export async function handleAdvanceTab(
  userId: string,
  content: LiveConductorContent,
  currentTabIndex: number,
  userContext: UserContext,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  forced: boolean = false
): Promise<{ resultText: string; newTab: LiveConductorTab | null; isLastTab: boolean }> {
  const isLastTab = currentTabIndex >= content.tabs.length - 1
  if (isLastTab) {
    return { resultText: 'This is already the last tab — call end_session when ready to finish.', newTab: null, isLastTab: true }
  }

  const newIndex = currentTabIndex + 1
  const newTab = content.tabs[newIndex]

  // Persist the new tab index immediately so a concurrent poll / reconnect
  // reads the right tab even before visual generation finishes. Also resets
  // the tab-stuck turn counter (see NUDGE_AT_TURN/FORCE_AT_TURN) — whether
  // this advance was model-initiated or server-forced, the new tab starts
  // fresh at turn 0.
  await supabase
    .from('walkthrough_state')
    .update({ live_conductor_tab_index: newIndex, live_conductor_visual: null, live_conductor_tab_turn_count: 0 })
    .eq('user_id', userId)

  // Fire-and-forget: generate the next tab's visual asynchronously. Never
  // awaited by the caller — the model's own conclusion/segue speech (per the
  // prompt in live-conductor-prompt.ts) is what covers this latency, not a
  // blocked tool response.
  // 2026-07-04 — now a per-attempt timeout (retried up to 10x internally,
  // ~4s per attempt, worst case ~40s) rather than a single hard 10s cutoff.
  // See lib/content/live-conductor-visual.ts for the retry loop.
  void generateLiveVisualWithTimeout(newTab, userContext, LIVE_CONDUCTOR_VISUAL_ATTEMPT_TIMEOUT_MS)
    .then(async (visual: LiveConductorVisualData | null) => {
      try {
        await supabase
          .from('walkthrough_state')
          .update({ live_conductor_visual: visual })
          .eq('user_id', userId)
      } catch (err) {
        console.error('[live-conductor-bridge] Failed to write live_conductor_visual:', err)
      }
    })
    .catch((err: unknown) => {
      // generateLiveVisualWithTimeout already catches internally, but guard the
      // whole async chain so a rejection can never surface as an unhandled
      // promise rejection in the route handler.
      console.error('[live-conductor-bridge] advance_tab visual generation chain failed:', err)
    })

  return {
    resultText: forced
      ? `[System-forced advance — you spent too long on the previous tab.] Now on tab ${newIndex + 1} of ` +
        `${content.tabs.length}: "${newTab.subtopic_title}". Briefly and naturally bridge from the previous ` +
        `topic into this one, then begin teaching its content.`
      : `Advanced to tab ${newIndex + 1} of ${content.tabs.length}: "${newTab.subtopic_title}". ` +
        `Its visual is generating in the background — keep speaking naturally (your conclusion/segue for ` +
        `the previous tab) until it's ready, then move into this tab's content.`,
    newTab,
    isLastTab: newIndex >= content.tabs.length - 1,
  }
}
