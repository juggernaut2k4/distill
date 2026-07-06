# Action Items — 2026-07-06 Test Session Review

Captured from Arun's message reviewing the HUME-NATIVE-01 test call, and everything
discovered/decided since. Kept up to date as each item is investigated, decided, or fixed — this is
the running source of truth for the day. Fixed-and-confirmed-deployed items are removed from this
table once verified live (see git history / BACKLOG.md for the full historical record).

## Status Sheet (as of live test call `90327691...`, 2026-07-06 ~05:16 UTC)

| # | Item | Category | Status |
|---|------|----------|--------|
| 9 | Third coaching capability (likely "defer question") still missing from every live session | HUME-NATIVE-01 / config | **Not a code bug — needs Arun's action.** Confirmed the base Hume config itself only has 2 of 3 tools attached at the source (checked directly against Hume, current version). Our code correctly carries over whatever is attached — nothing to fix in code. Needs the third capability attached to the base config in Hume's dashboard; will then flow automatically into every new session. |
| 12 | Automated quality-check flagged a test call as having no real coaching speech detected | Quality / content | Still open, not yet investigated. |
| 13 | "Unknown Session" placeholder text appearing in learner history | Data quality | Confirmed still live — and now confirmed to leak directly into what Clio reads before a real call (not just a display bug). Escalated priority given tonight's evidence. |
| 14 | **NEW** — Verified-minute billing (Hume's own record of call time) isn't firing on real calls; silently falls back to the old wall-clock method | Billing | ✅ **Fixed, verified in code, and now covered by an automated test.** Now waits 3 seconds for Hume to finish recording the call; if still not ready, waits 4 more seconds and tries exactly once more; if still not ready, uses the old method as final (no delayed correction later, by design). Confirmed the actual code matches the approved spec line-for-line, confirmed it never adds delay to non-Hume sessions, confirmed the project type-checks clean. Added a dedicated automated test tonight covering all 6 outcomes (immediate success, retry-then-success, no-retry-on-wrong-error-type, retry-then-still-fails, not-applicable, no-chat-id) — all passing. Committed locally. Not yet pushed/deployed — awaiting your review. |
| 15 | **NEW** — Shared screen got stuck on the opening title card for an entire real call, never advanced through topics | Live session UX | ✅ **Root cause found — ready for your approval.** The instructions we give Clio contain a contradiction: one line says screen numbers start at zero, but every actual example right below it starts at one. If Clio ever follows the wrong line instead of the examples, she'd land one screen behind every time she tries to advance — matching exactly what we saw. Fix is a one-line wording correction, no redesign. Awaiting your go-ahead to ship. |
| 16 | **NEW STANDING RULE** — every session's screen sequence must be: Overview (real "what you'll learn today" content) → each topic → Summary. A bare title-only screen must never be what's left on screen. | Live session UX / product requirement | 🔧 **Being written into spec now**, alongside the fix for item 15. Applies to all future sessions, not just a one-off fix. |

| 17 | **NEW** — Overview section's spoken words (not the visual card) still say "wing it, no prepared content" | Content pipeline | Distinct from item 16's visual-card fix, which is confirmed working. The actual words Clio says to open the call may still be unscripted. Needs re-check — not yet confirmed fixed or broken. |
| 18 | **Screen and narration permanently out of sync — the Overview screen doesn't actually exist in the live call's screen list** | Live session UX | ✅ **Fully built and verified, including the last piece.** Real Overview screen with agenda, real Summary screen listing what was covered, skipped topics correctly muted/excluded, all three places that build session screen data now agree with each other, type-checks clean, no regressions found. Not yet pushed/deployed — awaiting your review. |
| 19 | **NEW** — Leftover old closing instructions contradict the new closing behavior | Content pipeline | ✅ **Fixed.** Found the actual contradiction: the Hume voice path still told Clio to explicitly ask "do you have any questions?" and wait for an answer at the end of every call — left over from before we decided the closing behavior should just be a 2-sentence summary and a goodbye, no dangling question. Updated to match the newer rule exactly. (No literal reference to a deleted tool was found — the contradiction was in the wording of the closing steps themselves.) **Note: this supersedes the older item 8 description below (line "quick summary, ask if there are remaining questions...") — that description is now out of date; the confirmed current behavior is summary → goodbye, with no closing question asked, and only answering if the participant volunteers one on their own.** |
| 20 | **NEW** — Spoken material reads like a written article, not natural coaching | Content quality | ✅ **Scoped fix applied, not a full rewrite.** Added explicit "sound spoken, not written" guidance to the instructions that generate what Clio says — short varied sentences, contractions, no essay-style transition words ("furthermore", "moreover"), vary sentence openings. This is a targeted instruction addition to the existing generator, not a pipeline redesign — if scripts still read as too written after this, that's a signal a deeper content-pipeline rework is needed, which would be its own future piece of work. |
| 21 | **NEW** — Same check-in phrase repeated every section, word for word | Content quality | ✅ **Fixed.** This phrase only ever fires as a rare fallback (when a section's real question wasn't generated) — now rotates through 4 natural variants instead of repeating the same line. |

## Overnight process (per Arun's direction, 2026-07-06)
Items 14, 15, 16, 17, 18, 19, 20, 21 are going through CEO → BA → build → CEO review tonight,
without waiting for Arun. Nothing ships to real users without his morning review and explicit
approval.

## Big decisions made today (keep these straight — easy to lose track)

1. **Item 1 (double-charge) — Arun's decision: bill Hume-native sessions using Hume's own official call-duration record, not our internal calculation.**
   - Trade-off Arun explicitly accepted: this means billing will now also include the few seconds/tens-of-seconds of connection setup time before Clio starts talking — something we don't currently charge for. He confirmed this is fine.
   - **Scope: Hume-native sessions only.** The older system keeps its existing billing model and just gets a simple safety check added (don't let two things charge for the same call).
   - Spec being written now for this.

2. **Item 2/3/11 (session length) — for old/already-affected sessions, don't try to guess their original planned length. Just leave them as "unknown."** Only sessions created going forward need to show correctly. No backfill of historical data.

3. **Item 8 (graceful ending) — settled on two layers, not three.** A live one-time "wrap up now" signal near the end (primary), plus the existing hard cutoff as the only backstop. Arun explicitly decided **not** to also use Hume's own built-in "maximum call length" setting — kept things simpler.
   - Also added: a permanent rule in the prompt so Clio always does the same thing at the natural end of the material regardless of any external signal — quick summary, ask if there are remaining questions, answer them if so, then say goodbye.
   - Longer-term, deeper "how do we intelligently manage the whole session's pacing" conversation is intentionally **parked for later brainstorming** — today's fix is the practical, immediate version, not the final word on this topic.
   - Related idea, also for later: control call length by controlling how much content we hand Clio in the first place (chunk topics to fit the planned duration), rather than relying only on external timing signals. Not built yet — parked alongside the above.

## What's currently running in the background (as of last update)
- Building SESSION-DURATION-01 (item 2/3/11)
- Writing the spec for Hume-duration billing (item 1)
- Fixing the missing third tool (item 9)
- Fixing the config-checking tool's response-parsing bug (item 10, second bug)

## Already fixed and deployed today
- Item 5 — tone-instruction placement safety guardrail
- Item 6 — real background content wired in
- Item 8 — graceful session-ending nudge + closing-behavior prompt update (see item 19 note above — closing wording was further corrected tonight)
- Item 10 (first bug) — nightly cleanup/archive database migration applied

## Tonight's consolidated CEO review (2026-07-06, overnight batch)

Covers items 14, 15/16/18 (Overview/Summary screens), 19, 20, 21 as one combined review before
Arun looks at this in the morning.

- **Type-check:** `npx tsc --noEmit` run fresh across the whole combined change set — clean, zero errors.
- **Diff review:** every core file read line-by-line (`lib/session-billing.ts`, `lib/templates/session-bookends.ts`,
  `lib/voice/relay-handler.ts`, `inngest/session-content-pipeline.ts`, plus the smaller prompt/content-generator
  changes for items 19–21) — all changes are scoped, commented, and internally consistent. No half-finished edits found.
- **Tests:** added a new automated test file, `tests/unit/session-billing-hume-retry.test.ts`, covering the
  item-14 retry logic end to end (6 scenarios, all passing) — this path had zero prior coverage. Full existing
  suite re-run: 556 pre-existing tests still pass.
- **Pre-existing, unrelated test failure found (not caused by tonight's work):** `tests/unit/voice-gap-watchdog.test.ts`
  fails on `main` before any of tonight's changes too (verified by stashing and re-running) — its Supabase mock
  is missing a `minutes_ledger` table case that the real code already writes to. Separate from tonight's scope;
  flagging here so it doesn't get mistaken for something introduced tonight. Needs its own small fix later.
- **Commit:** one local commit created for tonight's combined work. Not pushed, not deployed.
