# Feature Brief: CONTENT-02 — Overview/Summary Real Content + Content-Readiness Guard Fix
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-07

## What Arun Said

Three related problems surfaced from a real test call and a follow-up investigation:

1. The session Overview screen has no real spoken content prepared for it, so Clio blows past
   it in about a second while the participant is still looking at the screen — confirmed live.
2. A specific new curriculum session (`claude-for-developers-from-zero-to-production-part-5`,
   session id `12dacbd0-f306-46c9-a083-75522d784084`) shows `content_status = 'ready'` in the
   database, but has literally zero rows in `topic_content_cache` — meaning content generation
   never actually produced anything for it, yet the system reported success. Clio ended up
   teaching from her own general knowledge instead of the prepared material.
3. Arun's broader direction: this is a pattern, not a one-off — the content-generation/readiness
   path has a habit of quietly reporting "ready" when generation actually failed or is
   incomplete, instead of failing loudly or retrying. Fix the pattern in this specific path
   (content_status / sub_sessions readiness reporting), not a sweeping audit of every status
   flag in the codebase.

Arun was explicit: no backfill or repair of the already-broken session
(`12dacbd0-f306-46c9-a083-75522d784084`) or any other historical data. This is a going-forward
fix only — new sessions must not be able to end up in this false-ready state again.

## The Problem Being Solved

**Issue A (Overview has no real content):** Every real topic section has actual prepared
spoken content (TEACH/CHECKPOINT/PROBE/CONTINUE) built by the script generator. The
SessionOverview and SessionSummary "bookend" sections
(`lib/templates/session-bookends.ts`) are visual-only — they have no script segments of
their own. `lib/clio-context-builder.ts::buildSessionScript()` iterates the full wrapped
sections array including these two bookends, and for the Overview specifically falls back to
a generic filler line: `"(No script — explain the key concepts from the knowledge base in
plain language.)"` because there is no real script for it. The voice prompt template
(`lib/voice/hume-native/prompt-template.ts`, Rule 1) only instructs Clio to "briefly orient
the participant to today's agenda" — none of the same "teach → checkpoint → pause → advance"
discipline Rules 3–5 mandate for real sections applies to the Overview. Net effect: nothing
real to say, no instruction to linger, so Clio moves on almost instantly.

**Issue B (false-ready content status):** `sessions.content_status` was set to `'ready'` for
this session despite `topic_content_cache` having zero rows for it, and all 5 of its
`sub_sessions` show `template_section: null`. This is confirmed real — not a hypothesis.
The pipeline (`inngest/session-content-pipeline.ts`) has a "Step H" guard specifically meant
to prevent exactly this: it counts `topic_content_cache` rows for the session's `topic_id`
(which is always the session's own UUID — content is scoped per-session, not shared across
curriculum parts) before marking `content_status: 'ready'`, and throws if the count is zero.
On paper this guard should make Issue B's exact symptom impossible. Since it happened anyway,
something is bypassing or defeating that guard for this session, and the BA/developer must
find the real mechanism — not assume the guard's existing logic is sufficient. Two
hypotheses worth investigating (not prescribing the fix, just pointing at where to look):
  - Inngest step memoization: if an earlier partial/crashed run of this same function
    execution got far enough to have Step H "planned" or partially recorded, a retry could
    replay a stale step result without re-executing the live DB count check.
  - Some other code path writes `content_status: 'ready'` directly to the `sessions` table
    for this session outside of this pipeline's Step H (e.g. a different job, an admin/repair
    endpoint, or a race with another trigger), bypassing the guard entirely.
The BA must direct the developer to trace this to its actual root cause using logs/git
history/other call sites of `content_status` — not just re-read Step H's existing code and
declare it fine.

**Issue C (silent-success pattern, scoped):** Whatever the true root cause of Issue B turns
out to be, the fix must make the content-readiness path fail loudly (throw / retry / alert)
rather than silently succeed when generation didn't actually produce content for the specific
session in question. This should fall naturally out of properly closing Issue B's gap. Do not
expand this into a general audit of other status flags elsewhere in the codebase — if the
developer notices the identical silent-success pattern immediately adjacent to this code
(e.g. another step in the same pipeline file), flag it as a separate future item rather than
fixing it now.

## What Success Looks Like

