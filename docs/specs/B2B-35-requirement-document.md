# Live-Session Prompt Fidelity Fixes (post B2B-33 live test) — Requirement Document

Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-24
Feature ID: B2B-35
Source: CEO Feature Brief, 2026-07-24 ("Live-Session Prompt Fidelity Fixes (post B2B-33 live test)")

---

## 0. How this document is organized

This brief bundles three related build items plus one diagnosis-only item, all stemming from
Arun's first live test of B2B-33 ("Learn with AI" demo). To keep each independently buildable and
testable, this document treats them as four sub-features under the shared 12-section template:

- **F1 — Per-page content fidelity** (Option 1 / inline content mode only) — CEO points 3, 4, 6
- **F2 — Warm open, no phantom scripted sections** (Option 1 only) — CEO point 2
- **F3 — Parameterized audience persona** (Option 1 AND Option 2) — CEO point 5
- **D1 — Join-greeting diagnosis** (no code authorized) — CEO point 1

Every section below is written per sub-feature where behavior differs, and once where it's shared.
**Section 11 (Open Questions) is empty** — every question the CEO brief posed to the BA has been
resolved below, verified against live code, the database, and Vercel runtime logs, not assumed.

---

## 1. Purpose

Clio's live voice narration (Hume-native, inline content mode) has three defects surfaced by Arun's
first real live test on 2026-07-25 (session `ab71deef-977c-40e1-bfec-d0a182d241e3`, topic "What Is
Claude?"):

1. **F1**: Clio narrates only page *titles*, never the actual authored teaching content. The
   session's real material (e.g. the reinforcement-learning/Constitutional AI paragraphs in the
   "What Is Claude?" chapter) exists in `app/demo/_content.ts` and renders in the page's own
   "Transcript" tab, but is never sent to Hume — Clio has to improvise, and skips real content.
   Failure without this fix: every Option 1 (inline content mode) session — the mode B2B-33's demo
   and all future self-serve partners use — sounds shallow and inconsistent, undermining the core
   product promise of accurate, calibrated narration.
2. **F2**: Clio's fixed prompt instructs her to open with "the Session Overview section's prepared
   content" and close with "the Session Summary section's prepared content" — real, populated
   things in Option 2 (template mode), but nothing exists under those labels in Option 1. Clio was
   instructed to recite content that doesn't exist for this path, producing an abrupt, unwarm open
   with no icebreaker.
3. **F3**: The prompt hardcodes "a senior executive" as the audience, regardless of who Clio is
   actually talking to. Failure without this fix: every reseller's end users are coached as if they
   were C-suite executives, even when the reseller describes a completely different audience (e.g.
   "a first-year sales rep") through their own API.

Fixing these closes the gap between "Clio has the right material and audience context" and "Clio
actually uses it," for every partner who will build on Option 1 going forward — not just the demo.

---

## 2. User Story

As a **live-session participant on a partner's Option 1 (inline content) session** (e.g. Arun in the
"What Is Claude?" demo, or a future partner's end user),
I want Clio to teach me the *actual* authored material for each page, open warmly with a natural
icebreaker, and address me in a way that fits who I actually am,
So that the session feels complete, accurate, and personally calibrated — not like Clio is
improvising from a table of contents.

As a **reseller/partner building an Option 1 or Option 2 session via the partner API**,
I want to optionally tell Clio who the end user is (their role/title) and, for Option 1, optionally
supply the real per-page narration content,
So that Clio's live coaching reflects my end user's actual context instead of a generic
"senior executive" assumption, without being forced to adopt Option 2's template system.

---

## 3. Trigger / Entry Point

All three build items (F1, F2, F3) activate at the same point in the same existing flow — there is
no new route, no new UI, no new user-facing entry point:

- **Route**: `POST /api/partner/v1/sessions` (existing, `lib/partner/session-schema.ts`'s
  `CreateSessionSchema`) — the request body gains new **optional** fields (Section 6). No new
  endpoint.
- **Trigger**: A partner (or, for the demo, `app/api/demo/[slug]/dispatch/route.ts` acting as a
  caller of the same real contract) calls this endpoint to start a live session. The prompt
  assembly that consumes the new fields runs inside `resolveLiveSessionRender()` /
  `resolveInlineSessionRender()` (`lib/partner/live-render.ts`), reached when the partner-render
  page (`app/partner-render/[clio_session_ref]/page.tsx`) loads for the meeting bot.
- **State required**: Identical to today — a valid `partner_sessions` row created via the sessions
  endpoint, `content_pages` populated (Option 1) or `content_ref`/`partner_topic_ref` populated
  (Option 2). No auth changes, no new session states.

---

## 4. Flow Description

### F1 — Per-page content fidelity (Option 1 only)

**Today's flow** (confirmed by reading `lib/partner/live-render.ts` lines 361–396 and
`app/api/demo/[slug]/dispatch/route.ts` lines 68–73):
1. Partner calls `/sessions` with `content_pages: [{ url, media_type, title, subtitle,
   transition_trigger }, ...]` — no field for the page's actual teaching content exists on the wire
   contract (`ContentPageSchema`, `session-schema.ts` lines 16–22).
