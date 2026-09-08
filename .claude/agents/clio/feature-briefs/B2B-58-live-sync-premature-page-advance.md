# Feature Brief: B2B-58 — Live Sync Bug: Page Auto-Advances Before Clio Speaks

From: CEO (Arun)
To: Developer Agent (no BA gate — see Governance Call) — fast-track P0
Priority: P0 — live, currently broken, affecting real reseller demo sessions today
Date: 2026-07-30

---

## What Arun Said / Root Cause (Orchestrator-traced, CEO-verified against live code)

In inline content-delivery mode (`app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`,
the real path live partner sessions use), confirmed directly in the current file:

```js
const inlineTools = {
  show_visual: async () => {
    const marker = inlinePages![activeIndexRef.current]?.transitionMarker
    if (marker) advanceOnTransition(marker)
    return 'Advanced.'
  },
  advance_tab: async () => {
    const marker = inlinePages![activeIndexRef.current]?.transitionMarker
    if (marker) advanceOnTransition(marker)
    return 'Advanced.'
  },
  ...
}
```

`advanceOnTransition()` is forward-only and unconditional: `Math.min(activeIndexRef.current + 1,
count - 1)`, deduped only by whether that section's marker has already fired. The system prompt
(`lib/voice/hume-native/prompt-template.ts`) instructs Clio (Rule 3, line ~180) to call `show_visual`
"at the moment you begin covering that section, BEFORE you start speaking about it substantively" — but
because `show_visual`'s handler is identical to `advance_tab`'s, that call force-advances the page one
section ahead immediately, before Clio has said anything about it. The whole session then runs one page
ahead of the narration for its entire duration.

---

## Confirmed additional risk not in the original description (CEO catch)

Rule 5 of the same prompt (line ~187-189) reads: "call the advance_tab tool (or show_visual for the
next section, per the wire...)" — **the prompt itself tells Clio she may use `show_visual` as an
alternate way to signal "section complete, advance."** If the code fix below ships without also fixing
this prompt line, there is a real chance Clio continues to call `show_visual` (per her own instructions)
expecting it to advance the page — and under the fix, it will silently do nothing. That would trade
today's "one page ahead" bug for a worse one: sessions that never advance, or advance unpredictably
depending on which tool Clio happens to choose. **This is not optional cleanup — it must ship in the
same PR as the handler fix, or the fix is incomplete and may not resolve the reported symptom.**

Also confirmed as a separate, independent safety net that is unaffected either way: a
transcript-phrase-match backup (`matchesTransitionMarker`, wired at line ~227-228) already calls
`advanceOnTransition` when Clio's spoken transcript matches the section's completion phrase, regardless
of which tool she calls. This backup is correctly scoped today and needs no change — worth confirming
in QA that it still fires correctly after the fix, since it's the one thing that would mask a
mis-wired Rule 5 if the prompt edit above is skipped or wrong.

---

## What Success Looks Like

- `show_visual`'s inline-mode handler becomes a no-op with respect to page position — it returns a
  confirmation string only (e.g. `'Visual is showing.'` or similar), and never calls
  `advanceOnTransition`.
- `prompt-template.ts` Rule 5 is edited in the same change to remove the "(or show_visual for the next
  section...)" alternative — `advance_tab` (plus the existing phrase-match backup) is the only
  documented way to advance a section.
- `advance_tab` and the phrase-match backup remain exactly as they are today — both already correctly
  scoped to "section complete."
- Template mode (the legacy non-inline path, explicit `section_index`) is untouched — confirmed it does
  not share this code path.
- Verified on a real or demo live session (not just `tsc --noEmit`) that the page now advances in sync
  with narration, not ahead of it, and does not stall.

---

## Known Constraints

- Do not change `advance_tab`'s behavior, `advanceOnTransition`'s dedup/forward-only logic, or the
  phrase-match backup — only `show_visual`'s inline handler and the one prompt-template line.
- Check for any other call site depending on `show_visual`'s return value beyond the generic
  confirmation string used by the Hume tool-call loop — none found in this review, but the dev agent
  should re-check before shipping, since this is a shared function used across both inline and template
  tool sets.

---

## Governance Call

**No BA Requirement Document needed — approved for immediate build as a fast-track P0 technical fix.**
This is a pure bug fix to existing, already-approved live-session behavior (B2B-19) — no new screen, no
new product decision, no change to what content/copy the user sees, only when it appears. Squarely
within CLAUDE.md's "pure technical/bug fixes... do not [need BA gate]" carve-out and the standing
practice for live P0s this session.

**Condition on approval**: the prompt-template.ts Rule 5 edit is not optional polish — it's part of the
fix. Do not ship the handler change alone. Re-run the mandatory live-session verification (not just a
clean build) before marking this done, given the history this session of "clean build, tests pass"
giving false confidence on exactly this file's dependency chain (see B2B-07/08/09 gap notes in
`docs/b2b-pivot-status.md`).

## Questions for BA

None — no BA involvement required.
