# Session Quality Fixes — Requirement Document
Version: 1.0
Status: APPROVED (CEO findings authoritative — implement exactly)
Author: Business Analyst Agent
Date: 2026-06-28

---

## 1. Purpose

Four compounding quality defects degrade every live Clio coaching session. Participants experience: a session that begins mid-content without showing the agenda overview; an agent that reads stage-direction labels aloud (e.g. "CHECKPOINT"); a delivery pace that feels rushed and transactional rather than warm and patient; and Developer/Engineer users who receive C-Suite governance framing that is irrelevant to their work. These four issues are independent in cause but unified in effect — they erode trust in Clio as a competent coach and reduce the perceived value of the session. All four are fixable through prompt engineering and small, targeted code changes. No schema migrations are required.

---

## 2. User Stories

As a session participant,
I want to see the session overview and agenda before any content begins,
So that I can orient myself and feel prepared before the first topic.

As a session participant,
I want the coach to speak naturally and never read out formatting artefacts,
So that the conversation feels human and professional, not like a script being read aloud.

As a session participant who is a Developer or Engineer,
I want Clio's content framing to match my technical context,
So that the session teaches me things I can actually implement, not things I would never be asked to govern.

As a session participant (any role),
I want Clio to teach at a patient, absorb-friendly pace,
So that I leave with real understanding, not just a feeling that a lot of information was delivered quickly.

---

## 3. Trigger / Entry Point

All four fixes affect content that is assembled at two moments:

1. **Script generation time** — when `session-content-pipeline.ts` (Inngest job) calls `generateScriptAndVisualization` in `lib/content/script-generator.ts`. The generated script is cached to `topic_content_cache.training_script`. Fix 3 (tone) and Fix 4 (role calibration) affect this step.

2. **Session launch time** — when `POST /api/recall/bot` calls `buildAllClioDocs` in `lib/clio-context-builder.ts`. The resulting `system_prompt` is written to `walkthrough_state.clio_session_context` and becomes the ElevenLabs agent system prompt for the live session. Fix 1 (overview opening) and Fix 2 (stage direction labels) affect this step. Fix 4 (role calibration) also partially affects this step via the `roleLevel` value passed from `recall/bot/route.ts`.

3. **Session connection time** — when `WalkthroughClient.tsx` calls `Conversation.startSession`. Fix 3 (voice speed) affects the `tts` override block at this moment.

User state required: authenticated (Clerk), session in `content_status = 'ready'`, Recall.ai bot creation requested.

---

## 4. Screen / Flow Description

No new user-facing screens are introduced. All changes are to the system prompt delivered to the ElevenLabs agent and to the Inngest-generated script cached in `topic_content_cache`. The participant's experience changes as follows:

**Fix 1 — Overview First:**
When the bot connects, Clio immediately calls `show_visual({ section_index: 0 })` before speaking any TEACH content. The overview card (the synthetic `session-overview` section prepended in `recall/bot/route.ts` at line ~281) loads on screen. Clio says "Let me pull up today's overview." then reads the agenda section titles aloud. Only after the agenda walkthrough does Clio proceed to Section 1 content.

**Fix 2 — No Stage Direction Labels Spoken:**
Labels such as `CHECKPOINT`, `TEACH`, `PROBE`, `CONTINUE`, `SECTION` that currently appear in the script body as plain text are reformatted in the script builder to use bracket notation (`[STAGE DIRECTION — DO NOT SAY]`). A new behavioural rule explicitly instructs the agent that all-caps labels in brackets are stage directions only and must never be spoken.

**Fix 3 — Pace and Tone:**
The generated script uses warmer, more patient language. Em-dashes and ellipses signal brief pauses. The `tts` override in `WalkthroughClient.tsx` includes `voiceSettings` with `stability: 0.65` and `speed: 0.92` to slow ElevenLabs' default voice rate by ~8%. The session brief rule no longer says "keep pace — this is executive time" and instead instructs the agent to prioritise understanding over coverage speed.

**Fix 4 — Developer Role Calibration:**
When `role_level` resolves to `'specialist'` (either from the database or via the new `inferRoleLevel()` helper), the LLM calibration block in `script-generator.ts` instructs Claude to use full technical depth, implementation framing, and API/architecture examples — not governance, procurement, or board-level framing. The `ROLES` taxonomy adds `'Software Engineer / Developer'` as an explicit value.

