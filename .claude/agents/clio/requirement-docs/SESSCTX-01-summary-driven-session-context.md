# Summary-Driven Session Context for Hume-Native — Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-08

---

## 1. Purpose

Today, every Hume-native voice session (`NEXT_PUBLIC_VOICE_PROVIDER=hume` AND
`NEXT_PUBLIC_HUME_NATIVE_ENABLED=true`) hands Clio a fully pre-written script
for every section she teaches: literal TEACH paragraphs, a literal
CHECKPOINT question, and 7 hardcoded response branches (V1–V7) she must
pattern-match the participant's answer against. This is built by
`buildSessionScript()` in `lib/clio-context-builder.ts` and makes up roughly
half of the ~28,000-character `[SESSION CONTENT]` block assembled in
`app/api/hume-native/provision-config/route.ts`.

The problem: this makes Clio sound like she is reading aloud rather than
coaching live, and it hard-caps her adaptive range at 7 predefined answer
patterns — she cannot respond with genuine judgment to what the participant
actually says, only pick the closest pre-written bucket.

This feature replaces the full pre-written script's contribution to
`[SESSION CONTENT]` with a compact, per-topic summary — topic titles and
what each one needs to cover — with no literal TEACH paragraphs and no
hardcoded checkpoint variants. Clio teaches live, in her own words,
substantively drawing on the already-existing, untouched Topic Knowledge
Base (`buildTopicContext()`) rather than reading from a script. She still
asks a verification question every section (existing prompt rule 4 already
requires and covers this) — but now improvised, not selected from 7
branches.

Failure mode without this change: Clio continues to sound scripted in every
Hume-native session, and her adaptive-response quality stays permanently
capped at 7 predefined branches instead of genuine live coaching judgment —
the core reason Arun is building a voice coach rather than a static app.

This is a real, permanent, production feature — not a test mode. It ships
behind a new flag, default OFF, flippable in production at any time with no
code change, and OFF means today's exact behavior, unchanged, byte for byte.

---

## 2. User Story

As **Arun (product owner)**,
I want Clio's Hume-native sessions to teach from a compact summary and her
own judgment instead of a fully pre-written script,
So that live sessions sound like genuine coaching, not a script being read,
and can be toggled back to the current proven behavior instantly if the new
mode underperforms in a real call.

As **a participant in a live Clio session** (the end user experiencing the
call, indirectly affected),
I want Clio's teaching and her responses to my answers to sound natural and
responsive to what I actually said,
So that the session feels like talking to a knowledgeable advisor, not
listening to a recording.

(No other distinct user type — there is no UI for this feature; it is a
server-side prompt-assembly change with one operator-facing toggle.)

---

## 3. Trigger / Entry Point

- **No route, no URL, no user-facing UI.** This is a change to what text is
  assembled inside an existing, already-invoked server code path.
- **Existing trigger, unchanged:** `POST /api/hume-native/provision-config`,
  called once per session start from `WalkthroughClient.tsx`'s Hume
  `onConnect` callback, only when `NEXT_PUBLIC_HUME_NATIVE_ENABLED` is true
  for that session. This feature does not add or remove any call to this
  route — it changes what happens *inside* the route once it's already
  running.
- **New condition governing behavior inside that route:** a new server-only
  environment variable, `HUME_NATIVE_SUMMARY_MODE`. Read once, at the top of
  the `POST` handler in `app/api/hume-native/provision-config/route.ts`,
  as `const summaryModeEnabled = process.env.HUME_NATIVE_SUMMARY_MODE === 'true'`.
  Any value other than the exact string `'true'` (including unset,
  `'false'`, empty string, typos) resolves to OFF — the current, proven
  full-script behavior. This is a deliberate fail-safe default: a
  misconfigured or missing env var can never accidentally activate the new,
  less-tested mode.
- **State required:** identical to today — an active `sessions` row for the
  user, and a `walkthrough_state` row with `sections`/`training_scripts`
  (or the CONTENT-POP-01 self-heal path successfully regenerating them).
  Nothing about session/user state changes for this feature.

---

## 4. Screen / Flow Description

