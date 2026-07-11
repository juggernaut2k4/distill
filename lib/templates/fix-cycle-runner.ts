/**
 * TMPL-01 — Fix-cycle business logic (requirement doc Section 4.2/6:
 * .claude/agents/clio/requirement-docs/TMPL-01-automated-feedback-fix-loop.md).
 *
 * Extracted out of the Inngest wrapper (inngest/template-fix-generator.ts) so
 * it can be unit-tested directly by calling runFixCycle(). This codebase has
 * no harness for driving an Inngest step function's `step.run` machinery in a
 * test (see tests/unit/voice-gap-watchdog.test.ts's own note on this) — every
 * Inngest job here that needs real behavioral coverage extracts its logic
 * into a plain, directly-callable function and unit-tests that instead of the
 * `inngest.createFunction(...)` wrapper.
 *
 * Runs up to 5 automatic attempts per cycle (Section 4.2), each validated
 * against the target template's fixed style-override slot allowlist (Layer 2,
 * styleOverrideSlots.ts) before ever being written to the row. `status` is
 * NEVER touched on a failed cycle — it must remain exactly whatever it
 * already was (`changes_requested`) — this is the single most important
 * correctness property of this feature (Section 6/7).
 */

import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateStyleFix, type PriorFixAttempt, type StyleFixOutcome } from './fix-generator'
import {
  isFixLoopTemplate,
  validateStyleOverrides,
  type StyleOverrides,
} from './styleOverrideSlots'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

const MAX_AUTOMATIC_ATTEMPTS = 5

const MALFORMED_REASON = 'The model returned malformed or unparsable JSON output.'

export interface FixRequestedEventData {
  templateName: string
  notes: string
  fixCycleId: string
  /** Set only by POST .../nudge's force_retrigger action (Section 4.3/6). */
  forceRetrigger?: boolean
}

export type FixCycleOutcome = 'succeeded' | 'failed_terminal' | 'stale_discarded' | 'not_applicable'

export interface FixCycleResult {
  outcome: FixCycleOutcome
  attemptsRun: number
}

// ─── LOGGING / PROGRESS HELPERS ────────────────────────────────────────────
//
// Section 3 (build task) / Section 6 (spec): "Write a template_fix_log row at
// every step ... and update fix_last_activity_at each time, so the progress
// view always has fresh data to show." These writes are UNGUARDED by the
// fix_cycle_id staleness check below — only the FINAL success/failure write
// to template_library's status/fix_state needs that guard. Attempt-level log
// rows are explicitly fine to write even from a since-superseded invocation:
// they are scoped to their own fix_cycle_id, and the progress view only
// treats the row's CURRENT fix_cycle_id as authoritative when deciding what
// counts as "the current cycle" vs. "previous cycles."

async function logFixEvent(
  supabase: SupabaseAdminClient,
  templateName: string,
  fixCycleId: string,
  entry: { attemptNumber: number | null; eventType: string; message: string }
): Promise<void> {
  const nowIso = new Date().toISOString()

  await supabase.from('template_fix_log').insert({
    template_name: templateName,
    fix_cycle_id: fixCycleId,
    attempt_number: entry.attemptNumber,
    event_type: entry.eventType,
    message: entry.message,
  })

  await supabase
    .from('template_library')
    .update({ fix_last_activity_at: nowIso, updated_at: nowIso })
    .eq('template_name', templateName)
}

async function bumpAttemptCount(
  supabase: SupabaseAdminClient,
  templateName: string,
  attemptNumber: number
): Promise<void> {
  await supabase
    .from('template_library')
    .update({ fix_attempt_count: attemptNumber })
    .eq('template_name', templateName)
}

/**
 * Guards the FINAL write of the whole cycle (success or terminal failure)
 * against a stale/superseded invocation: re-reads the row's CURRENT
 * fix_cycle_id and compares it to the one this invocation started with. If a
 * force-retrigger has since replaced it with a newer cycle, this invocation's
 * result is discarded entirely — it must never overwrite a fresher cycle's
 * outcome. Returns whether the write actually happened.
 */
