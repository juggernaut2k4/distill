# Participant Name + Industry Parameterization (F4), Voice-Pacing Mitigation (F5) — Requirement Document

Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-26
Feature ID: B2B-36
Source: CEO Feature Brief, 2026-07-26 (`.claude/agents/clio/feature-briefs/B2B-36-participant-name-industry-and-voice-pacing-mitigation.md`)

---

## 0. How this document is organized

This brief bundles two independent pieces, discussed and resolved together in one CEO working
session (same rationale B2B-34/35 used for bundling). Both extend `lib/voice/hume-native/
prompt-template.ts` and share one `PROMPT_TEMPLATE_VERSION` bump, so they are specified together
under the shared 12-section template, split into **Part F4** and **Part F5** wherever behavior
differs:

- **Part F4 — Parameterized participant name + industry.** Extends B2B-35's `end_user_role`
  mechanism (`docs/specs/B2B-35-requirement-document.md` §6.7–6.8) with two new fields:
  `end_user_name` (required going forward) and `end_user_industry` (optional). Touches
  `lib/partner/session-schema.ts`, `lib/partner/live-render.ts`, `lib/voice/hume-native/
  prompt-template.ts`, `app/api/partner/v1/sessions/route.ts`, `app/api/demo/[slug]/meeting/
  route.ts`, `app/api/demo/[slug]/dispatch/route.ts`, `app/demo/[slug]/DemoTopicClient.tsx`, and a
  new migration `098_b2b36_end_user_name_industry.sql`.
- **Part F5 — Voice-pacing mitigation.** A soft, toggleable, prompt-only mitigation for Clio's
  voice fading to a whisper during long continuous speech. Touches only
  `lib/voice/hume-native/prompt-template.ts` and `.env.local.example`. No DB migration, no
  dependency on F4.

**All facts below were independently re-verified against live code (read in full) and live
production data (queried directly via the Supabase MCP against project `nqxlpcshouboplhnuvrh`,
2026-07-26) — not assumed from the CEO brief's own verification.** Every implementation-level fork
the CEO brief resolved (industry-clause wording, name-greeting scoped to inline mode only, single
toggle read inside `assembleHumeNativePrompt()`) is carried through here precisely, unchanged.

**Section 11 (Open Questions) is empty.**

---

## 1. Purpose

**F4**: Clio's live voice narration currently addresses every participant as a generic "the
participant" and calibrates to a role but never an industry (B2B-35). This flattens the
personalization the product promises — a sales manager at a hospital system and a sales manager at
a software company hear identical language. Failure without this fix: every partner session (and
the public demo) sounds impersonal at the exact moment — the opening greeting — where warmth
matters most, and misses an entire axis of calibration (industry-specific examples/language) that
B2C used to provide and B2B has not yet restored.

**F5**: Arun has observed Clio's voice gradually fading to a whisper during long, continuous,
uninterrupted speech in live sessions. Independent code verification (CEO brief, confirmed again
below in this document) rules out this codebase's own audio pipeline as the cause — the fade is a
vendor-side behavior (Hume TTS generation over one long unbroken turn, or an artifact of the
Attendee.dev browser-tab-audio-capture hop), neither of which this codebase can instrument or fix
directly. Failure without this fix: every long live session risks becoming inaudible partway
through Clio's longer explanations, undermining the core "reliable live coaching" product promise,
with no lever available to address it except prompting Clio to naturally break up long speech.

---

## 2. User Story

As a **live-session participant** (e.g. Arun in the public demo, or a future partner's end user),
I want Clio to greet me by name, calibrate her examples to my industry when it's known, and keep a
steady, audible voice throughout the session — even during her longer explanations,
So that the session feels personal, relevant to my context, and doesn't become hard to hear midway
through.

As a **reseller/partner building a session via the partner API**,
I want to optionally tell Clio who the end user is by name and industry (extending B2B-35's role
field),
So that Clio's live coaching addresses my end user personally and speaks to their specific
business context, without me having to build anything beyond populating a few more request fields.

As the **demo operator** (Arun, via the passcode-gated Meeting tab),
I want to save a participant name alongside the meeting URL before dispatching Clio's bot,
So that the live demo greets me by name, matching what a real partner's end user would experience.

---

## 3. Trigger / Entry Point

**F4** and **F5** activate at existing entry points — no new route, no new top-level UI page.

- **F4, wire contract**: `POST /api/partner/v1/sessions` (`lib/partner/session-schema.ts`'s
  `CreateSessionSchema`) — the request body gains one new **required** field (`end_user_name`) and
  one new **optional** field (`end_user_industry`). No new endpoint.
- **F4, demo UI**: the existing Meeting tab on `app/demo/[slug]/page.tsx` →
  `DemoTopicClient.tsx`, reached by any visitor to `/demo/[slug]` — no auth required to view; the
  passcode gate applies only to the existing Save action, unchanged. A visitor must be on the
  Meeting tab and know the shared demo passcode to save a name (same gate as the existing URL
  field).
- **F4, prompt assembly**: consumed inside `resolveLiveSessionRender()` /
  `resolveInlineSessionRender()` (`lib/partner/live-render.ts`), reached when the partner-render
  page (`app/partner-render/[clio_session_ref]/page.tsx`) loads for the meeting bot — identical
  trigger to B2B-35.
- **F5**: no new trigger at all — it is a change to the fixed portion of
  `HUME_NATIVE_PROMPT_TEMPLATE`'s rule 7, gated by a new server-only env var
  (`HUME_NATIVE_PACING_GUIDANCE_ENABLED`) read once inside `assembleHumeNativePrompt()`. Every
  existing call site (both partner render paths, and the legacy
  `app/api/hume-native/provision-config/route.ts`) picks it up automatically with no code change
  at any of those three call sites.
- **State required**: identical to B2B-35 — a valid `partner_sessions` row created via the sessions
  endpoint (F4), or, for the demo, a `demo_meeting_urls` row with a saved `meeting_url` (F4). No
  auth changes, no new session states, for either piece.

---

## 4. Flow Description

### F4 — Parameterized participant name + industry

**Today's flow** (confirmed live in `lib/voice/hume-native/prompt-template.ts` and
`lib/partner/live-render.ts`, both read in full 2026-07-26):
1. `HUME_NATIVE_PROMPT_TEMPLATE`'s opening sentence resolves `${AUDIENCE_PLACEHOLDER}` from
   `session.endUserRole?.trim() || 'a professional'` (B2B-35 F3) — role only, never industry.