There is no UI. Per the CEO brief, this section describes the literal
request → assembly → provisioning flow at the same level of detail a UI
flow would get.

### 4.1 Current flow (flag OFF — unchanged, described for contrast)

1. `WalkthroughClient.tsx` calls `POST /api/hume-native/provision-config`
   with `{ userId }`.
2. Route resolves the active `sessions` row, then reads
   `walkthrough_state.sections` / `.training_scripts` / `.topic_title`.
3. **Pre-check (lines ~148–152):** builds a throwaway
   `sessionContentPreCheck` string by concatenating
   `buildTopicContext(sections, sections.map(() => null))` +
   `buildSessionScript(sections, trainingScripts)`, purely to run
   `isSuspiciouslyEmpty()` — a heuristic completeness gate. This string is
   never sent to Clio; only the boolean result of the gate matters.
4. If suspiciously empty: CONTENT-POP-01 self-heal runs synchronously
   (regenerates `sections`/`trainingScripts` from
   `generateLiveConductorContent`), then **recheck (lines ~311–315)**
   rebuilds the same throwaway concatenation
   (`buildTopicContext` + `buildSessionScript`) and re-runs
   `isSuspiciouslyEmpty()`. Hard-fails with 502 if still empty.
5. **Real assembly (lines ~376–380):** builds the actual
   `sessionContent` string sent to Clio:
   `[topic title heading] + buildTopicContext(sections, topicContextDocs) + buildSessionScript(sections, trainingScripts)`.
6. `sessionContent` is passed into `assembleHumeNativePrompt()` along with
   `profileContext` and `intentContext`, producing the final prompt string.
7. `provisionNativeConfig()` provisions a Hume Config with that prompt;
   `configId` is persisted on the `sessions` row and returned to the client.

### 4.2 New flow (flag ON) — exactly steps 1–4 and 6–7 above, **unchanged**.
Only step 5 changes:

5. **Real assembly (lines ~376–380), summary-mode branch:** if
   `summaryModeEnabled` is true, call the new function
   `buildSessionSummary(sections, trainingScripts)` in place of
   `buildSessionScript(sections, trainingScripts)`. Everything else in this
   step is identical: same `topicTitleForContent` heading, same
   `buildTopicContext(sections, topicContextDocs)` call (completely
   untouched), same join logic, same downstream `assembleHumeNativePrompt()`
   call.

**Explicitly confirmed and resolved (this is the answer to CEO Question 4):**
Steps 3 and 4 (pre-check and recheck) **do not branch on the toggle** — they
always call the existing, unmodified `buildSessionScript()`, regardless of
`summaryModeEnabled`. Rationale: their only purpose is a defensive
completeness heuristic (`isSuspiciouslyEmpty`, gating on text length and the
presence of usable fields) run against the same underlying `sections`/
`trainingScripts` data that both functions read — the full-script text is a
strict superset in verbosity of the summary text, making it the more
conservative (harder to false-positive against the `content.trim().length < 200`
threshold) of the two detectors. Using it unconditionally for the
completeness check, independent of which format will ultimately be shown to
Clio, means the toggle can never weaken this existing defensive gate. This
directly satisfies the CEO brief's instruction to "account for all three [call
sites] or explain why the pre-check/recheck ones don't need the same
toggle-awareness."

### 4.3 Where the branch lives in code (CEO Question 4, full answer)

