# Feature Brief: B2B-59 — Transition-marker phrase flagged as a false "glitch"

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-30

**Numbering note:** the dispatch instruction assumed "B2B-60" as the next ID. I checked
`docs/b2b-pivot-status.md` and `.claude/agents/clio/feature-briefs/` directly — the highest ID in
both is B2B-58. This brief is **B2B-59**.

---

## What Arun Said

On a real live call, Clio said "cobalt-kestrel-8068" mid-sentence while transitioning between
topics. The post-session AI glitch-extraction flagged it as an anomaly: "appears to be a system
artifact or ID that leaked into the response." Arun asked for root cause, a confidence level, and a
proposed approach — for his review and approval tonight, before anything is built overnight.

## Root Cause — independently re-verified against live code, not taken on faith

**Confirmed. This is not a bug — it is the transition-marker system (B2B-19, built on RTV-02/03
machinery) working exactly as designed.**

- `lib/content/transition-markers.ts` lines 25-31: `MARKER_WORDS` contains both `'cobalt'` and
  `'kestrel'`, literally.
- Line 76: the numeric tag is generated as `1000 + randInt(9000)` — a 4-digit range that "8068"
  falls squarely inside.
- `generateTransitionMarker()` (lines 67-82) combines two distinct words from that list + the tag
  into exactly the `word-word-####` shape Arun heard.
- The marker is deliberately "near-zero natural occurrence" (module doc comment, line 10) so a
  single hit is safe to advance a page on — that is the entire point of the design.
- `lib/partner/live-render.ts` lines 621-640 (`buildInlineSessionContent`) confirms Clio is
  explicitly instructed, per page, to "say this exact phrase naturally as part of your sentence"
  at the transition point, then call `advance_tab`. This is a **stage direction**, not a leak — the
  system is telling Clio to say it on purpose.
- `PartnerRenderClient.tsx` (`onMessage`, lines 222-231; `matchesTransitionMarker` import) confirms
  the client is watching Clio's own live speech for exactly this phrase to trigger the page advance.

**One correction to the framing in the dispatch instruction, worth being precise about:** the
transcript-watch is not "a redundant fallback alongside the advance_tab tool call" — per the
approved B2B-19 requirement doc (`docs/specs/B2B-19-requirement-document.md`, State C3 / Q-B
resolution, line 338), transcript-watch is the **primary** signal and the `advance_tab` tool-call is
the **backup**. `PartnerRenderClient.tsx` line 222's own comment says the same
("transcript-watch (primary signal, inline only)"). This matters for the trade-off below — dropping
the spoken marker doesn't fall back to a secondary system, it promotes the current backup to sole
authority.

**The AI-generated glitch classification is wrong, not Clio.** The extraction prompt
(`inngest/partner-session-insights-extractor.ts`, `PARTNER_INSIGHTS_SYSTEM_PROMPT`) has no awareness
that this phrase pattern is expected system behavior — it's reading the transcript cold and
correctly concluding, from a naive read, that a random-looking token doesn't belong there. From a
real listener's perspective it's genuinely jarring even though the system worked correctly.

**Confidence: high.** Word-list match, tag-range match, prompt-instruction text, and dual-signal
wiring are all confirmed directly in the current code, not inferred.

**Scope check — who actually sees this:** I checked whether the flagged glitch (or the transition
marker phrase generally) reaches partners. It does not, currently. `lib/partner/webhooks.ts` lines
791-801 confirms B2B-53 deliberately removed `glitches` from the reseller-facing webhook payload —
it is internal-only (`partner_session_insights.glitches`, `/dashboard/admin/glitches`). So tonight's
issue is Arun's own visibility into session quality being polluted with a false-positive, not a
partner-facing defect today. Worth knowing in case B2B-53's decision is ever revisited.

## The Problem Being Solved

Two distinct problems, and they don't necessarily need the same fix:

1. **Live listening experience:** a human on the call hears an out-of-nowhere, nonsense-sounding
   phrase mid-sentence. This is inherent to the marker design — it exists specifically *because* it
   must sound unlike anything else Clio would organically say.
2. **Post-session reporting accuracy:** the glitch-extraction model has no way to distinguish "system
   artifact working as intended" from "real conversational breakdown," so it puts expected system
   behavior in the same bucket as real problems — degrading the signal quality of the one tool Arun
   uses to catch actual issues.

## What Success Looks Like

Arun stops seeing this specific, expected, by-design phrase pattern show up dressed as an anomaly in
his glitch review — without weakening the page-sync reliability the marker system exists to
guarantee, and without a same-night change to a load-bearing live-voice mechanism that we don't yet
have reliability data to evaluate.

## Options Considered (for Arun's decision, not mine to make)

**Option A — Do nothing / accept it.**
This was a deliberate, CEO+BA-approved trade-off (B2B-19 Q-B, dual-signal design). It fires once per
page transition, is rare in absolute listening time, and reliable page-sync is the priority. Valid
if Arun decides the live-experience cost is acceptable and the only real complaint is the report
noise (which Option D below fixes independently).

**Option B — Drop transcript-watch, rely solely on `advance_tab`.**
Removes the need to speak anything unnatural. **I do not recommend this tonight.** Two reasons,
both concrete:
- Transcript-watch is the *primary* signal today, not a redundant backup — this would promote the
  tool-call path from backup to sole authority, a bigger behavioral change than it first sounds.