2. `RULE_1_INLINE_TEXT` (Option 1's opening-rule text) contains the fixed, literal phrase "Greet
   the participant, introduce yourself briefly..." — never a real name, for every session.
3. No `end_user_name` or `end_user_industry` field exists anywhere on the wire contract, the
   `partner_sessions` table, or the demo's `demo_meeting_urls` table.

**New flow**:
1. A reseller/partner may now supply `end_user_name` (**required** on every new request) and
   `end_user_industry` (**optional**) on `POST /api/partner/v1/sessions`, top-level, alongside the
   existing `end_user_role`.
2. For the demo specifically: the Meeting tab gains a required "Name" field, saved together with
   the Google Meet URL via the same passcode-gated Save action
   (`POST /api/demo/[slug]/meeting`). `app/api/demo/[slug]/dispatch/route.ts` reads the saved name
   back out of `demo_meeting_urls` and passes it as `end_user_name` in its own call to
   `/api/partner/v1/sessions` — mirroring exactly how it already does this for `meeting_url`.
3. `assembleHumeNativePrompt()` gains two new optional inputs: `participantName` and
   `endUserIndustry`.
   - `participantName` resolves into `RULE_1_INLINE_TEXT`'s greeting (Option 1 / inline mode
     **only** — see Fork 2 below), defaulting to the literal `'the participant'`
     (byte-identical output) when omitted.
   - `endUserIndustry` extends the **same** opening-sentence audience clause that
     `end_user_role` already resolves (**both** Option 1 and Option 2 — see Fork 1 below),
     appending `" in {industry}"` when present, and resolving to `''` (nothing — the clause is
     omitted entirely, never a placeholder) when absent.
4. Both `resolveLiveSessionRender()` (Option 2 / template mode) and `resolveInlineSessionRender()`
   (Option 1 / inline mode) in `live-render.ts` pass `endUserIndustry` through. Only
   `resolveInlineSessionRender()` passes `participantName` — Option 2's rule 1 is a verbatim
   scripted recitation of an authored Session Overview, with no natural seam for a name (same
   reasoning B2B-35 F2 used to scope its own inline-only warm-open fix).

**Fork 1 — how `end_user_industry` changes the prompt** (CEO-resolved, carried through unchanged):
extend the same opening sentence `audienceDescription` already lives in. Today (B2B-35):
`` `...delivering a live, one-on-one coaching session to ${AUDIENCE_PLACEHOLDER} over voice.` ``.
New: `` `...delivering a live, one-on-one coaching session to
${AUDIENCE_PLACEHOLDER}${INDUSTRY_CLAUSE_PLACEHOLDER} over voice.` ``, where
`INDUSTRY_CLAUSE_PLACEHOLDER` resolves to `''` when industry is absent (byte-identical to today)
or `` ` in ${industry}` `` when present.

**Fork 2 — name-based greeting scope** (CEO-resolved, carried through unchanged): applies to
`RULE_1_INLINE_TEXT` (Option 1) only, not `RULE_1_TEMPLATE_TEXT` (Option 2). `end_user_name` is
still collected as a schema field applicable to both content modes; it is simply only *used* in the
greeting mechanism for Option 1 today.

### F5 — Voice-pacing mitigation

**Today's flow**: `HUME_NATIVE_PROMPT_TEMPLATE`'s rule 7 (unconditional, both modes) reads: *"Keep
a natural pace: teach with patience, not speed. Prioritize the participant actually understanding
the material over covering everything at maximum velocity — but you are responsible for keeping
the session moving toward completion within a reasonable session length."* — no guidance
addressing sustained continuous speech.