---

## 5. Visual Examples

No new screens. The only visible change for the participant is that the session overview card appears on screen at the very start of the session (it was already being rendered for the KB view; this fix ensures the agent navigates to it at session open).

---

## 6. Data Requirements

**Read:**
- `walkthrough_state.clio_session_context` — assembled by `buildAllClioDocs` at bot-launch time; the system prompt the agent operates under
- `walkthrough_state.sections` — array of `TemplateSection` including the prepended `session-overview` section at index 0
- `topic_content_cache.training_script` — generated at Inngest pipeline time; contains `segments` array (TEACH, CHECKPOINT, PROBE, CONTINUE/CLOSE)
- `users.role_level` — used for calibration in script generation
- `users.role` — used by `inferRoleLevel()` when `role_level` is null

**Written:**
- No new columns. No schema migrations.
- `topic_content_cache.training_script` is regenerated with updated tone when the Inngest pipeline runs for new sessions (existing cached scripts are not retroactively updated — see Section 10).

**APIs called:**
- ElevenLabs `Conversation.startSession` — the `tts.voiceSettings` block is added here
- Anthropic Messages API — called by `generateScriptAndVisualization` with the updated prompt text

**localStorage / sessionStorage:** None.

---

## 7. Success Criteria (Acceptance Tests)

### Fix 1 — Overview shown first

✓ Given a session with N subtopics (N >= 1), when the Recall.ai bot connects and Clio begins speaking, then `show_visual({ section_index: 0 })` is the first tool call emitted, before any TEACH content is spoken.

✓ Given the system prompt produced by `buildSessionBrief`, when the OPENING SEQUENCE block is inspected, then it appears before the BEHAVIOURAL RULES block in the output string.

✓ Given a session with 3 subtopics (overview at index 0, subtopics at indices 1, 2, 3), when Clio calls `show_visual` for the first subtopic, then it passes `section_index: 1`, not `section_index: 0`.

✓ Given the OPENING SEQUENCE instruction, when the session brief is rendered, then it contains the exact phrase "Call show_visual({ section_index: 0 }) immediately when the session starts."

✓ Given a session with 0 subtopics (empty `freshSections`), when `syntheticOverview` is null and no sections exist, then no OPENING SEQUENCE instruction references section_index: 0 for content sections (edge case — brief is empty anyway).

### Fix 2 — No stage direction labels spoken

✓ Given the `buildSessionScript` output, when any script block is inspected, then the string "CHECKPOINT — ask this after TEACH" does not appear anywhere in the output.

✓ Given the `buildSessionScript` output, when any script block is inspected, then the string "CHECKPOINT RESPONSE GUIDE" does not appear anywhere in the output.

✓ Given the system prompt delivered to ElevenLabs, when BEHAVIOURAL RULES is inspected, then a rule exists that contains the phrase "stage directions only — never speak them aloud."

✓ Given the reformatted labels, when the script block for any section is rendered, then labels appear in the format `[STAGE DIRECTION — DO NOT SAY]` followed by the human-readable descriptor.

✓ Given a TEACH segment, when the script block is rendered, then "TEACH —" does not appear as a bare label; it appears as "[STAGE DIRECTION — DO NOT SAY] Deliver teaching content:" or equivalent bracket form.

### Fix 3 — Patient pace and tone

✓ Given the `buildSessionBrief` output, when rule 10 is inspected, then it contains the phrase "Teach with patience, not pace" and does not contain "Keep pace — this is executive time."

✓ Given the `buildSessionBrief` output, when the duration line is inspected, then it contains the phrase "Prioritise understanding over speed" and does not contain "cut elaboration."

✓ Given the `generateScriptAndVisualization` prompt, when the TEACH segment instruction is inspected, then "No filler, no hedging." does not appear in the word-budget instruction line.

✓ Given the `generateScriptAndVisualization` prompt, when the tone instruction lines are inspected, then "warm and patient tone" appears and "confident peer tone" does not.

