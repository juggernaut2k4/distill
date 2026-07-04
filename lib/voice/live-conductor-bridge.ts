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
import { CLIO_LIVE_CONDUCTOR_BEHAVIOR, LIVE_CONDUCTOR_TRANSITION_BUFFER_MS } from '@/lib/content/live-conductor-prompt'
import { formatTabContentForPrompt, type LiveConductorContent, type LiveConductorTab } from '@/lib/content/live-conductor-content'
import { generateLiveVisualWithTimeout, type LiveConductorVisualData } from '@/lib/content/live-conductor-visual'
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
): Promise<{ content: LiveConductorContent; tabIndex: number } | null> {
  const { data: wsRow } = await supabase
    .from('walkthrough_state')
    .select('live_conductor_tab_index, live_conductor_visual, session_id')
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

  // ── Proactive tab-1 visual generation (LIVE-01 gap fix) ──────────────────
  // Normally a tab's visual is kicked off by handleAdvanceTab when the model
  // calls advance_tab to move INTO that tab. Tab 1 (index 0) has no preceding
  // advance_tab call — nothing ever generates its visual, so the first tab of
  // every session showed LiveConductorVisual's empty-state fallback forever.
  //
  // Guard: only fire when we're truly at session start (tabIndex 0 AND
  // live_conductor_visual is still null), and not already generating for this
  // user (tab1GenerationInFlight covers the case where several turns land
  // within the same second, before the DB write below has landed). Once the
  // write completes, live_conductor_visual is non-null on success, so
  // subsequent turns skip this block via the existingVisual check alone; on
  // failure/timeout it's written back as null and the next turn will retry —
  // that self-heals a transient generation failure instead of leaving tab 1
  // permanently stuck on the empty-state fallback.
  const existingVisual = (wsRow as { live_conductor_visual?: LiveConductorVisualData | null } | null)
    ?.live_conductor_visual ?? null

  if (clampedTabIndex === 0 && existingVisual === null && userContext && !tab1GenerationInFlight.has(userId)) {
    const firstTab = content.tabs[0]
    tab1GenerationInFlight.add(userId)
    // Fire-and-forget, mirroring handleAdvanceTab's pattern exactly: never
    // awaited here, never blocks the caller's turn/response.
    void generateLiveVisualWithTimeout(firstTab, userContext, LIVE_CONDUCTOR_TRANSITION_BUFFER_MS)
      .then(async (visual: LiveConductorVisualData | null) => {
        try {
          await supabase
            .from('walkthrough_state')
            .update({ live_conductor_visual: visual })
            .eq('user_id', userId)
        } catch (err) {
          console.error('[live-conductor-bridge] Failed to write tab-1 live_conductor_visual:', err)
        }
      })
      .catch((err: unknown) => {
        console.error('[live-conductor-bridge] tab-1 visual generation chain failed:', err)
      })
      .finally(() => {
        tab1GenerationInFlight.delete(userId)
      })
  }

  return { content, tabIndex: clampedTabIndex }
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
  userContext: UserContext & { firstName?: string | null }
): string {
  const currentTab = content.tabs[tabIndex]
  const isLastTab = tabIndex >= content.tabs.length - 1

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
 * @returns the tool result text to send back to the model for this turn, and
 *          the new tab (or null if already on the last tab).
 */
export async function handleAdvanceTab(
  userId: string,
  content: LiveConductorContent,
  currentTabIndex: number,
  userContext: UserContext,
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<{ resultText: string; newTab: LiveConductorTab | null; isLastTab: boolean }> {
  const isLastTab = currentTabIndex >= content.tabs.length - 1
  if (isLastTab) {
    return { resultText: 'This is already the last tab — call end_session when ready to finish.', newTab: null, isLastTab: true }
  }

  const newIndex = currentTabIndex + 1
  const newTab = content.tabs[newIndex]

  // Persist the new tab index immediately so a concurrent poll / reconnect
  // reads the right tab even before visual generation finishes.
  await supabase
    .from('walkthrough_state')
    .update({ live_conductor_tab_index: newIndex, live_conductor_visual: null })
    .eq('user_id', userId)

  // Fire-and-forget: generate the next tab's visual asynchronously. Never
  // awaited by the caller — the model's own conclusion/segue speech (per the
  // prompt in live-conductor-prompt.ts) is what covers this latency, not a
  // blocked tool response.
  void generateLiveVisualWithTimeout(newTab, userContext, LIVE_CONDUCTOR_TRANSITION_BUFFER_MS)
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
    resultText:
      `Advanced to tab ${newIndex + 1} of ${content.tabs.length}: "${newTab.subtopic_title}". ` +
      `Its visual is generating in the background — keep speaking naturally (your conclusion/segue for ` +
      `the previous tab) until it's ready, then move into this tab's content.`,
    newTab,
    isLastTab: newIndex >= content.tabs.length - 1,
  }
}
