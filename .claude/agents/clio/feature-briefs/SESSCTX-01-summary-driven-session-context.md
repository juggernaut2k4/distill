# Feature Brief: Summary-driven Session Context for Hume-native (replace full script with compact per-topic summary)
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-08

## What Arun Said
Today, Hume-native voice sessions (`NEXT_PUBLIC_VOICE_PROVIDER=hume` AND
`NEXT_PUBLIC_HUME_NATIVE_ENABLED=true`) get their full teaching content
upfront via `assembleHumeNativePrompt()`
(`lib/voice/hume-native/prompt-template.ts`). The `[SESSION CONTENT]` block is
built in `app/api/hume-native/provision-config/route.ts` from two pieces,
both produced by `lib/clio-context-builder.ts`:

1. `buildTopicContext()` — a rich per-subtopic Q&A knowledge base (~14,800
   chars typical). Untouched by this change.
2. `buildSessionScript()` — the full pre-written script per section: literal
   TEACH text, a literal CHECKPOINT question plus 7 hardcoded response
   variants (V1–V7), a PROBE fallback, and a CONTINUE bridge line (~14,000
   chars typical).

Arun's decision: replace `buildSessionScript()`'s contribution to the
Hume-native `[SESSION CONTENT]` block with a **compact summary view** — topic
count plus what each topic needs to cover — with NO full pre-written TEACH
text and NO 7 hardcoded checkpoint variants. Clio should teach live, in her
own words, substantively pulling from the unchanged `buildTopicContext()`
knowledge base rather than reading a script. She still asks a verification
question per topic (unchanged — existing prompt rule 4 already requires
this), but both the question and her response to the participant's answer
should now be improvised, not pattern-matched to one of 7 pre-written
branches.