✓ Given `WalkthroughClient.tsx`, when the `tts` override block is inspected, then `voiceSettings` is present with `stability: 0.65` and `speed: 0.92`.

### Fix 4 — Developer/Specialist role calibration

✓ Given `taxonomy.ts`, when ROLES is inspected, then `'Software Engineer / Developer'` is present in the array.

✓ Given `session-content-pipeline.ts`, when `role_level` in the `users` row is null and `role` is `'Software Engineer / Developer'`, then `inferRoleLevel()` returns `'specialist'` and `userContext.roleLevel` is set to `'specialist'`.

✓ Given `session-content-pipeline.ts`, when `role` matches any of: "developer", "engineer", "architect", "specialist", "analyst", "scientist" (case-insensitive), then `inferRoleLevel()` returns `'specialist'`.

✓ Given `session-content-pipeline.ts`, when `role` matches "manager", "lead", or "head" (case-insensitive), then `inferRoleLevel()` returns `'manager'`.

✓ Given `session-content-pipeline.ts`, when `role` matches "vp", "svp", "evp", or "director" (case-insensitive), then `inferRoleLevel()` returns `'vp-dir'`.

✓ Given `recall/bot/route.ts`, when the `users` table select query is inspected, then `role_level` is included in the selected columns alongside `role`, `industry`, `ai_maturity`, and `primary_domain`.

✓ Given the SPECIALIST calibration block in `script-generator.ts`, when a specialist user's script is generated, then the prompt contains "What do I need to build/implement/integrate?" framing and does not contain "greenlight", "board reporting", or "vendor evaluation" framing.

✓ Given the SPECIALIST entry in `session-content-generator.ts` roleLevel instruction map, when the instruction is inspected, then it contains "Full technical depth" and references "implementation" rather than "procurement" or "budget."

---

## 8. Error States

**Fix 1:**
- If `freshSections.length === 0` (no content), `syntheticOverview` is already null per the existing guard in `recall/bot/route.ts` (line ~268). In this case `buildSessionBrief` is called with an empty `sections` array. The OPENING SEQUENCE block should still be emitted — but `show_visual({ section_index: 0 })` will find no section. This is an existing graceful-degradation state (empty session) and is unchanged by this fix.
- If the `session-overview` section is not at index 0 of `sectionsWithOverview` for any reason (ordering bug), the agent will navigate to whichever section is at index 0. This is caught by the acceptance test in Section 7.

**Fix 2:**
- If the agent ignores the `[STAGE DIRECTION — DO NOT SAY]` label format (LLM instruction does not guarantee compliance), the bracket text itself is benign — a participant hearing "stage direction — do not say: Deliver teaching content" is awkward but not harmful. The behavioural rule in the system prompt is the primary control; the label renaming is defence-in-depth.
- No error state to handle in code — this is a prompt-only change. No API or database calls are affected.

**Fix 3:**
- If the `@11labs/client` SDK does not support `voiceSettings` at the path `overrides.tts.voiceSettings`, the startSession call will silently ignore the unrecognised key (SDK ignores unknown fields). The session will proceed at default speed. Developer must verify the exact field path against the installed SDK version before deploying. If the field names are wrong, no runtime error occurs — only the speed remains unchanged.
- If `speed: 0.92` produces a perceptibly too-slow result in production testing, this value can be tuned without any other code change. Acceptable range: 0.85–1.0.

