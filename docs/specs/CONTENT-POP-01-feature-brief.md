# Feature Brief: CONTENT-POP-01 — Live-Conductor Content Population Fix + Provisioning Self-Heal

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-05

---

## What Arun Said

A session investigation this session found that `app/api/recall/bot/route.ts` (lines ~262-296)
correctly detects when a session uses the newer "live-conductor" content pipeline
(`hasLiveConductorContent` flag, gating the `CONTENT_NOT_READY` guard) but never actually
populates `freshSections` / `trainingScripts` from `live_conductor_content.tabs` when that
flag is true. Confirmed directly against the DB for session
`2f04bdb6-1bfd-459c-b6bd-e5b2755a2db5`: `live_conductor_content.tabs` contains real generated
content and `content_status = 'ready'`, but the resulting `walkthrough_state` has
`sections: null`, `training_scripts: null`, and `topic_title: null`.

Arun has approved a two-part fix:

**Part A** — fix the actual root cause in `app/api/recall/bot/route.ts`: build
`freshSections` / `trainingScripts` from `live_conductor_content.tabs` when
`hasLiveConductorContent` is true, mapping into whatever `TemplateSection` / `TrainingScript`
shape the file already uses on the non-live-conductor path. This also fixes the "Unknown
Session" bug as a side effect (once `topic_title` populates, the fallback string never fires).

**Part B** — self-healing pre-flight check in
`app/api/hume-native/provision-config/route.ts`: before pushing the assembled system prompt to
Hume, verify the content and user-context sections are not suspiciously empty. Arun's explicit,
verbatim requirement: **do not hard-block the call if content is missing** — instead trigger
on-demand content generation synchronously (reusing whatever function already generates this
content in the normal background pipeline), wait for it to complete, then proceed with
provisioning using the freshly generated content. Only fail/block if that on-demand generation
itself fails or times out. Arun was told and accepted the trade-off explicitly: this adds real
latency to call-start when it triggers, in exchange for never starting a call with empty content.

---

## The Problem Being Solved

Two linked failures, both confirmed live:

