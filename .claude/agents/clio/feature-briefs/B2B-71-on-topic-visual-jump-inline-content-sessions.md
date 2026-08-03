# Feature Brief: B2B-71 — On-topic visual jump for the widget channel (standalone build)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-08-03 (scope finalized same day, per Arun's direct answer below)
Status: SCOPE RESOLVED — ready for BA Requirement Document

**Numbering note:** highest ID found in both `docs/b2b-pivot-status.md` and
`.claude/agents/clio/feature-briefs/` is B2B-70. This brief is **B2B-71** (verified directly against
both locations, not assumed from the last brief built).

---

## What Arun Said (verbatim)

> "We need to build this capability. We know which page or image belongs to which topic so when we
> know which topic user asks question why can't we render that page. We need not go forward or
> backward. Directly render that asset on which we are discussing about"

Context this instruction sits inside: Arun asked how the widget channel's `render_url` works and
whether the bot can navigate back to a previous page when the learner asks a question about earlier
content. The Orchestrator investigated the live code (not assumption) and reported findings, which I
have treated as verified fact for this brief — see "What's already true in the code" below.

## Arun's Follow-Up Decision (verbatim) — resolves the two questions this brief originally flagged

The first draft of this brief flagged two questions as needing Arun's direct input before a BA spec
could be approved: (1) whether this touches the shared meeting-bot code path or is widget-only, and
(2) whether a question-triggered jump redefines where `advance_tab` continues from. Arun answered both
directly:

> "Can you build this feature confidently because page rendering issues we faced a lot until we made it
> working in live meeting. If you want to create a separate file and modify for this solution pathway
> that is fine as well. If we see this working then we can merge with the live meeting solution later."

**This resolves both questions:**

1. **Scope is WIDGET-ONLY, via a genuinely separate implementation.** Arun's reasoning is explicit and
   risk-driven: the live-meeting render path (`PartnerRenderClient.tsx` / `inlineTools`) is exactly the
   file/pair this project spent a full overnight session getting stable after real, painful page-render
   bugs. He does not want this new, less-proven capability touching that path at all. Concretely: build
   new, standalone file(s)/component(s) for the widget channel's tool-handling and rendering, structurally
   parallel to `inlineTools.show_visual` / `resolveSectionIndex` / `goToSection` but NOT sharing code with
   `PartnerRenderClient.tsx`. The existing meeting-bot render component and its prompt-template rules must
   not be edited at all as part of this build — zero risk to the already-stabilized live-meeting
   experience. If the widget-channel version proves out, folding it into (or replacing) the shared
   meeting-bot path is an explicit, separate future decision — not part of this build, not implied by it.

2. **Position-tracking is no longer an entanglement risk, because the implementation is now standalone
   with its own state** — there is no shared `activeIndexRef` to worry about conflating. But the
   underlying *behavior* Arun originally asked for is unchanged and still applies: showing a different
   page to answer a question must still be a side-trip. Whatever forward-progress tracking the new,
   independent widget implementation uses, a question-triggered jump must not change what that tracking
   considers "current" for progression purposes. This still needs to be given a precise, named shape by
   the BA (e.g. two distinct pieces of state in the new component) — it's just no longer a risk to the
   shared file, since the shared file isn't touched.