1. The Overview screen has real, generated spoken content — a proper "here's what we'll cover
   today" teaching beat, not a throwaway line — and the voice prompt treats it with the same
   deliver → check understanding → pause → advance discipline as any other section. The
   Summary screen gets the equivalent proper wrap-up treatment. `buildSessionScript()` uses
   this real content instead of falling back to filler text for these two bookends.
2. For any NEW session created after this fix ships: it is no longer possible for
   `content_status` to end up `'ready'` while `topic_content_cache` has zero rows (or while
   `sub_sessions[].template_section` is null) for that session. If generation genuinely fails,
   the system fails loudly (throws, retries per Inngest's normal retry behavior, and/or alerts)
   rather than quietly reporting success.
3. The already-broken test session (`12dacbd0-f306-46c9-a083-75522d784084`) is left exactly as
   it is today — no backfill, no repair, no special-cased fix. This is a going-forward
   guarantee only.

## Known Constraints

- No backfill or repair of session `12dacbd0-f306-46c9-a083-75522d784084` or any other
  historical data — Arun was explicit and consistent with today's other scoping decisions.
- Scope for Issue C is limited to the content-generation/readiness path
  (`content_status` / `sub_sessions` readiness reporting) specifically. Do not sweep the whole
  codebase for similar patterns. Flag anything broader found in passing as a separate future
  item, do not build it now.
- Must not regress: existing real subtopic sections' script/teaching behavior, LIVE-01 /
  Hume-native voice path when its own toggle is on, LLM topic generation, session generation —
  per the standing "no impact on existing" rule. Any change that requires touching existing
  behavior beyond the Overview/Summary bookends and the Step H guard must be flagged to CEO
  before building, not silently done.
- `npx tsc --noEmit` must stay clean.
- Per current working agreement: build and typecheck only. Do not commit, push, or deploy.
  Arun/CEO will review the diff directly.
- The Overview/Summary content generation approach must not populate these screens with
  speculative/undefined AI-generated content — the content must be clearly and deliberately
  designed (what exactly gets said, from what source data) before any code is written, per the
  "never use AI-generated content to fill undefined screens" product principle. If a static,
  templated construction (not a fresh LLM call) is sufficient and simpler, prefer that — this
  is a technical/product judgment call for the BA to make explicit and for CEO to approve, not
  to leave ambiguous.

## Questions for BA

1. For the Overview's real spoken content: should this be a fresh Claude generation call
   (like other subtopics' TEACH segments), or can it be deterministically constructed from
   data Clio already has (the session's agenda / subtopic titles / topic title), with no new
   LLM call needed? Recommend the simplest approach that still sounds natural when spoken, and
   document exactly what the generated text will contain with a concrete example.
2. Same question for the Summary wrap-up — should it be generated fresh per session (e.g.
   referencing what was actually covered) or does a well-designed template suffice? Document
   with a concrete example.
3. Trace and document the ACTUAL root cause of why session
   `12dacbd0-f306-46c9-a083-75522d784084` ended up with `content_status: 'ready'` and zero
   cache rows, given that Step H's guard as currently written should have prevented exactly
   this. Do not accept "the guard looks correct" as an answer — find the actual gap (Inngest
   step memoization on retry, a different code path writing `content_status` directly, or
   something else) and cite the evidence (code location, git history, logs if available).
   If truly no direct evidence is recoverable and the mechanism must be inferred, say so
   explicitly, propose the most likely mechanism, and specify what defensive fix closes that
   gap regardless of which exact mechanism was at play.
4. Design the concrete fix for the guard/readiness path so that a NEW session literally
   cannot repeat this — e.g. re-verify actual row identity per session (not just a nonzero
   count) at the moment `content_status` is set, and make sure that check cannot be skipped by
   a memoized/replayed Inngest step. Specify exact function/step names and the exact new check
   logic in the spec, precise enough that a developer builds only what's approved.
5. Confirm whether `sub_sessions[].template_section` is written by a step that is independent
   of `topic_content_cache` upserts — if so, does the fixed guard also need to check that field
   for consistency, or is that a separate/future concern? Recommend and get CEO sign-off before
   including it in scope.
6. List every file the developer will touch for both issues (Files Changed section, per spec
   template) so CEO review has a precise diff surface to check.