async function finalizeIfCurrentCycle(
  supabase: SupabaseAdminClient,
  templateName: string,
  fixCycleId: string,
  updatePayload: Record<string, unknown>
): Promise<boolean> {
  const { data: current, error: fetchError } = await supabase
    .from('template_library')
    .select('fix_cycle_id')
    .eq('template_name', templateName)
    .maybeSingle()

  if (fetchError || !current || (current as { fix_cycle_id: string | null }).fix_cycle_id !== fixCycleId) {
    console.warn(
      `[template-fix-generator] Discarding result for "${templateName}" — this invocation's cycle (${fixCycleId}) has been superseded by a newer one (${(current as { fix_cycle_id?: string })?.fix_cycle_id ?? 'unknown'}).`
    )
    return false
  }

  const { error: updateError } = await supabase
    .from('template_library')
    .update({ ...updatePayload, updated_at: new Date().toISOString() })
    .eq('template_name', templateName)

  if (updateError) {
    console.error(`[template-fix-generator] Failed to write final result for "${templateName}"`, updateError)
    return false
  }

  return true
}

function apiErrorReason(err: unknown): string {
  return `Anthropic API error: ${err instanceof Error ? err.message : String(err)}`
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

/**
 * Runs one fix cycle for `data.templateName`, triggered by the
 * `clio/template.fix_requested` event (fired by either the PATCH
 * request_changes action or the nudge force_retrigger action).
 *
 * Automatic-cycle vs. force-retrigger attempt budget (Section 4.2):
 * the automatic cycle (triggered by "Request changes") runs up to 5
 * unattended attempts. A manual force-retrigger is "explicitly uncapped"
 * precisely BECAUSE it is a single, deliberate action each time Arun takes it
 * — the spec's own words: "Each force-retrigger simply runs one more attempt
 * (attempt 6, 7, ... as needed)." Running another silent 5-attempt loop on
 * force-retrigger would reintroduce exactly the unattended-cost risk the cap
 * exists to prevent, so a force-retrigger invocation runs exactly ONE attempt
 * here, numbered by whatever fix_attempt_count the nudge route already
 * incremented to (this function never re-derives or resets that count for a
 * force-retrigger — it only continues logging/bumping fix_last_activity_at
 * against it).
 */
export async function runFixCycle(data: FixRequestedEventData): Promise<FixCycleResult> {
  const { templateName, notes, fixCycleId, forceRetrigger = false } = data
  const supabase = createSupabaseAdminClient()

  if (!isFixLoopTemplate(templateName)) {
    // Structurally shouldn't happen — only Heatmap/Overlay ever fire this
    // event (isFixLoopTemplate gates both the PATCH and nudge routes) — but
    // never trust the event payload blindly (Section 4.1: defense in depth).
    console.error(
      `[template-fix-generator] Received clio/template.fix_requested for "${templateName}", which is not a fix-loop template (Heatmap/Overlay only). Ignoring.`
    )
    return { outcome: 'not_applicable', attemptsRun: 0 }
  }

  const { data: row, error: fetchError } = await supabase
    .from('template_library')
    .select('sample_data, style_overrides, fix_attempt_count')
    .eq('template_name', templateName)
    .maybeSingle()

  if (fetchError || !row) {
    console.error(`[template-fix-generator] Could not fetch template_library row for "${templateName}"`, fetchError)
    return { outcome: 'not_applicable', attemptsRun: 0 }
  }

  const typedRow = row as { sample_data: unknown; style_overrides: StyleOverrides | null; fix_attempt_count: number | null }
  const currentOverrides: StyleOverrides = typedRow.style_overrides ?? {}
  const sampleData = typedRow.sample_data
  const startingAttemptCount = typedRow.fix_attempt_count ?? 0

  const attemptsThisInvocation = forceRetrigger ? 1 : MAX_AUTOMATIC_ATTEMPTS

  const priorAttempts: PriorFixAttempt[] = []
  let attemptsRun = 0

  for (let i = 0; i < attemptsThisInvocation; i++) {
    const attemptNumber = forceRetrigger ? startingAttemptCount : startingAttemptCount + i + 1
    const isLastAttemptThisInvocation = i === attemptsThisInvocation - 1
    const attemptLabel = forceRetrigger
      ? `Force-retriggered attempt ${attemptNumber}`
      : `Attempt ${attemptNumber} of ${MAX_AUTOMATIC_ATTEMPTS}`

    attemptsRun++

    await logFixEvent(supabase, templateName, fixCycleId, {
      attemptNumber,
      eventType: 'attempt_started',
      message: `${attemptLabel} started`,
    })
    await bumpAttemptCount(supabase, templateName, attemptNumber)

    let outcome: StyleFixOutcome
    try {
      outcome = await generateStyleFix(
        templateName,
        sampleData,
        currentOverrides,
        notes,
        priorAttempts
      )
    } catch (err) {
      // Section 8: an Anthropic API failure is treated as a failed attempt
      // like any validation failure — logged, retried, counts toward the cap.
      const reason = apiErrorReason(err)
      await logFixEvent(supabase, templateName, fixCycleId, {
        attemptNumber,
        eventType: 'attempt_failed',
        message: `${attemptLabel} failed — ${reason}${isLastAttemptThisInvocation ? '' : ' Retrying.'}`,
      })
      priorAttempts.push({ proposedOverrides: null, rejectionReason: reason })
      continue
    }

    if (outcome.kind === 'out_of_scope') {
      // Immediate terminal case (Section 4.2/8) — does NOT consume remaining
      // attempt budget: stop right here regardless of how many attempts were
      // still available in this invocation.
      const finished = await finalizeIfCurrentCycle(supabase, templateName, fixCycleId, {
        fix_state: 'failed',
        fix_failure_reason: outcome.reason,
      })
      await logFixEvent(supabase, templateName, fixCycleId, {
        attemptNumber,
        eventType: 'fix_failed_terminal',
        message: `Fix cycle failed — this feedback cannot be expressed as an automated style fix: ${outcome.reason}`,
      })
      return { outcome: finished ? 'failed_terminal' : 'stale_discarded', attemptsRun }
    }

    if (outcome.kind === 'malformed') {
      await logFixEvent(supabase, templateName, fixCycleId, {
        attemptNumber,
        eventType: 'attempt_failed',
        message: `${attemptLabel} failed — ${MALFORMED_REASON}${isLastAttemptThisInvocation ? '' : ' Retrying.'}`,
      })
      priorAttempts.push({ proposedOverrides: null, rejectionReason: MALFORMED_REASON })
      continue
    }

    // outcome.kind === 'proposed' — run it through Layer 2 (all-or-nothing).
    const validation = validateStyleOverrides(templateName, outcome.overrides)

    if (validation.valid) {
      const merged = { ...currentOverrides, ...validation.overrides }
      const finished = await finalizeIfCurrentCycle(supabase, templateName, fixCycleId, {
        status: 'pending_review',
        fix_state: 'none',
        style_overrides: merged,
        fix_changes_summary: outcome.summary,
        fix_failure_reason: null,
      })
      await logFixEvent(supabase, templateName, fixCycleId, {
        attemptNumber,
        eventType: 'fix_succeeded',
        message: `${attemptLabel} succeeded: ${outcome.summary}`,
      })
      return { outcome: finished ? 'succeeded' : 'stale_discarded', attemptsRun }
    }

    // Invalid — logged via validation_result (acceptance test: "a
    // validation_result log entry records the specific reason, and a new
    // attempt starts").
    await logFixEvent(supabase, templateName, fixCycleId, {
      attemptNumber,
      eventType: 'validation_result',
      message: `${attemptLabel} failed validation — ${validation.reason}${isLastAttemptThisInvocation ? '' : ' Retrying.'}`,
    })
    priorAttempts.push({ proposedOverrides: outcome.overrides, rejectionReason: validation.reason })
  }

  // Exhausted every attempt available to this invocation without success or
  // an immediate terminal case. `status` is NEVER touched here — it must stay
  // exactly `changes_requested` (Section 6: "status stays changes_requested
  // throughout"). This is the single most important correctness property of
  // this feature — verified explicitly in tests/unit/template-fix-generator.test.ts.
  const lastReason = priorAttempts[priorAttempts.length - 1]?.rejectionReason ?? 'Unknown failure.'
  const exhaustionReason = forceRetrigger
    ? `Force-retriggered attempt failed. ${lastReason}`
    : `Fix cycle failed after ${MAX_AUTOMATIC_ATTEMPTS} attempts. ${lastReason}`

  const finished = await finalizeIfCurrentCycle(supabase, templateName, fixCycleId, {
    fix_state: 'failed',
    fix_failure_reason: exhaustionReason,
  })

  await logFixEvent(supabase, templateName, fixCycleId, {
    attemptNumber: null,
    eventType: 'fix_failed_terminal',
    message: forceRetrigger
      ? `Force-retriggered attempt failed. Needs Arun's attention or a manual design change.`
      : `Fix cycle failed after ${MAX_AUTOMATIC_ATTEMPTS} attempts. Needs Arun's attention or a manual design change.`,
  })

  return { outcome: finished ? 'failed_terminal' : 'stale_discarded', attemptsRun }
}