Both of the CEO-level product questions this brief needed Arun to answer are now closed. What remains
below (Questions for BA #3–7 in the original numbering, renumbered below) are BA-resolvable
implementation-detail questions, not open product decisions.

## New Finding: the widget channel has no render route of its own today (verified against live code)

Before finalizing this brief I checked what "separate file" needs to mean concretely, since Arun's
instruction ("create a separate file and modify for this solution pathway") doesn't by itself specify
*how* the widget channel would come to load a different component. I checked directly:

`app/api/partner/v1/widget-sessions/route.ts` constructs `render_url` as literally
`${appUrl}/partner-render/${clioSessionRef}` (lines 197, 212, 265) — the exact same route served by
`app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx` → `PartnerRenderClient.tsx` that
meeting-bot sessions use. **There is no separate widget render route today.** Both channels currently
converge on one URL pattern and one page/component.

This matters because "genuinely separate implementation, don't touch `PartnerRenderClient.tsx`" has two
structurally different ways to realize it, and the BA must pick one explicitly rather than leave it
implicit:

- **(a) Branch inside the existing shared route** — `page.tsx` or `PartnerRenderClient.tsx` inspects
  session type and conditionally mounts a different child component for widget sessions. This technically
  keeps one URL pattern, but it means touching the shared file at the branch point — a smaller edit than
  rewriting `inlineTools`, but not "zero edits to the file," which is a meaningfully weaker guarantee than
  what Arun asked for.
- **(b) Give the widget channel its own dedicated route** (e.g. `/widget-render/[clio_session_ref]`),
  with its own `page.tsx` and a new, standalone client component, and change
  `widget-sessions/route.ts`'s `render_url` construction to point there instead of at `/partner-render/`.
  This is a strictly cleaner realization of "genuinely separate, not touching
  `PartnerRenderClient.tsx` or its route at all" — the meeting-bot path (`/partner-render/...`) is
  literally untouched, byte-for-byte, and the widget path lives entirely in new files.

**My recommendation is (b)** — it's the only version of "separate" that gives Arun the zero-risk
guarantee he's actually asking for (the whole reason he asked for a separate file is to protect the
just-stabilized meeting-bot path; (a) still edits that path's shared file). This is a technical/
structural decision within my and the BA's normal autonomy — it doesn't change any product behavior,
only which files implement it — but I'm calling it out explicitly rather than letting the BA infer it,
since "separate file" alone under-specifies it and a wrong choice here would silently reintroduce the
exact risk Arun is trying to avoid.

## The Problem Being Solved

Today, when a participant asks a question about a topic that isn't the page currently on screen, Clio
can answer the question out loud (the model already has full narration text for every page in its
system prompt from session start) — but the screen stays frozen on whatever page it happened to be
showing. The learner hears an answer about, say, page 3's content while looking at page 6. That's a
disjointed experience for a product whose whole pitch is a tight narration-to-visual match.

Arun's ask is narrow and specific: when the model judges a question is about a different page than
what's on screen, jump the screen directly to that page's visual so what's shown matches what's being
said. This is explicitly **not** a request to change how the session progresses forward — Arun's own
words rule that out ("We need not go forward or backward"). `advance_tab`'s forward-only,
model-judgment-timed progression stays exactly as it is. This is a side-trip capability layered on top,
not a redefinition of progress.

## What Success Looks Like

- Participant asks a question referencing an earlier (or later) topic than what's currently displayed.
- The model recognizes the question is about a different page, calls `show_visual` with either
  `section_index` or `topic_title` identifying that page, and the screen jumps directly to it while
  Clio answers.
- The session's forward progress (wherever `advance_tab` is tracking) is unaffected by this jump —
  when the model later calls `advance_tab` again, it continues from where the session actually was,
  not from wherever the question-answer jump happened to land.
- No regression to any of the behavior this project spent a full overnight session stabilizing
  (forward-only `advance_tab`, playback-catch-up wait, debounce/dedup guards, "tool call never ends
  your turn" rules) — see Known Constraints.
- **Scoped to the widget channel only**, built as a standalone implementation. The existing meeting-bot
  render path (`app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`, its
  `inlineTools`, and `lib/voice/openai-realtime-prompt-template.ts`'s existing rules) is not edited at
  all as part of this work — provably, not just in intent. If the widget-channel version proves out,
  merging it into (or replacing) the shared meeting-bot path is a separate future decision Arun will make
  later, not something this build should anticipate or half-build toward.

## What's Already True in the Code (verified by the Orchestrator, not assumed)

I'm passing this through because it directly shapes what's actually left to build — the BA should
treat this as ground truth to start from, not re-derive from scratch:

1. The voice model already has the full narration text for every page in its system prompt at session
   start — it can always verbally answer a question about any page's content regardless of what's on
   screen today. The gap is purely visual, not conversational.
2. Two navigation tools are wired into the live session: `advance_tab` (forward one page only, model's
   own judgment on timing) and `show_visual`.
3. `show_visual`'s tool schema (`lib/voice/openai-realtime-tools.ts`) already accepts either
   `section_index` (integer) or `topic_title` (string), with a description already telling the model to
   "pass whichever of section_index or topic_title you know" — the schema was already built to support
   jumping to an arbitrary section, this was never built out only for "the next one."
4. In `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` there are two
   different tool-handler implementations for `show_visual`, chosen by session type:
   - `templateTools.show_visual` (Option 2 / content_ref-template-mode sessions — currently disabled
     platform-wide via `TEMPLATE_MODE_SESSIONS_ENABLED`, see `isTemplateModeEnabled()` in
     `lib/partner/session-schema.ts`) already does exactly what Arun is describing: it calls
     `resolveSectionIndex(params)` (resolves `section_index`, or looks up `topic_title` against each
     section's `subtopicTitle`), then `goToSection(idx)`, which sets `activeIndex` to that arbitrary
     index and scrolls it into view. A genuine, proven, working arbitrary jump.
   - `inlineTools.show_visual` — used by every session built from inline `content_pages`, which is
     every meeting-bot session today AND every widget session (the widget channel always uses inline
     content) — is currently a complete no-op: `async () => { return 'Visual is showing.' }`. It was
     deliberately neutered by B2B-58 because it used to be wired identically to `advance_tab` and would
     force-advance the page before Clio had finished speaking about the new section. The comment there
     confirms it was made a no-op to stop unwanted auto-advance, not because arbitrary jump-on-demand is
     undesirable. The underlying mechanism (`resolveSectionIndex` / `goToSection`) already exists in
     this same file and is proven working by `templateTools` — it simply isn't wired up for the inline
     path.
   - `advance_tab` (both variants) is genuinely, deliberately forward-only
     (`Math.min(current + 1, count - 1)`) and must stay that way per Arun's own words above.

So the mechanism this brief needs is proven and already exists — but per Arun's decision above, this
build does **not** wire it into `inlineTools` or touch `PartnerRenderClient.tsx` at all. Instead, the
new standalone widget implementation should port the *proven logic* of `resolveSectionIndex` /
`goToSection` (arbitrary-index resolution by `section_index` or exact `topic_title` match, then jump)
into its own new component/state — reusing the pattern, not the file. The work is: (a) build a new,
independent widget render component + tool-handler wiring with this jump capability built in correctly
from the start (never having carried the auto-advance bug B2B-58 had to fix, since this is new code, not
a repair of `inlineTools`), and (b) resolving the remaining implementation questions below.

## Known Constraints

- **Widget-only, standalone implementation** (Arun's direct decision, 2026-08-03): zero edits to
  `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`, its `inlineTools`, or
  `lib/voice/openai-realtime-prompt-template.ts`'s existing rules. The meeting-bot render path must be
  provably untouched — the BA spec's acceptance criteria should include "diff against
  `PartnerRenderClient.tsx` and the existing prompt template is empty" as a literal, checkable bar.
- `advance_tab`'s forward-only, model-judgment-timed progression must not change in any way, in
  whichever component (existing or new) implements it. This is Arun's explicit instruction, not a
  design preference.
- The jump-for-a-question behavior must be a side-trip: it must not redefine whatever the new,
  independent widget implementation treats as "current position" for forward-progress purposes. Since
  this is new, standalone state (not `activeIndexRef`), the BA has a clean slate to name this correctly
  from the start — see Questions for BA #1.
- Any implementation must preserve, with zero regression, every stabilized meeting-bot behavior — moot
  for widget-only code, but the BA spec must still confirm via the full existing test suite that nothing
  in the shared voice-adapter layer (if any is actually shared — see Questions for BA #3) is disturbed.
- Only approved libraries/patterns per `CLAUDE.md` — this is new code following an existing proven
  pattern (`resolveSectionIndex`/`goToSection`), not a new vendor integration, so no new approvals are
  anticipated.
- No AI-generated content filling an undefined screen — this feature only changes *which already-built
  page* is displayed, it does not generate any new visual content, so this constraint is structurally
  satisfied as long as the BA spec keeps it that way.

## Questions for BA

Both CEO-level product questions (scope, and whether the jump redefines progress) are now resolved by
Arun directly — see "Arun's Follow-Up Decision" above. What remains are implementation-detail questions
the BA must resolve and document concretely. None of these require going back to Arun first, but the BA
must not leave any of them as prose without a concrete, checkable answer.

1. **Where does the new standalone widget render live, structurally?**
   I verified `widget-sessions/route.ts` constructs `render_url` as `${appUrl}/partner-render/${id}` —
   the same route meeting-bot uses. My recommendation (see "New Finding" above): give the widget channel
   its own dedicated route (e.g. `/widget-render/[clio_session_ref]`) with its own `page.tsx` and a new,
   standalone client component, and change `render_url` construction in `widget-sessions/route.ts` to
   point there. The BA must confirm this route name/shape (or propose a better one) and specify the new
   component's file path(s) precisely — this is the concrete realization of "separate file."
   Also confirm: does anything else construct or assume `/partner-render/...` as the widget's render URL
   (e.g. partner-facing docs, the Configurator's widget preview, cached/previously-issued render URLs for
   in-flight widget sessions) that would break if the URL pattern changes? Enumerate and address.

2. **Position-tracking state shape in the new component.**
   The BA should name the two pieces of state precisely (e.g. `progressIndexRef` for where forward
   progression continues from vs. `displayedIndexRef` for what's currently on screen), specify exactly
   which tool call touches which, and confirm this is a clean design given there's no legacy
   `activeIndexRef` constraint to work around this time — this is fresh code, so get the shape right from
   day one rather than porting over any awkwardness from the shared file.

3. **What, if anything, is actually shared between the new widget component and the existing meeting-bot
   path?** E.g. `lib/voice/openai-realtime-tools.ts` (tool schema defs), `lib/voice/adapter.ts`
   (`VoiceSessionAdapter` interface), or any Hume-related files. "Standalone" means the render
   component/tool-handler wiring and the meeting-bot prompt-template rules are not touched — it does not
   necessarily mean duplicating every shared, lower-level utility. The BA must draw this line explicitly:
   what's reused as-is (safe, since it's not being modified) vs. what's genuinely new/parallel code, so
   "standalone" doesn't silently become "also forked the tool schema" or vice versa "also edited the
   shared adapter."

4. **How does the model reliably resolve "which topic/page the question is about"?**
   The proven pattern (`resolveSectionIndex`'s exact-string `findIndex` against a section's
   `subtopicTitle`) has no fuzzy matching. Recommend porting the same approach into the new component,
   governed by an explicit new prompt rule (in the widget's own prompt assembly, not the shared
   `openai-realtime-prompt-template.ts`) instructing the model to use a known section title verbatim. The
   BA should confirm this is sufficient or specify something more robust — don't leave it open.

5. **Rate/abuse guard.**
   Recommend a debounce or cap analogous in spirit to `ADVANCE_DEBOUNCE_MS`, to prevent a chatty
   participant from thrashing the screen with rapid tangential questions. The BA should specify a
   concrete threshold and behavior for the new component.

6. **New prompt-rule text, and does it need to exist anywhere else?**
   The widget's own prompt assembly needs a rule governing this new jump-for-a-question use case,
   distinct from (and not contradicting) the existing new-section-intro `show_visual` rule pattern. Since
   this is standalone, there's no risk of destabilizing the already-tuned meeting-bot prompt template —
   but the BA must still write the exact new rule text precisely, not leave it to developer
   interpretation (per this project's "ambiguous UX = STOP" and "implement literally" principles, which
   apply to prompt-rule text exactly as they do to screens).

7. **Do-not-break / test bar for the new component itself.**
   Since this is new code, "don't regress the meeting-bot stabilization" is satisfied by construction
   (nothing shared is touched) — but the BA must still define what test coverage + live test call this
   new widget capability itself needs before shipping (unit tests for jump resolution, a real live widget
   session test asking an off-current-page question, etc.), per this project's QA Gate 3 requirement (no
   PASS on code review alone).

8. **Hume parity for the widget channel.**
   Does the widget channel run on Hume as well as OpenAI Realtime today, or OpenAI-only? If Hume is a
   live option for widget sessions, does this new capability need an equivalent in Hume's prompt
   assembly for the widget path? The BA must not silently scope this to OpenAI Realtime only without
   checking which voice providers the widget channel actually supports and saying so explicitly.

---

## CEO Recommendation on Next Steps

Both CEO-level product questions this brief originally required Arun's input on are now resolved by his
direct answer above (widget-only, standalone implementation; jump is a side-trip realized in new,
independent state). I have enough information to approve this moving to a BA Requirement Document.

**Recommendation:** dispatch to the BA now to write the full Requirement Document (all 12 sections)
against this finalized scope. The BA should treat Questions for BA #1–8 above as the specific things
Section 11 must close out with concrete, checkable answers — none of them require Arun's input first,
but none of them may be left as open prose either. Once the BA returns a complete spec, I will review it
against this brief (does it solve the problem, is scope appropriate, are all 8 questions answered
concretely) before approving it for a developer to build against.
