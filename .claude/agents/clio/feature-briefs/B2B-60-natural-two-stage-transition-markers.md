# Feature Brief: B2B-60 — Natural two-stage transition markers (replaces random-word marker)

From: CEO (Arun)
To: Developer Agent (direct build — see Governance Call below)
Priority: P1
Date: 2026-07-30

**Numbering note:** checked `docs/b2b-pivot-status.md` (highest B2B ID referenced: B2B-58) and
`.claude/agents/clio/feature-briefs/` directly (highest file: B2B-59, tonight's sibling brief on the
same mechanism). This brief is **B2B-60**.

**Relationship to B2B-59:** B2B-59 (`B2B-59-transition-marker-glitch-misclassification.md`) diagnosed
"cobalt-kestrel-8068" as the random-marker system working as designed, and left the live
marker/detection mechanism untouched, recommending only a reporting-layer fix. Arun read that and
overrode it directly: replace the live mechanism itself with a natural two-stage design. That
override is **approved and in scope here**. B2B-59's own sibling fix (a shared 2-second debounce
across both advance signals, tracked as B2B-59's implementation — tests already exist at
`tests/unit/b2b59-advance-debounce.test.ts` and the pure decision module already exists at
`lib/partner/advance-transition.ts`, ahead of `PartnerRenderClient.tsx` actually importing it) is a
**separate, still-pending build** this brief must compose with, not duplicate or conflict with.

---

## What Arun Said (verbatim)

> 1. clio starts with screen 1. it is loaded and clio starts speaking about it.
> 2. then once the content is done, it says 'In Summary' or something likes this. This becomes
>    Marker 1 and it wakes up clio to listen in for Marker 2
> 3. Marker 2 is the title of the next screen. after giving the summary, it says going to next
>    topic, now next topic word becomes the marker 2 and when that is said, it triggers the move to
>    next page.

"Proceed as above" — approved.

## The Problem Being Solved

The current mechanism (`lib/content/transition-markers.ts`, B2B-19) advances pages when Clio speaks
a system-generated, deliberately unnatural two-word-plus-digit phrase (e.g.
"kestrel-vellum-9471") that she's instructed to insert mid-sentence at every transition. It works
reliably, but it means real participants hear a nonsense phrase on every single page change, and
tonight it got flagged (wrongly) as a glitch in Arun's own quality review. Arun wants the trigger
phrase replaced with something Clio would say anyway as part of natural narration — a wrap-up cue,
then the next section's real title — so the mechanism disappears into the conversation instead of
interrupting it.

## What Success Looks Like

Every live-session page transition still fires reliably (no regression against the current dual-signal
system: transcript-watch + `advance_tab` tool-call, whichever fires first, forward-only, idempotent),
but the words Clio says to trigger it are ordinary narration — a short fixed wrap-up line, followed
naturally by her introducing the next section by its real name — with no synthetic phrase audible to
the participant on non-final pages, and a cleaner (not redundant) close on the final page.

## Technical Design

### 1. Stage 1 — the fixed wrap-up phrase

**Recommendation: do NOT use Arun's literal "In summary" verbatim. Use instead:**

> **"That covers what I wanted to walk through here."**

**Reasoning (this is a real, non-cosmetic risk, not a style preference):** "In summary" is exactly
the kind of phrase a warm advisor voice narrating **business/AI content** says organically and
often — mid-explanation, when wrapping a sub-point inside a chart or framework, not only at genuine
section-end. That's a materially different risk profile from the old system, where "near-zero
natural occurrence" came from using genuinely rare words (kestrel, vellum, basalt, ...). A fixed
phrase can't get that same protection from word rarity — "summary" is core vocabulary in exactly the
content domain Clio teaches. The replacement phrase keeps the same *intent* (a natural "I'm wrapping
up" cue) but is self-referential/discourse-level ("what I wanted to walk through here" — a comment
about the conversation itself) rather than generic business vocabulary, which real subject-matter
narration essentially never produces as a contiguous clause. It is also intentionally free of
contractions (no "that's") for cleaner ASR/matching behavior (see §3).

