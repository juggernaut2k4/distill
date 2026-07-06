# Stale Background Tasks — Completion Audit

**Why this exists:** 8 background agent tasks were found still showing as "Running" in the
session's task panel, each 28-51 hours old — clearly orphaned from earlier work in this same
long session, not actually still executing anything useful. Before dismissing them, Arun asked
to verify whether the underlying work each one was investigating actually got addressed in the
codebase, rather than just closing them out unchecked.

**Status:** Investigation complete (2026-07-05). All 8 items checked directly against current
code and docs.

## Checklist

- [x] **1. `grep -rln "is_approved" app/api app/lib lib`** (Bash task, ~51h old)
      **RESOLVED.** Ran the exact grep — hits in `curriculum/save-preview`, `curriculum/plan`,
      `curriculum/generate`, `plan/approve`, `admin/repair-session-titles`, `sessions/[id]/meeting-url`,
      `sessions/[id]/start`. Confirmed the known fix (commit `0dd5c19`, "enforce plan approval gate
      on /start and /meeting-url") is live in both files: `/start` checks
      `curriculum_plans.is_approved` and 403s with "This session's plan has not been approved yet."
      if false (only skipped when `session.curriculum_plan_id` is null, i.e. legacy pre-session-designer
      sessions), and `/meeting-url` has the identical guard. No other route reads/writes plan data
      in a way that bypasses the gate — `plan/approve` is the only writer of `is_approved`, and it's
      set exactly once, correctly, at approval time.

- [x] **2. LIVE-01 open questions in codebase** (Agent, ~44h old)
      **RESOLVED — status is current, not stale.** `ATTENDEE-HUME-ARCHITECTURE-brainstorm.md`
      has an "Open items — resolved vs. still open" section explicitly updated 2026-07-04 (one day
      before this audit). It states: mid-call context injection and stuck-tab/backstop pacing are
      now resolved by decision (no longer open); genuinely open items are two things resolvable
      only by a live test call (whether Hume accepts the full upfront prompt size, whether Hume's
      LLM reliably fires visualization tool calls unprompted); and two new/not-yet-spec'd items
      (post-session transcript extraction, PDF export) are logged for future spec work, not silently
      dropped. This matches the task title's implied concern (e.g. "force-advance on last tab") —
      that item specifically is recorded as resolved by design (tracking Clio's tab position via
      transcript instead of a forced backstop), not silently fixed or newly broken.

- [x] **3. Auto-generation trigger points** (Agent, ~43h old)
      **RESOLVED.** Confirmed in `app/api/plan/approve/route.ts` (lines 246-250): the comment
      states explicitly "AUTOGEN-01 Part B: approval no longer triggers content generation at all.
      Session 1 content is kicked off by session-designer-auto.ts as soon as its title/subtopics are
      finalized (pre-approval). Sessions 2–N are picked up by the Part A hourly cron... not by this
      route." This matches the intended design in `project_autogen01_decisions.md` /
      `project_content_generation_timing.md` — generate in the background BEFORE approval, display
      only AFTER. `session-designer-auto.ts` triggers on event `clio/plan.generated` (pre-approval),
      and `generate-content/route.ts` fires the canonical `distill/session.content.generate` event
      consumed by `session-content-pipeline.ts`. No double-trigger: the old "fire content gen for
      all sessions on approval" block was explicitly removed per the comment. No missing-trigger gap
      found — Session 1 pre-approval, 2-N via cron, both wired.

- [x] **4. Route call site for `getLiveConductorState`** (Agent, ~41h old)
      **RESOLVED.** `getLiveConductorState` is defined once in `lib/voice/live-conductor-bridge.ts`
      (line 137) and has exactly one call site: `app/api/clio/chat/completions/route.ts` (line 318),
      the CLM chat-completions route for live-conductor sessions — exactly as expected. No dead or
      orphaned references found.

- [x] **5. `live-conductor-visual` call sites** (Agent, ~30h old)
      **RESOLVED.** `buildAgendaVisual` (tab-1 agenda) and `generateLiveVisualWithTimeout` (tabs 2+,
      generated with a timeout/retry wrapper) are both exported from
      `lib/content/live-conductor-visual.ts` and both consumed from within
      `lib/voice/live-conductor-bridge.ts` only — `buildAgendaVisual` at line 197,
      `generateLiveVisualWithTimeout` at line 338. Matches documented behavior exactly. No other
      call sites, no orphaned exports.

- [x] **6. `tool_call` handling across voice integrations** (Agent, ~29h old)
      **RESOLVED — consistent, documented divergence only where expected.** `hume-adapter.ts` (CLM
      mode) has full `tool_call` handling (line 183+). The new `lib/voice/hume-native/` modules
      (`config-provisioner.ts`, `prompt-template.ts`) do not reimplement tool_call handling — a code
      comment in `config-provisioner.ts` states directly: "Same wire-protocol tool_call /
      tool_response pattern already implemented in hume-adapter.ts for CLM mode today. No new tool
      schema." Both hume-native files are explicitly marked as isolated/not imported into any
      production path yet (gated behind `NEXT_PUBLIC_HUME_NATIVE_ENABLED`, only reachable via the
      new `/api/hume-native/*` routes). `elevenlabs-adapter.ts` has **no** `tool_call` handling at
      all (confirmed via grep — zero matches). This is a real divergence but appears intentional:
      the ElevenLabs path doesn't use the tool-based tab-navigation mechanism the Hume paths use.
      Flagging as a design fact rather than a gap since there's no evidence ElevenLabs was ever
      meant to support this — but noting it here in case that assumption is wrong.

- [x] **7. Existing write-heavy DB patterns in codebase** (Agent, ~29h old)
      **RESOLVED — already synthesized, not a separate open thread.** Confirmed the exact synthesis
      exists in `ATTENDEE-HUME-ARCHITECTURE-brainstorm.md`: "1. DB write load (item 1): Not a
      concern. Confirmed safe at 100+ concurrent sessions" followed by a detailed answer (line 76+)
      citing `walkthrough_state`'s existing polling/update pattern as the comparable load, worst-case
      burst math (~100 writes/sec at 100 concurrent sessions), and an explicit revisit trigger (10-50x
      growth past 100 concurrent, or heavier row payloads). This task's findings were folded into
      that answer — nothing left hanging.

- [x] **8. Codebase write-pattern findings synthesis** (Agent, ~29h old)
      **RESOLVED — same synthesis as #7, no separate follow-up needed.** This was the
      follow-up/synthesis step for #7, and it's the same paragraph in the brainstorm doc referenced
      above. There is no unresolved synthesis step outstanding; the conclusion (non-issue at current
      and 10-50x scale) is already written down and dated.

## Summary

**8 of 8 RESOLVED.** 0 need attention. 0 undeterminable.

All eight background tasks were investigating things that turned out to already be correctly
handled in the current codebase — either by a targeted fix already shipped (item 1, commit
`0dd5c19`), by an explicit design decision already documented and dated (items 2, 3, 6), or by
analysis that was already written down and folded into the relevant doc (items 4, 5, 7, 8). Safe
to dismiss all 8 stale task chips — none of them represent unfinished work.

One soft observation, not a gap: item 6 surfaced that `elevenlabs-adapter.ts` has zero `tool_call`
handling, unlike both Hume paths. This reads as intentional (ElevenLabs doesn't use tool-based tab
navigation), but is worth a one-line confirmation from whoever owns the ElevenLabs integration
decision if that assumption should ever be revisited.
