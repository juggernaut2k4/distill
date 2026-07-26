# Feature Brief: B2B-36 — Parameterized Participant Name + Industry (F4), Voice-Pacing Mitigation (F5)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 for both pieces (F4: closes a real gap in the demo/reseller live-session experience,
no existing production caller broken since zero real partner traffic exists; F5: unverified-theory
mitigation behind a revert-safe toggle, not a confirmed production bug fix)
Date: 2026-07-26

---

## How to read this brief

This is a direct relay of a working session with Arun, not raw material for me to interpret — the
decisions below were reached in that discussion and are being documented, not invented. This bundles
two pieces (F4, F5) because they were discussed and resolved together in one continuous session,
the same rationale B2B-34/35 used for bundling. Both build directly on B2B-35
(`docs/specs/B2B-35-requirement-document.md`, shipped 2026-07-25 — commit `0de16c1`), which added
`end_user_role` to `CreateSessionSchema` and the `sessionContentMode`/`audienceDescription` mechanism
to `assembleHumeNativePrompt()`. **I independently re-verified every claim in the relay against live
code and live production data before writing this brief** — findings and any corrections are called
out inline as "CEO verification" blocks. Section "Questions for BA" is empty; every fork I found is
resolved below with my own reasoning attached, per the B2B-34/35 rigor bar.

---

## Piece F4 — Parameterized participant name + industry

### What Arun Said

Arun wants Clio to greet the session's one initiating participant by name, and optionally calibrate
examples/language to their industry — the same personalization B2C used to do. Confirmed decisions
from the discussion (not re-litigated here):

1. **Scope: one person only** — the session's initiator, not a live multi-attendee roster. Live
   participant-detection (asking Attendee.dev for a roster, or Google Calendar attendee lookup) was
   explicitly investigated and rejected — no such live-lookup capability exists in this codebase or
   is confirmed on the vendor side, and calendar lookup would require OAuth into a calendar this
   system has no access to. The information is supplied upfront instead, exactly like `meeting_url`
   and (as of B2B-35) `end_user_role` already work.
2. **Two new fields**: `end_user_name` (required) and `end_user_industry` (optional, no default).
   `end_user_role` (B2B-35) is unchanged.
3. **Fallback logic — Arun's own wording, "Option B", no separate toggle**: "if value exists then use
   it, else proceed explanation not role/industry aligned" — when role/industry are present, Clio
   calibrates to them; when absent, Clio teaches generically, no fabricated assumption.
4. **No default value for industry when blank.** Unlike `end_user_role`'s safe default (`'a
   professional'` is true of literally anyone), there is no equivalent safe-for-everyone industry — a
   specific-sounding default would be a wrong, misleading guess. When absent, Clio simply never
   mentions or calibrates to an industry — the relevant clause is omitted entirely, never replaced
   with a placeholder.