Confirmed: this is **one fixed string, shared across every transition, every session, every
partner** — not per-page, not per-partner-configurable. That's the correct read of Arun's design (a
generic "I'm wrapping up" cue, not content-specific), and it's also an important architectural
constraint worth stating explicitly: **because it's fixed and global, there is no per-session
"regenerate on collision" escape valve** the way the old random-marker system had
(`generateTransitionMarker`'s retry loop). The wording has to be safe for all partner content
forever, not verified per-session. See §5 for the lightweight, non-blocking mitigation for this.

### 2. Stage 2 — the next page's title

Confirmed available in advance for inline-mode sessions, not generated live: `content_pages[i].title`
is supplied by the partner in the original `POST /sessions` payload
(`app/api/partner/v1/sessions/route.ts` line ~166), persisted on the `partner_sessions` row, and
read back into `InlineContentPage`/`InlinePageProp.title` (`lib/partner/live-render.ts` line ~234,
234-236) fully resolved before the prompt is assembled and before the client ever renders. Nothing
about Stage 2 requires new data.

**Collision / reliability risk — real, and needs a per-transition eligibility gate, not a blanket
assumption it's always safe:**
- Two pages in the same session can have identical or near-identical titles (partner-authored
  content, no uniqueness guarantee today).
- A title can be too short/generic to be a reliable spoken-trigger ("Overview", "Next Steps",
  "Q&A") — high odds of appearing elsewhere in the session (agenda preview, an earlier page's own
  title, casual mention).
- A title's words can independently appear in another page's narration (`content_text`), subtitle,
  or `transition_trigger`, or in the session-level `content_to_explain`/title/subtitle.

**Design: reuse the existing collision-check *pattern*, adapted.** `generateTransitionMarkers()`
already builds a `forbidden` word set from every page's title/subtitle/`transition_trigger` plus
session narration, and checks candidate words against it (`lib/content/transition-markers.ts` lines
97-104). Add a new, client-safe function in the same module using the identical scope of source
text:

```ts
export interface EligibilityPageInput {
  title: string | null
  subtitle?: string | null
  transitionTrigger?: string | null
}

/**
 * Per-transition (i.e. "advancing FROM page i") eligibility for Stage-2 transcript detection.
 * Returns an array of length pages.length; index i is true iff page i+1's title is distinctive
 * enough (>=1 word token of length >=4) AND none of its word tokens collide with any OTHER
 * page's title/subtitle/transitionTrigger or the session narration. The LAST index is always
 * false (no next page to detect — see §4). Ineligible transitions simply fall back to the
 * existing advance_tab tool-call as the sole advance signal for that specific transition; nothing
 * else in the dual-signal system changes.
 */
export function computeStage2Eligibility(pages: EligibilityPageInput[], narrationText: string): boolean[]
```

This is computed **once, from data already available on both sides of the client/server boundary**
(same `pages`/`inlinePages` array both `buildInlineSessionContent` and `PartnerRenderClient.tsx`
already receive in full) — no new DB column, no new persistence, no schema change. Both call sites
derive the identical answer from the identical inputs, so the prompt (what Clio is told) and the
client (what it listens for) can never drift out of sync.

**Important, deliberate scope decision:** the prompt instruction to Clio is **the same regardless of
eligibility** — she always says the wrap-up phrase and then naturally names the next section, on
every transition, for a consistent listening experience. Eligibility only ever changes what the
*client* trusts as a detection signal; it never changes what Clio is told to say. This keeps the
prompt simple (no per-transition prompt branching to get wrong) and means an ineligible transition
degrades to exactly today's `advance_tab`-only reliability — never worse.

### 3. Matching logic — this is the most important technical catch in this brief

The existing `matchesTransitionMarker()` does **word-set matching**: every marker word must appear
*somewhere* in the utterance, in *any order*, with *no adjacency requirement*. That's safe for the
old system only because the words themselves (kestrel, vellum, ...) are rare enough that the set
membership check alone is the whole safety margin. **It is not safe to reuse for natural-language
phrases.** A phrase like "That covers what I wanted to walk through here" tokenizes to common words
(that, covers, what, wanted, walk, through, here); under pure set-matching, any utterance that
happens to contain all of those words *scattered anywhere, in any order* — entirely plausible over a
long enough stretch of narration — would false-fire. Reusing `matchesTransitionMarker` as-is for
Stage 1/Stage 2 would silently reintroduce a worse version of the exact problem this brief exists to
fix.

**New function required**, same module, order- and proximity-aware instead of pure set membership:

```ts
/**
 * True iff `phrase`'s word tokens appear in `spokenText` as an ordered, bounded-proximity
 * subsequence — each successive phrase word must be found within `maxGap` tokens of the previous
 * match (default 3), preserving relative order. Stricter than matchesTransitionMarker's pure
 * set-membership check by design: natural-language phrases reuse common words constantly, so
 * safety here comes from requiring the words to actually appear together, in order, the way the
 * phrase would be spoken — not from word rarity. Used for Stage 1 (fixed phrase) and Stage 2
 * (next-page title) detection; matchesTransitionMarker is unchanged and untouched, and is no
 * longer used for any live spoken-transcript matching (see §6).
 */
export function matchesSpokenPhrase(spokenText: string, phrase: string, maxGap = 3): boolean
```

Tokenization reuses the existing `wordTokens()` internal helper (lowercase, alphabetic, length >= 3
— already strips most filler words as a side effect, which also improves ASR-variance tolerance).
Unit tests should cover: exact match; match with 1-2 filler words inserted between phrase words
(ASR noise tolerance); no match when words are present but scattered far apart or out of order
(the specific failure mode this function exists to prevent); no match on partial phrase.

### 4. The two-stage "arm then trigger" state machine

New ref in `PartnerRenderClient.tsx`, alongside the existing `firedMarkersRef`/`activeIndexRef`:

```ts
const stage1ArmedRef = useRef(false)
```

`stage2EligibleRef` — computed once from `inlinePages` (stable prop for the session's lifetime), via
`computeStage2Eligibility`.

New `onMessage` body for inline mode (replaces the current single `matchesTransitionMarker` check):

```ts
const onMessage = isInline
  ? (text: string, source: string) => {
      if (source !== 'ai' || !text) return
      const idx = activeIndexRef.current
      const page = inlinePages![idx]
      if (!page) return
      if (idx === count - 1) return // last page — no Stage 2 target; see §4a
      if (!stage2EligibleRef.current[idx]) return // collision/too-generic — advance_tab is sole signal here

      if (!stage1ArmedRef.current) {
        if (matchesSpokenPhrase(text, STAGE_1_WRAP_UP_PHRASE)) stage1ArmedRef.current = true
        return
      }

      const nextTitle = inlinePages![idx + 1]?.title
      if (nextTitle && matchesSpokenPhrase(text, nextTitle)) {
        advanceOnTransition(page.transitionMarker) // resets stage1ArmedRef — see below
      }
    }
  : () => {}
```

`advanceOnTransition()` gains one line, reset on every successful advance regardless of which signal
fired it (transcript path above, or the unchanged `advance_tab` tool-call path) — so a stale armed
state can never leak into the next page's transition:

```ts
function advanceOnTransition(transitionMarker: string) {
  if (!shouldAdvanceOnTransition(transitionMarker, Date.now(), firedMarkersRef.current, lastAdvanceAtRef)) return
  stage1ArmedRef.current = false // B2B-60 — reset two-stage arm state on every real advance
  const next = Math.min(activeIndexRef.current + 1, count - 1)
  goToSection(next)
}
```

**Composes cleanly with the B2B-59 debounce work already staged**: that work's contract
(`lib/partner/advance-transition.ts`'s `shouldAdvanceOnTransition`, and the pinned test
`tests/unit/b2b59-advance-debounce.test.ts`) expects `advanceOnTransition(transitionMarker: string)`
to call `shouldAdvanceOnTransition(transitionMarker, Date.now(), firedMarkersRef.current,
lastAdvanceAtRef)` and then `goToSection(next)`. This brief does not change that signature or that
call — it only adds the `stage1ArmedRef.current = false` line between them, which is additive and
doesn't touch either pinned assertion. **Deliberate compatibility decision**: `page.transitionMarker`
(the per-page string from `generateTransitionMarkers`) is kept exactly as-is — still generated,
still stored, still collision-checked — but is now purely an **internal, opaque, never-spoken dedup
key** for `firedMarkersRef`/`shouldAdvanceOnTransition`. It stops being something Clio says or the
client listens for. This is the minimal-diff path: zero schema change, zero change to
`app/api/partner/v1/sessions/route.ts`, zero change to the B2B-59 debounce module or its tests — only
the prompt text and the transcript-matching logic change.

**4a — the last page.** Confirmed there is no "next title" to use, and confirmed this is fine to
special-case rather than needing to be forced into the two-stage shape: today, `advanceOnTransition`
on the last page already clamps to the same index (`Math.min(activeIndexRef.current + 1, count -
1)`) — it's a functional no-op regardless of what fires it. So skipping Stage 1/2 detection entirely
on the last page changes **no live-advance behavior**. It does change the prompt: see §4b for why
dropping the spoken marker there is also a *content* improvement, not just a safe no-op. `end_session`
(rule 8's closing sequence, `lib/voice/hume-native/prompt-template.ts` `RULE_8_INLINE_TEXT`) remains
the sole authority for ending the session — untouched by this brief.

**4b — prompt wording, non-last pages** (`buildInlineSessionContent`,
`lib/partner/live-render.ts`, replaces the `else` branch at lines 636-639):

```
[STAGE DIRECTION — DO NOT SAY THE BRACKETED LABEL] When you have finished covering this page
(transition intent: "{transition_trigger}"), say "That covers what I wanted to walk through here."
naturally as part of your sentence. Then, as you begin the next part, naturally say its name —
"{next page title}" — before continuing to teach it. Only after you have said the next part's name
should you call the advance_tab tool.
```

If `nextPage.title` is null/empty (the one input-data edge case where Stage 2 has nothing to key
on), drop the naming clause and keep the rest — this is the same condition
`computeStage2Eligibility` independently evaluates to `false` for, so the prompt and the client
detector degrade together, in sync, automatically.

**4c — prompt wording, last page** (replaces lines 629-634): **drop the spoken-marker instruction
entirely.** Today's system asks the bot to say the marker phrase *and* immediately follow with rule
8's own "recap the one or two most important things... then follow the closing sequence" — two
back-to-back wrap-up cues on the one page where it matters least (nothing is listening for the first
one; it exists purely for prompt symmetry with the other pages today). Under this redesign, keeping
the wrap-up phrase there would be worse: it'd sit directly next to rule 8's own natural close and
read as a redundant, slightly odd double wrap-up ("that covers what I wanted to walk through
here... [immediately] ...let me recap what we covered today"). Simplify to:

```
[STAGE DIRECTION — DO NOT SAY THE BRACKETED LABEL] This is the final page (transition intent:
"{transition_trigger}"). When you have finished covering it, follow the closing sequence (rule 8)
and call the end_session tool.
```

This is a net improvement over the current shipped behavior on the final page, not just a
side-effect-free removal.

### 5. Fixed-phrase collision awareness (non-blocking observability, not a hard gate)

Because Stage 1's phrase can't be regenerated per-session the way the old random marker could, add a
cheap, non-blocking check at prompt-assembly time in `buildInlineSessionContent`: run
`matchesSpokenPhrase(narrationText, STAGE_1_WRAP_UP_PHRASE)` against the same narration blob already
assembled for the marker-collision check. If it matches, `console.warn` (server-side, Vercel-log
visible, same spirit as the existing diagnostic logging pattern) — **do not block session creation**.
This is early-warning observability for "does this specific partner's content already contain
language close to our fixed wrap-up phrase," not a gate; blocking would be a worse outcome than
monitoring, given there's no fallback phrase to regenerate into.

### 6. Signal-timing risk (Arun's task item — tool-call vs. spoken-title ordering can drift)

Real risk, and not new to this brief: nothing enforces that Clio actually says the next page's title
*before* calling `advance_tab`, even though the prompt now sequences it that way ("Only after you
have said the next part's name should you call the advance_tab tool"). If the tool-call fires first
(model decides to call the tool promptly after Stage 1's phrase, without waiting to actually narrate
the next title), the page visually advances before Clio has said anything about the new section —
the exact "page jumps ahead of narration" failure class B2B-58 fixed for `show_visual`, now
reachable via `advance_tab` instead.

**This is not a new risk class introduced by this brief** — today's shipped prompt already sequences
"say marker, then call advance_tab" back-to-back with the identical ordering assumption, and
transcript-watch is documented as the *primary* signal specifically because it tends to resolve
before a tool round-trip completes (live caption events vs. a separate model decision + call).
Resolving this with certainty requires real data, not a guess, so: **piggyback on the B2B-59
sibling's planned signal-source logging** (already scoped in that brief's Option B follow-up) to
additionally record, whenever `advance_tab` fires, whether the next page's title had already
appeared in the transcript at that moment. That gives an actual measurement of how often ordering
holds, instead of a same-night assumption. If real sessions show this drifting badly, that's a
follow-up brief with data behind it — not a blocker to shipping the natural-phrase redesign tonight,
since (again) the failure mode is identical in kind and severity to what's already live today.

### 7. Incidental benefit worth noting

Because Stage 1/Stage 2 are now a fixed natural phrase and a real section title — not a
system-looking token — this redesign likely **eliminates B2B-59's underlying problem as a side
effect**: a glitch-extraction model reading a transcript that contains "That covers what I wanted to
walk through here... now let's look at [real next section title]" has nothing anomalous to flag,
unlike "cobalt-kestrel-8068." Worth noting for whoever picks up B2B-59's still-open Option D
(extractor-level masking) — it may become unnecessary once this ships, though that's their call to
confirm against real post-ship transcripts, not assumed here.

## Files Changed

- `lib/content/transition-markers.ts` — add `STAGE_1_WRAP_UP_PHRASE` constant,
  `matchesSpokenPhrase()`, `computeStage2Eligibility()`, `EligibilityPageInput` type.
  `matchesTransitionMarker`, `generateTransitionMarker(s)`, `MarkerPageInput` are **unchanged** —
  still used to generate/store the opaque per-page dedup key.
- `lib/partner/live-render.ts` — `buildInlineSessionContent()`: replace the per-page transition
  instruction (both the `isLast` and non-last branches) per §4b/§4c. Add the non-blocking
  narration-collision warning per §5.
- `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` — add
  `stage1ArmedRef`, `stage2EligibleRef` (computed once from `inlinePages` via
  `computeStage2Eligibility`), rewrite the inline `onMessage` handler per §4, add the
  `stage1ArmedRef.current = false` reset line inside `advanceOnTransition()`. Import
  `matchesSpokenPhrase`/`computeStage2Eligibility`/`STAGE_1_WRAP_UP_PHRASE` in place of
  (additionally to) `matchesTransitionMarker`. **No change** to `inlineTools.advance_tab`,
  `templateTools`, `resolveSectionIndex`, or anything in the non-inline (Option 2) path.
- No DB migration, no change to `app/api/partner/v1/sessions/route.ts`, no change to
  `lib/partner/advance-transition.ts` or its pinned tests.
- Tests: new unit coverage for `matchesSpokenPhrase` (order/proximity/ASR-noise cases per §3) and
  `computeStage2Eligibility` (collision, generic-title, null-title, last-index-always-false cases),
  alongside the existing `tests/unit/transition-markers.test.ts`. Update
  `tests/unit/b2b35-inline-session-content.test.ts` /
  `tests/unit/b2b35-live-render-call-sites.test.ts` / `tests/unit/b2b36-live-render-call-sites.test.ts`
  for the new instruction wording if they assert on the old marker-phrase text.

## Known Constraints

- Do not touch `lib/partner/advance-transition.ts`, its exported signature, or
  `tests/unit/b2b59-advance-debounce.test.ts` — that work is approved and in flight separately;
  this brief's client changes must call `advanceOnTransition`/`shouldAdvanceOnTransition` exactly as
  that module already expects.
- Do not remove `matchesTransitionMarker`, `generateTransitionMarker(s)`, or the `transition_marker`
  DB field/generation path — repurposed as an internal dedup key only, not deleted. (It is now
  unused for live transcript matching in production, which is expected and fine — not a code-quality
  defect to fix in this brief.)
- Keep the Stage 1 phrase as a single fixed global string, not per-page/per-partner-configurable,
  per Arun's design.
- The non-blocking collision warning in §5 must never block session creation.

## Governance Call

Arun specified the product behavior directly and unambiguously ("proceed as above"); this brief's
job was to finalize *how*, not re-litigate *whether*. Per the CEO Agent's standing authority to
approve a technical fix for direct build without a separate BA Requirement Document when the design
is fully specified and edge-case-safe after review (consistent with how B2B-58 and B2B-59's sibling
debounce were handled tonight): **I am approving this for direct build.** Every open question Arun's
description didn't address has been resolved above with stated reasoning — the matching-algorithm
risk (§3, the most significant thing this review surfaced beyond Arun's own description), the
last-page case (§4a/4c), title-collision/eligibility (§2, §4), the fixed-phrase collision blind spot
(§5), and the tool-call/spoken-title ordering risk (§6, resolved via instrumentation rather than a
guess, matching tonight's established pattern for genuinely data-dependent questions). No open
items remain.
