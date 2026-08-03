# On-Topic Visual Jump — Widget Channel (Standalone Build) — Requirement Document
Version: 1.1
Status: APPROVED
Author: Business Analyst Agent (v1.1 correction: CEO Agent)
Date: 2026-08-03

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Every load-bearing claim in
`.claude/agents/clio/feature-briefs/B2B-71-on-topic-visual-jump-inline-content-sessions.md` was
re-checked directly against source, not taken on faith. Findings below are the answers to the
brief's "Questions for BA" #1–8; the brief's own numbering is kept throughout this document.

- **`widget-sessions/route.ts` render_url construction, confirmed exactly as the brief describes**
  (`app/api/partner/v1/widget-sessions/route.ts`): the idempotent-replay branch (line 197) and the
  normal-success branch (`const renderUrl = ...` line 212, used at line 265) both build
  `${appUrl}/partner-render/${clioSessionRef}` — identical to the do-not-touch meeting-bot
  `/sessions` route's own convention. Confirmed, not assumed.
- **`page.tsx` → `PartnerRenderClient.tsx`, confirmed by direct read.** Both files read in full.
  `page.tsx` (`app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx`) is channel-agnostic —
  it never reads `delivery_channel` and renders identically for a meeting-bot or widget session
  today. Confirmed by grep: `delivery_channel` appears nowhere in `lib/partner/live-render.ts`,
  `lib/voice/hume-adapter.ts`, or `lib/voice/openai-realtime-adapter.ts` — every layer below
  `PartnerRenderClient.tsx` already treats both channels identically. This is why B2B-70's own BA
  spec (`docs/specs/B2B-70-requirement-document.md`, confirmed via `docs/b2b-pivot-status.md`'s
  B2B-70 status row) deliberately reused `/partner-render/` for widget sessions with "zero changes
  and no new wrapper route" — that was the CORRECT call at the time, made for a different reason
  (statelessness, no frame-blocking header) than this document's reason for now separating the two
  paths (isolating a new, less-proven capability from the just-stabilized meeting-bot experience).
  This document is a deliberate, reasoned re-architecture of that prior decision, not a contradiction
  of it — flagged explicitly, not glossed over.
- **`PartnerRenderClient.tsx`'s inline-mode tool handlers, confirmed line-for-line** (lines 313–347):
  `inlineTools.show_visual` is `async () => { return 'Visual is showing.' }` — a genuine no-op,
  exactly as the brief states. `resolveSectionIndex`/`goToSection` (lines 252–270) are template-mode
  (`sections`) only, matching against `section.meta.subtopicTitle` — there is no equivalent for
  inline pages (`InlinePageProp` has `title`/`subtitle`, no `subtopicTitle`).
- **`OPENAI_REALTIME_TOOLS` (`lib/voice/openai-realtime-tools.ts`), confirmed shared and
  provider-internal, not caller-supplied.** `lib/voice/openai-realtime-adapter.ts` line 302 hardcodes
  `tools: OPENAI_REALTIME_TOOLS` inside `OpenAIRealtimeAdapter.create()` itself — the `tools` field
  `PartnerRenderClient.tsx` passes into `create()` (`inlineTools`/`templateTools`) is a different
  thing: a map of JS handler *functions*, not the JSON Schema sent to OpenAI. This means the tool
  schema is genuinely shared, provider-level, and identical for meeting-bot and widget sessions
  today — see §0's Question 3 discussion below for why this document does not need to touch it.
