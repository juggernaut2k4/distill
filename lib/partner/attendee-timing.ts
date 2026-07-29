/**
 * B2B-50 — extracted from app/api/attendee/webhook/route.ts (previously private, unexported
 * functions of the same name/behavior) so inngest/partner-participants-empty-debounce.ts can reuse
 * the same wall-clock duration math instead of duplicating it. Behavior is byte-for-byte unchanged
 * from the originals.
 */

export function extractAttendeeEventTimestamp(event: { data: Record<string, unknown> }): string | null {
  const candidates: unknown[] = [
    event.data?.created_at,
    event.data?.timestamp,
    event.data?.occurred_at,
    event.data?.event_time,
    event.data?.changed_at,
    event.data?.time,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' || typeof c === 'number') {
      const d = new Date(c)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
  }
  return null
}

export function clampDurationMinutes(ms: number): number {
  return Math.min(600, Math.max(0, ms / 60000))
}
