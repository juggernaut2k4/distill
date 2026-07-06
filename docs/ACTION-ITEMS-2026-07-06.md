# Action Items — 2026-07-06 Test Session Review

Captured from Arun's message reviewing the HUME-NATIVE-01 test call (config
`3c10c0cf-0256-4f48-9373-a70704046a67`), and everything discovered/decided since. Kept up to date
as each item is investigated, decided, or fixed — this is the running source of truth for the day.

## Status Sheet

| # | Item | Category | Status |
|---|------|----------|--------|
| 1 | Double-charge race condition (manual "End Session" vs. automatic timeout/watchdog could both deduct minutes) | Billing | **Decision made** — see "Big decisions" below. Spec in progress. |
| 2/3/11 | Session length field mixes up "planned length" vs. "actual minutes used"; finished sessions can be rejoined | Billing / session lifecycle | ✅ **Spec approved (SESSION-DURATION-01), build in progress.** Splits into two fields, blocks rejoining completed sessions. Historical sessions: leave as "unknown" rather than guessing (Arun's call). |
| 4 | Investigate the specific call/config/transcript for config `3c10c0cf` | HUME-NATIVE-01 | Investigated in full — see items 5-13 below. |
| 5 | Character-limit warning (~20,569 chars) seen in Hume's dashboard | HUME-NATIVE-01 / prompt assembly | ✅ **Resolved, no bug** — real Hume limit, but only affects a voice-tone layer we don't rely on. Safety guardrail added and deployed. |
| 6 | Placeholder text "Full context not yet generated" in every knowledge-base section | HUME-NATIVE-01 / content pipeline | ✅ **Fixed and deployed** — now pulls real background material instead of a placeholder. |
| 7 | `web_search` tool sometimes shows disabled | HUME-NATIVE-01 / config-provisioner | 🔧 **Fix in progress** — confirmed genuinely inconsistent earlier; being fixed alongside item 9 (dynamic tool list). |
| 8 | Clio didn't greet, felt unchanged from the old system / abrupt call ending | HUME-NATIVE-01 / graceful ending | ✅ **Fixed and deployed** — Clio now gets a quiet nudge near the end and wraps up naturally with a summary + Q&A + goodbye; prompt also updated so this is her default closing behavior regardless. |
| 9 | A third custom capability (likely "defer question") missing entirely from new sessions | HUME-NATIVE-01 / config-provisioner | 🔧 **Fix in progress** — same pattern as the earlier `web_search` fix (read dynamically from account instead of hardcoding). |
| 10 | Our own config-checking tool was broken two ways | HUME-NATIVE-01 / diagnostics | Migration applied ✅. Second bug found (tool wasn't reading Hume's response correctly) — 🔧 **fix in progress.** |
| 12 | Automated quality-check flagged the test call as having no real coaching speech detected | Quality / content | Not yet investigated further — needs the config-check tool (item 10) working first. |
| 13 | "Unknown Session" repeatedly appearing in learner profile history | Data quality | Confirmed separate, pre-existing bug, unrelated to today's changes. Not yet scheduled. |

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
- Item 8 — graceful session-ending nudge + closing-behavior prompt update
- Item 10 (first bug) — nightly cleanup/archive database migration applied
