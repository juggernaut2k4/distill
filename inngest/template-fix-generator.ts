import { inngest } from './client'
import { runFixCycle, type FixRequestedEventData } from '@/lib/templates/fix-cycle-runner'
import { sendAdminAlert } from '@/lib/delivery/email'

/**
 * TMPL-01 — Automated template feedback → LLM fix → re-review loop.
 * (requirement doc: .claude/agents/clio/requirement-docs/
 * TMPL-01-automated-feedback-fix-loop.md, Section 4.2/6 — APPROVED.)
 *
 * Triggered by 'clio/template.fix_requested', fired by:
 *   - PATCH /api/templates/library/[templateName] (action: 'request_changes',
 *     Heatmap/Overlay only) — the normal automatic cycle, up to 5 attempts.
 *   - POST /api/templates/library/[templateName]/nudge (action:
 *     'force_retrigger') — Arun's manual, uncapped escape valve. See
 *     lib/templates/fix-cycle-runner.ts for why this runs a single attempt
 *     per invocation rather than another unattended 5-attempt loop.
 *
 * Inngest-level retries are explicitly disabled (retries: 0) — this function
 * owns its own bounded retry internally (Section 4.2/6). Letting Inngest's own
 * platform retry ALSO fire on top of that would either multiply attempts
 * beyond the 5-attempt cap, or re-run a stale invocation that a force-retrigger
 * has already superseded. runFixCycle()'s own fix_cycle_id staleness guard
 * (re-checked immediately before the final success/failure write) is defense
 * in depth for that same class of problem, not a substitute for retries: 0.
 *
 * All business logic lives in lib/templates/fix-cycle-runner.ts's
 * runFixCycle() — this file is a thin Inngest wrapper only, matching this
 * codebase's convention (see inngest/voice-gap-watchdog.ts) of extracting
 * logic into a plain, directly-testable function since there is no harness
 * here for driving an Inngest step function's `step.run` machinery in tests.
 */
export const templateFixGenerator = inngest.createFunction(
  {
    id: 'template-fix-generator',
    name: 'Template Automated Fix Cycle',
    retries: 0,
    triggers: [{ event: 'clio/template.fix_requested' }],
    onFailure: async ({
      error,
      event,
    }: {
      error: Error
      event: { data: FixRequestedEventData }
    }) => {
      try {
        await sendAdminAlert({
          subject: `template-fix-generator failed — ${event.data?.templateName ?? 'unknown template'}`,
          body: `The automated template fix-cycle Inngest job threw an uncaught error.\n\nError: ${error.message}`,
          context: {
            templateName: event.data?.templateName,
            fixCycleId: event.data?.fixCycleId,
            forceRetrigger: event.data?.forceRetrigger,
            errorStack: error.stack,
          },
        })
      } catch (alertErr) {
        // Never let alert failure mask the original error
        console.error('[template-fix-generator:onFailure] Failed to send admin alert:', alertErr)
      }
    },
  },
  async ({ event, step }: { event: { data: FixRequestedEventData }; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const data = event.data

    const result = await step.run('run-fix-cycle', () => runFixCycle(data))

    console.log(
      `[template-fix-generator] "${data.templateName}" cycle ${data.fixCycleId} finished: ${result.outcome} (${result.attemptsRun} attempt(s) run)`
    )

    return result
  }
)