5. **`end_user_name` required everywhere, sourced two ways — mirrors `meeting_url`'s own pattern**:
   - **Demo path**: a new "Name" field on the Meeting tab (`app/demo/[slug]/DemoTopicClient.tsx`),
     saved together with the Google Meet URL via the same passcode-gated Save flow
     (`POST /api/demo/[slug]/meeting`, `demo_meeting_urls` table).
   - **Real reseller path**: the reseller passes `end_user_name` in `POST /api/partner/v1/sessions`,
     same as `end_user_role`/`end_user_industry`.
   - `end_user_name` is **required** on `CreateSessionSchema` (unlike the optional
     `end_user_role`/`end_user_industry`) — safe because zero real partners exist in production today
     (re-verified below, not assumed from B2B-34's older finding).
6. **Where these feed the prompt**: `end_user_name` powers the greeting (rule 1's inline-mode
   icebreaker, `lib/voice/hume-native/prompt-template.ts`, B2B-35's new text). `end_user_industry`
   calibrates examples/language alongside the existing `end_user_role` mechanism (B2B-35's
   `audienceDescription` parameter-injection pattern on `assembleHumeNativePrompt()`).

### CEO Verification (independent, against live code + live production DB, not the relay alone)

- **Confirmed** `lib/voice/hume-adapter.ts` — irrelevant to F4, see F5 below.
- **Confirmed** `lib/onboarding.ts` (still present in the repo, wired into
  `app/api/webhooks/clerk/route.ts` — B2C's Clerk-signup path, not deleted) has exactly the fields
  claimed: `role: z.string()`, `roleLevel: z.enum([...])`, `industry: z.string().default('')` — free
  text/enum, used to calibrate. **Flagging, not blocking**: this file also calls
  `assignPhoneNumber()` from `lib/delivery/sms.ts`, which is the retired `twilio` package per
  `CLAUDE.md`'s "Removed from the approved list" section — this is live B2C-era code still on a
  wired path (Clerk webhook), calling a vendor this project says is fully removed. Out of scope for
  this brief; flagging separately as a standalone cleanup item so it isn't lost.
- **Confirmed** `app/api/hume-native/provision-config/route.ts:453-459` — B2C's name-greeting is a
  Clerk `clerkClient.users.getUser(userId)` lookup done server-side before the session connects, not
  a live in-call detection. Matches the relay exactly.
- **Confirmed live production data** (`hello-clio`, project `nqxlpcshouboplhnuvrh`, queried directly,
  not inferred): `partner_sessions` still has **exactly 1 row**, `test_mode: true` (the B2B-33 demo
  session) — zero real partners exist today, same as B2B-35's own finding, re-verified fresh rather
  than assumed still true. Making `end_user_name` required is safe. `demo_meeting_urls` has exactly
  one row (`slug: 'claude-ai'`, `meeting_url` already saved, dispatched 2026-07-25). **This means**:
  once the new `end_user_name` column lands (nullable at the DB level, since it doesn't exist on this
  row today), that existing row will have `end_user_name = NULL`, and the demo's "Learn with AI"
  button must go back to disabled until Arun re-saves the Meeting tab with a name — documented as an
  explicit edge case below, not a silent regression.
- **Confirmed** `lib/partner/session-schema.ts`'s `CreateSessionSchema` has `end_user_role` exactly as
  B2B-35 described (top-level, `.trim().max(200).optional()`) — this is the pattern F4's two new
  fields should mirror.
- **Confirmed** the full `end_user_role` plumbing chain end-to-end by reading every hop: wire schema
  → `app/api/partner/v1/sessions/route.ts` insert (`end_user_role: end_user_role ?? null`, line 177)
  → `PartnerSessionRow`/`getPartnerSession()` in `lib/partner/live-render.ts` (lines 41-88) →
  `resolveLiveSessionRender()` and `resolveInlineSessionRender()`'s respective
  `assembleHumeNativePrompt()` calls (lines 199-217, 325-343), both passing
  `audienceDescription: session.endUserRole?.trim() || 'a professional'`. This is the exact chain F4
  must extend for `end_user_name`/`end_user_industry`.
- **Confirmed** the current, exact rule 1 inline-mode text (`RULE_1_INLINE_TEXT`,
  `prompt-template.ts` line 324-325): *"Open the session warmly and with genuine energy. Greet the
  participant, introduce yourself briefly, and offer a short, natural icebreaker..."* — this is what
  needs the real name substituted in.
- **Confirmed** the migration sequence: highest existing migration is `097_b2b35_end_user_role.sql` —
  next available is `098`.
- **Confirmed** `DemoTopicClient.tsx`'s exact Meeting-tab state/handlers (`urlInput`, `passcodeInput`,
  `handleSave()` posting `{ meeting_url, passcode }`, `canSave = urlInput.trim().length > 0 &&
  passcodeInput.length > 0 && !saving`, and — separately — `meetingReady = Boolean(savedMeetingUrl)`
  gating the "Learn with AI" button at line 366 (`disabled={!meetingReady || meetingLoading}`)) and
  the exact JSX insertion point (lines 505-573). **Important implementation detail the relay didn't
  spell out, which I'm flagging explicitly so it isn't missed**: adding a Name field to the form is
  necessary but not sufficient — `canSave` and, separately, `meetingReady` both need updating so
  "Learn with AI" stays disabled until **both** a URL and a name are saved, not just the URL (matching
  Arun's "required everywhere... before Learn with AI can be used").
- **Confirmed** `app/api/demo/[slug]/dispatch/route.ts`'s exact body construction (lines 83-92) — this
  is where `end_user_name` (read from `demo_meeting_urls`) gets added to the outbound
  `/api/partner/v1/sessions` call.

### CEO Resolutions on implementation-level design forks (so the BA isn't guessing)

**Fork 1 — how does `end_user_industry` actually change the prompt, mechanically?** The relay says
"alongside the existing `end_user_role` mechanism" and separately that the industry "clause" is
omitted (not placeholder-substituted) when absent. Reading these together, I resolve this as: **extend
the same opening sentence `audienceDescription` already lives in**, not a separate context block. Today
(B2B-35): `` `...delivering a live, one-on-one coaching session to ${AUDIENCE_PLACEHOLDER} over
voice.` ``. New: `` `...delivering a live, one-on-one coaching session to
${AUDIENCE_PLACEHOLDER}${INDUSTRY_CLAUSE_PLACEHOLDER} over voice.` ``, where
`INDUSTRY_CLAUSE_PLACEHOLDER` resolves to `''` when industry is absent (byte-identical to today: "...to
a professional over voice.") or `` ` in ${industry}` `` when present ("...to a mid-level sales manager
in healthcare over voice."). This is the most literal reading of "omit the clause entirely" (there's an
actual clause to omit, not a placeholder gap) and requires no restructuring of the CONTEXT block.

**Fork 2 — does the name-based greeting apply to Option 2 (template mode) too, or only Option 1
(inline)?** The relay's own code citation is specific: *"the inline-mode icebreaker instruction should
now be able to actually use a real name"* — referring to `RULE_1_INLINE_TEXT` specifically, not
`RULE_1_TEMPLATE_TEXT`. I confirmed why this scoping makes sense independently: Option 2's rule 1 is a
verbatim scripted recitation of an authored "Session Overview" section (unchanged since before B2B-35),
not an ad-libbed icebreaker — there's no natural seam to insert a name into a scripted recitation
without the BA authoring a whole new Overview-content mechanism, which B2B-35 already explicitly
declined to build for a smaller reason (warmth) and this brief has even less reason to reopen. **CEO
resolution: name-based greeting substitution applies to `RULE_1_INLINE_TEXT` (Option 1) only,
matching B2B-35 F2's own scoping precedent.** `end_user_name` is still collected as a schema field
applicable to both content modes (mirroring `end_user_role`), it is simply only *used* in the greeting
mechanism for Option 1 today — a future brief could extend Option 2's Overview content to use it if
Arun wants that later.

**Fork 3 — exact resolved text for `RULE_1_INLINE_TEXT`.** Byte-identical-when-absent is the
established discipline throughout this codebase (B2B-11, B2B-35). Proposed:
```
export const PARTICIPANT_NAME_PLACEHOLDER = '[PARTICIPANT NAME]'

const RULE_1_INLINE_TEXT =
  `Open the session warmly and with genuine energy. Greet ${PARTICIPANT_NAME_PLACEHOLDER}, introduce
  yourself briefly, and offer a short, natural icebreaker — casual and human, never a
  rehearsed-sounding script (for example, a light remark tied to the session's topic, the time of
  day, or how they're doing). Then, in your own words, set the agenda using the SESSION TITLE,
  SESSION SUBTITLE, and WHAT TO EXPLAIN content provided below in SESSION CONTENT — synthesize and
  paraphrase this material naturally; do not recite it verbatim as a script and do not read it like a
  list. Confirm they're ready, then move into page 1.`
```
`assembleHumeNativePrompt()` resolves `PARTICIPANT_NAME_PLACEHOLDER` from a new `participantName?:
string` input, defaulting to the literal `'the participant'` when omitted/blank — which reproduces
*exactly* today's fixed wording ("Greet the participant, introduce yourself briefly...") for every
caller that doesn't pass it. Since `end_user_name` is required at the wire-schema layer for every new
inline-mode session, this default only matters for defensive robustness (a malformed/legacy session),
never for a real new session.

**Fork 4 — DB nullability vs. API requiredness.** Mirrors `end_user_role`'s own precedent exactly:
`end_user_name`/`end_user_industry` are nullable columns at the DB level (so old rows and the
migration itself don't break), but `end_user_name` is non-optional (`.min(1)`, no `.optional()`) at
the Zod/API layer for every *new* session going forward, on both `CreateSessionSchema` and the demo's
own `SaveMeetingUrlSchema`.

### Data Requirements (resolved, for the BA to specify formally)

- **`lib/partner/session-schema.ts`**, `CreateSessionSchema`, top-level (mirrors `end_user_role`):
  ```ts
  end_user_name: z.string().trim().min(1, 'end_user_name is required').max(200),
  end_user_industry: z.string().trim().max(200).optional(),
  ```
- **Migration `098_b2b36_end_user_name_industry.sql`**:
  ```sql
  ALTER TABLE partner_sessions ADD COLUMN end_user_name text;
  ALTER TABLE partner_sessions ADD COLUMN end_user_industry text;
  ALTER TABLE demo_meeting_urls ADD COLUMN end_user_name text;
  ```
- **`app/api/partner/v1/sessions/route.ts`** insert object gains `end_user_name: end_user_name ??
  null, end_user_industry: end_user_industry ?? null` alongside the existing `end_user_role` line
  (~line 177). Note: Zod already rejects a request missing `end_user_name` before this point runs, so
  `?? null` here is defensive only, matching the file's existing style for optional fields.
- **`lib/partner/live-render.ts`**: `PartnerSessionRow` gains `endUserName: string | null,
  endUserIndustry: string | null`; `getPartnerSession()`'s select list and mapping gain the two new
  columns, identical pattern to `endUserRole` (lines 41-88).
- **`lib/voice/hume-native/prompt-template.ts`**:
  - New placeholders: `PARTICIPANT_NAME_PLACEHOLDER` (Fork 3), `INDUSTRY_CLAUSE_PLACEHOLDER` (Fork 1).
  - `AssembleHumeNativePromptInput` gains `participantName?: string` and `endUserIndustry?: string`.
  - `HUME_NATIVE_PROMPT_TEMPLATE`'s opening sentence becomes `` `...to
    ${AUDIENCE_PLACEHOLDER}${INDUSTRY_CLAUSE_PLACEHOLDER} over voice.` ``.
  - `RULE_1_INLINE_TEXT` becomes Fork 3's text; `RULE_1_TEMPLATE_TEXT` is untouched (Fork 2).
  - `assembleHumeNativePrompt()` resolves both new placeholders: `participantName?.trim() || 'the
    participant'` for the greeting; `endUserIndustry?.trim() ? \` in ${endUserIndustry.trim()}\` :
    ''` for the industry clause.
  - `PROMPT_TEMPLATE_VERSION` bumps `'v8'` → `'v9'` (source change; assembled output byte-identical
    for every caller that passes neither new field — this should be F4's own regression test,
    mirroring B2B-35's AT-6). Recommend F5 lands in the same version bump if built in the same PR
    (Dependencies section).
- **Both `resolveLiveSessionRender()` and `resolveInlineSessionRender()`** (`live-render.ts`) pass
  `endUserIndustry: session.endUserIndustry` (both modes, Fork 1) to `assembleHumeNativePrompt()`;
  only `resolveInlineSessionRender()` passes `participantName: session.endUserName` (Fork 2 — Option 2
  doesn't use the greeting mechanism, so passing it there would be a harmless no-op, but I'd rather
  the BA make it explicit that it's intentionally inline-only, not accidentally omitted from
  template-mode by oversight).
- **`app/api/demo/[slug]/meeting/route.ts`**: `SaveMeetingUrlSchema` gains `end_user_name:
  z.string().trim().min(1, 'Name is required').max(200)`. `POST` upserts it into
  `demo_meeting_urls`. `GET` response gains `end_user_name: data?.end_user_name ?? null`.
- **`app/demo/[slug]/DemoTopicClient.tsx`**:
  - New state: `nameInput`, `savedEndUserName` (mirroring `urlInput`/`savedMeetingUrl`).
  - New form field ("Name") in the Meeting tab, placed before the URL field (natural top-to-bottom
    order: who, then where).
  - `handleSave()` body gains `end_user_name: nameInput`; success handler sets `savedEndUserName`
    from the response and clears `nameInput`.
  - `canSave` becomes `urlInput.trim().length > 0 && nameInput.trim().length > 0 &&
    passcodeInput.length > 0 && !saving`.
  - `meetingReady` becomes `Boolean(savedMeetingUrl) && Boolean(savedEndUserName)` — this is the
    change that actually gates "Learn with AI" on both fields (the implementation detail flagged
    above).
  - The "not ready" helper text under the button (line 377) updates from *"Save a meeting URL in the
    Meeting tab to enable this."* to *"Save a meeting URL and name in the Meeting tab to enable
    this."*
- **`app/api/demo/[slug]/dispatch/route.ts`**: reads `end_user_name` alongside `meeting_url` from
  `demo_meeting_urls` (line ~44's select); if absent, returns a new `422 { code: 'no_end_user_name' }`
  (mirrors the existing `no_meeting_url` check at line 48-53) — a defensive server-side check, since
  dispatch is its own independently-callable, passcode-gated endpoint that shouldn't rely solely on
  the button being disabled client-side. Adds `end_user_name: savedRow.end_user_name` to the outbound
  `body` object (line ~83-92).

### Edge Cases (resolved)

- The existing `claude-ai` demo row has `meeting_url` saved but (post-migration) `end_user_name =
  NULL` — "Learn with AI" goes back to disabled on the live public demo page until Arun re-saves the
  Meeting tab with a name. This is expected, not a regression to prevent — flag it to Arun in the
  hand-off so he isn't surprised the button is greyed out again after this ships.
- `end_user_industry` supplied as whitespace-only (`"   "`) — same treatment as B2B-35 gave
  `end_user_role`: resolves identically to absent (empty clause), not a literal-whitespace clause.
- A reseller passes `end_user_name` but omits `end_user_industry` — greeting uses the real name,
  audience sentence has no industry clause (just role, or "a professional" if role is also absent).

### Out of Scope (explicit)

- Any live/roster-based participant detection (explicitly rejected per point 1).
- Extending the name-based greeting mechanism to Option 2 (template mode) — Fork 2's resolution;
  flagged as a possible future brief, not built here.
- A UI for partners to set these fields beyond the existing API-only contract (no Designer/Configurator
  changes — matches B2B-35's own scoping).
- Prompt-injection hardening for `end_user_name`/`end_user_industry` — same class of risk
  `end_user_role`/`assistantName` already carry today (B2B-35 flagged this as a P2 backlog note, not
  specially addressed per-field); not reopened here.

---

## Piece F5 — Voice-pacing mitigation ("fades to a whisper")

### What Arun Said

Clio's voice gradually fades to a whisper during long, continuous, uninterrupted speech. Ship a soft,
prompt-only mitigation first, not a hard technical enforcement mechanism — behind a toggle for easy
revert, since this is a mitigation based on a reasonable but unproven theory. A hard technical
enforcement (tracking elapsed continuous-speech time and force-injecting a "wrap up and pause"
instruction via the live mid-session prompt-injection mechanism already used for
wrap-up-nudge/join-greeting) is explicitly deferred, not built now — only escalate to it if the soft
version doesn't work.

### CEO Verification (independent code read, confirms this is NOT a client-side bug)

- **Confirmed** `lib/voice/hume-adapter.ts`: `outputVol` is a private field defaulting to `1.0` (line
  32), assigned once into `gainNode.gain.value` at audio-context setup (line 67) and never reassigned
  anywhere else in this file except inside `setVolume(volume: number)` (line 348-350).
- **Confirmed by repo-wide grep** that `setVolume(` is never called anywhere in this codebase outside
  its own definitions (`hume-adapter.ts`, `deepgram-adapter.ts`, the shared `adapter.ts` interface
  declaration) — zero call sites. There is no fade/dynamic-gain logic anywhere client-side; the one
  mechanism that could produce a fade is defined but dead code.
- **Conclusion, matching the relay exactly**: the fade is not this codebase's client-side audio
  pipeline. It's either Hume's own TTS generation behavior over a long single continuous turn, or an
  artifact of Attendee.dev's own browser-tab-audio-capture hop (Clio's voice plays in a headless
  browser tab that Attendee captures as the bot's mic feed) — both vendor-side, both opaque to this
  codebase, neither instrumentable directly. A prompt-level mitigation (encouraging Clio to naturally
  break up long stretches of speech, reducing how often either vendor layer is asked to sustain one
  very long unbroken TTS generation) is the only lever available without vendor cooperation.
- **Confirmed the toggle-mechanism precedent**: `HUME_NATIVE_SUMMARY_MODE` — a bare (no
  `NEXT_PUBLIC_` prefix, since it only matters server-side at prompt-assembly time), directly-read
  env var (`process.env.HUME_NATIVE_SUMMARY_MODE === 'true'`, `provision-config/route.ts:71`) that
  branches which prompt-building function runs. This is the exact style/mechanism F5's toggle should
  follow.

### CEO Resolution on implementation-level design fork

**Where does the toggle get checked?** The relay says this "applies broadly — both inline and
template modes, since the fade isn't mode-specific," but doesn't say whether legacy B2C sessions
(`app/api/hume-native/provision-config/route.ts`, which also calls `assembleHumeNativePrompt()`)
should get it too. Since the root cause (Hume TTS / Attendee capture) is generic to every Hume-native
voice session regardless of caller, and since threading a boolean through three separate call sites
creates three chances for one of them to be missed or fall out of sync, **I recommend reading the env
var exactly once, inside `assembleHumeNativePrompt()` itself**, so a single flip in Vercel's env
config affects every caller automatically with no per-call-site wiring required. This is a technical
implementation choice within the BA/dev's normal autonomy — flagging my reasoning so it isn't silently
decided the other way without a stated reason, not mandating it as a hard requirement.

**Exact toggle name**: `HUME_NATIVE_PACING_GUIDANCE_ENABLED` (matches `HUME_NATIVE_SUMMARY_MODE`'s
bare, server-only naming convention). **Code-level default when entirely unset: `false`/off** —
matching this codebase's universal "byte-identical/no-op when unconfigured" discipline. Per the
standing preference to default new toggles ON so Arun can observe the change (`feedback_prefer_new_toggles_on.md`),
**I recommend the BA/dev explicitly set `HUME_NATIVE_PACING_GUIDANCE_ENABLED=true` in the production
Vercel environment as part of shipping this piece** (documented in `.env.local.example` with a
comment explaining it's a live, revertible mitigation, not a proven fix) — live for Arun's very next
test, one flip away from reverting if it doesn't help or has side effects.

### Data Requirements (resolved)

- **`lib/voice/hume-native/prompt-template.ts`**:
  - New placeholder: `PACING_GUIDANCE_PLACEHOLDER = '[PACING GUIDANCE]'`, appended to the end of rule
    7's fixed text (chosen over inserting a new numbered rule, to avoid renumbering rules 8-12, several
    of which cross-reference each other by number — e.g. rule 8b references "rule 6", rule 11
    references "rule 8"; renumbering is unnecessary risk for an additive change). Rule 7 becomes:
    ```
    7. Keep a natural pace: teach with patience, not speed. Prioritize the
       participant actually understanding the material over covering everything
       at maximum velocity — but you are responsible for keeping the session
       moving toward completion within a reasonable session length.${PACING_GUIDANCE_PLACEHOLDER}
    ```
  - New function:
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
    Substituted via `.split(PACING_GUIDANCE_PLACEHOLDER).join(buildPacingGuidance())` inside
    `assembleHumeNativePrompt()`, same mechanism as every other placeholder in this file. Returns `''`
    (byte-identical to today's rule 7) when the toggle is off or unset.
  - `PROMPT_TEMPLATE_VERSION` bump — shared with F4's `'v8'` → `'v9'` bump if built in the same PR
    (Dependencies section), since both touch the same fixed template text in one coordinated edit.
- **`.env.local.example`**: add `HUME_NATIVE_PACING_GUIDANCE_ENABLED=PLACEHOLDER_FALSE_OR_TRUE` with a
  comment noting it's a revertible live-pacing mitigation for the "fades to a whisper" issue, default
  `false`, recommended `true` in production per this brief.

### Edge Cases / Out of Scope (explicit)

- **Not built here**: hard technical enforcement (elapsed-continuous-speech tracking + forced
  mid-session prompt injection) — explicitly deferred by Arun. Document as a P2 follow-up candidate in
  `docs/b2b-pivot-status.md`/`BACKLOG.md`, contingent on the soft version's live-test results.
- No automated way to verify this mitigation actually fixes the fade (it's a prompt *request*, Hume's
  own LLM decides whether to comply) — the only verification is Arun's next live test. This should be
  called out to Arun explicitly at hand-off, not implied as a guaranteed fix.
- Toggle interacts with nothing else in the prompt (it's purely additive text on rule 7) — no
  interaction with `sessionContentMode`, `promptBehavior`, or any B2B-11 partner-configured guidance.

---

## Dependencies

- **F4**: Requires migration `098_b2b36_end_user_name_industry.sql` applied before the code reading
  the new columns ships (build-then-migrate-then-deploy, per this project's standard practice — same
  as B2B-35's `097`). No dependency on F5.
- **F5**: No DB dependency. No dependency on F4.
- **Recommended sequencing, not a hard gate**: build both in one pass against
  `prompt-template.ts`/`live-render.ts`/`session-schema.ts` (F4) plus `prompt-template.ts` alone (F5),
  sharing one `PROMPT_TEMPLATE_VERSION` bump (`v8`→`v9`), exactly like B2B-35 recommended bundling
  F1/F2/F3 to avoid multiple version bumps for one coordinated template edit. If the BA/Orchestrator
  finds a reason to split them into two PRs, that's fine — flag it, don't silently resequence.

---

## Standalone item flagged during verification (not part of this brief, not to be built now)

`lib/onboarding.ts` (still live, wired into `app/api/webhooks/clerk/route.ts`) calls
`assignPhoneNumber()` from `lib/delivery/sms.ts`, which depends on the `twilio` package —
`CLAUDE.md`'s "Removed from the approved list under the pivot" section says `twilio` should be fully
removed, not just unused going forward. This is dead-B2C-but-still-wired code on a live webhook path.
Flagging for a separate cleanup task; not addressed in this brief.

---

## Questions for BA

None. Every fork I found while verifying this brief is resolved above with my own reasoning attached.
If the BA finds a genuine ambiguity I missed, stop and escalate per the standard chain — do not guess.
