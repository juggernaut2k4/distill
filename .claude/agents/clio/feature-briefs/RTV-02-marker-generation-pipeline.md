# Feature Brief: RTV-02 — Marker-Generation Content-Authoring Pipeline
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-09

## Series context
Phase 2 of five. Authoritative requirements:
`docs/brainstorm-realtime-transcript-driven-visualization.md` Section 7. This
brief covers **requirement #3 (unique keyword/marker generation algorithm), #5
(prerequisite state), #17 (bookend Overview/Summary marker handling), and the
authoring-time + KB-storage portions of #9/#15/#20**. It does NOT cover the
live tracker (RTV-03), templates (RTV-04), or display (RTV-05). This phase
produces DATA ONLY — a marker set stored per topic. Nothing runs live, nothing
is displayed. It is safe to build and ship inertly.

Scope guardrail: Hume-native summary-mode only (#16). The markers are for
identifying which of a session's non-bookend topics is currently being taught.

## What Arun Said
The tracker identifies the current topic by watching Clio's live speech for
**session-specific, deliberately-distinctive keyword markers**. Those markers
must be generated automatically per session (not hand-curated). Arun refined
the algorithm across several rounds; the FINAL, resolved version (requirement
#3) is:

A candidate word qualifies as a marker only if it passes **all three** checks:
1. **Noun / specific named thing or technical term** — not descriptive or
   paraphrasable language. (Semantic judgment — LLM.)
2. **"Cannot-miss" test** — the topic literally cannot be taught without saying
   it. (Semantic judgment — LLM.)
3. **Corrected uniqueness rule (deterministic, no LLM):** count how many
   *different topics* in the session the word appears in — grouped by topic,
   NOT raw total occurrence count. It qualifies only if it appears in exactly
   ONE topic. A word repeated many times within its one home topic and never
   elsewhere is the **strongest possible signal ("golden word")** and gets top
   priority — more repetition inside its home topic is a plus, never a
   disqualifier.

Other resolved specifics from Arun:
- **Source is Session Content ONLY** — the "what to cover" text that
  `buildSessionSummary()` already produces per topic. **Never** the richer
  Topic Knowledge Base (`buildTopicContext()` / `topic_context_doc`). This was
  an explicit correction — do not source markers from the KB doc.
- **No artificial target count** per topic — however many words naturally
  qualify is that topic's marker set.
- **Detection is single-hit-decisive** (this affects RTV-03, but the marker set
  must be authored to support it): one hit of any one qualifying marker is
  sufficient and decisive; no corroboration. So marker quality matters more
  than quantity — every marker in the set must be safe to act on alone.
- **NO FALLBACK ALLOWED (hard guarantee, explicit).** Every topic must always
  have at least one qualifying golden word. If the deterministic check finds
  zero qualifying words for a topic, the content-authoring process must
  **actively rework that topic's Session Content wording** (or re-run
  extraction with a deliberate instruction to surface/insert a genuinely unique
  named term) until at least one word passes all three checks — before that
  topic is considered ready. A topic is NEVER allowed to ship with zero
  coverage. This is a hard requirement, not a soft degrade.
- **Bookends (Overview / Summary) — requirement #17:** NO content-based marker
  extraction. Skip the three-check pipeline entirely for these two. Instead the
  marker for each is simply the literal word "Overview" / "Summary" — safe
  because there is exactly one of each per session and it can't collide with
  real topic content. (The prompt instruction that makes Clio actually *say*
  those words is RTV-03's job; RTV-02 only records that the bookend markers ARE
  those literal words in the stored marker data.)
- **Saved once per session/topic, reused if that exact session is reused**
  (#9/#15). Only the marker set is saved — this phase saves no filled visual
  content (#20 governs template content, not markers; markers themselves are
  legitimately persisted).

## The Problem Being Solved
The live tracker (RTV-03) cannot exist without a reliable, per-topic set of
distinctive markers to listen for. Generic/common words would cause false
topic-transition signals (wrongly concluding a topic changed, or the session is
ending). This phase produces the high-precision marker sets that make
single-hit-decisive detection safe. The no-fallback rework guarantee is what
lets RTV-03 promise a tight, bounded worst case rather than silent wrong output.

## What Success Looks Like
- At content-authoring time, for every non-bookend topic in a summary-mode
  Hume-native session, a marker set is derived from that topic's Session Content
  ("what to cover" text) via the exact three-check algorithm above, and stored
  in the knowledge base keyed to the topic.
- The two bookends carry their literal-word markers ("Overview" / "Summary") in
  the same stored structure, without running the three-check pipeline.
- The no-fallback guarantee holds: no topic is ever marked ready with an empty
  marker set. The rework/re-extraction loop is real, bounded, and testable —
  the BA must define exactly how many rework attempts, what the re-extraction
  instruction is, and what happens if it still fails (this must NOT be "ship
  empty" — propose the correct hard-stop, e.g. flag the session as not ready
  for the RTV series and fall back to today's `show_visual`-driven behavior for
  that session, which is always safe because RTV-05's display toggle defaults
  OFF).
- Marker sets are inspectable (for QA and for Arun) — a way to see, for a real
  session, each topic and its golden words.
- Toggle-gated / additive, default OFF, following the established pattern.
  Generating and storing markers must not alter any existing content-authoring
  output when off. When on, it is purely additive data — existing
  session content, scripts, and KB are untouched.
- Precision over recall is the explicit design bias — a smaller set of truly
  golden words beats a larger set with borderline ones, because RTV-03 acts on
  a single hit.

## Known Constraints (do not expand scope)
- Source text is Session Content only (`buildSessionSummary()`'s per-topic
  "what to cover"). Do NOT read from `buildTopicContext()` /
  `topic_context_doc`. Verify exactly what text `buildSessionSummary()` emits
  per topic and treat that as the sole marker source.
- Do not build the live tracker, prompt instructions, templates, or display
  here. Storing the bookend literal-word markers is in scope; making Clio say
  them is not.
- Do not regress existing content generation. Per the standing rule
  (`feedback_no_impact_existing_no_delete.md`): never regress topic selection /
  LLM topic gen / session gen; flag any needed existing-code change; never
  delete code without explicit approval.
- Check 3 must be implemented deterministically (grouped-by-topic counting), NOT
  via LLM. Only checks 1 and 2 use the LLM. Document the split precisely.

## Grounding already gathered (do not re-derive — use this)
- `lib/clio-context-builder.ts` — `buildSessionSummary()` (~line 336) is the
  producer of the per-topic "what to cover" text (`extractWhatToCover()`,
  ~40-word / ~260-char compact line per non-bookend topic). This is the marker
  source. Bookends are special-cased there (`SessionOverview`/`SessionSummary`,
  `getBookendScript()`) — these are the two that get literal-word markers
  instead. Confirm the exact string each non-bookend topic contributes.
- `topic_content_cache` table (project `nqxlpcshouboplhnuvrh`) is the natural
  storage home: it is keyed by `topic_id` + `subtopic_slug`, already stores
  per-subtopic `template_type`, `section_data`, `content_outline`,
  `training_script`, `tab_manifest`, `subtopic_title`. A NEW column (e.g.
  `topic_markers jsonb`) fits here — one marker set per subtopic row, decided
  once, reused. Confirm this is the right table vs. `sessions.live_conductor_content`
  or `walkthrough_state.sections`, and propose the exact column + shape. Note
  the same content also flows through `walkthrough_state.sections` /
  `training_scripts` and `sessions.live_conductor_content` at runtime — the BA
  must decide the single canonical storage location and how RTV-03 will read it.
- The content-authoring pipeline that populates these rows:
  `inngest/session-content-pipeline.ts`, `lib/content/live-conductor-content.ts`
  (`generateLiveConductorContent`), and the self-heal path in
  `app/api/hume-native/provision-config/route.ts` (~line 173+) that regenerates
  content on demand. The marker-generation step must hook into wherever Session
  Content becomes final, and must cover the on-demand self-heal path too (or
  explicitly document why that path defers to today's safe `show_visual`
  behavior). Verify all producers before choosing the hook point.
- Anthropic SDK usage pattern: existing content generators use
  `@anthropic-ai/sdk` with `claude-sonnet-4-6`. Reuse that for checks 1 & 2.

## Questions for BA
1. **Exact algorithm spec.** Tokenization of the Session Content per topic; how
   checks 1 & 2 are prompted to the LLM (single call across all topics vs.
   per-topic); how check 3's grouped-by-topic uniqueness count is computed
   deterministically over the tokens; how golden-word priority (repetition
   within home topic) is scored/ordered. Include worked pseudocode.
2. **The no-fallback rework loop.** Exact mechanics: how a zero-marker topic is
   detected, what the re-extraction / rework instruction to the LLM is, the
   bounded number of attempts, and the correct hard-stop behavior if it still
   fails (propose: flag session as RTV-ineligible → RTV-05 display toggle stays
   effectively OFF for it → today's safe `show_visual` path). Never "ship empty."
3. **Storage.** Confirm `topic_content_cache.topic_markers jsonb` (or your
   proposed alternative). Exact JSON shape — per-topic markers, golden-word
   ranking, and the bookend literal-word entries. How RTV-03 will key into it
   from the live runtime (`walkthrough_state` / `sessions`).
4. **Hook point.** Exactly where in the authoring pipeline marker generation
   runs (including the self-heal path), and the toggle that gates it.
5. **Bookend handling.** Confirm the two bookends get literal-word markers
   stored without the three-check pipeline, per #17.
6. **Inspectability.** How markers are surfaced for QA/Arun review (e.g. an
   admin/debug read path or a documented SQL query).
7. **Toggle + rollback.** Exact env var name, default OFF, explicit acceptance
   criterion that OFF leaves all existing content-authoring output unchanged.

## Process
Write the full 12-section Requirement Document (no user-facing UI in this phase
except the inspectability read path — document that concretely). Section 11
must be empty before returning to CEO. Suggested id:
`RTV-02-marker-generation-pipeline`.
