/**
 * Pure-code session organizer — Step 2 of the CURR-01 content-first architecture.
 *
 * Receives arcs with comprehensive_subtopics[] (produced by the planner LLM) and
 * divides them into PlannedSession[] based on the user's preferred session duration.
 *
 * No LLM calls. No async. No external dependencies. No drops guarantee:
 * every subtopic in the input appears in exactly one output session.
 *
 * Cross-arc packing rule: if an arc's remainder is too small for its own shorter session
 * (< halfSession items), those items carry over and are prepended to the next arc's pool
 * to form one combined cross-arc session. This prevents near-empty sessions at arc boundaries.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlannedSession = {
  session_index: number    // 0-based, global across all arcs
  arc_names:     string[]  // 1 arc normally; 2 when is_cross_arc is true
  subtopics:     string[]  // the exact subtopics allocated to this session
  duration_mins: number    // actual minutes (rounded to nearest 5, minimum 5)
  tab_count:     number    // equals subtopics.length
  is_cross_arc:  boolean   // true when subtopics span 2 arcs
}

type InputArc = {
  arc_name:                string
  comprehensive_subtopics: string[]
  is_visible:              boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Rounds n to the nearest 5, enforcing a minimum of 5. */
function roundToNearest5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5)
}

/** Deduplicates an array of strings while preserving insertion order. */
function deduplicatePreserveOrder(names: string[]): string[] {
  return Array.from(new Set(names))
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

/**
 * Returns the number of subtopics per full session for a given duration.
 * Mirrors the PACE-01 formula: floor((sessionMins - 2) / 2), minimum 2.
 *
 * 5-min  → 2 subtopics
 * 15-min → 6 subtopics
 * 30-min → 14 subtopics
 */
export function subtopicsPerSessionForDuration(sessionMins: number): number {
  return Math.max(2, Math.floor((sessionMins - 2) / 2))
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Divides arc subtopics into sessions based on the user's preferred session duration.
 *
 * @param arcs       - Arcs from the planner output (v2 shape). Only visible arcs are processed.
 * @param sessionMins - Target session duration from user's learning_goal preference.
 * @returns           - Ordered list of PlannedSession objects. No subtopic is dropped.
 *
 * Cross-arc packing: remainders < halfSession carry over into the next arc's pool.
 * Remainders >= halfSession become their own shorter session at proportional duration.
 * Remaining carry-over after the last visible arc is flushed as a final shorter session.
 */
export function organizeSubtopicsIntoSessions(
  arcs: InputArc[],
  sessionMins: number,
): PlannedSession[] {
  if (arcs.length === 0) return []

  const subtopicsPerSession = subtopicsPerSessionForDuration(sessionMins)
  const halfSession = Math.ceil(subtopicsPerSession / 2)
  const result: PlannedSession[] = []
  let sessionIndex = 0
  let carryOver: { subtopics: string[]; arc_names: string[] } = { subtopics: [], arc_names: [] }

  const visibleArcs = arcs.filter((arc) => arc.is_visible)

  for (const arc of visibleArcs) {
    if (arc.comprehensive_subtopics.length === 0) {
      console.warn(`[session-organizer] arc "${arc.arc_name}" has 0 comprehensive_subtopics — skipped`)
      continue
    }

    // Merge carry-over from previous arc with this arc's subtopics
    const pool: string[] = [...carryOver.subtopics, ...arc.comprehensive_subtopics]
    let poolArcNames: string[] = deduplicatePreserveOrder([...carryOver.arc_names, arc.arc_name])
    carryOver = { subtopics: [], arc_names: [] }

    // Emit full-size sessions
    while (pool.length >= subtopicsPerSession) {
      const chunk = pool.splice(0, subtopicsPerSession)
      const isCrossArc = poolArcNames.length > 1
      result.push({
        session_index: sessionIndex++,
        arc_names:     isCrossArc ? poolArcNames : [arc.arc_name],
        subtopics:     chunk,
        duration_mins: sessionMins,
        tab_count:     chunk.length,
        is_cross_arc:  isCrossArc,
      })
      // After the first full chunk, all remaining items are from the current arc
      poolArcNames = [arc.arc_name]
    }

    // Handle remainder (pool.length is now 0 to subtopicsPerSession-1)
    if (pool.length === 0) {
      continue
    } else if (pool.length >= halfSession) {
      // Large enough for its own shorter session
      const isCrossArc = poolArcNames.length > 1
      result.push({
        session_index: sessionIndex++,
        arc_names:     poolArcNames,
        subtopics:     pool,
        duration_mins: roundToNearest5((pool.length / subtopicsPerSession) * sessionMins),
        tab_count:     pool.length,
        is_cross_arc:  isCrossArc,
      })
    } else {
      // Too small — carry over into next arc
      carryOver = { subtopics: pool, arc_names: poolArcNames }
    }
  }

  // Flush remaining carry-over after the last visible arc
  if (carryOver.subtopics.length > 0) {
    result.push({
      session_index: sessionIndex++,
      arc_names:     carryOver.arc_names,
      subtopics:     carryOver.subtopics,
      duration_mins: roundToNearest5((carryOver.subtopics.length / subtopicsPerSession) * sessionMins),
      tab_count:     carryOver.subtopics.length,
      is_cross_arc:  carryOver.arc_names.length > 1,
    })
  }

  return result
}