**New flow**: rule 7 gains one additional sentence, present only when
`HUME_NATIVE_PACING_GUIDANCE_ENABLED === 'true'`, encouraging Clio to naturally break up long
stretches of continuous speech with brief pauses or check-in questions — a soft, revocable
mitigation, not a hard technical enforcement (elapsed-speech tracking + forced mid-session prompt
injection is explicitly deferred, contingent on this soft version's live-test results). The toggle
is read exactly once, inside `assembleHumeNativePrompt()` itself, so every caller (both partner
render paths and the legacy B2C provision-config route) picks it up with zero additional wiring —
mirrors the existing `HUME_NATIVE_SUMMARY_MODE` toggle's exact mechanism, confirmed live at
`app/api/hume-native/provision-config/route.ts:71`
(`process.env.HUME_NATIVE_SUMMARY_MODE === 'true'`).

---

## 5. Visual Examples

### 5.1 — F4: assembled prompt opening sentence, before vs. after

**Before** (B2B-35 output, `end_user_role` present, no industry field exists):
> "...delivering a live, one-on-one coaching session to a mid-level sales manager over voice."

**After** (reseller supplies `end_user_role: "a mid-level sales manager"`,
`end_user_industry: "healthcare"`):
> "...delivering a live, one-on-one coaching session to a mid-level sales manager in healthcare
> over voice."

**After** (industry omitted — byte-identical to B2B-35's own output):
> "...delivering a live, one-on-one coaching session to a mid-level sales manager over voice."

### 5.2 — F4: `RULE_1_INLINE_TEXT`'s resolved greeting instruction, before vs. after

**Before**: *"...Greet the participant, introduce yourself briefly, and offer a short, natural
icebreaker..."*

**After** (`end_user_name: "Arun"`): *"...Greet Arun, introduce yourself briefly, and offer a
short, natural icebreaker..."*

**After** (name omitted/blank — defensive path only, unreachable for any new session since
`end_user_name` is required at the wire-schema layer): *"...Greet the participant, introduce
yourself briefly..."* — byte-identical to today.

### 5.3 — F4: demo Meeting tab, before vs. after (wireframe)

**Before** (today — URL field, then Passcode field, then Save):
```
┌─────────────────────────────────────────────────────────┐
│  Currently saved: https://meet.google.com/sbe-bmsd-gnw   │
│  — saved Jul 25, 2026, 4:20 AM                            │
│                                                            │
│  Google Meet URL                                          │
│  [ https://meet.google.com/xxx-xxxx-xxx              ]    │
│                                                            │
│  Passcode                                                  │
│  [ ••••••••                                           ]    │
│                                                            │
│  [ Save ]                                                  │
└─────────────────────────────────────────────────────────┘
```

**After** (Name field added first, "who, then where"; summary line acknowledges both fields):
```
┌─────────────────────────────────────────────────────────┐
│  Currently saved: Arun, meeting at                        │
│  https://meet.google.com/sbe-bmsd-gnw                     │
│  — saved Jul 25, 2026, 4:20 AM                            │
│                                                            │
│  Name                                                      │
│  [ Participant's name                                 ]    │
│                                                            │
│  Google Meet URL                                           │
│  [ https://meet.google.com/xxx-xxxx-xxx              ]    │
│                                                            │
│  Passcode                                                  │
│  [ ••••••••                                           ]    │
│                                                            │
│  [ Save ]                                                  │
└─────────────────────────────────────────────────────────┘
```

**After, immediately post-migration, before Arun re-saves** (the one existing `claude-ai` row has
`meeting_url` but `end_user_name = NULL` — an explicit, expected edge case, not a bug):
```
┌─────────────────────────────────────────────────────────┐
│  Currently saved: https://meet.google.com/sbe-bmsd-gnw    │
│  (no name saved yet — add a name below to enable          │
│  Learn with AI) — saved Jul 25, 2026, 4:20 AM              │
│                                                            │
│  Name                                                       │
│  [ Participant's name                                 ]    │
│  ...                                                        │
└─────────────────────────────────────────────────────────┘
```
And in the action bar above the tabs, "Learn with AI" stays disabled with helper text: *"Save a
meeting URL and name in the Meeting tab to enable this."* (updated from today's "Save a meeting URL
in the Meeting tab to enable this.")

**Never-saved state** (fresh topic, neither field ever saved — updated empty-state copy):
> "For this demo, enter the participant's name and paste the Google Meet URL you want Clio's bot to
> join, then Save."

### 5.4 — F5: assembled rule 7, before vs. after (toggle enabled)

**Before / toggle off (byte-identical)**:
> "7. Keep a natural pace: teach with patience, not speed. Prioritize the participant actually
> understanding the material over covering everything at maximum velocity — but you are
> responsible for keeping the session moving toward completion within a reasonable session
> length."

**After / toggle on**:
> "7. Keep a natural pace: teach with patience, not speed. Prioritize the participant actually
> understanding the material over covering everything at maximum velocity — but you are
> responsible for keeping the session moving toward completion within a reasonable session length.
> When explaining something at length, naturally break up longer stretches of continuous speech —
> roughly every minute or so — with a brief pause, a quick check-in like 'does that make sense so
> far?', or a short verification question, rather than delivering one long unbroken monologue. This
> is about rhythm and delivery, not shortening the material."

---

## 6. Data Requirements

### 6.1 — Migration `098_b2b36_end_user_name_industry.sql`

Confirmed live: highest existing migration is `097_b2b35_end_user_role.sql` — next available is
`098`. Exact file, matching `097`'s own doc-comment convention:

```sql
-- B2B-36 F4 — parameterized participant name (required at the API layer for every new session
-- going forward) and optional industry, extending B2B-35's end_user_role mechanism
-- (docs/specs/B2B-35-requirement-document.md §6.7-6.8). Both nullable at the DB level so this
-- migration and any pre-existing row (the demo's own `claude-ai` row currently has no name) do not
-- break — non-nullability is enforced at the Zod/API layer only (§6.2 below), same precedent as
-- every other field on these tables.
-- See docs/specs/B2B-36-requirement-document.md.

ALTER TABLE partner_sessions ADD COLUMN end_user_name text;
ALTER TABLE partner_sessions ADD COLUMN end_user_industry text;
ALTER TABLE demo_meeting_urls ADD COLUMN end_user_name text;
```

**Live-data confirmation (queried directly, 2026-07-26, project `nqxlpcshouboplhnuvrh`)**:
- `partner_sessions`: 1 total row, 0 non-test-mode rows — zero real partners exist. Making
  `end_user_name` required at the API layer is safe (§6.2).
- `demo_meeting_urls`: exactly 1 row (`slug: 'claude-ai'`, `meeting_url:
  'https://meet.google.com/sbe-bmsd-gnw'`, `updated_at: 2026-07-25 04:20:01`). This row has no
  `end_user_name` column today; after this migration it will read `end_user_name = NULL`. Per §9
  (Edge Cases), "Learn with AI" on the live public demo page goes back to **disabled** until Arun
  re-saves the Meeting tab with a name — expected, not a regression, and called out to Arun at
  hand-off.

### 6.2 — `CreateSessionSchema` (`lib/partner/session-schema.ts`)

Live schema confirmed (read in full 2026-07-26) — `end_user_role: z.string().trim().max(200)
.optional()` sits as the last field before the closing `})`. New fields added immediately after
it, same block:

```ts
// B2B-36 F4 — required, session-wide participant name (docs/specs/B2B-36-requirement-document.md
// §6.2). Unlike end_user_role/end_user_industry, this has no .optional() — every new session must
// supply it. Safe: zero real (non-test-mode) partner_sessions rows exist as of 2026-07-26
// (re-verified live, not assumed from a prior finding).
end_user_name: z.string().trim().min(1, 'end_user_name is required').max(200),
// B2B-36 F4 — optional, session-wide industry description (e.g. "healthcare"), extending the
// end_user_role audience clause. No default when absent — the industry clause is omitted
// entirely, never replaced with a placeholder (§6.4).
end_user_industry: z.string().trim().max(200).optional(),
```

- **Caps**: 200 chars each, matching `end_user_role`'s own cap on the same schema (generous for a
  name or an industry description, not paragraph-length input).
- **No interaction with the existing `.refine()` calls** — both refine functions check only
  `content_pages`/`content_ref`/`content_source_id`; adding top-level fields outside that logic is
  additive and does not require touching either refine.
- **Existing-caller impact**: the only current caller of this endpoint is
  `app/api/demo/[slug]/dispatch/route.ts` (§6.6 — updated in this same brief to supply
  `end_user_name`). Zero real partners exist to be broken (confirmed live, §6.1). This is the one
  caller-breaking change in this brief and it is fixed in the same PR.

### 6.3 — `PartnerSessionRow` / `getPartnerSession()` (`lib/partner/live-render.ts`)

Live interface confirmed (read in full 2026-07-26) — `endUserRole: string | null` is the last
field. New fields added the same way:

```ts
export interface PartnerSessionRow {
  // ...unchanged fields...
  endUserRole: string | null
  // B2B-36 F4 — new. Null for every pre-B2B-36 session (resolves to the 'the participant'/no
  // industry-clause defaults, unchanged).
  endUserName: string | null
  endUserIndustry: string | null
}
```

`getPartnerSession()`'s select string gains `, end_user_name, end_user_industry` (appended after
`end_user_role`); the mapped-object return gains:
```ts
endUserName: (data.end_user_name as string | null) ?? null,
endUserIndustry: (data.end_user_industry as string | null) ?? null,
```