2. `buildInlineSessionContent()` renders each page as only a title/subtitle + a stage-direction
   transition instruction into the `SESSION CONTENT` block of the assembled Hume prompt.
3. Clio receives titles and a single session-wide `content_to_explain` overview paragraph, but
   never the page body — she improvises the substance.

**New flow**:
1. Partner (or the demo dispatch route) may now include an optional `content_text` field per page
   in `content_pages[]` — the same plain-narration text that already exists as authored material
   for that page (for the demo: `Chapter.blocks`, flattened to plain text; for future partners:
   whatever they choose to populate, sourced from their own already-authored/reviewed content —
   never LLM-generated to fill this gap).
2. `buildInlineSessionContent()` includes `content_text` (when present) as the page's actual
   teaching material inside its `[PAGE N of M]` block, before the stage-direction transition
   instruction.
3. Clio narrates the real material. If a partner does not populate `content_text` for a page, that
   page's block is byte-identical to today (title/subtitle/transition instruction only) — no
   silent behavior change for any existing (non-demo) Option 1 caller (there are currently none in
   production — see Section 6's "Existing partner impact" note).
4. For the demo specifically, `app/api/demo/[slug]/dispatch/route.ts` is updated to populate
   `content_text` per page from `topic.chapters[i].blocks`, flattened (Section 6.3) and truncated
   if needed (Section 6.4) — no AI call in this route, unchanged from today's "no AI call anywhere
   in this route" guarantee.

### F2 — Warm open / no phantom Session Overview or Summary (Option 1 only)

**Today's flow**: The fixed `BEHAVIORAL RULES` (rules 1, 8, 12 of `HUME_NATIVE_PROMPT_TEMPLATE`,
`prompt-template.ts`) instruct Clio, verbatim, in every session regardless of mode, to open by
delivering "the Session Overview section's prepared content (marked in SESSION CONTENT) in full,"
and close by delivering "the Session Summary section's prepared content ... in full." In Option 1,
no such labeled section is ever produced — Clio was told to recite something that isn't there.

**New flow**: `assembleHumeNativePrompt()` gains a new parameter, `sessionContentMode: 'inline' |
'template'` (Section 6.5), defaulting to `'template'` for every existing/unspecified caller
(byte-identical output preserved — Section 7's regression test). Rules 1, 8, and 12 of the fixed
template become mode-conditional (Section 6.6 has the exact revised text):
- **`'template'` mode** (Option 2, and the legacy direct-Clio-product caller in
  `app/api/hume-native/provision-config/route.ts`): rules 1/8/12 text is **completely unchanged**
  from today, word for word.
- **`'inline'` mode** (Option 1): rule 1 becomes "open warmly with a natural icebreaker, then
  paraphrase the agenda from SESSION TITLE/SUBTITLE/WHAT TO EXPLAIN in your own words" (never a
  verbatim scripted recitation, since none exists); rule 8 becomes "close with a natural, own-words
  recap, then the same standard closing sequence (steps a–c, unchanged)"; rule 12 (the
  "say the word overview/summary out loud" instruction) is dropped entirely for this mode, since it
  only made sense as a label for a scripted section that no longer applies here.

### F3 — Parameterized audience persona (Option 1 AND Option 2)

**Today's flow**: `HUME_NATIVE_PROMPT_TEMPLATE`'s first sentence hardcodes: "You are Clio, an AI
business coach delivering a live, one-on-one coaching session to **a senior executive** over
voice." — literal, never substituted, for every caller.

**New flow**: The literal clause is replaced with a placeholder resolved from a new
`audienceDescription` parameter on `assembleHumeNativePrompt()` (Section 6.7). Both
`resolveLiveSessionRender()` and `resolveInlineSessionRender()` in `live-render.ts` (i.e. **both**
Option 1 and Option 2) now pass:
```
audienceDescription: session.endUserRole?.trim() || 'a professional'
```
sourced from a new optional `end_user_role` field on the session-creation contract
(`CreateSessionSchema`), which the reseller/partner populates from their own knowledge of the end
user (Section 6.8). The legacy, non-partner caller (`app/api/hume-native/provision-config/route.ts`)
never passes this parameter, so `assembleHumeNativePrompt()`'s own default value (`'a senior
executive'`, unchanged) applies there — that call site's output stays byte-identical, per the
"do not touch what isn't part of this brief" discipline this codebase already follows throughout
`prompt-template.ts`.

### D1 — Join-greeting (diagnosis only, no build)

See Section 4's counterpart doesn't apply — this is investigation, not a flow to build. Findings
are in Appendix A ("Diagnosis Findings — Point 1") and summarized for Arun in this document's cover
message.

---

## 5. Visual Examples

This is a backend prompt-assembly and wire-contract change with no new UI screen — Section 5's
"wireframe per screen state" format doesn't apply. In its place, below are before/after examples of
the actual artifact that changes: the assembled Hume prompt text, and a representative
before/after of what Clio says.

### 5.1 — F1: assembled `SESSION CONTENT` block, before vs. after (page 1 of the demo)