- **New function, not a mode parameter, not an extension of
  `buildAllClioDocs`'s enum.** Add `buildSessionSummary(sections,
  trainingScripts)` as a new export in `lib/clio-context-builder.ts`,
  sitting alongside (not replacing or wrapping) `buildSessionScript()`.
- Confirmed via direct search of the codebase: `buildSessionScript()` is
  imported and called **only** inside
  `app/api/hume-native/provision-config/route.ts` (its 3 call sites listed
  above). `buildAllClioDocs()` — which internally calls `buildSessionScript()`
  for the ElevenLabs/Hume-Custom-LLM paths — is called from three entirely
  different files: `app/api/admin/qa-session-context/route.ts`,
  `app/api/recall/bot/route.ts`, and `inngest/session-meeting-setup.ts`.
  None of these ever touch `provision-config/route.ts` or the new
  `buildSessionSummary()` function. This confirms a new sibling function
  with a route-level conditional is the lowest-risk fit: it requires zero
  changes to `buildSessionScript()`'s body, zero changes to
  `buildAllClioDocs()`, and therefore provably zero behavior change for any
  ElevenLabs/Custom-LLM/admin-QA caller — they never import or reference
  `buildSessionSummary()` at all.
- The only file that ever imports the new function is
  `app/api/hume-native/provision-config/route.ts`, at its single real
  `sessionContent` assembly call site (~line 376–380).

---

## 5. Visual Examples

No UI (per CEO brief, wireframes N/A). In place of wireframes, here is a
literal before/after example of the assembled block for one representative
subtopic, illustrating exactly what text changes and what stays identical.

Grounding: `lib/clio-context-builder.ts`'s existing self-heal mapping
(`provision-config/route.ts` lines 287–303) already constructs each
section's `TEACH` segment as
`[overview, how_it_works, enterprise_implications].filter(Boolean).join(' ')`
— itself sourced from `content_outline.content_article.sections` in
`topic_content_cache` (verified live in Supabase: 181 of 229 rows have this
populated; see Section 6). The example below uses a representative TEACH
paragraph of realistic length/tone for a subtopic titled "Choosing Your
Model: Haiku vs. Sonnet vs. Opus."

### BEFORE — current `buildSessionScript()` output for one section (flag OFF, unchanged)

```
--- SECTION 2/5: "Choosing Your Model: Haiku vs. Sonnet vs. Opus" --- [call show_visual({ section_index: 2 })]

[STAGE DIRECTION — DO NOT SAY] Deliver teaching content after show_visual({ section_index: 2 }):
Model selection in the Claude API is not a one-time architectural decision — it is a
per-request engineering trade-off that directly shapes your system's cost structure,
latency, and output quality. Anthropic offers three tiers: Haiku (speed and economy),
Sonnet (the balanced workhorse), and Opus (maximum reasoning depth). Over-provisioning
Opus for simple tasks burns budget; under-provisioning Haiku for complex reasoning
produces brittle outputs. Model routing — dynamically selecting per request — can cut
inference costs 40-70% in mixed workloads without measurable quality loss.

[STAGE DIRECTION — DO NOT SAY] Verification question — ask after TEACH:
Given what we just covered, which of your team's current AI features do you think is
using the wrong-tier model right now?