### 6.4 — `lib/voice/hume-native/prompt-template.ts` (F4 + F5, one coordinated edit)

**New placeholder constants** (F4), added alongside the existing `AUDIENCE_PLACEHOLDER`:
```ts
export const PARTICIPANT_NAME_PLACEHOLDER = '[PARTICIPANT NAME]'
export const INDUSTRY_CLAUSE_PLACEHOLDER = '[INDUSTRY CLAUSE]'
```

**New placeholder constant** (F5):
```ts
export const PACING_GUIDANCE_PLACEHOLDER = '[PACING GUIDANCE]'
```

**Template opening sentence** (F4, Fork 1) — `HUME_NATIVE_PROMPT_TEMPLATE`'s first line changes
from the live, confirmed text:
```
You are Clio, an AI business coach delivering a live, one-on-one coaching
session to ${AUDIENCE_PLACEHOLDER} over voice. This is a real-time conversation —
```
to:
```
You are Clio, an AI business coach delivering a live, one-on-one coaching
session to ${AUDIENCE_PLACEHOLDER}${INDUSTRY_CLAUSE_PLACEHOLDER} over voice. This is a real-time conversation —
```

**Rule 7** (F5) — live, confirmed text changes from:
```
7. Keep a natural pace: teach with patience, not speed. Prioritize the
   participant actually understanding the material over covering everything
   at maximum velocity — but you are responsible for keeping the session
   moving toward completion within a reasonable session length.
```
to (only the trailing placeholder is new; every other character is unchanged, including the exact
existing indentation):
```
7. Keep a natural pace: teach with patience, not speed. Prioritize the
   participant actually understanding the material over covering everything
   at maximum velocity — but you are responsible for keeping the session
   moving toward completion within a reasonable session length.${PACING_GUIDANCE_PLACEHOLDER}
```
This is appended to rule 7's existing text rather than inserted as a new numbered rule 8+, so
rules 8–12 (several of which cross-reference each other and rule 6/8 by number inside
`buildPartnerGuidanceBlock()`'s `ruleRef` string labels) never need renumbering.

**`RULE_1_INLINE_TEXT`** (F4, Fork 2/3) — live, confirmed text changes from:
```ts
const RULE_1_INLINE_TEXT =
  "Open the session warmly and with genuine energy. Greet the participant, introduce yourself briefly, and offer a short, natural icebreaker — casual and human, never a rehearsed-sounding script (for example, a light remark tied to the session's topic, the time of day, or how they're doing). Then, in your own words, set the agenda using the SESSION TITLE, SESSION SUBTITLE, and WHAT TO EXPLAIN content provided below in SESSION CONTENT — synthesize and paraphrase this material naturally; do not recite it verbatim as a script and do not read it like a list. Confirm they're ready, then move into page 1."
```
to (a template literal embedding the new placeholder token — `${PARTICIPANT_NAME_PLACEHOLDER}` is
inlined into the literal string at module-eval time, exactly like `HUME_NATIVE_PROMPT_TEMPLATE`
itself already does with `${AUDIENCE_PLACEHOLDER}`):
```ts
const RULE_1_INLINE_TEXT =
  `Open the session warmly and with genuine energy. Greet ${PARTICIPANT_NAME_PLACEHOLDER}, introduce yourself briefly, and offer a short, natural icebreaker — casual and human, never a rehearsed-sounding script (for example, a light remark tied to the session's topic, the time of day, or how they're doing). Then, in your own words, set the agenda using the SESSION TITLE, SESSION SUBTITLE, and WHAT TO EXPLAIN content provided below in SESSION CONTENT — synthesize and paraphrase this material naturally; do not recite it verbatim as a script and do not read it like a list. Confirm they're ready, then move into page 1.`
```
`RULE_1_TEMPLATE_TEXT` is **not touched** (Fork 2 — Option 2 keeps its own unrelated, unchanged
text).

**New function** (F5):
```ts
function buildPacingGuidance(): string {
  const enabled = process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED === 'true'
  if (!enabled) return ''
  return ' When explaining something at length, naturally break up longer stretches of ' +
    'continuous speech — roughly every minute or so — with a brief pause, a quick check-in ' +
    'like "does that make sense so far?", or a short verification question, rather than ' +
    'delivering one long unbroken monologue. This is about rhythm and delivery, not ' +
    'shortening the material.'
}
```

**`AssembleHumeNativePromptInput`** gains two new fields (F4 only — F5 needs no new input, it
reads its env var internally):
```ts
export interface AssembleHumeNativePromptInput {
  // ...unchanged fields, including audienceDescription...
  /**
   * B2B-36 F4 — optional participant name, substituted into RULE_1_INLINE_TEXT's greeting
   * (inline/Option 1 mode only — Fork 2). Defaults to the literal 'the participant' when
   * omitted/blank, reproducing today's fixed wording exactly.
   */
  participantName?: string
  /**
   * B2B-36 F4 — optional industry description, extending the same opening-sentence audience
   * clause end_user_role already resolves (both modes — Fork 1). Resolves to an empty clause
   * (nothing appended) when absent — never a placeholder guess.
   */
  endUserIndustry?: string
}
```

**`assembleHumeNativePrompt()`** — destructuring and resolution:
```ts
export function assembleHumeNativePrompt(input: AssembleHumeNativePromptInput): string {
  const {
    // ...unchanged...
    audienceDescription = 'a senior executive',
    participantName,        // NEW — F4
    endUserIndustry,        // NEW — F4
  } = input

  // ...unchanged...

  // B2B-36 F4 — resolves independently of sessionContentMode; the token only appears in
  // RULE_1_INLINE_TEXT, so this is a harmless no-op for 'template' mode (Fork 2).
  const resolvedParticipantName = participantName?.trim() || 'the participant'
  // B2B-36 F4 — Fork 1: byte-identical ('') when absent/whitespace-only, never a placeholder.
  const industryClause = endUserIndustry?.trim() ? ` in ${endUserIndustry.trim()}` : ''

  const assembled = namedTemplate
    .split(TONE_GUIDANCE_PLACEHOLDER).join(toneGuidance)
    .split(PARTNER_GUIDANCE_PLACEHOLDER).join(partnerGuidance)
    .split(RULE_1_PLACEHOLDER).join(rule1Text)
    .split(RULE_8_PLACEHOLDER).join(rule8Text)
    .split(RULE_12_PLACEHOLDER).join(rule12Text)
    .split(PARTICIPANT_NAME_PLACEHOLDER).join(resolvedParticipantName)   // NEW — F4
    .split(INDUSTRY_CLAUSE_PLACEHOLDER).join(industryClause)             // NEW — F4
    .split(PACING_GUIDANCE_PLACEHOLDER).join(buildPacingGuidance())      // NEW — F5
    .split(AUDIENCE_PLACEHOLDER).join(audienceDescription)
    .split(CONTEXT_PLACEHOLDER).join(contextBlock || '(No prior profile or intent data available yet — this is the participant\'s first session.)')
    .split(SESSION_CONTENT_PLACEHOLDER).join(sessionContent ?? '')

  // ...unchanged guardrail check below...
```

**`PROMPT_TEMPLATE_VERSION`**: `'v8'` → `'v9'` (template *source* changes for both F4 and F5;
assembled output for every caller that passes none of the three new inputs and has the F5 toggle
unset/false remains byte-identical to v8's own output — this codebase's own established
"source-changed/output-unchanged-when-unconfigured" convention, confirmed at
`prompt-template.ts:32-36`). Confirmed via repo-wide grep that `PROMPT_TEMPLATE_VERSION` has
exactly one functional reference (its own definition) plus one stale, non-functional comment in
`inngest/session-quality-evaluator.ts:173` that names a much older version (`'v3'`) in a comment
about rule 6 phrasing — unaffected by this bump, no code change needed there.

### 6.5 — `resolveLiveSessionRender()` / `resolveInlineSessionRender()` call sites (`lib/partner/live-render.ts`)

**`resolveLiveSessionRender()`** (Option 2 / template mode) — its `assembleHumeNativePrompt()` call
gains `endUserIndustry` only (Fork 1 — both modes get the industry clause):
```ts
const prompt = assembleHumeNativePrompt({
  // ...unchanged...
  sessionContentMode: 'template',
  audienceDescription: session.endUserRole?.trim() || 'a professional',
  endUserIndustry: session.endUserIndustry ?? undefined,   // NEW — F4, both modes
  // participantName intentionally NOT passed here — Fork 2, template mode has no greeting seam.
  promptBehavior: { /* unchanged */ },
})
```

**`resolveInlineSessionRender()`** (Option 1 / inline mode) — its `assembleHumeNativePrompt()` call
gains both new fields:
```ts
const prompt = assembleHumeNativePrompt({
  // ...unchanged...
  sessionContentMode: 'inline',
  audienceDescription: session.endUserRole?.trim() || 'a professional',
  participantName: session.endUserName ?? undefined,        // NEW — F4, inline only
  endUserIndustry: session.endUserIndustry ?? undefined,     // NEW — F4, both modes
  promptBehavior: { /* unchanged */ },
})
```

### 6.6 — `app/api/partner/v1/sessions/route.ts`

Live, confirmed destructuring (~line 39-53) gains the two new fields:
```ts
const {
  // ...unchanged...
  end_user_role,
  end_user_name,        // NEW — F4
  end_user_industry,    // NEW — F4
} = parsed.data
```
Live, confirmed insert object (~line 164-180) gains, alongside the existing `end_user_role` line:
```ts
// B2B-36 F4 — required at the Zod layer (§6.2), so `?? null` here is defensive only, matching
// this file's existing style for the other end_user_* fields.
end_user_name: end_user_name ?? null,
end_user_industry: end_user_industry ?? null,
```

### 6.7 — `app/api/demo/[slug]/meeting/route.ts`

Live, confirmed `SaveMeetingUrlSchema` gains a required field:
```ts
const SaveMeetingUrlSchema = z.object({
  meeting_url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), { message: 'meeting_url must be an https:// URL' }),
  // B2B-36 F4 — required. Mirrors end_user_name's own .min(1) at the partner-API layer (§6.2) —
  // the demo path enforces the same "required everywhere" rule via its own schema.
  end_user_name: z.string().trim().min(1, 'Name is required').max(200),
  passcode: z.string().min(1),
})
```
- **`GET`**: select list gains `end_user_name`; response gains `end_user_name: data?.end_user_name
  ?? null`.
- **`POST`**: the `upsert()` call's object gains `end_user_name: parsed.data.end_user_name`
  alongside `meeting_url`; the `.select(...)` list and the success response both gain
  `end_user_name`.
- **Validation-failure message**: the existing `validation_failed` response message ("Enter a
  valid https:// meeting URL.") is updated to **"Enter a name and a valid https:// meeting URL."**
  — the schema now validates two required fields, and this message should not silently mislead a
  caller whose name field failed instead of their URL. See §8 for why the client needs no new
  per-field error-message logic despite this change.

### 6.8 — `app/demo/[slug]/DemoTopicClient.tsx`

Live, confirmed component state/handlers (read in full 2026-07-26):

- **New state**, added alongside the existing `urlInput`/`savedMeetingUrl` pair:
  ```ts
  const [nameInput, setNameInput] = useState('')
  const [savedEndUserName, setSavedEndUserName] = useState<string | null>(null)
  ```
- **`GET /api/demo/[slug]/meeting` fetch effect** (~line 150-170): response type gains
  `end_user_name: string | null`; success handler gains `setSavedEndUserName(data.end_user_name)`.
- **New form field**, placed **before** the existing "Google Meet URL" field (natural top-to-bottom
  order: who, then where — CEO's own resolution), same styling primitives already imported
  (`meetingFieldWrapStyle`, `meetingLabelStyle`, `meetingInputStyle`):
  ```tsx
  <div style={{ ...meetingFieldWrapStyle, marginBottom: 16 }}>
    <label style={meetingLabelStyle} htmlFor="meeting-name-input">
      Name
    </label>
    <input
      id="meeting-name-input"
      type="text"
      value={nameInput}
      onChange={(e) => setNameInput(e.target.value)}
      disabled={saving}
      placeholder="Participant's name"
      style={meetingInputStyle}
    />
    {saveNameError && (
      <div style={{ fontSize: 12.5, color: COLORS.red, marginTop: 6 }}>{saveNameError}</div>
    )}
  </div>
  ```
  (`saveNameError` state addressed in §8 — added for structural symmetry with `saveUrlError`/
  `savePasscodeError` even though, per §8's reasoning, it is never actually reachable given
  `canSave`'s own client-side gate.)
- **`handleSave()`** (~line 178-213): the POST body gains `end_user_name: nameInput`; the success
  branch (`res.ok`) gains `setSavedEndUserName(data.end_user_name)` and `setNameInput('')`,
  alongside the existing `setSavedMeetingUrl`/`setUrlInput('')` calls.
- **`canSave`** (~line 262) changes from:
  ```ts
  const canSave = urlInput.trim().length > 0 && passcodeInput.length > 0 && !saving
  ```
  to:
  ```ts
  const canSave = urlInput.trim().length > 0 && nameInput.trim().length > 0 && passcodeInput.length > 0 && !saving
  ```
- **`meetingReady`** (~line 263) changes from:
  ```ts
  const meetingReady = Boolean(savedMeetingUrl)
  ```
  to:
  ```ts
  const meetingReady = Boolean(savedMeetingUrl) && Boolean(savedEndUserName)
  ```
  — this is the change that actually gates "Learn with AI" (disabled attribute at ~line 366) on
  both fields, not just the URL.
- **Helper text under the "Learn with AI" button** (~line 377) changes from *"Save a meeting URL in
  the Meeting tab to enable this."* to *"Save a meeting URL and name in the Meeting tab to enable
  this."*
- **"Currently saved" summary paragraph** (~line 507-517), which today is gated on
  `savedMeetingUrl` alone (not `meetingReady`), gains a name-aware branch — three states instead of
  two:
  ```tsx
  {savedMeetingUrl && savedEndUserName && (
    <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
      Currently saved: <strong style={{ color: COLORS.textPrimary }}>{savedEndUserName}</strong>,
      meeting at <strong style={{ color: COLORS.textPrimary }}>{savedMeetingUrl}</strong>
      {savedMeetingUpdatedAt && <> — saved {formatSavedAt(savedMeetingUpdatedAt)}.</>}
    </p>
  )}
  {savedMeetingUrl && !savedEndUserName && (
    <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
      Currently saved: <strong style={{ color: COLORS.textPrimary }}>{savedMeetingUrl}</strong>{' '}
      (no name saved yet — add a name below to enable Learn with AI)
      {savedMeetingUpdatedAt && <> — saved {formatSavedAt(savedMeetingUpdatedAt)}.</>}
    </p>
  )}
  {!savedMeetingUrl && (
    <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
      For this demo, enter the participant&apos;s name and paste the Google Meet URL you want
      Clio&apos;s bot to join, then Save.
    </p>
  )}
  ```
  This third state (`savedMeetingUrl && !savedEndUserName`) is precisely the migration edge case
  (§6.1, §9) — the existing `claude-ai` row the instant this migration lands, until Arun re-saves.

### 6.9 — `app/api/demo/[slug]/dispatch/route.ts`

Live, confirmed select (~line 42-46) gains `end_user_name`:
```ts
const { data: savedRow } = await supabase
  .from('demo_meeting_urls')
  .select('meeting_url, end_user_name, last_dispatch_attempted_at')
  .eq('slug', params.slug)
  .maybeSingle()