- **Hume's prompt content is baked server-side into an opaque `configId` before the client ever
  loads — confirmed, this is the key asymmetry driving Question 8's answer.**
  `lib/partner/live-render.ts`'s inline-mode branch (line ~619 `assembleHumeNativePrompt(...)`, line
  ~690 `provisionNativeConfig({ sessionId, assembledPrompt: prompt })`) runs entirely server-side,
  inside `resolveLiveSessionRender()`, before `page.tsx` ever returns HTML. The client only ever
  receives `humeConfigId` (an opaque string) — `HumeAdapter.create()`'s call site in
  `PartnerRenderClient.tsx` (lines 608–621) passes no instructions/prompt text at all. Confirmed by
  grep: `voiceInstructions` (the prop meant to carry Hume's raw prompt text) is destructured
  (line 150) but **never read anywhere else in the file** — it is vestigial today, a leftover from
  the pre-B2B-68 architecture the file's own comment (lines 100–106) describes as superseded.
  `sendWrapUpNudge()` (`lib/voice/hume-adapter.ts` lines 365–377) is the only live, client-side,
  Hume-side instruction-injection mechanism that exists — but it sends
  `{ type: 'session_settings', system_prompt: instructionText }`, which **replaces the entire active
  prompt** (per B2B-11 Technical Decision 6, referenced in this codebase's own comments), and is
  already used for the join-greeting and wrap-up-nudge one-time nudges. Reusing it to inject a
  persistent, session-wide new rule would strip out every other existing behavioral rule for that
  turn and risk colliding with the two pollers already using it — not a safe extension point for
  this purpose. This is the concrete basis for Question 8's resolution below.
- **No frame-blocking header anywhere in this app, confirmed by grep of `next.config.mjs`** (no
  `X-Frame-Options`/`Content-Security-Policy` headers configured) — a new `/widget-render/...` route
  is embeddable in an iframe exactly as `/partner-render/...` is today, no new work needed here.
- **No Configurator widget-preview/test tooling exists today, confirmed by grep** of
  `app/(with-clerk)/dashboard/` for `widget` — zero matches. The only widget preview/test surface in
  this codebase is the internal `/demo` "Widget Demo" tab (`app/api/demo/[slug]/widget-dispatch/route.ts`,
  `app/api/demo/[slug]/widget-status/route.ts`), addressed directly in Question 1 below.
- **The partner-facing API docs page does not document the widget-sessions endpoint at all yet**
  (confirmed by grep of `app/(with-clerk)/dashboard/configurator/docs/DocsClient.tsx` and
  `.../configurator/api/content.ts` for `widget` — zero matches, an existing, unrelated gap, not
  something this document needs to fix). No doc-string anywhere hardcodes a `/partner-render/...`
  path for widget sessions specifically.
- **No cached/persisted `render_url` anywhere** — confirmed by reading both server-side construction
  sites (`widget-sessions/route.ts`, `widget-status/route.ts`): both recompute the URL fresh from the
  session's `id` every time: there is no `render_url` column on `partner_sessions`, nothing to
  invalidate.
- **`middleware.ts`, confirmed by direct read** (lines 24, 45–51): `/partner-render/(.*)` is
  registered both in the public-route matcher (line 24) and in `TENANT_SCOPED_PATTERNS` (line 51,
  the B2B-05 defense-in-depth list preventing a silent 404 if `/partner-render/...` were ever served
  under a partner's white-label domain). A new `/widget-render/...` route needs the same two
  additions for the same defensive reasoning, even though today's widget `render_url` is always
  built from `NEXT_PUBLIC_APP_URL` (Clio's own domain), never a partner's white-label host — mirrors
  the existing comment's own reasoning ("so the gap can't resurface if a future change starts serving
  ... URLs under a partner's own domain").
- **`lib/partner/domain-config.ts`'s `RESERVED_SUBDOMAIN_SLUGS`, confirmed by direct read** (line 9):
  contains `'partner-render'` as a reserved subdomain slug (so no partner can register a white-label
  subdomain colliding with the render route). `'widget-render'` is absent and needs adding for the
  same reason.
- **No existing test file asserts the literal `/partner-render/` string for a widget session,
  confirmed by grep.** `tests/integration/b2b70-widget-sessions-api.test.ts` line 148 asserts only
  `expect(json.render_url).toContain('session-1')` — it will pass unchanged once the route
  constructs `/widget-render/session-1` instead. No `widget-status` test file exists at all today
  (confirmed by `find`), so there is nothing to break there either — a new test is added, not an
  existing one modified. This document's own file-change list therefore does not need to touch any
  existing test file, matching this project's standing practice on this exact point (see B2B-70's
  own "zero existing test file should need to change" bar, `docs/b2b-pivot-status.md`).
- **`app/(with-clerk)/layout.tsx`, confirmed by direct read** — wraps children in `<ClerkProvider>`
  but does not itself require a session; `/partner-render` already lives in this route group and
  renders headlessly/unauthenticated today. A new `/widget-render` route can live in the same group
  with zero changes to this layout file.

Nothing in the CEO brief's claims was found to be inaccurate. One thing the brief left as a "BA
should confirm" item, resolved below with a materially narrower scope than a first read of the brief
might suggest: full Hume parity for this specific new capability is **not built** in this document
(Question 8) — a concrete, reasoned, non-silent scope decision, not an oversight.

---

## CEO Review (2026-08-03) — APPROVED, v1.1

Every load-bearing claim above was independently re-verified a second time directly against live
code by the CEO Agent (not accepted on this section's own say-so) — the `render_url` construction
sites in `widget-sessions/route.ts` and `widget-status/route.ts`, `page.tsx`'s channel-agnosticism
and `voice_provider` write, `inlineTools.show_visual`'s no-op vs. `templateTools.show_visual`'s real
`resolveSectionIndex`/`goToSection` mechanism, `OPENAI_REALTIME_TOOLS` being adapter-internal and
untouched, the Hume server-side `configId`/vestigial-`voiceInstructions` claims (plus one supporting
nuance in `hume-adapter.ts` re: `sendWrapUpNudge`'s E0716/Custom-LLM context that strengthens rather
than undermines Question 8's conclusion), `middleware.ts`/`domain-config.ts`'s existing
`partner-render` entries, the 1-based/0-based numbering mismatch, and the existing test's
`toContain('session-1')` assertion surviving the URL change unmodified. All confirmed accurate.

**Scope confirmed clean**: no edit anywhere in this document touches `PartnerRenderClient.tsx`, its
`inlineTools`, or `lib/voice/openai-realtime-prompt-template.ts` — matching Arun's explicit,
risk-driven decision (Feature Brief, "Arun's Follow-Up Decision") exactly. All 8 of the Feature
Brief's "Questions for BA" are resolved with concrete, checkable, code-verified answers; Section 11
is confirmed empty.

**One narrow gap found and corrected directly (v1.0 → v1.1, same pattern as the B2B-70 CEO
correction)**: §6.2's description of `WidgetRenderClient.tsx` discussed `show_visual` and
`advance_tab` in depth but never explicitly required porting `end_session` — a real functional gap
(no way to end a session) rather than a stylistic omission. Added an explicit line requiring all
three `inlineTools`-equivalent handlers. No other changes needed.

**Verdict: APPROVED for developer handoff.** No further CEO-level or Arun-level input is required
before a developer builds against this spec. Standard QA Gate (code review + automated tests + the
mandatory live browser/live-call functional test in §13) still applies before merge, per this
project's QA Gate policy — this approval is a spec-level approval, not a substitute for QA sign-off.

---

## 1. Purpose

Today, in a widget-channel session, a participant can ask Clio a question about a page other than
the one currently on screen — Clio can already answer it verbally (she has every page's narration
content in her system prompt from session start), but the screen stays frozen on whatever page it
happened to be showing. The mismatch between what's said and what's shown undercuts the product's
core pitch of a tight narration-to-visual match.

This feature lets the model, when it judges a question is about a different page, jump the screen
directly to that page's visual while it answers — without in any way changing the session's real
forward progress (`advance_tab` stays exactly as forward-only and model-judgment-timed as it is
today). Built as a genuinely standalone widget-channel implementation, per Arun's explicit,
risk-driven decision (quoted in full in the Feature Brief) to protect the just-stabilized meeting-bot
render path from any risk during this new capability's proving-out period.

What failure looks like without it: an off-topic question always yields spoken-answer/visual-mismatch,
undermining the product's own core promise for exactly the moments (curiosity, clarification) where a
tight match matters most.

## 2. User Story

As a participant in a widget-channel Clio session,
I want the screen to jump to the page I'm asking about when I ask an off-current-page question,
So that what I see matches what I'm hearing, instead of staring at an unrelated page while Clio
answers.

(Single user type — the widget end-user. No partner-admin or Clio-internal-staff interaction with
this specific capability; the reseller only ever sees the resulting iframe, unchanged.)

## 3. Trigger / Entry Point

- **Route:** new, dedicated `/widget-render/[clio_session_ref]` (see Question 1 for the full
  reasoning and file list). Loaded by the reseller's own iframe `src` — the exact value returned as
  `render_url` from `POST /api/partner/v1/widget-sessions` (unchanged API contract shape; only the
  path segment of the URL's value changes, from `/partner-render/...` to `/widget-render/...`).
- **Trigger for the jump itself:** the voice model, mid-conversation, judges (from the participant's
  spoken question) that the question is about a page other than the one currently displayed, and
  calls the `show_visual` tool with `section_index` and/or `topic_title` identifying that page. This
  is model-judgment-timed, not a fixed rule the code enforces (the code only resolves and renders
  whatever the model asks for, exactly like every other tool call in this system).
- **Required state:** identical to today's widget-channel requirement — no Clerk session (public,
  headless-loadable route, mirroring `/partner-render`'s own posture), a valid, existing
  `partner_sessions` row whose `delivery_channel = 'widget'` (see Question 1's new defensive check),
  and (for the jump specifically) a live, open voice connection — the tool call is only ever received
  while `status !== 'ended'`.

## 4. Screen / Flow Description

This document does not change what any individual widget page *looks like* — every existing inline
page (HTML iframe or image) renders pixel-identical to how `PartnerRenderClient.tsx`'s inline branch
renders it today (same sandboxed `srcDoc`/`src` iframe, same image `<img>` fallback, same
`InlinePageErrorBoundary`, same connect-warmup overlay, same bottom-right "Voice connection issue"
banner). What changes is *which* already-rendered page is scrolled into view and *when* — a
navigation event, not a new visual.

**State 1 — Normal narration (unchanged).** The widget shows page N (whatever `progressIndexRef`
currently points to — see §6 for the exact state model), Clio narrates it. No jump has occurred.
Identical to today's inline-mode behavior in every respect.

**State 2 — Off-topic question triggers a jump.** The participant asks a question the model judges
is about a different page (say, page 2, while page 5 is on screen). The model calls `show_visual`
with `topic_title` (or `section_index`) identifying page 2. The widget:
1. Resolves the target index (§6.3 — exact-title match against the page's own `title`, or the given
   `section_index` directly, with a same-index fallback if neither resolves — see Question 4).
2. If the jump debounce/cap (§6.4, Question 5) is not currently blocking, scrolls smoothly to page 2
   (`behavior: 'smooth', block: 'start'`, identical CSS-level scroll mechanics to today's
   `goToSection`) and updates `displayedIndex`/`displayedIndexRef` to 2. `progressIndexRef` (where
   real forward progress continues from) is **not** touched — it still points at 5.
3. Clio answers the question, referencing what's now on screen (page 2).
4. No other visible change: no banner, no toast, no indication to the participant that a "jump"
   specifically occurred versus a normal page transition — from the participant's point of view this
   simply looks like the screen scrolling to the relevant page, identical in visual mechanics to a
   normal forward `advance_tab` transition.

**State 3 — Forward progress resumes after a jump.** Once the question is answered, Clio continues
teaching. When she next calls `advance_tab`, the widget computes `next = progressIndexRef.current + 1`
(= 6, i.e. one past page 5, the last real teaching position) — **not** `displayedIndexRef.current + 1`
(which would incorrectly compute 3, one past the page 2 the jump happened to land on). The screen
scrolls to page 6 and both `progressIndexRef` and `displayedIndexRef` are updated to 6, re-syncing
them. This is the exact "side-trip, not a redefinition of progress" behavior Arun's instruction
requires, made concrete.

**State 4 — Debounced/capped jump request.** The model calls `show_visual` again within the debounce
window (§6.4) or after the rolling cap has been hit. The tool handler still returns a benign success
string (so the model's own turn-taking logic is never disrupted by an apparent tool error — see
Question 5) but performs no visual move at all. Nothing is visible to the participant beyond the
screen simply not moving for that particular call — Clio's spoken answer to the underlying question
is completely unaffected either way, since her ability to answer questions verbally was never gated
on the screen actually moving (per the brief's own "the gap is purely visual" framing).

**State 5 — Unresolvable jump target.** The model calls `show_visual` with a `topic_title` that does
not exactly match any page's `title`, and no usable `section_index`. The resolver returns the
*current* `displayedIndex` unchanged (§6.3) — i.e., a genuine no-op: the screen does not move, no
error is surfaced to the model or the participant, Clio's spoken answer proceeds exactly as if the
tool call had succeeded. This mirrors `resolveSectionIndex`'s own existing fallback behavior in
`PartnerRenderClient.tsx` today (line 269: `idx < 0 ? activeIndexRef.current : idx`), ported
faithfully, not reinvented.

## 5. Visual Examples

**State 2 — Jump in progress (page 5 → page 2, mid-question)**
```
┌─────────────────────────────────────────────────────────────┐
│  [Page 5 content, momentarily still visible]                 │
│                                                                │
│         ⋮ smooth scroll transition (unchanged CSS/JS          │
│           mechanics — identical to today's advance_tab move)  │
│                                                                │
│  [Page 2 content now filling the viewport]                    │
│  (Clio's voice, unchanged UI: no visible banner/toast          │
│   indicating a "jump" occurred — looks like any normal page    │
│   transition to the participant)                               │
└─────────────────────────────────────────────────────────────┘
```
(No new DOM elements, no new visual chrome — this wireframe illustrates the *transition*, not a new
screen; the rendered page markup itself is byte-identical to today's inline page render.)

**State 4 — Debounced jump (nothing visibly different)**
```
┌─────────────────────────────────────────────────────────────┐
│  [Page 5 content — unchanged, no scroll occurs]               │
│  (Clio answers the question verbally regardless — the screen  │
│   simply does not move for this particular tool call)          │
└─────────────────────────────────────────────────────────────┘
```

There is no new persistent UI element, dialog, or indicator anywhere in this feature — every state
above is a navigation behavior difference on the exact same visual surface `PartnerRenderClient.tsx`'s
inline mode already renders today.

## 6. Data Requirements

### 6.1 No new database tables, columns, or migrations

This feature is entirely a client-side (React state) + prompt-text change. No new
`partner_sessions` column, no new table. The existing `voice_provider` persistence write that today's
`page.tsx` performs (lines 84–91: `supabase.from('partner_sessions').update({ voice_provider:
voiceProvider })`, read back later by `inngest/partner-session-insights-extractor.ts`) **must be
replicated** in the new `widget-render/page.tsx` — this is existing, load-bearing behavior for
billing/insight-extraction correctness that has nothing to do with the jump capability itself, but
which the new page must not silently drop simply because it is a new file. Confirmed: this write
lives directly in `page.tsx` today, not inside `resolveLiveSessionRender()`, so it must be copied
into the new page.tsx as its own explicit step.

### 6.2 New route and files (Question 1 — resolved)

**Route:** `/widget-render/[clio_session_ref]` — new, dedicated, not a branch inside
`/partner-render/...`. This is the only version of "separate file" that gives the "provably
untouched" guarantee Arun's decision requires (per the Feature Brief's own "New Finding" — option (b),
confirmed correct on direct re-verification, §0).

**New files:**
- `app/(with-clerk)/widget-render/[clio_session_ref]/page.tsx` — new server component. Structurally
  mirrors the existing `page.tsx` (same `UUID_RE` validation, same `ThemedMessage` fallback pattern,
  same `getPartnerSession`/`getThemeConfig`/`getActiveVoiceProvider`/`resolveLiveSessionRender` calls,
  all reused unmodified — see Question 3), with exactly one addition: after `getPartnerSession(ref)`
  succeeds, an additional raw check that this session's `delivery_channel === 'widget'` (a single
  `select('delivery_channel').eq('id', ref)` query — `getPartnerSession()`'s own `PartnerSessionRow`
  type does not currently select this column, and is not modified to add it, per Question 3's
  reasoning) — if the row is not a widget session, render the same `ThemedMessage` "This session
  reference could not be found." fallback used for any other not-found case. This closes the loophole
  of a meeting-bot session ref being loaded through the new widget path by URL substitution. Renders
  `<WidgetRenderClient>` (below) instead of `<PartnerRenderClient>` — and only ever the inline-mode
  props shape, since widget sessions are exclusively inline-content (confirmed: `widget-sessions/route.ts`
  never sets `sections`/template-mode fields at all).
- `app/(with-clerk)/widget-render/[clio_session_ref]/WidgetRenderClient.tsx` — new client component.
  The genuinely new, standalone render + tool-handling implementation. Structurally parallel to
  `PartnerRenderClient.tsx`'s inline-mode branch only (no template/`sections` branch at all — dead
  code for this component, since widget sessions are never template-mode) — see §6.3–6.5 for its
  internals, and Question 3 for exactly what it imports unmodified versus what is new. **Explicit for
  the avoidance of doubt (CEO review addition, v1.1):** its tool object must port all three of
  `inlineTools`'s handlers, not only the two discussed in depth in §6.3–6.5 —
  `show_visual` (new jump logic per §6.3/§6.4), `advance_tab` (ported forward-only clamp + debounce,
  touching only `progressIndexRef`, per §6.5), and `end_session` (ported unmodified: sets status to
  `'ended'` and calls the existing `/api/partner/render/end-session` route exactly as `inlineTools`
  does today, per §6.7's own listing of that route as reused-as-is). Omitting `end_session` would
  leave the widget component with no way to end a session at all — a functional gap, not a stylistic
  one.
- `lib/voice/widget-jump-resolution.ts` — new, dependency-free, directly-unit-testable module (see
  Question 4).
- `lib/partner/widget-jump-debounce.ts` — new, dependency-free, directly-unit-testable module (see
  Question 5).
- `lib/voice/widget-prompt-rules.ts` — new module holding the one new fixed prompt-rule string (see
  Question 6).

**Existing files edited (all additive, all outside the untouchable set named in Arun's decision):**
- `app/api/partner/v1/widget-sessions/route.ts` — change `render_url` construction at both existing
  call sites (line 197's replay branch, line 212's `const renderUrl = ...`) from
  `${appUrl}/partner-render/${...}` to `${appUrl}/widget-render/${...}`. No other change to this file.
- `app/api/demo/[slug]/widget-status/route.ts` — change the same construction at line 45 (this is the
  internal `/demo` "Widget Demo" tab's refresh-survives-reload endpoint; it independently reconstructs
  `render_url` from `latestWidget.id` rather than reading it from a stored value, so it must be
  updated in lockstep or the demo tool would keep loading the *old* component on every page refresh
  even after a real widget session used the new one). No other change to this file.
  (`app/api/demo/[slug]/widget-dispatch/route.ts` needs **no** change — confirmed by direct read: it
  forwards whichever `render_url` the `widget-sessions` API returns verbatim; it never constructs the
  path itself.)
- `middleware.ts` — two additive lines, mirroring `/partner-render/(.*)`'s own two existing entries
  exactly: add `'/widget-render/(.*)'` to the `isPublicRoute` matcher array (next to the existing
  `/partner-render/(.*)` entry, same comment style), and add `/^\/widget-render\/.+/` to
  `TENANT_SCOPED_PATTERNS` (next to the existing `/^\/partner-render\/.+/` entry). No other change.
- `lib/partner/domain-config.ts` — add `'widget-render'` to `RESERVED_SUBDOMAIN_SLUGS` (next to the
  existing `'partner-render'` entry). No other change.

No other file in the codebase constructs, assumes, caches, or documents `/partner-render/...` as the
widget channel's render URL (§0 — exhaustively checked: Configurator widget-preview tooling doesn't
exist; partner-facing API docs don't document the widget endpoint at all yet; no `render_url` value
is ever persisted/cached anywhere to go stale).

### 6.3 Topic/page resolution (Question 4 — resolved)

New function in `lib/voice/widget-jump-resolution.ts`:

```ts
export interface WidgetJumpTarget {
  title: string | null
}

/** Ported from PartnerRenderClient.tsx's resolveSectionIndex (template-mode only there) — same
 *  exact-match semantics, adapted to widget inline pages' own `title` field (there is no
 *  `subtopicTitle` concept for inline content). Returns `currentIndex` unchanged (a genuine no-op,
 *  not an error) if neither param is usable or topic_title matches nothing — identical fallback
 *  posture to the ported function's own existing `idx < 0 ? activeIndexRef.current : idx`. */
export function resolveWidgetJumpIndex(
  params: Record<string, unknown>,
  pages: WidgetJumpTarget[],
  currentIndex: number
): number {
  const sectionIndex = params.section_index as number | undefined
  const topicTitle = params.topic_title as string | undefined
  if (typeof sectionIndex === 'number' && sectionIndex >= 0 && sectionIndex < pages.length) {
    return sectionIndex
  }
  if (topicTitle) {
    const idx = pages.findIndex((p) => p.title === topicTitle)
    if (idx >= 0) return idx
  }
  return currentIndex
}
```

Confirmed sufficient, not left open: this is an exact-string match, same as the proven
`templateTools` pattern — no fuzzy matching is added. One real, pre-existing ambiguity ported
faithfully rather than silently fixed: `buildInlineSessionContent` (`lib/partner/live-render.ts` line
762) labels pages 1-based in the model's own visible context (`[PAGE 1 of 5 — "Title"]`), while the
`section_index` tool-schema field is documented "Zero-based" (`lib/voice/openai-realtime-tools.ts`
line 49) — an existing off-by-one risk that already applies to today's `advance_tab`/`show_visual`
tools, not something newly introduced here. §6.6 (Question 6) addresses this directly: the new
prompt rule instructs the model to prefer `topic_title` (the exact quoted string it already has
verbatim from `[PAGE N of M — "Title"]`) as primary, with `section_index` only as a fallback,
explicitly reminding it of the zero-based convention if it does use that field.

### 6.4 Rate/abuse guard (Question 5 — resolved)

New module `lib/partner/widget-jump-debounce.ts`, structurally mirroring
`lib/partner/advance-transition.ts`'s own proven pure-function/testable-ref pattern, but a distinct
concept (a genuinely new file, not a shared import) since jump-debounce and forward-advance-debounce
answer different questions:

```ts
/** Minimum time between two successful jumps. Chosen to absorb an accidental double-fire of a
 *  single question (the model calling show_visual twice for what is really one utterance) without
 *  blocking two genuinely distinct rapid-fire questions, which a real participant can plausibly ask
 *  a few seconds apart. */
export const JUMP_DEBOUNCE_MS = 2000

/** Hard ceiling on jumps per rolling minute, guarding against a pathological/adversarial run of
 *  tangential questions thrashing the screen. Implemented as a fixed (not rolling) 60s window for
 *  simplicity and direct testability — a participant asking 8 genuinely distinct off-topic
 *  questions within any single 60s window is already an extreme edge case; beyond it, further jumps
 *  are silently suppressed (Clio keeps answering verbally; only the screen stops moving) rather than
 *  erroring, so the model's own turn-taking is never disrupted by an apparent tool failure. */
export const MAX_JUMPS_PER_WINDOW = 8
export const JUMP_WINDOW_MS = 60_000

export interface JumpGuardState {
  lastJumpAt: number | null
  windowStartedAt: number | null
  jumpsInWindow: number
}

export function createJumpGuardState(): JumpGuardState {
  return { lastJumpAt: null, windowStartedAt: null, jumpsInWindow: 0 }
}

/** True iff a jump should actually be allowed to move the screen right now. Side-effecting on a
 *  `true` result (mirrors shouldAdvanceOnTransition's own convention): stamps lastJumpAt, and
 *  increments/resets the fixed-window counter. On `false`, state is left untouched. */
export function shouldAllowJump(state: JumpGuardState, now: number): boolean {
  if (state.lastJumpAt !== null && now - state.lastJumpAt < JUMP_DEBOUNCE_MS) return false
  if (state.windowStartedAt === null || now - state.windowStartedAt >= JUMP_WINDOW_MS) {
    state.windowStartedAt = now
    state.jumpsInWindow = 0
  }
  if (state.jumpsInWindow >= MAX_JUMPS_PER_WINDOW) return false
  state.lastJumpAt = now
  state.jumpsInWindow += 1
  return true
}
```

`WidgetRenderClient.tsx` holds one `useRef<JumpGuardState>(createJumpGuardState())` and calls
`shouldAllowJump(guardRef.current, Date.now())` before ever calling the scroll-to-index function from
the `show_visual` handler. This guard applies **only** to the jump path — it has no effect on
`advance_tab`, which keeps its own, separately-ported `ADVANCE_DEBOUNCE_MS`/`shouldAdvanceOnTransition`
guard from `lib/partner/advance-transition.ts` (imported as-is — see Question 3), unchanged.

### 6.5 Position-tracking state shape (Question 2 — resolved)

Exactly two pieces of state in `WidgetRenderClient.tsx`, named precisely, with a clean-slate design
(no legacy `activeIndexRef` constraint to work around, since this is new code):

- **`progressIndexRef` (a `useRef<number>(0)`, no corresponding React state — nothing ever needs to
  re-render off this value alone)** — where real forward progress continues from. Touched **only**
  by the `advance_tab` tool handler, which computes
  `progressIndexRef.current = Math.min(progressIndexRef.current + 1, count - 1)` (byte-identical
  forward-only clamp logic to today's `advance_tab`, per Arun's explicit instruction that this must
  not change in any way). Never touched by `show_visual`.
- **`displayedIndex` (`useState<number>(0)`) + `displayedIndexRef` (`useRef<number>(0)`, kept in sync
  the same dual-state/dual-ref pattern `PartnerRenderClient.tsx` already uses for `activeIndex`/
  `activeIndexRef`)** — what is currently scrolled into view / passed to
  `TemplateRenderer`-equivalent rendering (n/a here — inline pages don't need `isActive`, but the
  state is still needed to drive the scroll-into-view side effect). Touched by **both** handlers:
  - `advance_tab`: after computing the new `progressIndexRef`, also calls the shared
    `scrollToIndex(progressIndexRef.current)` helper, which sets both `displayedIndex` and
    `displayedIndexRef` and performs the `scrollIntoView({ behavior: 'smooth', block: 'start' })` —
    i.e., a normal forward advance moves both the progress pointer and what's displayed together, the
    common case, unchanged in spirit from today.
  - `show_visual`: calls **only** `scrollToIndex(resolveWidgetJumpIndex(params, pages, displayedIndexRef.current))`
    (gated by `shouldAllowJump`, §6.4) — moves what's displayed, `progressIndexRef` is left
    completely untouched. This is the entire mechanism realizing "a side-trip, not a redefinition of
    progress."

This directly answers the brief's own example naming (Question 2) — confirmed as the clean, correct
shape, not merely accepted verbatim: `advance_tab` reads and writes `progressIndexRef` (never
`displayedIndexRef` directly — it goes through the same `scrollToIndex` helper `show_visual` uses, so
there is exactly one code path that ever performs the actual visual move, reducing duplication risk).

### 6.6 New prompt-rule text (Question 6 — resolved)

New file `lib/voice/widget-prompt-rules.ts`:

```ts
/**
 * B2B-71 — the widget channel's OWN new rule governing the jump-for-a-question capability.
 * Deliberately NOT added to lib/voice/openai-realtime-prompt-template.ts (shared with the
 * meeting-bot path, explicitly not touched by this build). Appended, client-side, as a single
 * string concatenation onto the already-assembled `openaiVoiceInstructions` text
 * (lib/partner/live-render.ts's resolveLiveSessionRender() output, reused unmodified — see
 * Question 3) immediately before it is handed to OpenAIRealtimeAdapter.create(). OpenAI Realtime
 * only — see Question 8 for why this is not also delivered to Hume in this build.
 */
export const WIDGET_JUMP_RULE_TEXT = `

--- Widget-only addition: Jump the Screen to Answer an Off-Topic Question ---

11. Answering a Question About a Different Page — Jump the Screen to Match, Without Changing Where
    You're Actually Teaching From. If the participant asks a question that is clearly about a
    DIFFERENT page than the one currently on screen (earlier or later in the session), call the
    show_visual tool with that page's exact title (topic_title) — copy it exactly as it appears in
    its own "[PAGE N of M — \"Title\"]" marker in SESSION CONTENT, do not paraphrase or shorten it —
    so the screen jumps to match what you're about to say. Only use section_index instead if you do
    not have the exact title available, and remember it is ZERO-BASED (page 1 is index 0, page 2 is
    index 1, and so on) — this is different from the 1-based "PAGE N of M" numbering you see in
    SESSION CONTENT, so subtract 1 from the page number before using it. This use of show_visual is
    unrelated to rule 3's new-section-intro use of the same tool: it can happen at any point in the
    conversation, not only when a section begins, and calling it here does NOT mean you have started
    teaching that page or that your progress has moved there — it is a visual side-trip only.
    [show_visual DOES NOT END YOUR TURN — ANSWER THE QUESTION IMMEDIATELY AFTER CALLING IT, IN THE
    SAME TURN.] Once you've answered, continue exactly where you actually left off before the
    question — do not restart, recap, or re-teach the page you just jumped to visually unless the
    participant's question specifically requires teaching part of it; your own sense of "what topic
    am I actually progressing through" is completely unaffected by this jump. Do not overuse this —
    it is for genuine questions about a different page's content, not for restating or double-checking
    the page already on screen.`
`;
```

### 6.7 Reads and writes (summary)

- **Reads:** `getPartnerSession(ref)`, `getThemeConfig(partnerAccountId)`, `getActiveVoiceProvider()`,
  `resolveLiveSessionRender(session)` — all existing, unmodified functions, called fresh from the new
  `widget-render/page.tsx` (same call shape as today's `page.tsx`). One new raw read: a single
  `delivery_channel` column check (§6.2).
- **Writes:** the existing `voice_provider` persistence write (§6.1, replicated into the new
  page.tsx). No new writes — the jump/debounce/progress state is entirely in-memory, client-side,
  scoped to the single open browser tab/session, exactly like `activeIndexRef`/`firedMarkersRef` are
  today. Nothing about a jump is persisted to `partner_sessions` or any other table.
- **APIs called:** none new. The existing `/api/hume-token`, `/api/openai-realtime-token`,
  `/api/partner/render/end-session`, `/api/partner/render/session-chat-id`,
  `/api/partner/render/join-greeting/[ref]`, `/api/partner/render/transcript-capture`,
  `/api/partner/render/voice-diagnostic-capture`, and `/api/partner/render/client-error` routes are
  all reused as-is by `WidgetRenderClient.tsx` — none of them are tied to `PartnerRenderClient.tsx`
  specifically; all take `clio_session_ref` as a plain parameter.
- **localStorage/sessionStorage:** none, matching today's inline-mode behavior exactly.

## 7. Success Criteria (Acceptance Tests)

✓ Given a widget session with pages [A, B, C, D, E] currently displaying page D (index 3), when the
model calls `show_visual` with `topic_title` exactly matching page B's title, then the screen scrolls
to page B, `displayedIndex` becomes 1, and `progressIndexRef` remains 3.

✓ Given the state above (jumped to page B, `progressIndexRef` still 3), when the model next calls
`advance_tab`, then the screen scrolls to page E (index 4 = `progressIndexRef` 3 + 1), not to page C
(which index 1 + 1 would incorrectly produce).

✓ Given a `show_visual` call with a `topic_title` that matches no page's title and no valid
`section_index`, when the handler runs, then `displayedIndex` is unchanged, no error is thrown, and
the tool returns a normal success-shaped string (no visible difference to the participant beyond the
screen simply not moving).

✓ Given two `show_visual` jump calls arrive less than `JUMP_DEBOUNCE_MS` (2000ms) apart, when the
second call is processed, then no visual move occurs for it (the guard blocks it), while the first
call's jump is unaffected.

✓ Given 9 genuinely distinct, resolvable `show_visual` jump calls arrive within one 60-second window,
when the 9th call is processed, then it is silently suppressed (no visual move), while the first 8 in
that window succeeded normally.

✓ Given a real widget session dispatched with the platform's `active_provider` set to
`openai_realtime` (`/dashboard/admin`'s Live Voice Provider card), when a live participant asks a
question clearly about an earlier page than the one on screen, then the screen visibly jumps to that
page while Clio answers, and a subsequent `advance_tab` continues from the pre-jump progress point,
not the jumped-to page (live test — see Question 7/§13).

✓ Given `POST /api/partner/v1/widget-sessions` succeeds, when the response is inspected, then
`render_url` contains the path segment `/widget-render/` (not `/partner-render/`) followed by the
session's id.

✓ Given a session whose `delivery_channel` is NOT `'widget'` (e.g. a meeting-bot session), when its
id is used to load `/widget-render/[that-id]` directly, then the page renders the same
"This session reference could not be found." themed fallback used for any other not-found case — it
does not render that meeting-bot session through the new widget component.

✓ Given the full diff of this build, when `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`,
its `inlineTools`, and `lib/voice/openai-realtime-prompt-template.ts` are diffed against their
pre-B2B-71 state, then the diff is empty (the literal, checkable acceptance bar the Feature Brief
itself specifies).

## 8. Error States

- **Voice connection fails to establish at all** — identical to today's inline-mode behavior:
  `status` becomes `'error'`, content still renders (no voice, no jump capability either, since there
  is no tool call channel), the same bottom-right "Voice connection issue — content is still visible."
  banner appears. No new error state introduced by this feature.
- **`show_visual` called with malformed/missing params (neither `section_index` nor `topic_title`)** —
  resolves to the current `displayedIndex` unchanged (§6.3's no-op fallback) — never an exception, never
  surfaced to the model as a tool error (a hard tool-call failure would risk the model getting stuck
  or repeating itself, worse than a silent no-op for a screen-position mismatch that Clio's spoken
  answer never depended on).
- **Jump debounced/capped (§6.4)** — same non-error, benign-success-string handling as the malformed-
  params case; the model never sees a failure signal for either reason, deliberately, so its own
  turn-taking logic (governed by the existing "a tool call never ends your turn" rule, ported
  unmodified) is never disrupted by this feature.
- **Session is not a widget-channel session (§6.2's defensive check)** — themed "could not be found"
  fallback, identical treatment to an unknown/invalid session ref, no distinct error copy (this is a
  data-integrity guard, not a participant-facing error state that needs its own explanation).

## 9. Edge Cases

- **First page, jump request for "the current page."** `resolveWidgetJumpIndex` resolving to the
  already-displayed index is a legitimate outcome (not an error) — `scrollToIndex` scrolling to the
  index it's already at is a harmless no-op (React state setter with the same value, `scrollIntoView`
  on an already-in-view element does nothing perceptible).
- **Question about the last page while displaying the first.** No different from any other jump —
  `resolveWidgetJumpIndex` has no directional constraint (unlike `advance_tab`), by design: jumps can
  go in either direction, forward or backward, since they are pure navigation, never progress.
- **Hume-provider widget sessions (the default; `active_provider` starts as `'hume'` per
  `system_voice_config`'s own migration default).** No regression, no new capability: Clio still
  connects via `HumeAdapter` exactly as today, still narrates, still answers any question verbally
  using her existing full-narration knowledge, still supports `advance_tab` forward progress
  (ported, unmodified debounce/dedup). She simply does not receive the new jump-for-a-question prompt
  rule (§6.6, Question 8) and so will not proactively call `show_visual` for this specific new
  purpose — the `show_visual` handler itself is still wired and would work correctly if called, it
  is just never instructed to be called for this reason on Hume. This is a reasoned, explicit v1
  scope boundary (Question 8), not a silent gap.
- **The platform-wide voice-provider toggle changes mid-testing.** Because `getActiveVoiceProvider()`
  is a single global setting (`system_voice_config`, not scoped by `delivery_channel`), whether ANY
  given widget session — including a test dispatch for this very feature — runs on OpenAI Realtime at
  all depends on the admin's current platform-wide choice at `/dashboard/admin`. This build does
  **not** add any widget-specific override forcing OpenAI regardless of that toggle (an unrequested
  product decision, out of scope). The live test in §13 must explicitly confirm the toggle's current
  value before dispatching.
- **A jump lands on a page whose `status` is `'unavailable'`** (the fetch-time failure fallback
  `PartnerRenderClient.tsx`'s inline branch already handles, lines 806–807). `WidgetRenderClient.tsx`
  ports the identical `InlinePageErrorBoundary`/`status === 'unavailable'` rendering — a jump to such
  a page shows the exact same "This page isn't available right now." fallback text a normal
  `advance_tab` arrival at that page would show today; no new handling needed.
- **Mobile / narrow viewport.** No new UI surface is introduced by this feature (§5) — the existing
  full-screen, `scrollIntoView`-driven page stack is untouched in its responsive behavior; this
  document's standing responsive-by-default obligation is satisfied by construction (nothing new to
  make responsive).

## 10. Out of Scope

- Any change to `PartnerRenderClient.tsx`, its `inlineTools`, or
  `lib/voice/openai-realtime-prompt-template.ts`'s existing rules — provably zero-diff, per §7's own
  acceptance test.
- Full Hume-provider parity for the jump-for-a-question capability (Question 8) — a reasoned, explicit
  v1 boundary, not an oversight; Hume-provider widget sessions keep exactly today's existing behavior
  (verbal-only answers to off-topic questions, no screen jump). A future, separate, explicitly-scoped
  follow-up would need new server-side prompt-assembly plumbing (an `extraRules`-style parameter
  threaded through `assembleHumeNativePrompt`/`provisionNativeConfig`, or an equivalent new parallel
  function) — not attempted here.
- Changing `advance_tab`'s forward-only, model-judgment-timed semantics in any way, in either the
  existing or the new component — explicitly unaffected, per Arun's own instruction and §7's
  acceptance tests.
- The two-stage transcript-watch secondary advance signal (`SECONDARY_TRANSCRIPT_MATCH_ENABLED`,
  currently `false`/disabled in `PartnerRenderClient.tsx` as part of an active, in-flight A/B
  isolation test on the shared meeting-bot path) is **not** ported into `WidgetRenderClient.tsx` at
  all. The new component's `advance_tab` uses the tool-call signal alone — which is also the only
  currently-*active* signal on the shared path today, since the secondary signal is presently
  disabled there. This is a deliberate scope decision: porting an experimental, actively-changing
  mechanism into a brand-new component would work against this build's own "minimal risk, standalone,
  prove-it-out" premise. If Arun re-enables the secondary signal platform-wide and later wants
  parity, that is a distinct, separate follow-up.
- Template/Designer-mode (`sections`) rendering in the new widget component — dead code path that
  does not need to exist, since widget sessions are exclusively inline-content today (confirmed,
  §0).
- Any change to the Configurator dashboard, partner-facing API docs, or billing/wallet logic.
- Merging the widget-channel implementation into (or replacing) the shared meeting-bot path — an
  explicit, separate future decision Arun will make later, per his own words in the Feature Brief.
- Any visible participant-facing indicator that a "jump" specifically (as opposed to a normal forward
  transition) occurred — deliberately identical visual treatment, per §4/§5.

## 11. Open Questions

None. All eight items the Feature Brief's "Questions for BA" section raised are resolved above with
concrete, checkable answers, each grounded in direct re-verification against live code (§0):

1. **Route/file structure** — resolved: new `/widget-render/[clio_session_ref]` route (new
   `page.tsx` + new `WidgetRenderClient.tsx`), `widget-sessions/route.ts` and
   `widget-status/route.ts` updated to construct the new path, `middleware.ts` and
   `domain-config.ts` updated additively. Every other place in the codebase that could plausibly
   reference the widget's render URL was checked and found clean (§0, §6.2).
2. **Position-tracking state shape** — resolved: `progressIndexRef` (advance_tab-only, forward-only)
   vs. `displayedIndex`/`displayedIndexRef` (both handlers, via one shared `scrollToIndex` helper) —
   §6.5.
3. **What's shared vs. new** — resolved (§0, throughout §6): `lib/voice/adapter.ts`,
   `lib/voice/openai-realtime-adapter.ts`, `lib/voice/hume-adapter.ts`,
   `lib/voice/openai-realtime-tools.ts`, `lib/partner/live-render.ts`'s `getPartnerSession`/
   `resolveLiveSessionRender`, `lib/partner/theme.ts`, `lib/voice/provider-config.ts`,
   `lib/partner/advance-transition.ts`, `lib/partner/report-client-error.ts`, and every existing
   `/api/partner/render/*` + `/api/hume-token` + `/api/openai-realtime-token` route are all reused
   completely unmodified. Genuinely new: the route/component pair, the jump-resolution module, the
   jump-debounce module, and the one new prompt-rule string module.
4. **Topic/page resolution** — resolved: ported exact-title-match (§6.3), confirmed sufficient,
   with the pre-existing 1-based/0-based numbering ambiguity flagged and mitigated via prompt wording
   (§6.6) rather than silently left as a landmine.
5. **Rate/abuse guard** — resolved: 2000ms inter-jump debounce + 8-jumps-per-fixed-60s-window cap,
   silently suppressed beyond either limit (§6.4).
6. **New prompt-rule text** — resolved: exact text written in full (§6.6), OpenAI-Realtime-delivered
   only (Question 8).
7. **Test/live-test bar** — resolved: §13 below.
8. **Hume parity** — resolved: widget sessions do run on Hume today (confirmed, global
   provider-agnostic toggle), but true parity for this specific capability is out of scope for this
   build, for a concrete, structural reason (Hume's prompt is baked server-side into an opaque
   `configId` before the client ever loads, unlike OpenAI's client-visible instructions text; the one
   live client-side Hume instruction-injection mechanism, `sendWrapUpNudge`, replaces the entire
   active prompt and is unsuitable for a persistent new rule) — §0, §9, §10.

Nothing in this document requires escalation to Arun beyond the CEO's own review/approval of this
spec.

## 12. Dependencies

- `getPartnerSession`, `resolveLiveSessionRender`, `getThemeConfig` (`lib/partner/live-render.ts`,
  `lib/partner/theme.ts`) — already exist, reused unmodified.
- `getActiveVoiceProvider` (`lib/voice/provider-config.ts`) — already exists (B2B-61 Part B), reused
  unmodified.
- `VoiceSessionAdapter`, `OpenAIRealtimeAdapter`, `HumeAdapter` (`lib/voice/adapter.ts`,
  `lib/voice/openai-realtime-adapter.ts`, `lib/voice/hume-adapter.ts`) — already exist, reused
  unmodified, imported directly by the new `WidgetRenderClient.tsx` exactly as
  `PartnerRenderClient.tsx` already does.
- `shouldAdvanceOnTransition`, `ADVANCE_DEBOUNCE_MS`, `AdvanceDebounceRef`
  (`lib/partner/advance-transition.ts`) — already exist, reused unmodified for the new component's
  own `advance_tab` dedup.
- `reportClientError` (`lib/partner/report-client-error.ts`) — already exists, reused unmodified.
- The existing `/api/hume-token`, `/api/openai-realtime-token`, and every `/api/partner/render/*`
  route — already exist, reused unmodified.
- `system_voice_config` / `/dashboard/admin`'s Live Voice Provider card (B2B-61 Part B) — must be set
  to `openai_realtime` for the live test in §13 to actually exercise this capability, since Hume is
  the default and this build does not override that global toggle per-channel.
- `app/api/partner/v1/widget-sessions/route.ts` and `app/api/demo/[slug]/widget-status/route.ts` must
  both land their URL-construction change together — a partial rollout would leave the `/demo` Widget
  Demo tab's refresh path pointing at a stale route pattern for widget sessions dispatched after only
  one of the two files changed.

## 13. Test Plan

- **Unit:** `lib/voice/widget-jump-resolution.ts` — exact `topic_title` match resolves correctly;
  `section_index` resolves correctly when in range; out-of-range `section_index` falls through to
  `topic_title` if present, else to `currentIndex`; no usable params returns `currentIndex` unchanged;
  empty `pages` array does not throw. `lib/partner/widget-jump-debounce.ts` — a call within
  `JUMP_DEBOUNCE_MS` of the previous is blocked; a call after the debounce window but still within the
  same `JUMP_WINDOW_MS` increments the counter; the 9th call within one fixed window is blocked; a call
  in a new window after `JUMP_WINDOW_MS` has elapsed resets the counter and succeeds. A component-level
  (or extracted pure-function, mirroring `advance-transition.ts`'s own testability precedent) test
  proving `advance_tab`'s computed next index always derives from `progressIndexRef`, never
  `displayedIndexRef`, across a jump-then-advance sequence.
- **Integration:** `POST /api/partner/v1/widget-sessions` — `render_url` in the `201` response
  contains `/widget-render/` (updated assertion alongside the existing, unmodified
  `toContain('session-1')` check in `tests/integration/b2b70-widget-sessions-api.test.ts`, which
  passes unchanged). New test for `GET /api/demo/[slug]/widget-status` asserting the same
  `/widget-render/` path segment (no prior test file exists for this route — a wholly new test file,
  not a modification). A new route-level test (or a documented manual-verification step, if a full
  Next.js route test harness for a dynamic server component page isn't practical in this repo's
  existing test setup) confirming a non-widget `delivery_channel` session 404s/renders the
  not-found fallback via `/widget-render/[ref]`.
- **E2E / live test call (required before this ships, per this project's QA Gate 3 — no PASS on code
  review alone):** confirm `/dashboard/admin`'s Live Voice Provider card shows `openai_realtime` as
  active (switch it if not); dispatch a real widget session via the `/demo` Widget Demo tab (or a
  direct `POST /api/partner/v1/widget-sessions` call) with at least 3 distinct content pages; as a
  live participant, let the session begin narrating page 1, then ask a question clearly about page 3;
  confirm the screen visibly jumps to page 3 while Clio answers; confirm that when she next calls
  `advance_tab`, the screen moves to page 2 (one past page 1, the real pre-jump progress point), not
  page 4; confirm `git diff --stat` against `PartnerRenderClient.tsx`,
  `lib/voice/openai-realtime-prompt-template.ts`, and every pre-existing test file is empty.