[STAGE DIRECTION — DO NOT SAY] After they answer, pick the response that fits:
V1 (nailed it + added insight)  → (Celebrate their point + deepen it, then move to the bridge)
V2 (right but incomplete)       → (Acknowledge correct part + supply the missing piece)
V3 (partially right, gap)       → (Validate + fill the gap + re-anchor to the key takeaway)
V4 (adjacent, wrong direction)  → (Redirect without saying wrong + reframe simply)
V5 (incorrect)                  → (Affirm their thinking + correct clearly + re-explain with analogy)
V6 (I don't know)              → (Normalise uncertainty + strip back to simplest explanation)
V7 (explain again)             → (Completely different angle, simpler language, avoid repeating same words)
After any variant: deliver the bridge and proceed. If after V6/V7 still uncertain: deliver the bridge anyway — don't loop.

[STAGE DIRECTION — DO NOT SAY] Reframe fallback — use if participant seems uncertain:
Let me try a different angle.

[STAGE DIRECTION — DO NOT SAY] Bridge to next section:
Good. Let's move to the next section.
```

### AFTER — new `buildSessionSummary()` output for the same section (flag ON)

```
--- SECTION 2/5: "Choosing Your Model: Haiku vs. Sonnet vs. Opus" --- [call show_visual({ section_index: 2 })]

[STAGE DIRECTION — DO NOT SAY] What to cover — teach this live, in your own words, drawing on the TOPIC KNOWLEDGE BASE above. This is not a script:
Model selection is a per-request engineering trade-off shaping cost, latency, and
output quality across Haiku (speed/economy), Sonnet (balanced), and Opus (maximum
reasoning) — help the executive see where their team may be using the wrong tier.

[STAGE DIRECTION — DO NOT SAY] Verification — after teaching, ask a question that checks whether this landed, in your own words. There is no fixed question and no fixed response bank here — listen and respond naturally, per Behavioral Rule 4:
(Improvise a question specific to what you just taught and this executive's context.)

[STAGE DIRECTION — DO NOT SAY] If they seem uncertain, try a different angle in your own words — no fixed fallback line.

[STAGE DIRECTION — DO NOT SAY] Bridge to next section — transition naturally in your own words once the verification exchange is done.
```

**What stayed identical:** the section header line
(`--- SECTION 2/5: "..." --- [call show_visual({ section_index: 2 })]`) —
byte-for-byte the same format, same index, same title. This is what
preserves `show_visual`/`advance_tab` continuity (Section 4 detail, CEO
Question 3).

**What changed:** the literal TEACH paragraph is replaced with one compact
"what to cover" sentence (extracted/truncated from the same TEACH content,
not newly generated); the literal checkpoint question and all 7 V1–V7
branches are replaced with a single instruction to improvise, per rule 4;
the literal PROBE and CONTINUE lines are replaced with brief improvisation
instructions instead of pre-written text.

### Bookend sections (Session Overview / Session Summary) — unaffected either way

```
--- SECTION 0/5: "Session Overview" --- [call show_visual({ section_index: 0 })]

[STAGE DIRECTION — DO NOT SAY] Deliver teaching content after show_visual({ section_index: 0 }):
(unchanged bookend script — full real teach/checkpoint/continue text, exactly as today, in both flag OFF and flag ON)
```
See Section 4.3/6 for why bookends are explicitly excluded from
summarization.

---

## 6. Data Requirements

**No new database reads, writes, tables, or columns.** This feature is a
pure in-process string-assembly change plus one new environment variable.

- **Read (existing, unchanged):** `sessions.live_conductor_content`,
  `walkthrough_state.sections` / `.training_scripts` / `.topic_title` — same
  queries, same shape, same call sites as today.
- **New read:** `process.env.HUME_NATIVE_SUMMARY_MODE` (string), read once
  per request inside `POST /api/hume-native/provision-config`. Not read
  anywhere else. Not exposed to the client (no `NEXT_PUBLIC_` prefix — this
  route only ever runs server-side, confirmed by its existing file-level
  doc comment describing it as invoked from inside the Recall.ai bot's
  headless browser session via `userId` only).
- **Write:** none new. Existing writes (`sessions.hume_native_config_id`,
  `.hume_native_enabled`, and the CONTENT-POP-01 self-heal writes to
  `sessions.live_conductor_content`/`.content_status`) are entirely
  unchanged and unconditional on this toggle.
- **Grounding for the summary's source data (verified live against Supabase
  project `nqxlpcshouboplhnuvrh`, `topic_content_cache`, 2026-07-08):**
  - 229 total rows. 181 (≈79%) have `content_outline.content_article.sections.overview`
    populated as non-empty text, and `key_facts` populated as a JSON array,
    directly under the same row.
  - The remaining ≈21% have `content_outline.content_article` present but
    `sections` null/absent (older or partially-generated rows).
  - `topic_context_doc` was NULL on effectively all sampled rows (41 of
    229 non-null) — confirming the CEO's brief that this column is not the
    live runtime source; the actual per-session Topic Context comes from
    `live_conductor_content.tabs[].article` at runtime via
    `formatTabContentForPrompt()`, unaffected by this feature.
  - **Design decision (resolves CEO Question 1):** the new summary is
    **not** sourced from `topic_content_cache` or `content_outline`
    directly. It is derived from `trainingScripts[i]`'s existing `TEACH`
    segment — the same field `buildSessionScript()` already reads via
    `script?.segments.find(s => s.type === 'TEACH')?.content` — by taking
    the first complete sentence(s) up to a ~40-word / ~260-character cap
    (cut at the last sentence boundary within the cap, never mid-sentence).
    This is a **stricter reuse, not a new generation step**: `trainingScripts`
    is already loaded in-memory at this exact point in the route for both
    the pre-check and the real assembly, in an identical shape regardless
    of which pipeline (standard curriculum vs. CONTENT-POP-01 self-heal)
    produced it, and TEACH itself is already a synthesis of
    `content_outline.content_article.sections.overview` +
    `.how_it_works` + `.enterprise_implications` (per the self-heal mapping
    at `provision-config/route.ts` lines 296–299). No new Supabase call, no
    new LLM call, no new field is introduced.
  - **Fallback (mirrors existing convention):** if `trainingScripts[i]` or
    its TEACH segment is null/empty — which today already happens whenever
    a section has no generated script at all — the summary uses:
    `"(No prepared script — explain the key concepts for this topic from the Topic Knowledge Base above, in plain language.)"`
    This mirrors the tone and intent of `buildSessionScript()`'s own
    existing fallback string for the identical condition
    (`"(No script — explain the key concepts from the knowledge base in plain language.)"`),
    just reframed for a mode where improvisation is the default, not the
    exception.
- **In-memory only:** no `localStorage`/`sessionStorage` involvement — this
  feature never reaches the browser; it is fully resolved server-side before
  the Hume Config is provisioned.

---

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given `HUME_NATIVE_SUMMARY_MODE` is unset (or any value other than the
   exact string `'true'`), when `POST /api/hume-native/provision-config` is
   called for any session, then the resulting `sessionContent` string is
   byte-for-byte identical to the string produced before this feature
   existed (verified by a regression test asserting
   `sessionContent === buildTopicContext(...) + buildSessionScript(...)` output,
   with `buildSessionSummary` never invoked).

2. ✓ Given `HUME_NATIVE_SUMMARY_MODE=true` and a session with N real
   sections plus Overview/Summary bookends, when `sessionContent` is
   assembled, then every non-bookend section's block contains: the
   unchanged `--- SECTION i/total: "title" --- [call show_visual({ section_index: i })]`
   header, a compact "what to cover" line, an improvisation instruction for
   the verification question, and no literal pre-written checkpoint
   question or PROBE/CONTINUE text — while both bookend sections
   (`SessionOverview`/`SessionSummary`) retain their full, unabridged
   `teach`/`checkpoint`/`continue` text exactly as in flag-OFF mode.

3. ✓ Given `HUME_NATIVE_SUMMARY_MODE=true`, when the assembled
   `sessionContent` is parsed for every `show_visual({ section_index: X })`
   / bracketed index reference, then the set of indices present is
   identical, in identical order, to the set produced in flag-OFF mode for
   the same `sections` array (0 for Overview, 1..N for real sections, N+1
   for Summary) — confirming index continuity for rules 3/5 is unaffected
   by format.

4. ✓ Given `HUME_NATIVE_SUMMARY_MODE=true`, when the assembled
   `sessionContent` string is searched for the literal markers
   `"V1 ("`, `"V2 ("` … `"V7 ("` or any `checkpointVariants`-derived text,
   then zero matches are found anywhere in the non-bookend section blocks
   — confirming no hardcoded response variants leak into summary-driven
   mode.

5. ✓ Given `HUME_NATIVE_SUMMARY_MODE=true`, when a real (or fully simulated
   tool-call) Hume-native live session is run end-to-end, then the session
   calls `show_visual`/`advance_tab` for every section index from 0 through
   N+1 in order, delivers verification-question exchanges for every real
   section, and calls `end_session` only after the Summary bookend — i.e.
   the session completes the full agenda rather than truncating or ending
   early. This is the direct, explicit test against the ONDEMAND-02 failure
   mode: the post-call automated quality evaluator must **not** flag
   `quality_error: "no_clio_speech_detected"` for this session, and the
   session's own show_visual call count must equal `sections.length` (not
   1, as it was in the ONDEMAND-02 incident).

6. ✓ Given `HUME_NATIVE_SUMMARY_MODE=true` and a section whose
   `trainingScripts[i]` is null or has no TEACH segment (e.g. a
   self-healed section that only ever populates a TEACH segment, never
   CHECKPOINT/PROBE/CONTINUE), when that section's summary block is built,
   then the fallback text is used and rendering does not throw, produce
   `undefined`, or emit an empty "what to cover" line.

7. ✓ Given `HUME_NATIVE_SUMMARY_MODE=true` or unset/`false`, when the
   pre-check (`~148–152`) or recheck (`~311–315`) completeness gate runs,
   then it always uses the unmodified `buildSessionScript()` output
   regardless of the flag's value — confirming the existing
   `isSuspiciouslyEmpty()` defensive gate (and the CONTENT-POP-01 self-heal
   it triggers) is not weakened, bypassed, or made toggle-dependent by this
   feature.

---

## 8. Error States

- **`HUME_NATIVE_SUMMARY_MODE` set to an unexpected value** (e.g.
  `"1"`, `"yes"`, `"TRUE"`) → resolves to OFF (strict `=== 'true'` string
  match only). No error surfaced; this is the safe default, not a failure.
- **`trainingScripts[i]` null or TEACH segment missing** (summary mode) →
  falls back to the fixed instructional string (Section 6). Never throws,
  never renders `undefined`/`null` inline.
- **Section's TEACH content shorter than the ~40-word cap** → used
  verbatim, no truncation applied (cap only truncates, never pads).
- **`sections`/`trainingScripts` genuinely empty (regression, race
  condition, etc.)** → wholly unrelated to this feature's failure surface;
  caught upstream by the existing, unmodified pre-check/self-heal/recheck
  chain (Section 7, test 7), which runs identically regardless of this
  toggle and still hard-fails the request with `502` if content is
  genuinely unavailable, exactly as today.
- **Bookend section (`SessionOverview`/`SessionSummary`) missing its
  `data.script` field entirely** → pre-existing, unrelated gap (would
  already produce a degraded bookend today in flag-OFF mode via
  `getBookendScript()` returning `null` and `teach`/`checkpoint`/`cont`
  falling through to the same generic fallbacks `buildSessionScript()`
  already uses for non-bookend sections). This feature does not change
  that behavior in either mode.
- **Toggle flips ON in production for an in-flight call** → no effect;
  the flag is read once per `POST /api/hume-native/provision-config`
  request at session start, so an in-progress call's already-provisioned
  Hume Config is unaffected. Only the next session start picks up the new
  value.

---

## 9. Edge Cases

- **Session with only 1 real section (plus bookends):** header/index logic
  is unchanged from today's single-section handling — no special case
  needed; the same format applies whether N=1 or N=10.
- **Self-healed session (CONTENT-POP-01 path) with summary mode ON:**
  self-heal's `trainingScripts` mapping only ever populates a TEACH segment
  (no CHECKPOINT/PROBE/CONTINUE) — meaning today, in flag-OFF mode, these
  sessions already fall back to `checkpointFallback(i)` and generic
  probe/continue text for every section. Under summary mode, this is
  actually a **simpler** case: the verification/probe/bridge lines are
  already generic improvisation instructions regardless of whether a
  CHECKPOINT segment ever existed, so self-healed sessions have no
  additional edge-case behavior to design for.
- **Bookend sections always keep full script, in both modes** — this is a
  deliberate, resolved design choice (not a gap): existing prompt rules 1
  and 8 (`lib/voice/hume-native/prompt-template.ts`, unchanged, out of
  scope) explicitly instruct Clio to "deliver the Session Overview
  section's prepared content... in full" and "deliver the Session Summary
  section's prepared content in full... do not additionally improvise."
  Summarizing bookends would contradict these existing, untouched fixed
  rules — so `buildSessionSummary()` must special-case
  `section.type === 'SessionOverview' | 'SessionSummary'` exactly the way
  `buildSessionScript()` already does via its `isBookend`/`bookendScript`
  branch, and reuse that same real bookend content unmodified.
- **Toggle flipped mid-testing between two calls for the same user in the
  same day:** each call independently reads the flag at its own
  `provision-config` request time — no caching, no session-level pinning
  of the flag's value beyond that one request. Two consecutive sessions
  can legitimately run in different modes if the flag changes between them.
- **A session whose TEACH content is a single short clause (e.g. under the
  ~40-word cap):** used as-is; the cap only ever truncates, it does not
  pad short content with filler.

---

## 10. Out of Scope

Explicitly not part of this feature (per CEO brief's Known Constraints —
listed here so developers do not expand scope):

- `buildTopicContext()` — completely unchanged, not touched in any way.
- Pacing / per-section word-time budgets — not added to the new summary or
  anywhere else. Hume-native's lack of per-section time budgeting
  (unlike `buildSessionBrief()`'s "~X min per section" for the standard
  pipeline) is a known, separate future decision.
- Checkpoint-variant redesign — no new rules for judging/responding to
  answer quality are designed here. The 7 hardcoded variants are removed;
  existing prompt rule 4 (unchanged) already covers improvisation at a
  high level.
- The shipped `SESSION-END-01` `end_session` mechanism, rule 8's closing
  sequence, and fixed prompt-preamble rules 1–3, 5–7, 9–10 — completely
  unchanged.
- The ElevenLabs path and the Hume-Custom-LLM path — untouched.
  `buildSessionScript()` itself is not modified in any way; it keeps
  producing identical output for its existing callers (`buildAllClioDocs()`
  and, through it, `app/api/admin/qa-session-context/route.ts`,
  `app/api/recall/bot/route.ts`, `inngest/session-meeting-setup.ts`).
- `formatSingleSectionScript()` (split-mode single-tab injection) — not
  touched; it is a separate mechanism serving the ElevenLabs split-mode
  path.
- Any admin/operator-facing UI toggle for this flag — it is a plain server
  environment variable, set directly in the hosting platform (Vercel), the
  same way `NEXT_PUBLIC_HUME_NATIVE_ENABLED` is today. No new admin screen
  is in scope.
- `FAREWELL_PHRASES` hardening (flagged as a separate, independent finding
  in the ONDEMAND-02 brief) — explicitly out of scope for this feature;
  tracked separately.
- Any change to how `content_outline`/`topic_content_cache` is generated or
  populated upstream — this feature only reads already-loaded
  `trainingScripts` in-memory; it does not touch the content-generation
  pipeline.

---

## 11. Open Questions

None. All 7 questions raised in the CEO brief are resolved above:
1. Summary format — Section 6 (TEACH-segment extraction, sentence-boundary
   cap, documented fallback).
2. New prompt instruction text — Section 5 (AFTER example) and Section 4.3.
3. Section-index continuity — Section 4 (header line preserved verbatim)
   and Section 7, test 3.
4. Code branch location — Section 4.3 (new sibling function
   `buildSessionSummary()`, single call-site branch, pre-check/recheck left
   unconditional with rationale).
5. Env var name/mechanics — Section 3 (`HUME_NATIVE_SUMMARY_MODE`,
   server-only, default OFF, read once in `provision-config/route.ts`).
6. Rollback safety — Section 7, test 1 (byte-identical output when OFF).
7. ONDEMAND-02 anti-pattern check — see explicit statement immediately
   below.

### Explicit ONDEMAND-02 anti-pattern statement (non-negotiable per CEO brief)

ONDEMAND-02's failure mode was: real content was **discarded** (4 generated
subtopics thrown away, `sections` truncated to a single Overview element),
creating a hard dependency on a mid-call tool invocation (`advance_tab`)
that was **never actually instructed** in the prompt for that mode — the
prompt template had no on-demand-aware branch at all, `show_visual`'s
clamping logic silently masked the gap, and the existing completeness gate
(`isSuspiciouslyEmpty`) didn't even run in that code path (a different file,
`app/api/recall/bot/route.ts`'s `ONDEMAND-01` block, bypassing
`provision-config/route.ts` entirely). The result: Clio ran out of content
after the Overview and the call ended outright.

This feature is structurally incapable of repeating that failure mode,
because:

- **Nothing is discarded.** `sections` and `trainingScripts` remain
  exactly as populated by the existing pipeline (or CONTENT-POP-01
  self-heal) — same length, same order, same content, in both flag states.
  Summary mode changes only the *verbosity of the text rendered per
  section*, never the *number of sections* or *what data backs them*.
- **Nothing is deferred to an uninstructed mid-call action.** All N
  sections' content (in whichever format the flag selects) is present in
  `[SESSION CONTENT]` at session start, exactly as today — there is no
  mid-call fetch, no `advance_tab`-style backfill this feature depends on,
  and no new tool call this feature requires Clio to make that isn't
  already a working, already-shipped mechanism (`show_visual`, unchanged).
- **The existing defensive gate stays fully armed, unconditionally.** The
  pre-check/recheck completeness gate (`isSuspiciouslyEmpty`) is
  deliberately left non-toggle-aware (Section 4, 4.2) and always evaluates
  against the more verbose `buildSessionScript()` output — the same gate
  that protects today's full-script mode protects summary mode identically,
  because it never even sees which mode will ultimately ship to Clio.
- **Verified end-to-end, not assumed:** Section 7's acceptance test 5
  requires a real (or fully simulated) live session with the flag ON to
  actually reach `show_visual`/`advance_tab` for every index through N+1
  and call `end_session` only at the true end — the exact diagnostic
  signature (`show_visual` call count, quality-evaluator flag) that
  ONDEMAND-02's own postmortem used to detect the failure is written here
  as a hard, checkable pass/fail gate before this feature can ship.

---

## 12. Dependencies

**Must be true before this can be built:** nothing external — no new
migrations, no new third-party setup, no credentials. This is purely an
additive code change plus one new env var.

**Files a developer will need to change:**

1. `lib/clio-context-builder.ts` — add new exported function
   `buildSessionSummary(sections: Section[], trainingScripts: (TrainingScript | null)[]): string`,
   sitting alongside `buildSessionScript()`. Must:
   - Special-case bookend sections (`SessionOverview`/`SessionSummary`)
     to reuse the exact same `bookendScript` full-content logic
     `buildSessionScript()` already has (do not duplicate divergent logic —
     extract/share the bookend-handling branch if practical).
   - Emit the identical `--- SECTION i/total: "title" --- [call show_visual({ section_index: i })]`
     header line format for non-bookend sections.
   - Extract the compact "what to cover" line from `trainingScripts[i]`'s
     TEACH segment per the algorithm in Section 6, with the documented
     fallback string when missing.
   - Emit the fixed improvisation instructions for verification/probe/bridge
     in place of literal checkpoint/PROBE/CONTINUE text (Section 5, AFTER
     example).
   - Include a new fixed preface (replacing `buildSessionScript()`'s
     "Deliver each section's TEACH script..." preface) instructing Clio
     that this is a summary to teach live from, not a script — see Section
     4.3/5.
2. `app/api/hume-native/provision-config/route.ts` — read
   `HUME_NATIVE_SUMMARY_MODE` once near the top of the `POST` handler;
   branch only at the real assembly call site (currently lines ~376–380)
   between `buildSessionScript(sections, trainingScripts)` (flag OFF) and
   `buildSessionSummary(sections, trainingScripts)` (flag ON). Leave the
   pre-check (~148–152) and recheck (~311–315) call sites completely
   unconditional, always calling `buildSessionScript()`.
3. `.env.local.example` — add
   `HUME_NATIVE_SUMMARY_MODE=false` (documented placeholder/default,
   following existing convention for boolean flags in this file).
4. New test file (no existing test file for this module today — confirmed
   by direct search) — e.g. `tests/unit/clio-context-builder.test.ts` —
   covering acceptance tests 1–4, 6–7 from Section 7 (structural/string
   assertions; test 5, the live end-to-end session test, is a
   manual/QA-run acceptance test, not a unit test, per Section 7's own
   framing).

**Nothing else in the codebase needs to change.** Confirmed via direct
search: `buildSessionScript()` has exactly 3 call sites, all inside
`app/api/hume-native/provision-config/route.ts`; `buildAllClioDocs()` (the
ElevenLabs/Custom-LLM/admin-QA path) is called from three separate files
that never reference `provision-config/route.ts` or will ever import the
new `buildSessionSummary()` function.