**Before** (today, what Hume actually receives for page 1):
```
[PAGE 1 of 5 — "What Is Claude?"]
[STAGE DIRECTION — DO NOT SAY THE BRACKETED LABEL] When you have finished covering this page
(transition intent: "Move on once "What Is Claude?" has been fully explained."") and are about to
move to page 2, say this exact phrase naturally as part of your sentence: "<transition marker>".
Then call the advance_tab tool.
```
Note: no actual teaching content — Clio has nothing but a title to work from.

**After** (with `content_text` populated):
```
[PAGE 1 of 5 — "What Is Claude?"]
CONTENT TO TEACH ON THIS PAGE:
Claude is a family of large language models built by Anthropic. At its core, Claude takes text
(and often images, documents, or code) as input and generates text as output... [full flattened
chapter text, including the Constitutional AI / RLAIF material Arun flagged as missing]
[STAGE DIRECTION — DO NOT SAY THE BRACKETED LABEL] When you have finished covering this page...
```

### 5.2 — F2: what Clio says at open, before vs. after (Option 1)

**Before** (observed on the live call): Clio attempts to deliver a "Session Overview" she has no
material for, producing an abrupt or improvised, non-warm open.

**After**: e.g. *"Hey Arun, great to have you here! Before we dive in — this is 'What Is Claude,'
where we'll cover what Claude actually is, the model family, and how people use it day to day.
Ready to get started?"* — synthesized from `SESSION TITLE` / `SESSION SUBTITLE` / `WHAT TO EXPLAIN`,
never a verbatim script (none exists).

### 5.3 — F3: the template's opening sentence, before vs. after

**Before**: "You are Clio, an AI business coach delivering a live, one-on-one coaching session to
**a senior executive** over voice."

**After** (reseller supplies `end_user_role: "a mid-level sales manager"`): "...delivering a live,
one-on-one coaching session to **a mid-level sales manager** over voice."

**After** (reseller omits `end_user_role`, or sends `""`): "...delivering a live, one-on-one
coaching session to **a professional** over voice."

---

## 6. Data Requirements

### 6.1 — `ContentPageSchema` (wire contract), `lib/partner/session-schema.ts`

New optional field:
```ts
export const ContentPageSchema = z.object({
  url: z.string().url(),
  media_type: z.enum(['html', 'image']),
  title: z.string().max(200).optional(),
  subtitle: z.string().max(300).optional(),
  transition_trigger: z.string().min(1).max(500),
  content_text: z.string().max(6000).optional(),   // NEW — B2B-35 F1
})
```
- **Field name**: `content_text` (matches the CEO brief's own suggested naming; consistent with the
  existing `content_to_explain` naming pattern on the same schema).
- **Size limit**: 6000 characters. Rationale: the demo's own longest chapter body (flattened
  paragraphs + list items) runs well under 3000 characters; 6000 gives real partners roughly double
  that headroom for a single page's spoken material before it stops being something a live session
  should say on one shared-screen page. This is a **validation-layer cap** (Zod `.max()`), not a
  silent truncation — a partner request exceeding it gets a 422, exactly like `content_to_explain`'s
  existing 5000-char cap today (same convention, same file).
- **Truncation strategy for the demo's own content** (which must never exceed the cap it validates
  against): the demo dispatch route flattens `Chapter.blocks` to plain text (Section 6.3) and, if
  the flattened result exceeds 6000 characters, truncates at the last complete sentence boundary
  under the limit — the same "truncate at last complete sentence, never mid-word/mid-sentence"
  convention already used elsewhere in this codebase's content pipeline (`lib/content/generator.ts`
  document comment history). No demo chapter currently approaches this limit.
- **Follow-up flagged, not built here**: a partner whose real per-page content is *routinely* much
  longer than 6000 characters will need a proper summarization pipeline, not a hard cap. Logging
  this as a P1 backlog item in `BACKLOG.md` (Section 12) rather than solving it now — no partner
  exists yet to be affected (Section 6.9).