```
New check, added immediately after the existing `no_meeting_url` check (~line 48-53) — a
defensive server-side check, since this endpoint is independently callable and passcode-gated, not
solely reliant on the client button's `disabled` state:
```ts
if (!savedRow?.end_user_name) {
  return NextResponse.json(
    { error: { code: 'no_end_user_name', message: 'No participant name has been saved for this topic yet.' } },
    { status: 422 }
  )
}
```
Outbound `body` object (~line 83-92) gains `end_user_name`:
```ts
const body = {
  meeting_url: savedRow.meeting_url,
  end_user_name: savedRow.end_user_name,   // NEW — F4
  content_pages,
  content_source_id: process.env.DEMO_CONTENT_SOURCE_ID,
  content_to_explain: topic.overview,
  title: topic.title,
  subtitle: topic.subtitle,
  expected_duration_minutes,
  partner_reference: params.slug,
}
```
No new client-side error-message branch is needed for `no_end_user_name` in
`DemoTopicClient.tsx`'s `handleLearnWithAi()` — this path is unreachable via the UI once
`meetingReady` gates the button (§6.8), so it falls through to the existing generic fallback
message ("Something went wrong starting the bot. Try again in a moment."), exactly like the
existing, equally-unreachable-via-UI `no_meeting_url` case does today.

### 6.10 — `.env.local.example` (F5)

New entry, following the confirmed `HUME_NATIVE_SUMMARY_MODE` convention (bare, no
`NEXT_PUBLIC_` prefix — server-only, read once at prompt-assembly time):
```
# B2B-36 F5 — revertible, prompt-only mitigation for Clio's voice fading to a whisper during long
# continuous speech (theory, not a confirmed fix — see docs/specs/B2B-36-requirement-document.md
# Part F5). Default false/unset. Recommended `true` in production per this brief, so Arun can
# observe it on his next live test; one flip to revert.
HUME_NATIVE_PACING_GUIDANCE_ENABLED=PLACEHOLDER_FALSE_OR_TRUE
```
**Deployment note for the developer**: per the standing "prefer new toggles on" preference and this
brief's own recommendation, set `HUME_NATIVE_PACING_GUIDANCE_ENABLED=true` in the production Vercel
environment as part of shipping this piece (not just documented in `.env.local.example`) — this is
an env var change in Vercel, not a code change, and should be called out explicitly at hand-off
since it's easy to ship the code and forget the flip.

---

## 7. Success Criteria (Acceptance Tests)

**F4 — participant name + industry:**
1. ✓ Given a session is created with `end_user_name: "Arun"` and `sessionContentMode: 'inline'`,
   when the prompt is assembled, then `RULE_1_INLINE_TEXT`'s resolved text contains "Greet Arun,"
   and does not contain "Greet the participant,".
2. ✓ Given a session is created with `end_user_name` present but `sessionContentMode: 'template'`
   (or omitted), when the prompt is assembled, then rule 1's output is byte-identical to the
   pre-B2B-36 (v8) template-mode text — `participantName` is a no-op outside inline mode (Fork 2).
3. ✓ Given `POST /api/partner/v1/sessions` is called without `end_user_name`, when the request is
   validated, then the response is `422` with a Zod validation error referencing `end_user_name`
   ("end_user_name is required").
4. ✓ Given a session is created with `end_user_industry: "healthcare"` and `end_user_role: "a
   sales manager"`, when the prompt is assembled (either mode), then the opening sentence reads
   "...to a sales manager in healthcare over voice."