This is a real, permanent, toggleable production feature — not a test mode,
not a sandboxed experiment. Gated behind a new feature flag, default OFF
(today's exact full-script behavior unchanged when off), flippable back to
current behavior in production at any time with no code rollback.

## The Problem Being Solved
The current Hume-native script format hands Clio ~14,000 characters of
literal words to say, including 7 hardcoded response branches per checkpoint.
This makes her sound like she's reading rather than coaching live, and caps
her ability to respond naturally to what the participant actually says
(she's boxed into picking from V1–V7). Arun wants her to teach the way a real
advisor would — knowing what she needs to cover and drawing on real
knowledge (the untouched Topic Context) to explain it live — while keeping
the compact per-topic knowledge base fully intact. Failure mode without this
change: Clio continues to sound scripted, and adaptive-response quality is
capped at 7 predefined branches instead of genuine judgment.

## What Success Looks Like
- A new env var flag (naming is the BA's call, following the
  `NEXT_PUBLIC_VOICE_PROVIDER` / `NEXT_PUBLIC_HUME_NATIVE_ENABLED` pattern),
  default OFF.
- OFF (default): Hume-native sessions are byte-identical to today — full
  `buildSessionScript()` output included in `[SESSION CONTENT]`, exactly as
  now. This must be a checkable, explicit acceptance criterion, not assumed.
- ON: Hume-native sessions instead get a compact, per-topic summary in
  `[SESSION CONTENT]` in place of the full script — topic titles, what to
  cover, and whatever section-index information `show_visual`/`advance_tab`
  need (rules 3/5 of the existing prompt) to keep firing correctly — with an
  accompanying prompt instruction that gives Clio explicit permission and
  direction to teach live from the Topic Context using the summary as
  structure, since today's framing assumes a full script exists.
- The checkpoint question and Clio's response to the participant are fully
  improvised — no 7-variant block is present in the summary-driven prompt.
  Already-existing prompt rule 4 ("listen to the answer and respond
  naturally...") already covers the judgment call and is untouched.
- Flipping the toggle OFF at any point in production returns to today's
  current behavior with no code change required — stated as an explicit,
  testable acceptance criterion.
- The new summary-driven mode is a complete, self-sufficient alternative on
  its own — every acceptance criterion must be checkable against a real,
  working end-to-end session, not just "the prompt is shorter."

## Known Constraints (do not expand scope)
- `buildTopicContext()` — completely unchanged. Do not touch.
- Pacing / per-section word-time budgets — explicitly OUT OF SCOPE for this
  spec. Hume-native has zero per-section time budget today (unlike
  `buildSessionBrief()`'s "~X min per section" for the standard pipeline) —
  a real gap, but a separate future decision. Do not add pacing/budget
  language to the new summary.
- Checkpoint-variant redesign (new rules for judging/responding to answer
  quality) — explicitly OUT OF SCOPE. Do not design new adaptive-response
  rules. Just remove the 7 hardcoded variants; existing prompt rule 4 already
  covers improvisation at a high level and stays untouched.
- The shipped `SESSION-END-01` closing/`end_session` mechanism, rule 8, and
  all other fixed prompt-preamble rules (1-3, 5-7, 9-10) — completely
  unchanged.
- Scope is Hume-native only — same precedent as `SESSION-END-01`. Do not
  touch the ElevenLabs or Hume-Custom-LLM paths. `buildSessionScript()`
  itself must keep its existing behavior unchanged for those other callers
  (it's called directly by ElevenLabs/Custom-LLM code paths, and internally
  by `provision-config/route.ts`'s own self-heal pre-check — verify all
  callers before changing anything). This needs a NEW code path or an
  additive mode parameter for Hume-native specifically — never a
  behavior change to the existing function for its other callers.

## Non-negotiable: avoid repeating the ONDEMAND-02 failure mode
`docs/action-items.json` id `session-terminates-after-overview` /
`.claude/agents/clio/feature-briefs/ONDEMAND-02-session-ends-after-overview.md`
documents a directly relevant cautionary precedent: `LIVE_CONDUCTOR_ONDEMAND_TEST`
stripped session content down to less than the full picture, relying on a
mid-call backfill mechanism (`advance_tab`) that was never actually
instructed/invoked — sessions using that toggle broke outright (call ended
right after the Overview). Read that entry in full before writing the spec.

The BA's spec for this feature must explicitly design against repeating this
exact failure mode: whatever summary-driven mode ships must be a complete,
working alternative on its own, never a half-wired variant that silently
depends on something else happening that isn't actually instructed to
happen. This is a hard requirement on the spec, not a suggestion — call it
out as its own acceptance criterion.

## Grounding already gathered (do not re-derive — use this)
I read the actual current source before writing this brief:
- `lib/clio-context-builder.ts` — confirms `buildSessionScript()` and
  `formatSingleSectionScript()` (split-mode single-tab variant) both take
  `trainingScripts: (TrainingScript | null)[]` and render TEACH / CHECKPOINT
  (+7 variants) / PROBE / CONTINUE per section with explicit
  `--- SECTION i/total ---` headers and inline
  `[call show_visual({ section_index: i })]` instructions. `buildAllClioDocs()`
  already supports an `'all-upfront' | 'split'` mode parameter — worth
  checking whether that pattern (or a new third mode) is the cleanest fit,
  rather than assuming a brand-new function is required.
- `app/api/hume-native/provision-config/route.ts` — confirms exactly where
  `sessionContent` is assembled (lines ~376-380, and duplicated in the
  self-heal pre-check at ~148-152 and recheck at ~311-315 — note there are
  THREE call sites building this concatenation in this one file, not one; the
  BA must account for all three or explain why the pre-check/recheck ones
  don't need the same toggle-awareness).
- `lib/voice/hume-native/prompt-template.ts` — confirms the fixed prompt
  preamble (rules 1-10), the `[SESSION CONTENT]` placeholder mechanism via
  `assembleHumeNativePrompt()`, and the ~7,000-char voice-styling guardrail
  that must not be broken by any change to block ordering/length.
- Supabase `topic_content_cache` table (project `nqxlpcshouboplhnuvrh`)
  schema and live rows confirm: `content_outline` (jsonb) already stores a
  structured `content_article.sections` object per subtopic today —
  `overview`, `try_this`, `key_facts`, `how_it_works`, `decision_questions`,
  `illustrative_example`, `common_misconceptions`, `enterprise_implications`,
  `industry_angle`, `role_relevance` — real, populated data, not
  speculative. `subtopic_title` is also stored directly on the row. This is
  a strong candidate source for the compact summary's "what to cover" text
  without any new generation step — the BA should evaluate using
  `content_outline.content_article.sections.overview` (and/or `key_facts`)
  plus `subtopic_title`, rather than defaulting to inventing new generation.
  Note: `topic_context_doc` on this same table was NULL on all 5 rows
  sampled — the real topic context doc appears to be sourced elsewhere at
  runtime (matches `provision-config/route.ts`'s own
  `formatTabContentForPrompt(tab)` / `live_conductor_content` sourcing, not
  this column) — don't assume this column is populated; verify before
  relying on it.

## Questions for BA
1. **Summary format** — design the exact compact per-topic summary content
   and template. Ground it in the real `content_outline` structure above.
   Prefer reusing existing data over adding a new generation stage if at all
   possible. State plainly if a new lightweight derivation step is
   unavoidable and why.
2. **Prompt instruction change** — draft the exact new instruction text that
   accompanies the summary (replacing the framing that assumes a full script
   exists), giving Clio explicit permission/direction to teach live from
   Topic Context using only the summary as structure.
3. **show_visual/advance_tab index continuity** — confirm and document
   exactly what section-index information the summary must carry so rules
   3/5 keep firing correctly with only a summary in hand (no literal script,
   but the right indices).
4. **Where this branches in code** — propose the cleanest implementation
   (new function vs. mode parameter vs. extending `buildAllClioDocs`'s
   existing mode enum) covering all three `sessionContent`-assembly call
   sites in `provision-config/route.ts`, without altering
   `buildSessionScript()`'s existing behavior for ElevenLabs/Hume-Custom-LLM
   callers.
5. **Toggle name and mechanics** — confirm the exact env var name, confirm
   default OFF, and confirm exactly where the branch is read (server-side
   only, since this is assembled in an API route).
6. **Rollback safety** — state as an explicit, testable acceptance criterion
   that flipping the toggle OFF produces byte-identical output to today's
   current behavior.
7. **ONDEMAND-02 anti-pattern check** — explicitly document how this spec's
   design avoids the exact failure mode in that incident (half-wired
   dependency on an uninstructed follow-up action).

## Process
Write the full 12-section Requirement Document (wireframes N/A — no UI).
Section 11 (Open Questions) must be empty before this returns to CEO for
approval. Suggested id: `SESSCTX-01-summary-driven-session-context`.
