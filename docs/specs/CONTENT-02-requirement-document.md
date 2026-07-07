# Overview/Summary Real Content + Content-Readiness Guard Fix — Requirement Document
Version: 1.0
Status: DRAFT — pending CEO review
Author: Business Analyst Agent
Date: 2026-07-07

---

## 1. Purpose

Every real subtopic in a Clio session has actual prepared spoken content — a TEACH beat, a
verification question, a reframe fallback, a bridge line — built once by the content pipeline
and delivered with real discipline (deliver → check understanding → pause → advance). The two
"bookend" screens that wrap every session, Session Overview and Session Summary
(`lib/templates/session-bookends.ts`), have never had this. They exist visually (an agenda
list, a "what we covered" list) but have no spoken script segments of their own, and the voice
prompt only tells Clio to "briefly orient the participant to today's agenda" for the opening —
with none of the teach/checkpoint/pause/advance discipline that governs every other section.
The observed, confirmed symptom: Clio blows past the Overview screen in about a second while
the participant is still reading it, because there is nothing real prepared for her to say and
no instruction telling her to linger.

Separately, and more seriously: a real curriculum session
(`claude-for-developers-from-zero-to-production-part-5`, id
`12dacbd0-f306-46c9-a083-75522d784084`) ended up with `sessions.content_status = 'ready'` while
having zero rows in `topic_content_cache` and `null` `template_section` on every `sub_session`.
Clio taught that session entirely from her own general knowledge instead of the prepared
material — the exact failure this project's content pipeline exists to prevent. The pipeline
has a guard ("Step H" in `inngest/session-content-pipeline.ts`) that is specifically designed to
make this impossible, and it did not catch this case. Investigation (Section 3 below) found the
guard itself is not defective — a completely different code path, entirely outside the pipeline
it lives in, wrote `content_status = 'ready'` directly, with no equivalent verification at all.

Without this fix: (a) every session continues to open and close with a screen nobody actually
teaches from, undermining the "real content, not filler" principle the rest of the product is
built on, and (b) the false-ready failure mode remains fully open for the Hume-native /
live-conductor path — any future session using that path can silently end up "ready" with no
usable content, with Clio teaching off-script from memory and no error, retry, or alert
anywhere in the system.

## 2. User Story

As an **executive user** in a live Clio coaching session,
I want the opening and closing moments of the session to be delivered with the same real,
prepared, natural teaching quality as everything in between,
so that the session feels complete and intentional from the first second to the last, not like
it starts and ends with a placeholder.

As **Arun** (product owner, responsible for content integrity),
I want it to be structurally impossible for a new session to be marked "content ready" when its
actual prepared content does not exist,
so that Clio never again teaches a real session from her own unverified general knowledge
instead of the material the pipeline was supposed to produce.

## 3. Root Cause of Issue B — Investigation Findings (with evidence)

**Conclusion: Step H's guard is not defective. A second, independent code path writes
`content_status = 'ready'` directly to the `sessions` table, with no content-existence check
that is even capable of catching this failure mode, because it lives entirely outside
`topic_content_cache` — the table Step H checks.**

### Evidence trail

1. **Step H, as written, is correctly scoped and does what it claims.**
   `inngest/session-content-pipeline.ts` lines 463–489: it counts `topic_content_cache` rows
   `WHERE topic_id = sessionId` (confirmed at line 164, `const topicId = sessionId` — content is
   always keyed by the session's own UUID, never shared across curriculum parts) and throws
   before marking `content_status = 'ready'` if that count is 0. This guard is real, live code,
   not a stub, and would have caught Issue B's exact symptom **if this pipeline is the code
   path that ran for that session.**

2. **This pipeline has a branch that skips `topic_content_cache` entirely and Step H along with
   it.** Lines 241–287 (`LIVE_CONDUCTOR_ENABLED` branch, gated on
   `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED`): when true, the function generates
   `live_conductor_content`, writes it directly to `sessions.live_conductor_content` +
   `content_status: 'ready'` (lines 255–261), and **returns early at line 286** — Steps D–I,
   including Step H, never execute. This branch never writes a single row to
   `topic_content_cache`. A session that goes through this branch legitimately has zero
   `topic_content_cache` rows by design — that alone is not a bug.

3. **A completely separate route — not this pipeline at all — also writes
   `content_status: 'ready'`, with no row-existence check whatsoever.**
   `app/api/hume-native/provision-config/route.ts`, lines 250–260 (introduced under
   CONTENT-POP-01, the self-heal path for when a Hume-native session finds its prepared content
   missing at connect-time):
   ```ts
   // Persist, mirroring session-content-pipeline.ts's exact write shape.
   const { error: sessionWriteErr } = await supabase
     .from('sessions')
     .update({
       live_conductor_content: healed,
       content_status: 'ready',
     })
     .eq('id', sessionId)
   ```
   This write commits **before** the function's own completeness recheck runs (the
   `isSuspiciouslyEmpty` call at line 323, which happens 60+ lines later, after `sections` and
   `trainingScripts` are rebuilt in memory from `healed.tabs`). If that recheck at line 323
   fails, the function returns a 502 to the caller (line 325) — but it never undoes the
   `content_status: 'ready'` write that already committed at line 255. There is no call to
   `topic_content_cache` anywhere in this file, and no count/verification of any kind guards the
   line 255 write. This is a real, load-bearing, currently-shipped code path
   (`app/dashboard/walkthrough/` invokes it whenever `NEXT_PUBLIC_HUME_NATIVE_ENABLED` is true),
   not dead code.

