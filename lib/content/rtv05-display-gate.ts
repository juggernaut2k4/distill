/**
 * RTV-05 (Section 4.2) — the session-level display-authority gate.
 *
 * Factored into its own module (rather than left inline in, or exported
 * from, app/api/hume-native/provision-config/route.ts) purely so this
 * phase's single highest-risk decision is directly unit-testable in
 * isolation (Section 4.3 point 2 / tests/unit/rtv05-display-gate.test.ts).
 * Next.js App Router route files may only export the recognized HTTP method
 * handlers and a small fixed set of config values — an arbitrary named
 * export there fails Next's own route type-checking — so this logic lives
 * here instead and provision-config/route.ts imports and calls it. This is
 * purely a testability/build-constraint factoring; the logic itself is
 * exactly what the requirement doc's Section 4.2 pseudocode specifies, no
 * behavior change.
 *
 * "First connect" vs "reconnect" is determined by whether
 * `persistedRtv05DisplayActive` is null (never computed) vs already
 * true/false (computed on a prior connect for this same session) — mirrors
 * exactly how `sessions.rtv03_tracking_enabled` is persisted once and read
 * on any subsequent request for the same session row.
 *
 * On a reconnect, the persisted value is reused verbatim — never
 * recomputed, even if `checkApproval` would now return a different answer
 * for some template (e.g. Arun edited its status in template_library while
 * a call was in progress). This is the phase's central race-proofing
 * guarantee (Section 4.2): the decision is invariant for a session's entire
 * lifetime.
 */
export async function computeRtv05DisplayGate(params: {
  rtv05EnvToggleOn: boolean
  rtv03Active: boolean
  persistedRtv05DisplayActive: boolean | null
  nonBookendTypes: string[]
  checkApproval: (templateName: string) => Promise<boolean>
}): Promise<{ isFirstConnect: boolean; displayActive: boolean }> {
  const { rtv05EnvToggleOn, rtv03Active, persistedRtv05DisplayActive, nonBookendTypes, checkApproval } = params
  const isFirstConnect = persistedRtv05DisplayActive === null || persistedRtv05DisplayActive === undefined

  if (!isFirstConnect) {
    // Reconnect (or any later connect) for a session that already computed
    // this decision — reuse verbatim, never recompute.
    return { isFirstConnect, displayActive: persistedRtv05DisplayActive === true }
  }

  if (!rtv05EnvToggleOn || !rtv03Active) {
    return { isFirstConnect, displayActive: false }
  }

  // Every non-bookend topic in this session must individually be
  // isTemplateApprovedForProduction() === true against the live
  // template_library table, checked fresh for this connect.
  try {
    const approvals = await Promise.all(nonBookendTypes.map((t) => checkApproval(t)))
    return { isFirstConnect, displayActive: approvals.length > 0 && approvals.every((a) => a === true) }
  } catch (err) {
    // Section 8 — a failure checking approval status is treated as "not
    // approved" for the whole gate (fail closed, matching
    // isTemplateApprovedForProduction()'s own fail-closed behavior). Connect
    // proceeds unaffected — a tracker/display failure must never block
    // session connect.
    console.error('[rtv05-display-gate] Gate computation failed, resolving false (fail closed):', err instanceof Error ? err.message : err)
    return { isFirstConnect, displayActive: false }
  }
}