5. ✓ Given a session is created with `end_user_industry` omitted, when the prompt is assembled,
   then the opening sentence is byte-identical to B2B-35's own output — "...to a sales manager
   over voice." with no trailing space or empty clause artifact.
6. ✓ Given `end_user_industry: "   "` (whitespace only), when the prompt is assembled, then the
   output resolves identically to test 5 (no industry clause), not to a literal-whitespace clause
   — same treatment B2B-35 gave `end_user_role`.
7. ✓ Given the demo Meeting tab has a saved URL but no saved name (the migration edge case), when
   the page renders, then "Learn with AI" is disabled and the helper text reads "Save a meeting URL
   and name in the Meeting tab to enable this."
8. ✓ Given both a name and URL are saved via the Meeting tab, when "Learn with AI" is clicked and
   the passcode is correct, then `POST /api/demo/[slug]/dispatch` succeeds and the outbound
   `/api/partner/v1/sessions` call includes `end_user_name` sourced from the saved row.
9. ✓ Given `app/api/hume-native/provision-config/route.ts` (the legacy, non-partner caller) calls
   `assembleHumeNativePrompt()` without `participantName` or `endUserIndustry` (unchanged call
   site), when the prompt is assembled, then the output is byte-identical to v8's own output for
   that caller.

**F5 — voice-pacing mitigation:**
10. ✓ Given `HUME_NATIVE_PACING_GUIDANCE_ENABLED` is unset or any value other than the literal
    string `'true'`, when the prompt is assembled, then rule 7's output is byte-identical to the
    pre-B2B-36 (v8) fixed text — no trailing sentence, no trailing whitespace.
