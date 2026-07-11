import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TMPL-01 — runFixCycle() (lib/templates/fix-cycle-runner.ts), the business
 * logic behind inngest/template-fix-generator.ts.
 *
 * This codebase has no harness for driving an Inngest step function's
 * `step.run` machinery directly in a test (see tests/unit/voice-gap-watchdog.test.ts's
 * own note on this) — so, matching that established convention, this file
 * tests the extracted plain function (runFixCycle) instead of the
 * `inngest.createFunction(...)` wrapper. `generateStyleFix` (the LLM call) and
 * the Supabase client are mocked; `validateStyleOverrides` from
 * styleOverrideSlots.ts is NOT mocked — real Layer-2 validation runs against
 * Heatmap's actual slot allowlist so these tests exercise genuine validation
 * behavior, not a stub.
 */

interface MockRow {
  sample_data: unknown
  style_overrides: Record<string, unknown>
  fix_attempt_count: number
  fix_cycle_id: string | null
  status: string
  fix_state: string
  fix_failure_reason: string | null
  fix_changes_summary: string | null
}

let mockRow: MockRow
let fixLogInserts: Array<Record<string, unknown>>
let libraryUpdates: Array<Record<string, unknown>>

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'template_library') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: { ...mockRow }, error: null })),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            libraryUpdates.push(payload)
            Object.assign(mockRow, payload)
            return {
              eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
            }
          }),
        }
      }
      if (table === 'template_fix_log') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            fixLogInserts.push(row)
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      throw new Error(`Unexpected table in mock: ${table}`)
    }),
  })),
}))

const generateStyleFixMock = vi.fn()

vi.mock('@/lib/templates/fix-generator', () => ({
  generateStyleFix: (...args: unknown[]) => generateStyleFixMock(...args),
}))

import { runFixCycle } from '@/lib/templates/fix-cycle-runner'

const VALID_OVERRIDES = { 'cell-gap': 6, 'intensity-2': '#06B6D4' }
const INVALID_UNKNOWN_KEY = { 'cell-padding': 4 } // not an allowed Heatmap slot

function baseData(overrides: Partial<{ notes: string; fixCycleId: string; forceRetrigger: boolean }> = {}) {
  return {
    templateName: 'Heatmap',
    notes: 'Cells feel too dense — more breathing room.',
    fixCycleId: 'cycle-1',
    ...overrides,
  }
}