1. **Silent content loss on the live-conductor path.** Any session using
   `live_conductor_content` (the newer pipeline) reaches the call with an empty knowledge base
   and empty script, even though the content was successfully generated and is sitting in the
   database. Clio has nothing to teach from. This is invisible at launch time — the guard that
   would normally catch "no content" is explicitly bypassed for this path because the flag says
   content exists (it does — it's just never read into the fields the rest of the route needs).

2. **Downstream corruption of session history.** Because `topic_title` is one of the fields
   that stays null, `app/api/recall/webhook/route.ts:223` and
   `app/api/attendee/webhook/route.ts:129` snapshot the literal fallback string `'Unknown
   Session'` at call-end. That string gets written into the user's `sessionHistory[]` and then
   re-injected into every future session's prompt under "RECENT SESSIONS" — so the damage
   compounds across sessions, not just the one that failed.

Part A fixes the root cause for this specific, known gap. Part B is a defensive backstop: any
future cause (this bug recurring in a different form, a race condition, a partial write, an
unrelated regression) that results in empty content reaching provisioning should self-correct
rather than silently degrading the call or hard-failing it.

---

## What Success Looks Like

- A session using the live-conductor pipeline with `content_status: 'ready'` and populated
  `live_conductor_content.tabs` produces a `walkthrough_state` with non-null `sections`,
  non-null `training_scripts`, and a correct `topic_title` (not the `'Unknown Session'`
  fallback).
- `provision-config` never sends a system prompt to Hume with an empty "TOPIC KNOWLEDGE BASE" /
  "SESSION SCRIPT" / user-context section without first attempting on-demand generation to fill
  the gap.
- If on-demand generation succeeds, the call proceeds normally with real content — the user may
  notice added latency at call-start but the session itself teaches real material.
- If on-demand generation fails or times out, the call fails clearly (not silently, not with
  placeholder/mock content) with a diagnosable log trail.
- `sessionHistory[]` stops accumulating `'Unknown Session'` entries going forward (existing
  polluted entries are out of scope for this fix — see Known Constraints).
- Sessions NOT using the live-conductor pipeline (the older CLM/LIVE-01 path) are completely
  unaffected — same behavior as today.

---

## Known Constraints

- `app/api/recall/bot/route.ts` is a **shared, security-sensitive file** — it also handles
  audit-token logic used by both the old CLM/LIVE-01 path and the new native path. The fix must
  be **strictly additive and isolated to the existing `hasLiveConductorContent` branch** already
  gated in that file. It must not change behavior for any session that is not on the
  live-conductor path, and must not touch, refactor, or move the audit-token logic at all.
- No deletion of existing code in either file.
- The mapping from `live_conductor_content.tabs` to `freshSections` / `trainingScripts` must be
  **read from the actual code, not invented**. The BA/developer must inspect:
  - `inngest/session-content-pipeline.ts` for the exact shape `tabs` are produced in on write
    (the "LIVE-01 BRANCH POINT" referenced in the existing code comment is a good anchor).
  - `app/api/recall/bot/route.ts` for the exact `TemplateSection` / `TrainingScript` shape the
    non-live-conductor path already builds, so the new branch produces a compatible shape rather
    than a parallel, subtly-different one.
  - This is flagged explicitly as a verification task, not a design decision — do not guess the
    field mapping.
- Part B's self-heal must **reuse existing content-generation logic**, not duplicate or
  reimplement it. Identify the actual function used by the normal background pipeline (likely in
  `inngest/session-content-pipeline.ts` or a function it calls) and invoke that synchronously,
  rather than writing new generation logic inside `provision-config/route.ts`.
- Per the standing rule "no impact on existing, no delete without approval": if satisfying this
  brief requires changing behavior in a third file beyond the two named above, flag it back to
  CEO before touching it — do not silently expand scope.
- Retroactive cleanup of already-corrupted `sessionHistory[]` entries (existing `'Unknown
  Session'` rows already persisted) is **out of scope** — call this out explicitly to Arun as a
  follow-up if he wants it fixed separately.

---

## Explicitly Out of Scope

- The nightly cleanup job — that is a separate, already-approved spec
  (`docs/specs/HUME-NATIVE-01-phase-c-nightly-cleanup-feature-brief.md` /
  `...-requirement-doc.md`). Do not touch it, do not merge scope into it.
- Any change to how content is *normally* generated in the background pipeline. This brief only
  adds an on-demand synchronous trigger as a fallback path when provisioning detects emptiness —
  it does not change the primary generation pipeline's timing, triggers, or logic.
- Retroactive repair of already-corrupted session history data (see Known Constraints).
- Any UI-facing change. This is entirely a backend/pipeline correctness fix.

---

## Questions for BA

1. Read `inngest/session-content-pipeline.ts` and `app/api/recall/bot/route.ts` and document the
   **exact** field-by-field mapping from `live_conductor_content.tabs[]` entries to
   `TemplateSection` and `TrainingScript` objects. Do not proceed to write acceptance criteria
   until this mapping is confirmed against real code and, ideally, a real row (e.g. session
   `2f04bdb6-1bfd-459c-b6bd-e5b2755a2db5`).
2. Identify the exact existing function that performs live-conductor content generation in the
   normal background pipeline (candidate: something in `inngest/session-content-pipeline.ts`).
   Confirm it can be safely invoked synchronously/on-demand from an API route context (e.g. does
   it depend on Inngest step context, or is the core logic already extractable as a plain
   callable function?). If it is NOT easily callable outside of an Inngest step, document that as
   a blocker/escalation back to CEO before assuming a refactor is in scope.
3. Define the exact "suspiciously empty" check for Part B — what counts as empty for TOPIC
   KNOWLEDGE BASE / SESSION SCRIPT / user-context (e.g. null vs. empty array vs. empty string vs.
   below some minimum length)? Get this precise enough that a developer doesn't have to guess.
4. Define a specific timeout value for the synchronous on-demand generation wait, and the exact
   retry behavior ("wait for it to complete, then proceed" — is this one attempt with a timeout,
   and if it fails do we retry once before hard-failing, or fail immediately on first failure?).
   Arun's language implies: try once, if it fails or times out, block the call. Confirm this
   before writing acceptance criteria.
5. Define exact logging requirements for Part B: what gets logged when emptiness is detected,
   what gets logged when self-heal succeeds, what gets logged when self-heal fails (should be
   detailed enough to diagnose in Vercel runtime logs without DB access).
6. Confirm whether Part A's fix, once shipped, should also include a small forward-looking guard
   so that `topic_title` specifically is never null when `hasLiveConductorContent` is true (this
   is the direct fix for the "Unknown Session" propagation) — or whether this falls out
   automatically once sections/scripts are populated correctly. Verify against code rather than
   assuming.

All of the above must be answered and documented in the Requirement Document before any code is
written. Per the project's standing rule, this spec requires CEO approval before development
begins — do not hand to a developer agent until that approval is recorded.