11. ✓ Given `HUME_NATIVE_PACING_GUIDANCE_ENABLED=true`, when the prompt is assembled, then rule
    7's output ends with the exact pacing-guidance sentence specified in §6.4, appended directly
    after "...within a reasonable session length." with no extra blank line.
12. ✓ Given the toggle is enabled, when the prompt is assembled for **any** call site (Option 1,
    Option 2, or the legacy provision-config route), then all three receive the pacing guidance —
    confirming the single-read-inside-`assembleHumeNativePrompt()` mechanism covers every caller
    with no per-call-site wiring.

**Cross-cutting:**
13. ✓ Given F4 and F5 land together, when the full existing test suite runs (particularly
    `prompt-template`/`live-render` unit tests), then all pre-existing tests pass unmodified except
    where explicitly updated to assert the new default behavior — no pre-existing assertion about
    v8 output for an unconfigured/toggle-off caller should need to change.

---

## 8. Error States

- **`end_user_name` missing or empty on `POST /api/partner/v1/sessions`**: `422`, Zod validation
  error, same shared error-response shape as every other `CreateSessionSchema` failure
  (`{ error: 'Validation failed', details: parsed.error.flatten() }`).
- **`end_user_name`/`end_user_industry` exceed 200 chars**: same `422` path.
- **Demo Meeting tab: `end_user_name` missing on `POST /api/demo/[slug]/meeting`**: `422`,
  `validation_failed`, updated message "Enter a name and a valid https:// meeting URL." (§6.7).
  **Client-side note**: `canSave` already requires `nameInput.trim().length > 0` before the button
  is even clickable (§6.8), so in normal UI use this 422 can only fire for a malformed URL (the
  name is already guaranteed non-empty client-side) — the existing `saveUrlError` handling
  (unchanged) remains correct as the only practically-reachable branch. `saveNameError` state is
  added for structural symmetry and defensive display (e.g. a future direct-API caller bypassing
  the UI), but is not expected to ever render in normal use. This asymmetry is intentional, not an
  oversight — documented here so it is not "fixed" into unnecessary complexity later.
- **Demo dispatch: no saved name** (`no_end_user_name`, §6.9): `422`, server-side defensive check,
  unreachable via the UI once `meetingReady` gates the button; client falls through to the existing
  generic dispatch-failure message, same as the existing `no_meeting_url` case.
- **F5 toggle produces a prompt Hume's own LLM does not actually comply with**: not an error state
  in the technical sense — this is explicitly a prompt *request*, not an enforcement mechanism.
  There is no automated way to verify compliance; the only verification is Arun's next live test.
  This must be communicated to Arun explicitly at hand-off (§9), not implied as a guaranteed fix.

---

## 9. Edge Cases

**F4:**
- The existing `claude-ai` demo row has `meeting_url` saved but, immediately post-migration,
  `end_user_name = NULL` — "Learn with AI" goes back to disabled on the live public demo page
  until Arun re-saves the Meeting tab with a name. Expected, not a regression — flagged to Arun at
  hand-off (§5.3, §6.1, §7 AT-7).
- `end_user_industry` supplied as whitespace-only — resolves identically to absent (AT-6).
- A reseller passes `end_user_name` but omits `end_user_industry` — greeting uses the real name,
  audience sentence has no industry clause (just role, or "a professional" if role is also
  absent).
- A reseller passes `end_user_industry` on an Option 2 (template-mode) session — the industry
  clause still applies to the opening sentence (Fork 1 applies to both modes), even though
  `participantName`/greeting does not (Fork 2, inline-only).
- `end_user_name` containing content resembling a prompt-injection attempt — **not newly addressed
  here**, same class of risk `end_user_role`/`assistantName` already carry (B2B-35 flagged this as
  a P2 backlog note, not specially addressed per-field); not reopened in this brief.

**F5:**
- Toggle interacts with nothing else in the prompt — purely additive text on rule 7, no
  interaction with `sessionContentMode`, `promptBehavior`, or any B2B-11 partner-configured
  guidance block.
- A partner-configured `interSectionRecapStyle` or other `PromptBehaviorConfig` field is also set
  in the same session — no conflict; F5's addition lives inside the fixed rule 7 text, entirely
  separate from the `=== PARTNER-CONFIGURED GUIDANCE ===` block's own mechanism.
