/**
 * LIVE-01 — client-side (browser) module for the live conductor path, used by
 * app/walkthrough/[userId]/WalkthroughClient.tsx.
 *
 * Per the spec's toggle-isolation requirement, this holds its OWN state (not
 * WalkthroughClient's shared sectionsRef / trainingScriptsRef / etc.) and is
 * only invoked when the toggle is on. WalkthroughClient calls into this module
 * conditionally at a small number of well-defined points (registering the
 * `advance_tab` tool handler, and reading the live visual out of the polled
 * walkthrough_state) rather than branching inline inside its existing
 * connect()/effect logic.
 */

import type { LiveConductorVisualData } from './live-conductor-visual'

/** Mirrors the toggle check in lib/voice/live-conductor-bridge.ts (server-side
 *  copy) — duplicated intentionally rather than imported, since this file runs
 *  in the browser bundle and must not pull in any server-only module (the
 *  bridge file imports createSupabaseAdminClient, which is server-only). */
export function isLiveConductorEnabledClient(): boolean {
  return process.env.NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED === 'true'
}

/**
 * Shape of the live-conductor-relevant slice of walkthrough_state, as returned
 * by the existing /api/walkthrough-state/[userId] poll route (additive columns
 * from migration 054_live_conductor_state.sql — see that file for the JSONB
 * shape documentation).
 */
export interface LiveConductorPollState {
  live_conductor_tab_index?: number | null
  live_conductor_visual?: LiveConductorVisualData | null
}

/**
 * Own, isolated ref-like state container for the live conductor path. Created
 * once per WalkthroughClient mount (only when the toggle is on) and threaded
 * through the tool handler / render logic — deliberately NOT the same object
 * as any of WalkthroughClient's existing refs.
 */
export interface LiveConductorClientState {
  tabIndex: number
  visual: LiveConductorVisualData | null
}

export function createLiveConductorClientState(): LiveConductorClientState {
  return { tabIndex: 0, visual: null }
}

/**
 * Applies a freshly-polled walkthrough_state payload onto the live-conductor
 * client state in place. Called from WalkthroughClient's existing poll loop
 * behind an `if (isLiveConductorEnabledClient())` guard — when the toggle is
 * off this is never called and the object is never touched.
 */
export function applyLiveConductorPoll(
  state: LiveConductorClientState,
  data: LiveConductorPollState
): void {
  if (typeof data.live_conductor_tab_index === 'number') {
    state.tabIndex = data.live_conductor_tab_index
  }
  if (data.live_conductor_visual !== undefined) {
    state.visual = data.live_conductor_visual
  }
}

/**
 * Builds the `advance_tab` tool handler registered with the voice adapter
 * (HumeAdapter's `tools` config map — see lib/voice/hume-adapter.ts, which
 * dispatches to whatever handler map is passed in, provider-agnostic).
 *
 * ONDEMAND-02 — this handler now actually reaches server-side generation: it
 * POSTs to /api/live-conductor/advance-tab with the session's userId, which
 * resolves live-conductor state and calls the existing handleAdvanceTab()
 * (lib/voice/live-conductor-bridge.ts) — the same logic already used by the
 * Hume Custom-LLM path. The route persists the new tab index + visual
 * to walkthrough_state directly, and this client's poll loop picks up the
 * result via applyLiveConductorPoll above; no client-side state mutation is
 * needed here beyond returning the tool-call result string.
 *
 * Never throws — on any network failure or non-200 response, falls back to
 * the same acknowledgement string the stub previously always returned, so a
 * transport failure never crashes the live voice session.
 */
export function createAdvanceTabToolHandler(
  userId: string
): (params: Record<string, unknown>) => Promise<string> {
  return async () => {
    try {
      const res = await fetch('/api/live-conductor/advance-tab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) {
        console.error('[live-conductor-client] advance-tab route returned', res.status)
        return 'Acknowledged — advancing to next tab.'
      }
      const data = (await res.json()) as { resultText?: string }
      return data.resultText ?? 'Acknowledged — advancing to next tab.'
    } catch (err) {
      console.error('[live-conductor-client] advance-tab request failed:', err)
      return 'Acknowledged — advancing to next tab.'
    }
  }
}