4. **This matches the observed symptom precisely.** Issue B's session had `content_status =
   'ready'` + zero `topic_content_cache` rows + `null` on every `sub_sessions[].template_section`
   — exactly what results from either (a) the `LIVE_CONDUCTOR_ENABLED` branch running normally
   (which never touches `topic_content_cache` or `sub_sessions[].template_section` — both are
   legacy/parallel fields for a different content path, see Section 3a below), or (b) the
   `provision-config` self-heal writing `ready` and then its own post-write recheck failing
   silently from the caller's perspective (the write already committed). Both mechanisms produce
   the identical DB fingerprint; neither requires Step H to have a bug, because neither goes
   through Step H.

5. **Git history confirms this is a real, recently-active area of change**, not stale/dead code:
   commit `8db9008 fix(sessions): recognize live_conductor_content as ready evidence` (in
   `app/api/sessions/[id]/generate-content/route.ts`, a different file, same family of
   live-conductor "what counts as ready" logic) shows this exact status field has had more than
   one ad hoc fix layered onto it very recently, each one reasoning about "readiness" locally
   rather than from one shared, verified source of truth.

### Was the Inngest step-memoization hypothesis (raised in the brief) the mechanism?

No direct evidence supports it, and it is not necessary to explain the symptom — evidence 3 and
4 above are sufficient and directly reproducible by inspection. Per the brief's instruction to
say so explicitly if direct evidence for a specific mechanism isn't recoverable: no Inngest
step-memoization evidence was found or is needed here. The second-writer-outside-the-guard
mechanism (evidence 3) is confirmed by reading the shipped code directly, not inferred. This
finding does not rule out step memoization as a real risk *in general* for Step H itself, but it
was not the operative cause of this specific incident, and no changes to Inngest step
naming/memoization behavior are in scope for this fix (see Section 10).

### 3a. Is `sub_sessions[].template_section` a separate write path? (Brief Question 5)

Yes, and it is unrelated to Issue B's mechanism — this is a **legacy, pre-generation path**, not
part of `session-content-pipeline.ts` or `topic_content_cache` at all. `lib/session-plan.ts`
(`generateFirstSubtopicVisual` / `generateRemainingSubtopicVisuals`) is the only code that ever
writes `template_section`, and it writes it into an in-memory `SessionPlan` object — its
`visual_status: 'ready'` field is that path's own local readiness signal, entirely independent
of `sessions.content_status`. It is called from a different, older flow (pre-generation at plan
time, before curriculum sessions / `session-content-pipeline.ts` existed as the canonical
path). It never reads or writes `content_status`, and `content_status` never reads or writes it.
The two "readiness" concepts have no code-level relationship to each other today.

**Decision: `template_section` consistency is explicitly OUT OF SCOPE for this fix.** It is a
different subsystem with its own (separate, currently unguarded) risk profile, not a variant of
the bug this spec fixes. Flagged as a future item — see Section 10.

## 4. The Fix — Design

Two independent fixes, both scoped exactly to what the brief authorizes.

### 4.1 — Overview/Summary real content (Issue A)

**Decision: deterministic template construction, NOT a fresh LLM call.** Both the brief and the
product principle it cites ("never use AI-generated content to fill undefined screens") point
here, and on inspection it is clearly sufficient: the Overview's job is to state the session's
title and its exact fixed agenda (subtopic titles, already known and already displayed on
screen); the Summary's job is to state the session's title and the exact fixed list of subtopics
covered (also already known, already computed today by `wrapSectionsWithBookends` as
`covered_subtopics`). Neither requires generation, judgment, or synthesis — every fact needed is
already present as plain data by the time `wrapSectionsWithBookends` runs. A fresh Claude call
would introduce exactly the "speculative/undefined AI-generated content" risk the product
principle exists to prevent, for zero benefit over a deterministic template, since the
underlying facts (title, agenda, covered list) never vary in a way generation could add value
to.

**What changes:** `lib/templates/session-bookends.ts` gains real spoken content for both
bookends, expressed the same way every other section's spoken content is expressed — as
`TrainingScript`-shaped segments (`TEACH`, `CHECKPOINT`, `CONTINUE`) — so `buildSessionScript()`
in `lib/clio-context-builder.ts` can treat Overview/Summary exactly like any other section with
zero special-casing, and the generic filler fallback (`"(No script — explain the key concepts
from the knowledge base in plain language.)"`) is never reached for these two sections again.