**Fix 4:**
- If `users.role` is null AND `users.role_level` is null, `inferRoleLevel(null)` returns `'c-suite'` (the existing default). Behaviour is unchanged from before this fix for users with no role data.
- If `role_level` is set explicitly in the database (e.g. `'vp-dir'`), `inferRoleLevel()` is never called — the explicit value takes precedence. `inferRoleLevel()` is only the fallback when `role_level` is null.
- If the Supabase query in `recall/bot/route.ts` fails to return `role_level` (e.g. column doesn't exist on the select path), TypeScript will surface a type error at build time because `userRow` is typed. This is caught before deployment.

---

## 9. Edge Cases

**Fix 1:**
- Session with exactly 1 subtopic: overview is at index 0, the single subtopic is at index 1. The OPENING SEQUENCE instruction must still fire. After the agenda walkthrough (which lists one item), Clio proceeds immediately to Section 1 at index 1.
- Session where skipped topics make up all subtopics: `freshSections` would be empty, `syntheticOverview` is null. OPENING SEQUENCE instruction in the brief still references index 0 but there are no sections — this is a degenerate state and cannot be triggered in practice (the bot-launch guard blocks it for curriculum sessions).
- Reconnect (isReconnect = true): ElevenLabs re-establishes the WebSocket but the system prompt is unchanged. If the agent resumes mid-session, it should not replay the OPENING SEQUENCE. The instruction says "when the session starts" — the agent is expected to use context to determine whether the session is new or resumed. No code change needed; this is an instruction-level nuance.

**Fix 2:**
- Older cached scripts (generated before this fix) may still contain bare `CHECKPOINT —` labels in their `training_script` JSON stored in `topic_content_cache`. The `buildSessionScript` function reads from the `trainingScripts` array in memory (which comes from the cache). The label renaming in `buildSessionScript` is applied at render time in `clio-context-builder.ts`, not in the stored JSON — so the fix applies to all sessions regardless of when the script was generated. This is correct.
- Scripts where the CHECKPOINT segment has no content (falls through to `checkpoint ?? 'How does that land for you?'`): the default fallback text does not contain bare labels, so this edge case is already clean.

**Fix 3:**
- Duration copy in `buildSessionBrief` references `sessionDurationMins` and `timePerSection` calculated values. The updated copy must preserve these dynamic values. Example: "Available time: 30 minutes total (~10 min per section). Deliver every concept clearly — prioritise understanding over speed." The numeric values are unchanged; only the instructional tail is reworded.
- The word budget change (removing "No filler, no hedging.") applies to `generateScriptAndVisualization`, not to `adaptScriptToDuration`. The condensing prompt in `adaptScriptToDuration` has its own "Eliminate filler phrases, hedging language" instruction — this is NOT changed by this fix. The condenser's job is different: it is trimming an existing script, not generating tone.
- Voice speed `0.92` applies globally to all users regardless of role. There is no per-role speed setting.

**Fix 4:**
- User selects "Software Engineer / Developer" from ROLES dropdown during onboarding: stored as `role = 'Software Engineer / Developer'`. `role_level` may or may not be set. If `role_level` is null, `inferRoleLevel('Software Engineer / Developer')` matches `engineer` → returns `'specialist'`. If `role_level` is explicitly `'c-suite'` (e.g. a CTO who used the freeform field), the explicit value wins — `inferRoleLevel` is not called.
- User enters a freeform role not matching any regex pattern (e.g. "Chief of Staff"): `inferRoleLevel` returns `'c-suite'` (default). Behaviour unchanged.
- User with `role_level = 'specialist'` who is in C-Suite (e.g. a technical founder who chose specialist): the database value wins. No override from role inference.
- `recall/bot/route.ts` currently does NOT pass `role_level` to `buildAllClioDocs`. The `buildAllClioDocs` function does not use `roleLevel` directly — the `clio-context-builder.ts` functions do not apply calibration; calibration happens at script-generation time in `script-generator.ts`. Therefore, the missing `role_level` in the bot route query only affects future script regeneration paths that might use the live user profile during bot launch. For the primary pipeline (Inngest), the fix in `session-content-pipeline.ts` is what matters. The `role_level` column addition to the `recall/bot` query is still required to ensure the column is available if the bot route ever uses it for future features.

---

## 10. Out of Scope

- Retroactive regeneration of existing `topic_content_cache` rows. Scripts cached before this fix will have the old tone and calibration. Only newly generated sessions (pipeline triggered after deploy) will use updated prompts.
- Per-user voice speed settings (e.g. user preference to speed up or slow down). All users get `speed: 0.92`.
- Adding new role values beyond `'Software Engineer / Developer'` to the ROLES taxonomy.
- Fixing the ROLES taxonomy to enforce strict validation on onboarding input. Users can currently submit arbitrary role strings. That is a separate onboarding bug.
- Changes to the visual templates or `topic_content_cache.section_data` structure.
- Changes to `adaptScriptToDuration` tone instructions (the condensing prompt's "eliminate filler" instruction is intentional and stays).
- Changes to the `generateTrainingScript` (legacy path) — this path is only used when `generateScriptAndVisualization` is not available. Tone fixes apply to `generateScriptAndVisualization` only.
- Schema migrations of any kind.
- UI changes visible to the user during onboarding or in the dashboard.
- ElevenLabs agent configuration changes outside the `startSession` override block (e.g. changing the base agent's voice settings in the ElevenLabs dashboard).

---

## 11. Open Questions

None.

All design decisions and required fix text were provided authoritatively by the CEO investigation findings. Developer must verify one implementation detail before deploying Fix 3:

**Implementation note (not a blocker):** Verify that `voiceSettings` is the correct field name under `overrides.tts` in the installed version of `@11labs/client`. The field may be `voice_settings` (snake_case) or `voiceSettings` (camelCase). Check the TypeScript types in `node_modules/@11labs/client`. If the field is not present in the type definitions, do not add it — surface this as a blocker and escalate to the CEO agent. Do not guess the field name.

---

## 12. Dependencies

**Must exist before this can be built:**
- `lib/clio-context-builder.ts` — exists. All Fix 1 and Fix 2 changes are in this file.
- `lib/content/script-generator.ts` — exists. All Fix 3 and part of Fix 4 changes are in this file.
- `lib/content/session-content-generator.ts` — exists. Fix 4 roleLevel instruction map change is here.
- `lib/content/taxonomy.ts` — exists. Fix 4 ROLES array addition is here.
- `inngest/session-content-pipeline.ts` — exists. Fix 4 `inferRoleLevel` helper and fallback replacement are here.
- `app/api/recall/bot/route.ts` — exists. Fix 4 column addition to the users query is here.
- `app/dashboard/walkthrough/WalkthroughClient.tsx` — exists. Fix 3 `voiceSettings` addition is here.
- `@11labs/client` npm package — installed. Must verify TypeScript type for `voiceSettings` before committing Fix 3.

**No new tables, migrations, or routes required.**

**Deployment order:** All four fixes can be deployed in a single commit. They are independent — no fix depends on another being deployed first. The Inngest pipeline does not need to be re-run for Fix 1 and Fix 2 (they apply at bot-launch time). Fix 3 applies at session-connection time. Fix 4 applies at pipeline-run time for new sessions; existing cached scripts are unaffected.

**Rollback:** All changes are text modifications to TypeScript source files (prompt strings, rule text, one field addition). Reverting the commit is sufficient to roll back all four fixes completely. No data migration is needed to rollback.

---

## Appendix: Exact Text Changes

This appendix provides the developer with the exact before/after strings for each change to eliminate interpretation risk.

### Fix 1 — `lib/clio-context-builder.ts` — `buildSessionBrief`

Add the following block immediately after the agenda lines and before the `=== BEHAVIOURAL RULES ===` heading:

```
OPENING SEQUENCE — do this first, before anything else:
Call show_visual({ section_index: 0 }) immediately when the session starts.
This shows the Session Overview. While it loads, say: "Let me pull up today's overview."
Briefly walk through the agenda (read the section titles aloud), then proceed to Section 1.
Do NOT begin any TEACH content until after the overview has been shown and the agenda read.
```

The agenda section titles to read aloud are the items already listed in `TODAY'S AGENDA`. No additional data is needed.

Section indices in the SESSION SCRIPT (Document 3) must be offset by 1. The `buildSessionScript` function uses `section_index: ${i}` (0-based) in the SECTION header and TEACH lines. After Fix 1, the overview occupies index 0 — but `buildSessionScript` is called with `sections = freshSections` (without the overview), so its indices start at 0 for the first real subtopic. This is correct: when Clio navigates to the first subtopic's visual, it should pass `section_index: 1` (overview is 0, subtopic 1 is 1). Therefore the script must offset all section indices by 1.

Change in `buildSessionScript`:
- Line `--- SECTION ${i + 1}/${totalSections}: "${title}" --- [call show_visual({ section_index: ${i} })]` becomes `--- SECTION ${i + 1}/${totalSections}: "${title}" --- [call show_visual({ section_index: ${i + 1} })]`
- Line `TEACH — say this after calling show_visual({ section_index: ${i} }) for this section:` becomes `TEACH — say this after calling show_visual({ section_index: ${i + 1} }) for this section:`
- Rule 3 in BEHAVIOURAL RULES: update the parenthetical: `(0-based: section 1 = 0, section 2 = 1, etc.)` becomes `(Overview = 0; section 1 = 1, section 2 = 2, etc.)`

### Fix 2 — `lib/clio-context-builder.ts` — BEHAVIOURAL RULES and label formatting

Add after existing rule 4 (after the `After delivering TEACH, always ask...` line):

```
5. IMPORTANT — SCRIPT FORMAT: Labels in [STAGE DIRECTION — DO NOT SAY] brackets are stage directions only — never speak them aloud. Only speak the text that follows the label.
```

Renumber existing rules 5–10 to 6–11.

In `buildSessionScript`, rename labels as follows (exact substitutions):

| Old string | New string |
|---|---|
| `TEACH — say this after calling show_visual...` | `[STAGE DIRECTION — DO NOT SAY] Deliver teaching content after show_visual({ section_index: N }):` |
| `CHECKPOINT — ask this after TEACH to verify understanding:` | `[STAGE DIRECTION — DO NOT SAY] Verification question — ask after TEACH:` |
| `CHECKPOINT RESPONSE GUIDE — after they answer, pick the variant that best matches:` | `[STAGE DIRECTION — DO NOT SAY] After they answer, pick the response that fits:` |
| `PROBE — use this if they seem uncertain or ask you to explain differently:` | `[STAGE DIRECTION — DO NOT SAY] Reframe fallback — use if participant seems uncertain:` |
| `CONTINUE — say this to bridge before calling show_visual for the next section:` | `[STAGE DIRECTION — DO NOT SAY] Bridge to next section:` |
| `CONTINUE — [FINAL SECTION — after CHECKPOINT response, say this, then summarise 2 sentences, then call end_session immediately]:` | `[STAGE DIRECTION — DO NOT SAY] Final bridge — say this after CHECKPOINT response, then summarise 2 sentences, then call end_session immediately:` |

The `--- SECTION N/M: "Title" ---` header line does not need bracket notation — it is structural and not speech-adjacent.

### Fix 3 — `lib/clio-context-builder.ts` — `buildSessionBrief` rule 10 and duration line

**Rule 10 (after renumbering due to the new rule 5 above, this becomes rule 11):**

Old:
```
10. Keep pace — this is executive time. Do not dwell on any section beyond the script + one follow-up.
```

New:
```
11. Teach with patience, not pace. After delivering TEACH, pause briefly before asking the verification question — give the participant a moment to absorb. If you sense uncertainty, slow down. The goal is understanding, not coverage speed.
```

**Duration line (line ~82):**

Old:
```
`Available time: ${sessionDurationMins} minutes total${timePerSection ? ` (~${timePerSection} min per section)` : ''}. Keep TEACH tight — deliver every concept, cut elaboration.`
```

New:
```
`Available time: ${sessionDurationMins} minutes total${timePerSection ? ` (~${timePerSection} min per section)` : ''}. Deliver every concept clearly — prioritise understanding over speed.`
```

### Fix 3 — `lib/content/script-generator.ts` — tone and word budget

**Tone instruction lines (~205–208, in the `generateTrainingScript` prompt):**

Old:
```
- Natural spoken language — contractions, short sentences, confident peer tone
- Sound like a trusted colleague, not a teacher or consultant
```

New:
```
- Natural spoken language — contractions, varied sentence length, warm and patient tone
- Sound like a trusted expert who genuinely wants the participant to understand, not just to inform
- Use brief pauses (indicated by em-dash or ellipsis) after each key concept
```

**TEACH word budget instruction (~507–509, in the `generateScriptAndVisualization` prompt):**

Old:
```
   Write with confidence and precision. No filler, no hedging, no padding.
   Every sentence must teach something new.
```

New:
```
   Write with confidence and clarity.
   Every sentence must teach something new.
```

(Remove "No filler, no hedging, no padding." — this is the line that eliminates natural breathing room.)

### Fix 3 — `app/dashboard/walkthrough/WalkthroughClient.tsx` — TTS override block (~line 312)

Old:
```typescript
tts: {
  voiceId: VOICE_ID,
},
```

New:
```typescript
tts: {
  voiceId: VOICE_ID,
  voiceSettings: {
    stability: 0.65,
    speed: 0.92,
  },
},
```

Developer action required: before committing, verify that `voiceSettings` (camelCase) matches the TypeScript type exported by `@11labs/client`. If the type uses `voice_settings` (snake_case), use that instead. If `voiceSettings` does not exist on the TTS override type at all, do not add it — escalate to the CEO agent.

### Fix 4 — `lib/content/taxonomy.ts` — ROLES array

Add `'Software Engineer / Developer'` as the second-to-last entry (before `'Other'`):

Old:
```typescript
export const ROLES = [
  'CEO / MD / President',
  'VP / SVP / EVP',
  'CU Lead / Practice Head',
  'BU Lead / Functional Head',
  'Product Sponsor / Owner',
  'Director / Senior Manager',
  'Other',
] as const
```

New:
```typescript
export const ROLES = [
  'CEO / MD / President',
  'VP / SVP / EVP',
  'CU Lead / Practice Head',
  'BU Lead / Functional Head',
  'Product Sponsor / Owner',
  'Director / Senior Manager',
  'Software Engineer / Developer',
  'Other',
] as const
```

### Fix 4 — `inngest/session-content-pipeline.ts` — `inferRoleLevel` helper

Add this function before `sessionContentPipeline` (after the imports):

```typescript
function inferRoleLevel(role?: string | null): string {
  if (!role) return 'c-suite'
  const lower = role.toLowerCase()
  if (/developer|engineer|architect|specialist|analyst|scientist/.test(lower)) return 'specialist'
  if (/manager|lead|head/.test(lower)) return 'manager'
  if (/vp|svp|evp|director/.test(lower)) return 'vp-dir'
  return 'c-suite'
}
```

In `step.run('fetch-session-data')`, change the `userContext` block:

Old (line ~162):
```typescript
const userContext = {
  role: userProfile?.role ?? 'executive',
  industry: userProfile?.industry ?? 'business',
  maturity: userProfile?.ai_maturity ?? 'beginner',
  roleLevel: userProfile?.role_level ?? 'c-suite',
}
```

New:
```typescript
const userContext = {
  role: userProfile?.role ?? 'executive',
  industry: userProfile?.industry ?? 'business',
  maturity: userProfile?.ai_maturity ?? 'beginner',
  roleLevel: userProfile?.role_level ?? inferRoleLevel(userProfile?.role),
}
```

### Fix 4 — `app/api/recall/bot/route.ts` — users query (~line 64)

Old:
```typescript
supabase
  .from('users')
  .select('role, industry, ai_maturity, primary_domain')
  .eq('id', userId)
  .single(),
```

New:
```typescript
supabase
  .from('users')
  .select('role, industry, ai_maturity, role_level, primary_domain')
  .eq('id', userId)
  .single(),
```

### Fix 4 — `lib/content/script-generator.ts` — SPECIALIST calibration block (~line 471)

Old:
```
SPECIALIST CALIBRATION: Full technical depth. Edge cases, implementation nuance, architectural trade-offs.
```

New:
```
SPECIALIST/DEVELOPER CALIBRATION:
- Full technical depth is expected and required
- Include: code-adjacent concepts, API usage patterns, integration architecture, prompting techniques, system design trade-offs
- Frame content around: "What do I need to build/implement/integrate?" — not "What do I need to approve/govern/budget?"
- Replace governance framing ("greenlight", "vendor evaluation", "board reporting") with implementation framing ("how to call this API", "how to structure this prompt", "how to evaluate model output quality")
- Use concrete technical examples, not strategic analogies
```

### Fix 4 — `lib/content/session-content-generator.ts` — roleLevel instruction map (~line 423)

Old:
```typescript
'specialist': 'Write for a practitioner using AI tools directly. Full technical depth is appropriate.',
```

New:
```typescript
'specialist': 'Write for a practitioner who builds and integrates AI systems directly. Full technical depth is required. Frame everything around implementation, integration, and system design — not governance, procurement, or board-level strategy. Use concrete technical examples. The reader needs to know how to build or configure this, not how to approve it.',
```