- `advance_tab`/`show_visual` has an active, recent reliability history: commit `0f967e7` (today,
  B2B-58) fixed `show_visual` force-advancing the page *ahead* of narration because it was wired
  identically to `advance_tab`. Tool-call-driven advance has just had a real bug in this exact area.
- There is **no logging today** of which signal (transcript-watch vs. tool-call) actually fires a
  given advance — I checked `PartnerRenderClient.tsx`'s `advanceOnTransition()` and there is no
  instrumentation distinguishing the two paths. We have zero data on how often transcript-watch is
  the one that saves a transition advance_tab alone would have missed. Recommend closing that gap
  (cheap, non-behavior-changing) before ever making this call with confidence.

**Option C — Make Clio deliver the phrase more naturally.**
Checked the actual instruction (`lib/partner/live-render.ts` line 632/638): it currently says only
"say this exact phrase naturally as part of your sentence" — no guidance on tone, pacing, or
embedding technique. There is room to try softer delivery guidance, but I'm skeptical it moves the
needle much: "cobalt-kestrel-8068" is two uncommon nouns plus a random number by design (that's what
makes it safe to trigger on) — no delivery instruction makes an invented phrase parse as real
language. Reasonable as a cheap, low-priority experiment; not a fix I'd bet on.

**Option D — Stop the false-positive at the glitch-extraction step (new option, not in the original
menu).**
The extraction prompt in `inngest/partner-session-insights-extractor.ts` has no knowledge of the
transition-marker pattern. Two ways to fix this, either cheap and reversible:
- Strip/mask known transition-marker phrases from the transcript text before it's handed to the
  extraction model, since we know exactly what they look like and where they were injected
  (`transition_marker` is already stored per page).
- Or give the extraction system prompt explicit awareness of the marker format so it stops
  classifying an expected system phrase as a "system artifact or ID that leaked."
This fixes exactly the thing Arun reacted to tonight (a scary-looking flagged anomaly) with **zero
risk to the live page-sync mechanism**, since it touches only the after-the-fact reporting pipeline,
not anything spoken live or anything users on the call hear.

## My Recommendation

**Do Option D tonight (fix the false-positive at the glitch-extraction layer), plus add the missing
signal-source logging described under Option B, and leave the live marker/dual-signal mechanism
itself untouched for now.**

Reasoning: the two things bundled into "cobalt-kestrel-8068 is a glitch" are actually different in
urgency and risk. The report-pollution problem (a false-positive anomaly cluttering Arun's glitch
review) is real, annoying, cheap to fix, and zero-risk to touch. The live-voice-UX trade-off
(whether Clio should ever have to say something unnatural) is a real product question, but changing
it tonight would mean altering a load-bearing, already-approved reliability mechanism (Q-B) on the
same day its backup signal (`advance_tab`) had a bug fixed — that is exactly the kind of decision
that benefits from a data-informed second look, not an overnight patch. Add the logging now,
observe for a stretch of real sessions, then revisit Option B/C with actual signal-reliability data
instead of a guess.

Option A stays available as a no-build fallback if Arun would rather not touch even the reporting
layer tonight — the underlying mechanism is correct either way and nothing is actually broken in the
live product.

## Known Constraints

- Do not touch the dual-signal transition-advance mechanism itself (`PartnerRenderClient.tsx`,
  `lib/partner/live-render.ts` marker injection, `lib/content/transition-markers.ts`) beyond adding
  passive logging — it is a CEO+BA-approved, working reliability system (B2B-19 Q-B), not a bug.
  Any change to *whether/how* the marker is spoken or detected is a live product/UX decision that
  needs its own BA spec, not a same-night patch.
- `glitches` is internal-only (not partner-facing) as of B2B-53 — this is not an external quality
  incident, keep scope internal-tooling-sized accordingly.
- Whatever masking/awareness logic is added to the extractor must not suppress *real* glitches that
  happen to contain uncommon words — scope the fix narrowly to the known transition-marker shape
  (two `MARKER_WORDS` tokens + a 4-digit tag in the marker's known range), not "any short nonsense
  string."

## Questions for BA

1. For Option D's masking approach: should the transcript fed to the extractor have the exact stored
   `transition_marker` string for each page stripped out entirely (cleanest, but requires threading
   per-session marker list into the extractor job), or should the extraction system prompt instead
   be given a general pattern description (two uncommon words + 4 digits) to recognize and exclude
   at classification time (simpler, no new data plumbing, slightly less precise)? Recommend a
   default and confirm.
2. For the signal-source logging: where should it land — a new column on
   `partner_session_insights`/an existing session-events table, or a lightweight `reportClientError`
   -style fire-and-forget log entry (matching the existing B2B-49 diagnostic pattern already in
   `PartnerRenderClient.tsx`)? Recommend reusing the existing diagnostic-reporting pattern rather
   than a new table, given this is observability, not a feature.
3. Confirm scope boundary: this brief covers only stopping the false-positive glitch classification
   + adding observability. Any change to the marker's live delivery (Option C) or to which signal is
   primary (Option B) is explicitly out of scope pending real data and a separate Arun decision.