**Overview TEACH content — built from `session_title` + `agenda` (both already computed in
`wrapSectionsWithBookends`), pure string templating, no LLM:**

```
Function: buildOverviewTeachContent(sessionTitle: string, agenda: { subtopic_title: string; skipped: boolean }[]): string

Template (agenda items joined naturally, skipped items excluded):
"Today we're covering {sessionTitle}. We'll go through {N} things: {item 1}, {item 2}, and
{item 3}. By the end, you'll have a clear, practical grip on all of it — let's get started."
```

Concrete example (session: "Claude for Developers: From Zero to Production — Part 5", agenda:
["Evaluating model output quality", "Building a regression test harness", "Rolling out to
production safely"]):

> "Today we're covering Claude for Developers: From Zero to Production — Part 5. We'll go
> through three things: evaluating model output quality, building a regression test harness,
> and rolling out to production safely. By the end, you'll have a clear, practical grip on all
> of it — let's get started."

Edge case — single-subtopic session: "Today we're covering {sessionTitle}. We'll go deep on one
thing: {item}. By the end, you'll have a clear, practical grip on it — let's get started."

Edge case — zero-subtopic session (the existing defensive empty-list branch in
`wrapSectionsWithBookends`, lines 38–57): "Today we're covering {sessionTitle}. Let's get
started." (no agenda clause — nothing to list).

**Overview CHECKPOINT (verification question) — fixed, not per-session, since there is no
teaching content yet to check understanding of. Its purpose is different from a real section's
checkpoint: it confirms orientation, not comprehension:**

> "Does that agenda work for you, or is there something specific you want to make sure we get
> to?"

**Overview CONTINUE (bridge into subtopic 1) — fixed:**

> "Perfect — let's dive into the first one."

**Summary TEACH content — built from `session_title` + `covered_subtopics` (both already
computed in `wrapSectionsWithBookends`), pure string templating, no LLM:**

```
Function: buildSummaryTeachContent(sessionTitle: string, coveredSubtopics: string[]): string

Template:
"That's a wrap on {sessionTitle}. Today we covered {item 1}, {item 2}, and {item 3}. The one
thing worth carrying forward: {reuse the FIRST covered subtopic's title as the anchor, since it
is the item participants are statistically most likely to retain} — keep coming back to that as
you put this into practice."
```

Concrete example (same session, all 3 subtopics covered, none skipped):

> "That's a wrap on Claude for Developers: From Zero to Production — Part 5. Today we covered
> evaluating model output quality, building a regression test harness, and rolling out to
> production safely. The one thing worth carrying forward: evaluating model output quality —
> keep coming back to that as you put this into practice."

Edge case — a subtopic was skipped: `covered_subtopics` already excludes skipped items (existing
behavior, `wrapSectionsWithBookends` line 84–86) — no new logic needed; the template only ever
sees the covered list.

Edge case — zero covered subtopics (every subtopic skipped, or zero-subtopic session): "That's a
wrap on {sessionTitle}. Thanks for your time today."

**Summary CHECKPOINT — fixed, since the session is ending and there is nothing further to
verify comprehension of; this is a closing check-in, not a comprehension check:**

> "How did that feel — anything you want to flag before we close out?"

**Summary CONTINUE (final line, replaces the current fixed `"Nice work today."` closing line) —
fixed:**

> "Nice work today. Talk soon."

This is intentionally near-identical to the existing `SUMMARY_CLOSING_LINE` — it is already
approved, fixed copy per `SCREEN-01`, and Rule 8 of the prompt template (Section 4.2 below)
already governs the actual farewell sequence. This CONTINUE segment exists so
`buildSessionScript()` has a real, non-filler value to put in the "final bridge" slot; it is not
meant to replace Rule 8's own closing sequence, which still runs after Clio delivers the Summary
section's content.

**`wrapSectionsWithBookends` changes:** the `data` payload for both bookends gains a new field,
`script`, of shape `{ teach: string; checkpoint: string; continue: string }`, populated by the
two template functions above at construction time (no async work — pure string building from
data already in scope). `session-bookends.ts` remains the single source of truth: both
`session-meeting-setup.ts` and `app/api/recall/bot/route.ts` get this automatically since both
already call `wrapSectionsWithBookends`.

**`lib/clio-context-builder.ts::buildSessionScript()` changes:** currently `trainingScripts` is
indexed 1:1 with `sections` and read via `get(type)` against `script?.segments`. The Overview
and Summary sections do not have a `TrainingScript` entry today (their slot in `trainingScripts`
is implicitly `null`, which is what triggers today's filler fallback). The fix: when building
the script blocks, for the Overview and Summary section types specifically, read `teach` /
`checkpoint` / `continue` off `section.data.script` (the new field above) instead of off
`trainingScripts[i]`. No signature change to `buildSessionScript` — this is an internal branch
keyed on `section.type === 'SessionOverview' || section.type === 'SessionSummary'`. Every other
section type's behavior is byte-for-byte unchanged.

### 4.2 — Voice prompt discipline for bookends (part of Issue A)

`lib/voice/hume-native/prompt-template.ts`, Rule 1, currently reads:

> "1. Open the session warmly, briefly orient the participant to today's agenda, then begin
> teaching. Do not ask what they want to cover — the agenda for this session is fixed and
> provided below in SESSION CONTENT."

This is replaced with:

> "1. Open the session warmly. Deliver the Session Overview section's prepared content (marked
> in SESSION CONTENT) in full — state the agenda, ask its verification question, and wait for a
> response — before moving to the first real subtopic. Treat this exactly like any other
> section: teach → verification question → listen → respond → bridge. Do not skip or rush past
> it, and do not ask what they want to cover — the agenda is fixed and provided below in SESSION
> CONTENT."

Rule 8 (the closing sequence) is updated in the same spirit — it currently instructs Clio to
"briefly summarize what was covered today in exactly two sentences" as an ad hoc action at the
end. That is replaced with an instruction to deliver the Session Summary section's prepared
content (now real, from 4.1) the same way any section is delivered, and only then execute the
existing farewell mechanics (8b) unchanged:

> "8. When the final real subtopic is complete, deliver the Session Summary section's prepared
> content in full (it already contains the wrap-up and the one-thing-to-remember framing — do
> not additionally improvise your own summary). Ask its verification question, then follow this
> closing sequence every time, regardless of how the call has gone so far:
>    a. [unchanged — thank them and say a clear, natural goodbye...]
>    ..."

This makes Rules 1 and 8 apply the same teach/checkpoint/pause/advance discipline Rules 3–5
already mandate for real sections, scoped only to the two bookends — no other rule changes.

Because this file is explicitly documented as isolated to the Hume-native path (behind
`NEXT_PUBLIC_HUME_NATIVE_ENABLED`) with zero effect on the LIVE-01 / Custom-LLM-bridge path per
its own header comment, this edit cannot regress that other path — confirmed in scope per the
brief's "must not regress ... LIVE-01/Hume-native voice path when its own toggle is on" language
(this literally is that path, and it is being made *more* correct, not changed in a way that
alters its own toggle's on/off behavior).

**Note — is there an equivalent instruction set for the LIVE-01/Custom-LLM-bridge path?** The
Custom-LLM bridge (`app/api/clio/chat/completions`) is turn-steered per-message rather than
driven by one upfront static prompt, and its per-turn steering already derives directly from
`buildSessionScript()`'s output (via `lib/clio-context-builder.ts`), which is the function fixed
in 4.1. Since 4.1 already makes `buildSessionScript()` emit real Overview/Summary content for
both paths, no separate prompt-template edit is needed for LIVE-01 — it inherits the fix
automatically through the shared `buildSessionScript()` function. This is called out explicitly,
not left as an assumption.

### 4.3 — Content-readiness guard fix (Issues B & C)

**Root problem being fixed:** `content_status: 'ready'` can be set by more than one code path,
and at least one of those paths (`provision-config/route.ts`) has no verification tied to what
actually got persisted before writing `ready`. The fix is not "patch Step H harder" — Step H is
fine for the path it guards. The fix is to make the **write of `content_status: 'ready'`
itself** — regardless of which code path performs it — impossible without a same-transaction,
just-verified check that real content exists for exactly this session.

**New shared helper — single source of truth for "is this session's content actually ready":**

`lib/content/content-readiness.ts` (new file):

```ts
export interface ContentReadinessResult {
  ready: boolean
  reason?: string
  topicContentCacheRows?: number
  liveConductorTabs?: number
}

/**
 * The ONLY function permitted to determine whether a session's generated
 * content is real enough to mark content_status = 'ready'. Called
 * immediately before every write of content_status: 'ready', in the same
 * function/request that performs that write — never cached, never trusted
 * from a prior check.
 *
 * A session is ready if EITHER:
 *   - topic_content_cache has at least 1 row for topic_id = sessionId
 *     (the standard pipeline path), OR
 *   - live_conductor_content.tabs is a non-empty array with every tab
 *     containing a non-empty article.subtopic_title and at least one
 *     non-empty prose field under article.sections (the live-conductor
 *     path) — mirrors this file's existing isSuspiciouslyEmpty() check,
 *     but as the single named source of truth instead of a local inline
 *     helper duplicated per call site.
 * A session is NOT ready if neither condition holds — this function never
 * infers readiness from content_status itself (that would be circular).
 */
export async function verifyContentReadiness(
  supabase: SupabaseClient,
  sessionId: string,
  liveConductorContent?: LiveConductorContent | null
): Promise<ContentReadinessResult>
```

**Call site 1 — `inngest/session-content-pipeline.ts` Step H (existing pipeline path,
line 463–489):** unchanged in effect — it already does exactly what `verifyContentReadiness`'s
`topic_content_cache` branch does. Refactored to call the new shared function instead of
inlining the count query, so there is exactly one implementation of "what counts as ready" in
the codebase, not two. No behavior change for this call site.

**Call site 2 — `inngest/session-content-pipeline.ts` LIVE-01 branch (line 241–287):** currently
writes `content_status: 'ready'` at line 259 unconditionally after generation completes, with no
verification. Fixed to call `verifyContentReadiness` against the just-generated
`liveConductorContent` object **before** the `sessions` update, and throw (not silently return)
if not ready — matching Step H's existing throw-on-failure behavior for the standard path. This
makes the two branches of this same pipeline consistent with each other for the first time.

**Call site 3 — `app/api/hume-native/provision-config/route.ts` (the confirmed root cause,
lines 250–260):** this is the fix that directly closes Issue B's gap. Reordered so verification
happens **before** the write, not after:

```ts
// BEFORE (current, buggy order — write first, verify after, no rollback on failure):
//   1. supabase.from('sessions').update({ live_conductor_content: healed, content_status: 'ready' })
//   2. rebuild sections/trainingScripts from healed.tabs
//   3. isSuspiciouslyEmpty() recheck — on failure, return 502 (write from step 1 already committed)

// AFTER:
//   1. rebuild sections/trainingScripts from healed.tabs (unchanged logic, just reordered earlier)
//   2. const readiness = await verifyContentReadiness(supabase, sessionId, healed)
//   3. if (!readiness.ready) { log with readiness.reason; return 502; content_status is NEVER
//      touched — no write happens at all, so there is nothing to roll back }
//   4. only if readiness.ready: supabase.from('sessions').update({ live_conductor_content: healed,
//      content_status: 'ready' })
```

This guarantees the exact same invariant Step H already guarantees for the standard pipeline:
**`content_status` can only become `'ready'` in the same code path, immediately after, and
conditioned on, a fresh verification that real content exists** — never write-then-check.

**Any future call site that writes `content_status: 'ready'`** (there must never be a fourth
one added without going through this) is required to call `verifyContentReadiness` immediately
before the write, in the same function. This is documented as a hard rule in a comment directly
above the `sessions` table's `content_status` column usage in `lib/content/content-readiness.ts`
itself, and in a one-line comment at each of the three call sites pointing back to it, so a
future PR touching any of them sees the rule in the diff.

**Does this address Inngest step memoization risk (brief hypothesis)?** Yes, incidentally: Step
H's refactored call still runs inside its own `step.run('mark-session-ready', ...)` block,
unchanged — a memoized/replayed step still re-executes the function body (including the fresh DB
count) on every invocation unless Inngest has already durably recorded that exact step's
completed result, which is standard, expected Inngest behavior and not something this fix
alters or needs to alter. No Step naming or memoization-configuration change is included in this
fix (see Section 10 — flagged as a separate, lower-confidence future item if ever needed, since
no direct evidence ties it to this incident).

## 5. Screen / Flow Description

No new screens, routes, or UI states are introduced. This fix changes the *spoken content* and
*internal status-write logic* behind two screens that already exist and already render
correctly (`SessionOverview`, `SessionSummary` — visual layer unchanged, confirmed by inspection
of `session-bookends.ts`: only the `data.script` field is added, nothing visual is touched). The
flow a participant experiences is unchanged in shape: join → Overview screen appears → Clio
speaks → subtopics → Summary screen appears → Clio speaks → session ends. What changes is that
Clio now has real, deliberate things to say at the two ends of that flow instead of nothing.

No new user-facing states are added for Issue B/C's fix — it is entirely internal
(pipeline/route logic + one new status-check helper file). No UI reads or displays the
distinction between "verified ready" and "not verified" differently than it does today; it
continues to key off `content_status` exactly as before.

## 6. Data Requirements

**Read:**
- `sessions.session_title`, and the already-computed `agenda` / `covered_subtopics` arrays
  passed into `wrapSectionsWithBookends` (no new reads — these are existing function parameters).
- `topic_content_cache` — row count by `topic_id` (existing read, now centralized in
  `verifyContentReadiness`).
- `sessions.live_conductor_content` — read for the readiness check at call sites 2 and 3
  (existing field, no schema change).

**Written:**
- `lib/templates/session-bookends.ts` — no new DB writes; `data.script` is an in-memory field on
  the `TemplateSection` object already being constructed and returned (persisted wherever the
  caller already persists `TemplateSection`s today — no new persistence path).
- `sessions.content_status` — write behavior changes only in *ordering/gating* at call sites 2
  and 3 (Section 4.3); the column, its type, and its possible values (`'pending' | 'generating' |
  'ready'`) are unchanged.

**No new tables, no new columns, no migration required.**

**APIs called:** none new. No new LLM calls (explicitly ruled out per Section 4.1's decision).

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given a session with 3 real subtopics, when `wrapSectionsWithBookends` builds the Overview
   section, then `section.data.script.teach` contains the session title and all 3 subtopic
   titles in the fixed template format (Section 4.1), with no filler text.
2. ✓ Given the same session, when `buildSessionScript()` renders the Overview section's script
   block, then the TEACH line equals `section.data.script.teach` verbatim — the generic filler
   line (`"(No script — explain the key concepts..."`) never appears for `SessionOverview` or
   `SessionSummary` section types.
3. ✓ Given a session where one subtopic was skipped, when the Summary section is built, then
   `covered_subtopics` (and therefore the Summary TEACH content) excludes the skipped subtopic's
   title, exactly as today's existing filter behavior already guarantees.
4. ✓ Given the zero-real-subtopics defensive branch (`realSections.length === 0`), when Overview
   and Summary are built, then both `data.script` fields are populated with the zero-subtopic
   template text (Section 4.1) — the function never throws and never leaves `script` undefined.
5. ✓ Given the Hume-native prompt template, when Rule 1 fires at session start, then the
   assembled prompt instructs Clio to deliver the Overview's `teach`/`checkpoint` content and
   wait for a response before proceeding to subtopic 1 — verified by asserting the new Rule 1
   text is present in `HUME_NATIVE_PROMPT_TEMPLATE`.
6. ✓ Given `session-content-pipeline.ts`'s standard (non-live-conductor) path, when Step H runs
   with 0 `topic_content_cache` rows for the session, then it throws before any `content_status`
   write occurs — unchanged existing behavior, now proven via the shared
   `verifyContentReadiness` helper's unit tests instead of Step H's inline logic.
7. ✓ Given `session-content-pipeline.ts`'s `LIVE_CONDUCTOR_ENABLED` branch, when
   `generateTopicBackground`/content generation produces an empty or malformed
   `liveConductorContent.tabs` array, then the function throws before writing `content_status:
   'ready'` — this is new coverage; today this branch has no such check.
8. ✓ Given `app/api/hume-native/provision-config/route.ts`'s self-heal path, when
   `generateLiveConductorContent` returns tabs that fail `verifyContentReadiness` (e.g. all tabs
   have empty `article.sections`), then the route returns its existing 502 response AND never
   writes `content_status: 'ready'` to the `sessions` table — this directly fixes Issue B's
   confirmed root cause; today the write happens regardless of this outcome.
9. ✓ Given the same self-heal path succeeding normally (tabs have real content), when the route
   completes, then `content_status: 'ready'` and `live_conductor_content` are written together in
   one update, exactly as today, with no change in the success-path behavior a user would
   observe.
10. ✓ Given any NEW session created after this fix ships, it is not possible, through any of the
    three call sites identified in Section 4.3, for `content_status` to become `'ready'` while
    both `topic_content_cache` has 0 rows for that session AND `live_conductor_content.tabs` is
    empty/missing/malformed — every call site is now gated by the same shared check.
11. ✓ Given the existing broken session `12dacbd0-f306-46c9-a083-75522d784084`, this fix reads
    and writes nothing for that session's row — its `content_status`, `topic_content_cache` rows,
    and `sub_sessions` remain exactly as they are today (no backfill, per Known Constraints).

## 8. Error States

- **`verifyContentReadiness` DB query fails (network/transient error) at any call site:** treated
  identically to "not ready" — throw (pipeline paths) or return 502 (route path). Never treated
  as "ready" on a query failure; failing loudly on an inconclusive check is the entire point of
  this fix.
- **`generateLiveConductorContent` self-heal genuinely produces empty tabs (real generation
  failure, not a bug):** unchanged from today's existing behavior at the *user-facing* level — the
  route already returns a 502 in this case via the pre-existing `isSuspiciouslyEmpty` recheck.
  What changes is that `content_status` is no longer left stuck at `'ready'` afterward; it remains
  whatever it was before this call (typically `'pending'` or `'generating'`), which is correct —
  it allows a future retry (via the hourly cron's stale-ready recovery, or a fresh self-heal
  attempt) to be attempted again, rather than a false `'ready'` blocking all future recovery
  attempts as it does today (the hourly cron in `session-content-cron.ts` only re-queues sessions
  it can see are NOT `'ready'`).
- **Overview/Summary `script` template functions receive an unexpectedly empty `sessionTitle`:**
  falls back to `"this session"` in place of the title (e.g. "Today we're covering this
  session.") rather than producing a broken sentence with an empty string spliced in. This is a
  pure string-safety guard, not a new decision point requiring escalation.

## 9. Edge Cases

- Single-subtopic session — covered in Section 4.1 (Overview and Summary templates both have an
  explicit singular-phrasing branch).
- Zero-subtopic session — covered by the existing defensive branch in `wrapSectionsWithBookends`;
  templates handle it explicitly (Section 4.1).
- All subtopics skipped (Summary's `covered_subtopics` is empty) — explicit fallback line in
  Section 4.1.
- A session using the Custom-LLM-bridge path (LIVE-01, not Hume-native) — inherits the
  Overview/Summary content fix automatically via the shared `buildSessionScript()` function
  (Section 4.2, final note); no separate prompt-rule edit needed or made for that path.
- A session that legitimately uses the live-conductor branch and has real, correctly-generated
  tabs — success path is unchanged; `verifyContentReadiness` passes immediately and
  `content_status: 'ready'` is written exactly as it is today, same timing, same shape.
- Concurrent requests to `provision-config` for the same session (e.g. a retried request) — out
  of scope for this fix; not mentioned in the brief, and the existing route has no locking today
  either. Not a regression introduced by this change.

## 10. Out of Scope

- **No backfill or repair of session `12dacbd0-f306-46c9-a083-75522d784084`** or any other
  historical session — explicit, repeated constraint from the brief. This session's DB row is
  never read or written by any part of this fix.
- **No general audit of every `content_status` or readiness flag in the codebase.** Only the
  three call sites identified in Section 4.3 (Step H / LIVE-01 branch / `provision-config`
  self-heal) are touched.
- **`sub_sessions[].template_section` consistency checking** — confirmed (Section 3a) to be a
  fully separate, independent subsystem (`lib/session-plan.ts`) with no code-level relationship
  to `content_status` today. Flagged as a **separate future item**: that legacy pre-generation
  path has its own unguarded "readiness" signal (`visual_status: 'ready'`) with no equivalent
  verification, and may be worth the same treatment eventually — but building that now would
  expand this spec's scope beyond what the brief authorizes and beyond what CEO has approved.
  Recommend a follow-up brief if/when that path is still in active use.
- **Inngest step-memoization hardening** (e.g. renaming steps, adjusting retry/memoization
  config) — no evidence ties this to the actual root cause found (Section 3), so no changes are
  made here. Flagged as a future item only if new evidence of memoization-driven false-readiness
  ever surfaces.
- **Any change to the LIVE-01 / Custom-LLM-bridge path's own behavior, tool-steering, or session
  ending logic** beyond it inheriting the Overview/Summary content fix via the shared
  `buildSessionScript()` function it already calls. No new code is added to that path directly.
- **Any change to `session-content-cron.ts`'s stale-ready recovery task.** It continues to work
  exactly as today (resetting `'ready'`-but-empty sessions back to `'pending'` on an hourly
  sweep) — it remains a useful safety net for the standard pipeline path even after this fix, and
  is unmodified. It does not currently check `live_conductor_content`, which is a gap, but
  extending it to do so is not required to close Issue B (the write-time fix in Section 4.3
  prevents the false state from ever being written in the first place, which is the stronger and
  directly-requested fix). Flagged as a low-priority future hardening item, not built now.

## 11. Open Questions

None.

## 12. Dependencies

- `lib/templates/types.ts` — `TemplateSection` / `TemplateMeta` type definitions must support an
  additional optional `script` field on `data` for `SessionOverview`/`SessionSummary` section
  types; a small type addition, not a breaking change to the existing type (all other section
  types' `data` shapes are untouched).
- `lib/content/live-conductor-content.ts` — `LiveConductorContent` / `LiveConductorTab` /
  `ContentArticle` type shapes (already exist, used as-is by `verifyContentReadiness`'s
  live-conductor branch — no changes needed to this file itself).
- Existing `NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED` and `NEXT_PUBLIC_HUME_NATIVE_ENABLED` toggles —
  both already exist and are unchanged by this fix; this fix makes the code paths gated by them
  more correct, not differently toggled.
- No new environment variables, no new npm packages, no new migrations.

---

## Files Changed

1. **`lib/templates/session-bookends.ts`** — add `buildOverviewTeachContent()` and
   `buildSummaryTeachContent()` template functions (Section 4.1); populate `data.script` on both
   the Overview and Summary `TemplateSection` objects returned by `wrapSectionsWithBookends`
   (both the zero-subtopic defensive branch and the normal branch).

2. **`lib/clio-context-builder.ts`** — `buildSessionScript()`: add a branch that reads
   `teach`/`checkpoint`/`continue` from `section.data.script` for `SessionOverview` /
   `SessionSummary` section types instead of from `trainingScripts[i]`; no change to any other
   section type's handling.

3. **`lib/voice/hume-native/prompt-template.ts`** — update Rule 1 and Rule 8 text inside
   `HUME_NATIVE_PROMPT_TEMPLATE` per Section 4.2; bump `PROMPT_TEMPLATE_VERSION` per this file's
   own existing convention ("bump on any structural edit to the fixed portion").

4. **`lib/content/content-readiness.ts`** (new file) — `verifyContentReadiness()` shared helper
   per Section 4.3.

5. **`inngest/session-content-pipeline.ts`** — Step H (lines ~463–489): refactor inline count
   check to call `verifyContentReadiness` instead (no behavior change). LIVE-01 branch (lines
   ~241–287): insert a `verifyContentReadiness` call before the `sessions` update at line 259;
   throw if not ready.

6. **`app/api/hume-native/provision-config/route.ts`** — reorder lines 250–260 (Section 4.3, call
   site 3): move the `sections`/`trainingScripts` rebuild earlier, call `verifyContentReadiness`
   against `healed`, and only perform the `sessions` update (`live_conductor_content` +
   `content_status: 'ready'`) if the check passes; return the existing 502 response if not,
   without writing `content_status` at all in that case.

7. **`lib/templates/types.ts`** — add optional `script?: { teach: string; checkpoint: string;
   continue: string }` field to whatever type represents `SessionOverview`/`SessionSummary`
   section `data` shapes (exact location depends on how `TemplateSection`'s `data` union is
   currently typed per section type — developer to confirm the minimal, additive type change
   during implementation; no other section type's `data` shape is touched).

No changes to: `session-meeting-setup.ts`, `app/api/recall/bot/route.ts` (both consume
`wrapSectionsWithBookends`'s output unchanged — they get the fix automatically), `lib/session-plan.ts`
(explicitly out of scope, Section 10), `inngest/session-content-cron.ts` (explicitly out of scope,
Section 10), any migration file, any test file (test additions are expected but are the
developer's/testing-agent's normal responsibility, not enumerated here as a "files changed" item
per template convention used in prior specs).

---

## CEO Approval

Pending.