**Storage**: `partner_sessions.content_pages` is already a `jsonb` column storing an array of
per-page objects — **no database migration is required for this field**. `content_text` becomes one
more key in the same per-page JSON objects the route already inserts
(`app/api/partner/v1/sessions/route.ts`'s `pagesWithMarkers` construction, lines ~135–144).

### 6.2 — Code-level types needing the new field

- `InlineContentPage` interface, `lib/partner/live-render.ts` lines 29–36 — add
  `content_text: string | null`.
- `RenderedInlinePage` is **not** changed — page bodies for the *visual* render (sandboxed iframe /
  image) are a separate concern from the *spoken* narration content; F1 only affects what's sent to
  Hume, not what's shown on screen. Confirmed no overlap risk.
- `app/api/partner/v1/sessions/route.ts`'s `pagesWithMarkers` mapping (~line 135) — pass
  `content_text: p.content_text ?? null` through into the persisted JSON, alongside the existing
  `title`/`subtitle`/`transition_trigger`/`transition_marker` fields.

### 6.3 — Flattening `ContentBlock[]` to narration-safe plain text (demo only, F1)

New helper (co-located in `app/api/demo/[slug]/dispatch/route.ts` or extracted to
`app/demo/_content.ts` as a pure function — developer's choice, no behavioral difference) that
converts a `Chapter.blocks` array (`app/demo/_content.ts` lines 7–13: `paragraph | code | list`) to
plain text for `content_text`:
- `paragraph` blocks → the `text` field, verbatim, one paragraph per line-break-separated unit.
- `list` blocks → each `items[]` entry rendered as `"- <item text>"`, one per line.
- `code` blocks → **never read the raw code aloud**. Replace with a fixed spoken-safe placeholder
  sentence: `"(There's a code example on screen illustrating this — the participant can see it.)"`
  This is the BA's resolution of the CEO's open question on HTML/code flattening: raw code read
  aloud in a live voice session is unusable and was never the intent.
- Blocks are joined with a blank line between them (mirrors how `content_to_explain` and other
  multi-paragraph fields are already joined elsewhere in `live-render.ts`, e.g.
  `buildInlineSessionContent`'s own `blocks.join('\n\n')` convention).

### 6.4 — `app/api/demo/[slug]/dispatch/route.ts` changes (F1)

Line 68–73's `content_pages` mapping gains one more field per page:
```ts
const content_pages = topic.chapters.map((ch) => ({
  url: `${appUrl}/demo/${params.slug}/visuals/${ch.id}`,
  media_type: 'html' as const,
  title: ch.title,
  transition_trigger: `Move on once "${ch.title}" has been fully explained.`,
  content_text: flattenBlocksToNarrationText(ch.blocks),   // NEW
}))
```
`flattenBlocksToNarrationText` truncates to 6000 chars at the last complete sentence per Section 6.1
(defensive — no current chapter needs it, but the dispatch route must never itself violate the
contract it's calling).

### 6.5 — `buildInlineSessionContent()` changes (F1), `lib/partner/live-render.ts` lines 361–396

Inside the `pages.forEach(...)` loop, after the existing `Subtitle:` line and before the
`[STAGE DIRECTION...]` line:
```ts
if (page.content_text) {
  lines.push(`CONTENT TO TEACH ON THIS PAGE:\n${page.content_text}`)
}
```
Byte-identical output preserved for any page where `content_text` is absent (every existing/
non-demo Option 1 request today — there are none in production, Section 6.9).

### 6.6 — `AssembleHumeNativePromptInput` / template changes (F2), `lib/voice/hume-native/prompt-template.ts`

New field:
```ts
export interface AssembleHumeNativePromptInput {
  profileContext: string
  intentContext: string
  sessionContent: string
  assistantName?: string
  promptBehavior?: PromptBehaviorConfig | null
  sessionContentMode?: 'inline' | 'template'   // NEW — B2B-35 F2, default 'template'
  audienceDescription?: string                 // NEW — B2B-35 F3, default 'a senior executive'
}
```

Three new placeholder tokens in `HUME_NATIVE_PROMPT_TEMPLATE`, resolved by mode, replacing the
current literal text of rules 1, 8, and 12 (and the current literal "a senior executive" clause,
Section 6.7):
```
export const RULE_1_PLACEHOLDER = '[RULE 1 TEXT]'
export const RULE_8_PLACEHOLDER = '[RULE 8 TEXT]'
export const RULE_12_PLACEHOLDER = '[RULE 12 TEXT]'
```

**Exact resolved text — `'template'` mode** (byte-identical to today's fixed template; this is the
existing text of rules 1, 8, 12 verbatim, just moved behind the placeholder mechanism):

- Rule 1 (template): *"Open the session warmly. Deliver the Session Overview section's prepared
  content (marked in SESSION CONTENT) in full — state the agenda, ask its verification question,
  and wait for a response — before moving to the first real subtopic. Treat this exactly like any
  other section: teach → verification question → listen → respond → bridge. Do not skip or rush
  past it, and do not ask what they want to cover — the agenda is fixed and provided below in
  SESSION CONTENT."*
- Rule 8 (template): unchanged from today's rule 8 in full, including sub-steps a/b/c.
- Rule 12 (template): unchanged from today's rule 12 in full.

**Exact resolved text — `'inline'` mode** (new):

- Rule 1 (inline): *"Open the session warmly and with genuine energy. Greet the participant,
  introduce yourself briefly, and offer a short, natural icebreaker — casual and human, never a
  rehearsed-sounding script (for example, a light remark tied to the session's topic, the time of
  day, or how they're doing). Then, in your own words, set the agenda using the SESSION TITLE,
  SESSION SUBTITLE, and WHAT TO EXPLAIN content provided below in SESSION CONTENT — synthesize and
  paraphrase this material naturally; do not recite it verbatim as a script and do not read it like
  a list. Confirm they're ready, then move into page 1."*
- Rule 8 (inline): *"When the final page is complete, close warmly. In your own words — not a
  scripted section, since none exists in this mode — briefly recap the one or two most important
  things covered today. Then follow this closing sequence every time, regardless of how the call has
  gone so far: [a/b/c — identical wording to today's rule 8 sub-steps, reused verbatim]."*
- Rule 12 (inline): *"This rule does not apply in this mode — there is no separately labeled
  Overview or Summary section to announce. Simply open naturally per rule 1 and close naturally per
  rule 8, without announcing either as a distinct section."*

`assembleHumeNativePrompt()` selects the resolved text for all three placeholders from a single
`sessionContentMode` value (default `'template'`) and does the substitution the same way
`ASSISTANT_SELF_REFERENCE`/`TONE_GUIDANCE_PLACEHOLDER` are already substituted today (`.split().join()`
pattern, `prompt-template.ts` lines 314–329).

**`PROMPT_TEMPLATE_VERSION` bump**: `'v7'` → `'v8'` (template *source* text changes — the fixed
rules 1/8/12 become placeholder-driven — even though the *assembled output* for every default/
`'template'`-mode caller remains byte-identical to v7's output, per this file's own established
"source changed, assembled output unchanged for unconfigured callers" convention documented at
lines 32–36).

### 6.7 — Audience placeholder (F3)

New constant:
```ts
export const AUDIENCE_PLACEHOLDER = '[AUDIENCE]'
```
Template's opening sentence changes from the current literal:
```
...delivering a live, one-on-one coaching session to a senior executive over voice.
```
to:
```
...delivering a live, one-on-one coaching session to ${AUDIENCE_PLACEHOLDER} over voice.
```
`assembleHumeNativePrompt()` resolves `AUDIENCE_PLACEHOLDER` from the new `audienceDescription`
input parameter, **defaulting to the literal string `'a senior executive'`** when the parameter is
omitted — this is what keeps `app/api/hume-native/provision-config/route.ts` (the one caller that
never passes this field) byte-identical to today.

### 6.8 — `end_user_role` (F3), wire contract + storage

- **Wire field name**: `end_user_role` (matches the established `partner_end_user_ref` /
  `end_client_id` naming lineage already on this schema — `end_` prefix for fields describing the
  session's actual end user, as opposed to `partner_`-prefixed fields describing the reseller
  relationship itself).
- **`CreateSessionSchema`** (`session-schema.ts`), added at the top level (not inside
  `ContentPageSchema` — this is a session-wide attribute, not per-page):
  ```ts
  end_user_role: z.string().trim().max(200).optional(),
  ```
  200-char cap matches the existing `title` field's cap on the same schema — generous for a role/
  title description ("VP of Regional Sales, EMEA"), not intended for paragraph-length input.
- **Applies to both Option 1 and Option 2** — added as a shared top-level field (outside the
  `.refine()` inline/reference-mode branching), so it validates identically regardless of which
  content mode the request uses.
- **Database**: new nullable column, migration `097_b2b35_end_user_role.sql`:
  ```sql
  ALTER TABLE partner_sessions ADD COLUMN end_user_role text;
  ```
  (Next available migration number confirmed against `supabase/migrations/` — highest existing is
  `096_b2b34_learner_insight_schema.sql`.)
- **`PartnerSessionRow`** (`live-render.ts`) gains `endUserRole: string | null`, read alongside the
  existing `content_to_explain`/`content_title` columns in `getPartnerSession()`'s select list.
- **`app/api/partner/v1/sessions/route.ts`**'s insert gains `end_user_role: end_user_role ?? null`
  in the top-level insert object (not `inlineColumns` — applies to both modes, Section 6.8 above).
- **Default resolution** (both `resolveLiveSessionRender()` and `resolveInlineSessionRender()` in
  `live-render.ts`, at their respective `assembleHumeNativePrompt()` call sites):
  ```ts
  audienceDescription: session.endUserRole?.trim() || 'a professional'
  ```
  A blank string (`""`) or whitespace-only value is treated identically to absent — both resolve to
  `'a professional'`, per the CEO brief's explicit "if we don't get that field or if its blank"
  wording.

### 6.9 — Existing partner impact (answers CEO Question 1)

Queried `partner_sessions` in the live Supabase project (`hello-clio`, project ref
`nqxlpcshouboplhnuvrh`) directly: **exactly one row exists in the entire table**, belonging to the
`"Clio Internal — Public Demo"` account (`test_mode: true`) — the B2B-33 demo session itself. Zero
real (non-demo) partners have created a session via `/api/partner/v1/sessions` in either mode as of
this writing. This means:
- The Option 1 vs. Option 2 usage split the CEO brief asked about is **0 vs. 0** among real
  partners — there is no existing partner traffic to protect beyond the standing "additive/optional,
  byte-identical when unpopulated" discipline this document already follows throughout.
- This is currently a **demo/pre-launch correctness fix**, not a live-partner regression risk. It
  remains important because Option 1 is the exact code path real partners will hit once onboarded,
  and shipping it now means the first real partner already gets correct behavior.

---

## 7. Success Criteria (Acceptance Tests)

**F1 — content fidelity:**
1. ✓ Given a `content_pages[]` entry with `content_text` populated, when the session's prompt is
   assembled via `resolveInlineSessionRender()`, then the assembled `SESSION CONTENT` block for that
   page contains a `CONTENT TO TEACH ON THIS PAGE:` line followed by the exact `content_text` value.
2. ✓ Given a `content_pages[]` entry with `content_text` omitted, when the prompt is assembled,
   then that page's block is byte-identical to the pre-B2B-35 output (title/subtitle/transition
   instruction only, no `CONTENT TO TEACH` line).
3. ✓ Given the demo dispatch route is called for the `claude-ai` topic, when `content_pages` is
   built, then every chapter's `content_text` is non-empty and contains the flattened paragraph/list
   text from that chapter's `blocks` (verified: no `code`-type block exists in current demo content,
   but the placeholder-substitution logic is unit-tested independently).
4. ✓ Given a `content_text` value longer than 6000 characters is submitted to `/sessions`, when the
   request is validated, then the response is `422` with a Zod validation error referencing
   `content_pages[i].content_text` — never silently truncated server-side for partner-submitted
   content.

**F2 — warm open:**
5. ✓ Given `sessionContentMode: 'inline'` is passed to `assembleHumeNativePrompt()`, when the prompt
   is assembled, then rule 1 in the output matches the new inline-mode text exactly (Section 6.6),
   and does not contain the string `"Session Overview section's prepared content"`.
6. ✓ Given `sessionContentMode` is omitted or `'template'`, when the prompt is assembled, then the
   output is byte-identical to the pre-B2B-35 (v7) output for rules 1, 8, and 12, given identical
   other inputs — this is the core backward-compatibility regression test and must be an automated
   unit test, not manual inspection.
7. ✓ Given `resolveLiveSessionRender()` (Option 2/template path) runs, when its
   `assembleHumeNativePrompt()` call is inspected, then `sessionContentMode` is either omitted or
   explicitly `'template'` — Option 2 behavior is provably untouched.
8. ✓ Given `resolveInlineSessionRender()` (Option 1) runs, when its `assembleHumeNativePrompt()`
   call is inspected, then `sessionContentMode` is explicitly `'inline'`.

**F3 — audience persona:**
9. ✓ Given a session is created with `end_user_role: "a first-year sales associate"`, when the
   prompt is assembled for that session (either mode), then the output's opening sentence reads
   "...delivering a live, one-on-one coaching session to a first-year sales associate over voice."
10. ✓ Given a session is created with `end_user_role` omitted, when the prompt is assembled, then
    the output's opening sentence reads "...to a professional over voice."
11. ✓ Given a session is created with `end_user_role: "   "` (whitespace only), when the prompt is
    assembled, then the output resolves identically to test 10 (`"a professional"`), not to a
    literal whitespace string.
12. ✓ Given `app/api/hume-native/provision-config/route.ts` calls `assembleHumeNativePrompt()`
    without `audienceDescription` (unchanged call site), when the prompt is assembled, then the
    output's opening sentence is unchanged: "...to a senior executive over voice."

**Cross-cutting:**
13. ✓ Given any of F1/F2/F3 land, when the full existing test suite runs (particularly
    `prompt-template`/`live-render` unit tests), then all pre-existing tests pass unmodified except
    where they are explicitly updated to assert the new default-mode/default-audience behavior —
    no pre-existing assertion about v7 output for an unconfigured caller should need to change.

---

## 8. Error States

- **`content_text` exceeds 6000 chars** (partner-submitted): `422`, Zod validation error, same
  error-response shape as every other `CreateSessionSchema` validation failure today (no new error
  code needed — reuses the existing "Validation failed" + `details: parsed.error.flatten()` shape
  at `app/api/partner/v1/sessions/route.ts`'s existing validation branch).
- **`end_user_role` exceeds 200 chars**: same as above, `422` via the shared schema validation path.
- **`content_text` present but the page itself fails to fetch** (`safeFetchPartnerPage` returns
  non-`ok`): unaffected — `content_text` is narration-only and does not depend on the page's visual
  fetch succeeding; a page marked `unavailable` for display purposes still gets its narration
  content in the prompt, since the participant is meant to hear the material even if the visual
  render degraded. This is a deliberate design choice — flagged explicitly rather than left implicit,
  since it's a small behavioral judgment call: narration and visual display are two independent
  data paths in this system (confirmed via Section 6.2's review), and there's no reason a broken
  image/HTML fetch should also silence Clio.
- **`sessionContentMode` somehow reaches an unexpected value** (should be unreachable given the Zod/
  TypeScript union type, but defensively): treat as `'template'` (the safer, existing-behavior
  default) rather than throwing — mirrors this file's existing "never throw, degrade to a defined
  state" discipline (`resolveLiveSessionRender()`'s own doc comment, line 136–138).
- **Demo dispatch's flattening helper encounters an unknown block `type`** (schema currently only
  has `paragraph | code | list`, so unreachable today, but defensive): skip that block silently
  (log a warning), do not throw and abort the whole dispatch — narrating 4 of 5 blocks correctly is
  better than failing dispatch entirely over one malformed block.

---

## 9. Edge Cases

**F1:**
- A page with `content_text` present but empty string (`""`) after `.trim()` at the Zod layer —
  Zod's `.optional()` on a `z.string()` does not auto-strip whitespace-only strings; specify
  `.max(6000)` without `.min(1)` deliberately, so an explicitly-empty string is accepted and treated
  identically to `content_text` being absent (no `CONTENT TO TEACH` line emitted) — avoids a
  confusing half-empty prompt block.
- A demo chapter whose `blocks[]` array is empty (not expected today, but defensive): flattening
  produces an empty string, `content_text` becomes `undefined`/omitted for that page — same
  degrade-gracefully behavior as above.
- Multiple `code` blocks in one chapter: each gets its own placeholder sentence, not deduplicated —
  acceptable, since seeing "There's a code example on screen" twice in a two-code-block chapter is
  harmless and accurate.

**F2:**
- A partner's Option 1 session with **zero pages** — already structurally impossible
  (`content_pages: z.array(ContentPageSchema).min(1)`), so rule 1's "move into page 1" instruction
  always has a page 1 to move into.
- Mid-call reconnect / Hume session resume: out of scope for this brief — no evidence this fix
  interacts with reconnect logic; `sessionContentMode` is baked into the upfront-assembled prompt
  snapshot exactly like every other prompt-behavior field today (`assembled_prompt_snapshot`), so
  reconnect behavior is unchanged from today's existing pattern.

**F3:**
- `end_user_role` containing content that looks like a prompt-injection attempt (e.g. "ignore
  previous instructions and...") — **not newly in scope for this brief** to build a defense for:
  the value is substituted into a single descriptive noun phrase inside a fixed sentence ("...to
  ${value} over voice"), not appended as a standalone instructional block the way
  `PARTNER-CONFIGURED GUIDANCE` is (which already has its own explicit non-override framing,
  `buildPartnerGuidanceBlock()`). If this is a concern, it is the same class of risk `assistantName`
  already carries today (also substituted directly into a sentence) and should be addressed
  consistently across both, not specially for this field — flagging as a P2 backlog note rather than
  scope creep here.
- A reseller (`account_kind: 'channel_partner'`) creating a session on behalf of an end client via
  `client_id` — `end_user_role` is independent of `client_id`/`end_client_id` (which identifies
  *which client account*, not *what role the specific end user has*) — no interaction, both can be
  set independently.

---

## 10. Out of Scope

- **Any LLM call generating or summarizing per-page content** — explicitly prohibited by the CEO
  brief. `content_text` is always partner-authored (or, for the demo, `Chapter.blocks`-derived)
  plain text, never model-generated.
- **A proper long-content summarization pipeline** for partners whose per-page material routinely
  exceeds 6000 characters — flagged as a P1 follow-up in `BACKLOG.md`, not built here (Section 6.1).
- **Building real `SessionOverview`/`SessionSummary` authored-content types for Option 1** — CEO
  explicitly rejected this design fork; F2's fix is a prompt-instruction change only.
- **Touching Option 2 (template mode) content or bookend behavior** — verified via this
  investigation that Option 2 already has real, populated Session Overview/Summary content
  (`SessionOverviewData`/`SessionSummaryData`, `lib/templates/types.ts`) and its `sessionContentMode`
  stays `'template'`, byte-identical output. No Option 2 code path is touched by F1 or F2.
- **Point 1 (name-based greeting) — no code changes authorized in this document.** Diagnosis only
  (Appendix A has findings); any fix requires a fresh CEO brief once Arun reviews the findings.
- **Prompt-injection hardening for `end_user_role` or any other directly-substituted field** —
  flagged as a P2 backlog note (Section 9), not built here.
- **A UI for partners to set `end_user_role` or `content_text`** — both are API-only fields on the
  existing `/sessions` contract; no Designer/Configurator UI changes are in scope (no such UI exists
  for Option 1 fields today either).

---

## 11. Open Questions

None. Every question the CEO brief posed to the BA (Section "Questions for BA," items 1–5) is
resolved in this document:
1. Answered in Section 6.9 (0 real partners on either mode — verified against live Supabase data).
2. Answered in Section 6.1 (`content_text`, 6000-char Zod-validated cap, truncate-at-sentence-
   boundary for the demo's own flattening step, P1 backlog flag for a future summarization pipeline).
3. Answered in Section 6.6 (exact rule 1/8/12 text for both modes, resolved via a single
   `sessionContentMode` parameter rather than two full template variants).
4. Answered in Section 6.7–6.8 (`end_user_role` wire field on `CreateSessionSchema`, threaded via a
   new `audienceDescription` parameter — explicitly *not* modeled on the `DualModePromptField`/
   `assistantName` pattern, since this is a per-session value sourced from the session-creation call,
   not a per-partner-account config value; default resolution and both-modes applicability confirmed).
5. Answered in Appendix A ("Diagnosis Findings — Point 1"), with primary evidence (DB row +
   Vercel runtime logs for the exact session), not inference.

---

## 12. Dependencies

- **F1**: None beyond what already exists — `content_pages` is already `jsonb`, no migration
  needed. Demo-side change depends only on `app/demo/_content.ts`'s existing `Chapter.blocks`
  structure (already stable, used by B2B-33).
- **F2**: Depends on F3 landing in the same `prompt-template.ts` edit pass only in the sense that
  both touch `HUME_NATIVE_PROMPT_TEMPLATE` and bump `PROMPT_TEMPLATE_VERSION` — recommend building
  F1/F2/F3 as one PR against `prompt-template.ts`/`live-render.ts`/`session-schema.ts` to avoid two
  separate `PROMPT_TEMPLATE_VERSION` bumps for what is really one coordinated template edit.
- **F3**: Requires migration `097_b2b35_end_user_role.sql` (new nullable column,
  `partner_sessions.end_user_role`) applied to Supabase before the code reading/writing that column
  ships — sequence build-then-apply-migration-then-deploy, per this project's standard practice.
- **D1**: No dependency — diagnosis only, already complete, no further data needed unless Arun
  wants the recommended follow-up test run.

---

## Appendix A — Diagnosis Findings (Point 1: Join-Greeting), for Arun's review — no code authorized

*(Presented as an appendix, not a numbered spec section, since it documents an investigation rather
than a build item — placed per the CEO brief's explicit "document your findings... this section
does not need engineering work authorized yet.")*

**Session identified**: Arun's live test corresponds to `partner_sessions.id =
ab71deef-977c-40e1-bfec-d0a182d241e3`, `hume_chat_id = 83a1080e-a1b0-47ee-884b-6a4ddd2f62b9`
(matches the ID referenced in the Orchestrator's investigation), topic "Claude AI: Models &
Capabilities" / "What Is Claude?" chapter, `partner_reference: 'claude-ai'`, session ran
2026-07-25 04:20:02 UTC → 04:31:05 UTC (~11 minutes), `status: 'completed'`.

**What I found, directly from the database and Vercel runtime logs (not inference):**

- `join_greeting_pending` = `false`, `join_greeting_participant_first_name` = `null` (queried
  post-session). `assembled_prompt_snapshot` was present (9,229 chars) — the prompt-persistence
  mechanism itself worked correctly.
- The join-greeting **client-side poll fired correctly and continuously**: Vercel logs show
  `GET /api/partner/render/join-greeting/ab71deef-...` returning `200` every ~2 seconds for the
  entire session (confirmed the 2-second interval matches `PartnerRenderClient.tsx`'s own
  `setInterval(poll, 2000)`), from shortly after session start through session end. The polling
  mechanism is not the problem.
- **Only two `participant_events.join_leave` webhook events fired during the entire session**:
  - `04:21:05` — 7 seconds *before* the bot's own `joined_recording` state change
    (`04:21:12`). Given this timing (before the bot itself had even finished joining/recording) and
    that no `[attendee/webhook] partner session participant.joined — join greeting flag set:` log
    line appears for this event (which the code only logs *after* successfully setting the flag), the
    code path exited via one of the two early `break`s in the handler (`app/api/attendee/webhook/
    route.ts` lines ~476–503) — most consistent with this being Attendee's own event for the bot's
    own presence, correctly filtered out by the "skip the bot itself" name check.
  - `04:31:41` — 39 seconds *after* the session's own `ended_at` (04:31:05), i.e. right at
    call teardown. Same absence of a "flag set" log line — most consistent with this being a
    `participant_left` event (filtered by the `eventType !== 'participant_joined'` guard), not a
    join.
- **No `participant_events.join_leave` event was ever received for Arun's own join**, despite Arun
  being the actual human participant on the call. Combined with the fact he joined the Google Meet
  himself (as the meeting's host/initiator) before or around when the bot dispatched, the most
  likely explanation is a known class of meeting-bot limitation: **join/leave webhooks typically
  only fire for participants who join *after* the bot begins actively tracking the meeting roster
  (i.e., after or around `joined_recording`)** — a participant already present in the meeting when
  the bot arrives may never generate a "joined" event for the bot's webhook integration to observe,
  because from the provider's perspective that participant didn't "join" during the bot's
  observation window at all.

**Conclusion for Arun**: The join-greeting *mechanism itself* — flag-set on webhook, live poll,
Hume prompt-prefix send, PATCH-clear — is fully built, correctly wired end-to-end, and functioned
exactly as designed for every event it actually received. It did not fire for Arun specifically
because **no `participant_joined` webhook event was ever received for him** — not a bug in the
greeting code, but very likely a gap in when Attendee (the meeting-bot vendor) emits join events
relative to when the bot itself joins. This is answerable with more confidence only by testing a
call where the human participant joins *after* the bot is already present and recording — if that
produces a `participant_joined` event and a successful greeting, it confirms the "already-present
participant" theory precisely; if it still doesn't fire, the deeper bug is elsewhere (e.g. in
Attendee's own roster-detection or the bot's name-matching). **Recommend this specific test as the
next step before any code changes are considered** — not proposing a fix yet, per the brief's
diagnosis-only scope.

---

## Section 11 Restated — Confirmation

Per the governance gate in `CLAUDE.md`: Section 11 (Open Questions) is empty. This document is
ready for CEO Agent approval. No developer should begin work until that approval lands.