describe('runFixCycle (TMPL-01 automated fix loop)', () => {
  beforeEach(() => {
    mockRow = {
      sample_data: { title: 'Where AI Maturity Stands' },
      style_overrides: {},
      fix_attempt_count: 0,
      fix_cycle_id: 'cycle-1',
      status: 'changes_requested',
      fix_state: 'generating',
      fix_failure_reason: null,
      fix_changes_summary: null,
    }
    fixLogInserts = []
    libraryUpdates = []
    generateStyleFixMock.mockReset()
  })

  it('succeeds on attempt 1: sets status=pending_review and fix_state=none', async () => {
    generateStyleFixMock.mockResolvedValueOnce({
      kind: 'proposed',
      overrides: VALID_OVERRIDES,
      summary: 'Increased cell gap and reinforced mid-intensity color.',
    })

    const result = await runFixCycle(baseData())

    expect(result).toEqual({ outcome: 'succeeded', attemptsRun: 1 })
    expect(generateStyleFixMock).toHaveBeenCalledTimes(1)
    expect(mockRow.status).toBe('pending_review')
    expect(mockRow.fix_state).toBe('none')
    expect(mockRow.fix_failure_reason).toBeNull()
    expect(mockRow.style_overrides).toMatchObject(VALID_OVERRIDES)
    expect(mockRow.fix_changes_summary).toBe('Increased cell gap and reinforced mid-intensity color.')

    expect(fixLogInserts.some((r) => r.event_type === 'fix_succeeded')).toBe(true)
  })

  it('invalid on attempts 1-4, valid on attempt 5: still succeeds using the full retry budget', async () => {
    for (let i = 0; i < 4; i++) {
      generateStyleFixMock.mockResolvedValueOnce({
        kind: 'proposed',
        overrides: INVALID_UNKNOWN_KEY,
        summary: 'Attempted a fix.',
      })
    }
    generateStyleFixMock.mockResolvedValueOnce({
      kind: 'proposed',
      overrides: VALID_OVERRIDES,
      summary: 'Finally valid.',
    })

    const result = await runFixCycle(baseData())

    expect(result).toEqual({ outcome: 'succeeded', attemptsRun: 5 })
    expect(generateStyleFixMock).toHaveBeenCalledTimes(5)
    expect(mockRow.status).toBe('pending_review')
    expect(mockRow.fix_state).toBe('none')

    // Each retry must have been informed of why the prior attempt(s) failed
    // (Section 4.2: "what each retry sees").
    const call5Args = generateStyleFixMock.mock.calls[4]
    const priorAttemptsSeenOnCall5 = call5Args[4] as Array<{ rejectionReason: string }>
    expect(priorAttemptsSeenOnCall5.length).toBe(4)
    expect(priorAttemptsSeenOnCall5[0].rejectionReason).toMatch(/cell-padding/)

    const validationResults = fixLogInserts.filter((r) => r.event_type === 'validation_result')
    expect(validationResults.length).toBe(4)
  })

  it('invalid on all 5 attempts: sets fix_state=failed and status is left untouched', async () => {
    for (let i = 0; i < 5; i++) {
      generateStyleFixMock.mockResolvedValueOnce({
        kind: 'proposed',
        overrides: INVALID_UNKNOWN_KEY,
        summary: 'Attempted a fix.',
      })
    }

    const result = await runFixCycle(baseData())

    expect(result).toEqual({ outcome: 'failed_terminal', attemptsRun: 5 })
    expect(generateStyleFixMock).toHaveBeenCalledTimes(5)

    // THE single most important correctness property: status must remain
    // exactly what it already was — never silently become pending_review.
    expect(mockRow.status).toBe('changes_requested')
    expect(mockRow.fix_state).toBe('failed')
    expect(mockRow.fix_failure_reason).toBeTruthy()
    expect(mockRow.fix_failure_reason).toMatch(/cell-padding/)

    // Confirm no update payload anywhere in the whole run ever included a
    // `status` key — the failure-path update must never even attempt to set it.
    for (const update of libraryUpdates) {
      if ('fix_state' in update && update.fix_state === 'failed') {
        expect(update).not.toHaveProperty('status')
      }
    }

    expect(fixLogInserts.some((r) => r.event_type === 'fix_failed_terminal')).toBe(true)
  })

  it('reports "out of scope" on attempt 1: terminates immediately without consuming remaining attempts', async () => {
    generateStyleFixMock.mockResolvedValueOnce({
      kind: 'out_of_scope',
      reason: 'This implies adding a new zone, a layout change, not a styling change.',
    })

    const result = await runFixCycle(baseData())

    expect(result).toEqual({ outcome: 'failed_terminal', attemptsRun: 1 })
    expect(generateStyleFixMock).toHaveBeenCalledTimes(1) // no further attempts consumed

    expect(mockRow.status).toBe('changes_requested') // untouched
    expect(mockRow.fix_state).toBe('failed')
    expect(mockRow.fix_failure_reason).toMatch(/new zone/)

    const terminalLog = fixLogInserts.find((r) => r.event_type === 'fix_failed_terminal')
    expect(terminalLog).toBeTruthy()
    expect(String(terminalLog?.message)).toMatch(/new zone/)
  })

  it('discards its result when a stale invocation\'s fix_cycle_id no longer matches the row (superseded by a newer cycle)', async () => {
    // Simulate a force-retrigger having already replaced the row's fix_cycle_id
    // with a newer one while this (now-stale) invocation was still running.
    mockRow.fix_cycle_id = 'cycle-NEWER'

    generateStyleFixMock.mockResolvedValueOnce({
      kind: 'proposed',
      overrides: VALID_OVERRIDES,
      summary: 'Would have succeeded.',
    })

    const result = await runFixCycle(baseData({ fixCycleId: 'cycle-STALE' }))

    expect(result).toEqual({ outcome: 'stale_discarded', attemptsRun: 1 })

    // Must NOT have overwritten the row with this stale invocation's outcome.
    expect(mockRow.status).toBe('changes_requested')
    expect(mockRow.fix_state).toBe('generating') // untouched — still whatever the newer cycle set
    expect(mockRow.style_overrides).toEqual({})
    expect(mockRow.fix_changes_summary).toBeNull()

    // Attempt-level log rows from the stale run are still fine to have been written.
    expect(fixLogInserts.some((r) => r.event_type === 'attempt_started' && r.fix_cycle_id === 'cycle-STALE')).toBe(true)
  })

  it('a stale invocation also discards an exhaustion/terminal-failure result, not just a success', async () => {
    mockRow.fix_cycle_id = 'cycle-NEWER'
    generateStyleFixMock.mockResolvedValueOnce({
      kind: 'out_of_scope',
      reason: 'Layout change requested.',
    })

    const result = await runFixCycle(baseData({ fixCycleId: 'cycle-STALE' }))

    expect(result).toEqual({ outcome: 'stale_discarded', attemptsRun: 1 })
    expect(mockRow.fix_state).toBe('generating') // untouched
    expect(mockRow.fix_failure_reason).toBeNull()
  })

  it('force-retrigger runs exactly one attempt using the already-incremented fix_attempt_count, not a fresh 5-attempt loop', async () => {
    mockRow.fix_attempt_count = 6 // nudge route already incremented this before firing the event
    generateStyleFixMock.mockResolvedValueOnce({
      kind: 'proposed',
      overrides: INVALID_UNKNOWN_KEY,
      summary: 'Attempted a fix.',
    })

    const result = await runFixCycle(baseData({ forceRetrigger: true }))

    expect(generateStyleFixMock).toHaveBeenCalledTimes(1)
    expect(result.attemptsRun).toBe(1)
    expect(result.outcome).toBe('failed_terminal')
    expect(mockRow.status).toBe('changes_requested')
    expect(mockRow.fix_state).toBe('failed')

    const attemptStarted = fixLogInserts.find((r) => r.event_type === 'attempt_started')
    expect(attemptStarted?.attempt_number).toBe(6)
  })
})