- Toggle is flipped mid-way through a long-running live session — not applicable; the prompt is
  assembled once, upfront, at session start (`assembled_prompt_snapshot`), exactly like every other
  prompt-behavior field today. A toggle flip only affects sessions created after the flip.

---

## 10. Out of Scope

- **Any live/roster-based participant detection** (F4) — explicitly rejected; the participant's
  name/industry is supplied upfront by the reseller or the demo operator, exactly like
  `meeting_url` and `end_user_role` already work.
- **Extending the name-based greeting mechanism to Option 2 (template mode)** (F4, Fork 2) — a
  possible future brief, not built here.
- **A UI for partners to set `end_user_name`/`end_user_industry` beyond the existing API-only
  contract** (F4) — no Designer/Configurator changes, matching B2B-35's own scoping. (The demo
  Meeting tab is not a partner-facing config UI — it is this specific demo's own operator tool,
  already in scope per B2B-33/35 precedent.)
- **Prompt-injection hardening for `end_user_name`/`end_user_industry`** (F4) — same class of risk
  as `end_user_role`/`assistantName`, flagged as a standing P2 backlog note, not specially
  addressed here.
- **Hard technical enforcement of pacing** (F5) — elapsed-continuous-speech tracking + forced
  mid-session prompt injection via the live prompt-injection mechanism already used for
  wrap-up-nudge/join-greeting — explicitly deferred by Arun, contingent on the soft version's
  live-test results. Log as a P2 follow-up candidate in `docs/b2b-pivot-status.md`/`BACKLOG.md`.
- **Any automated verification that F5's mitigation actually works** — Hume's own LLM decides
  whether to comply with a prompt request; the only verification path is Arun's live test.

---

## 11. Open Questions

None. Every implementation-level fork the CEO brief identified is resolved above, and every factual
claim in the CEO brief (schema shapes, file line numbers, migration numbering, live production
data) has been independently re-verified against live code and a fresh live database query as of
2026-07-26, not assumed from the brief alone. This document is ready for CEO Agent approval. No
developer should begin work until that approval lands.

**CEO review, 2026-07-26 — APPROVED, no revision cycle needed.** Independently re-verified every
load-bearing claim against live code (not the spec's own narrative): `PROMPT_TEMPLATE_VERSION` is
genuinely `'v8'` today (`v8`→`v9` bump is correct); `097_b2b35_end_user_role.sql` is genuinely the
highest existing migration (`098` is the correct next number); the template opening sentence, rule
7's exact text, and `RULE_1_INLINE_TEXT`'s exact text all match the spec's quoted "before" text
byte-for-byte at their stated lines; `end_user_role` is genuinely `.optional()` (no `.min(1)`) on
`CreateSessionSchema` today, confirming the required/optional distinction the brief drew for
`end_user_name`/`end_user_industry` is correctly carried through; `HUME_NATIVE_SUMMARY_MODE` is
genuinely a bare, non-`NEXT_PUBLIC_`, directly-`process.env`-read toggle at
`provision-config/route.ts:71`, confirming `HUME_NATIVE_PACING_GUIDANCE_ENABLED` correctly follows
that precedent; rule 11's own template text does reference "rule 8" and `buildPartnerGuidanceBlock()`
does label a `ruleRef` as `'rule 8b'`, confirming the renumbering-risk reasoning for appending to
rule 7 instead of inserting a new numbered rule is real, not overcautious. Queried live production
data directly (project `nqxlpcshouboplhnuvrh`, not trusting the spec's own prior query): confirmed
`demo_meeting_urls` has exactly one row (`slug: 'claude-ai'`) with columns
`slug, meeting_url, last_dispatch_attempted_at, updated_at` — no `end_user_name` column exists yet,
which independently confirms the migration will genuinely leave this row's `end_user_name = NULL`
and "Learn with AI" will genuinely go back to disabled until Arun re-saves the Meeting tab, exactly
as documented; confirmed `partner_sessions` has 1 total row, 0 non-test-mode rows, confirming
`end_user_name` required-at-the-API-layer is genuinely safe. Confirmed the demo's client-side gating
logic (`DemoTopicClient.tsx`) — `meetingReady = Boolean(savedMeetingUrl)` at its current line 263,
and `saveUrlError`/`savePasscodeError` as the existing error-state naming — matches exactly what the
spec's `meetingReady`/`saveNameError` changes are built against. All three of the brief's
implementation-level forks (industry clause appended to the existing audience sentence via
`INDUSTRY_CLAUSE_PLACEHOLDER`, resolving to `''` — genuinely empty, never a placeholder string —
when absent; name-greeting scoped to `RULE_1_INLINE_TEXT` only, `RULE_1_TEMPLATE_TEXT` genuinely
untouched; the `HUME_NATIVE_PACING_GUIDANCE_ENABLED` toggle read exactly once inside
`assembleHumeNativePrompt()` itself, covering all three call sites — both partner render paths and
the legacy `provision-config` route — with zero per-call-site wiring) are carried through precisely,
not reinterpreted. The production deployment step (`HUME_NATIVE_PACING_GUIDANCE_ENABLED=true` must
actually be set in Vercel, not just documented in `.env.local.example`) is explicitly spec'd in §6.10
and flagged again in §12 Dependencies as "easy to forget and should be explicitly checked at
hand-off" — this is a real requirement on the developer/Orchestrator at ship time, not merely
documentation. **Verdict: approved as-is, zero revision requests.** Status header updated to
APPROVED. Ready for dev dispatch.

---

## 12. Dependencies

- **F4**: Requires migration `098_b2b36_end_user_name_industry.sql` applied before the code reading
  the new columns ships (build-then-migrate-then-deploy, per this project's standard practice —
  same as B2B-35's `097`). No dependency on F5.
- **F5**: No DB dependency. No dependency on F4. Requires
  `HUME_NATIVE_PACING_GUIDANCE_ENABLED=true` set in the production Vercel environment as part of
  shipping (§6.10) — a deployment step, not a code dependency, but one that is easy to forget and
  should be explicitly checked at hand-off.
- **Recommended sequencing, not a hard gate**: build both in one pass against
  `prompt-template.ts` (touched by both), sharing one `PROMPT_TEMPLATE_VERSION` bump (`v8` →
  `v9`), exactly as the CEO brief recommends and B2B-35 itself did for F1/F2/F3. If the
  Orchestrator finds a reason to split them into two PRs, that's fine — flag it, don't silently
  resequence.
