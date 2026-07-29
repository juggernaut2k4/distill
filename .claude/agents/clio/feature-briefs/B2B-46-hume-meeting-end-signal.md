# Feature Brief: B2B-46 — Signal Hume/Clio When a Participant Leaves the Meeting

From: CEO (Arun)
To: Business Analyst Agent (informational — see Governance verdict below; this is filed as a
technical-fix brief, not a spec awaiting BA sign-off)
Priority: P0
Date: 2026-07-29

## What Arun Said

After manually ending a live "Learn with AI" Google Meet test call: "now i ended the call in google
meet. ideally hume should know that the meeting ended also and should inform clio as well."

## Verdict up front

**Real, confirmed gap. Real, buildable fix — but it is narrower and different from the fix implied
by the original framing, and I found a second, independent problem while verifying it.** Everything
below is checked against live source and, where noted, against real production logs from Arun's own
test session tonight (2026-07-29, ~14:35–14:40 UTC, `partnerSessionId: ede530c4-be50-4801-a840-734d7c557a09`).

---

## 1. The original diagnosis — confirmed true

`handleSessionEnd()` (`lib/partner/live-render.ts:656-706`) does exactly four things: updates
`partner_sessions` status/`ended_at`, emits an Inngest cutoff-cancel event, emits
`clio/partner-session.ended` (B2B-37 insights pipeline), and records billable usage. It never touches
Hume in any way — confirmed by reading the full function. Hume's live WebSocket connection is not a
server-side connection our backend holds at all; it's opened **client-side, inside the meeting bot's
own headless browser tab**, by `HumeAdapter` (`lib/voice/hume-adapter.ts`) running inside
`PartnerRenderClient.tsx` — confirmed via `lib/meeting-bot/attendee.ts:54-79`
(`createBotBrowserMode()`), where `renderUrl` (`/partner-render/[clio_session_ref]`) is passed to
Attendee as `voice_agent_settings: { url: walkthroughUrl }`. Attendee loads that URL **in the same
browser tab it uses to join the Google Meet call** — there is no separate server-side Hume session our
backend can reach into and no separate "output media" tab. This confirms the task brief's own
hypothesis 3 architecture, not hypothesis 2 (no server-to-server "stop Hume" API exists or is needed).

## 2. What actually happens today when a participant leaves — confirmed from tonight's real logs

Pulled via Vercel runtime logs (`prj_05lfiXOO7aVzoMwf5xPyuYvXv3OO`, production, last 7 days,
`attendee/webhook`). Tonight's session:

- `transcript.update` events run continuously until 14:39:56.
- At 14:38:55, a real `participant_events.join_leave` event fires.
- At 14:39:55, 14:39:56, and 14:40:01, three `bot.state_change` events fire in quick succession; the
  last one carries `new_state: 'ended'`.
- That final event triggers the **fallback** path: `console.warn('[attendee/webhook] partner session
  fallback completion triggered (client-side end-session never landed)')`, then
  `handleSessionEnd(..., durationMinutes: 7.13, billedSource: 'attendee')`.

Two things this proves, independent of any code reading:

**(a) The bot's browser tab did not get a clean shutdown.** `PartnerRenderClient.tsx`'s own
`useEffect` cleanup calls `endSessionOnce()` on unmount, which calls `adapter.endSession()` (an
*intentional*, graceful WebSocket close — `hume-adapter.ts:308-313`) before posting to
`/api/partner/render/end-session`. That client-side path is documented in the code itself as
"authoritative and expected to win in the common case" (`live-render.ts:665`). Tonight it did **not**
fire — only the Attendee-webhook fallback did. That means when Arun left the meeting, Attendee tore
the bot's headless Chromium process down hard enough that the React cleanup never got to run its
fetch, let alone gracefully close the WS. This is exactly the failure mode Arun is describing: Hume's
side of the connection just goes dark, no goodbye, no `end_session` tool call, nothing.

**(b) By the time `bot.state_change: ended` reaches our webhook, it is already too late to fix this.**
`ended` means Attendee's bot process — and the browser tab holding the live Hume WebSocket — is
**already gone**. There is nothing left running client-side to receive a "wrap up now" instruction.
So the fix cannot hook `bot.state_change: ended`; by construction that event always arrives after the
window to gracefully signal Hume has already closed. **The only viable hook is a signal that fires
while the bot's browser tab is still alive** — i.e., before Attendee itself decides to leave.

## 3. The mechanism to reuse already exists and is proven — this is not new capability

`PartnerRenderClient.tsx` already runs a 2-second poll (`app/api/partner/render/wrap-up-nudge/[clio_session_ref]/route.ts`)
that, when `partner_sessions.wrap_up_pending = true`, sends the full assembled prompt plus a
"wrap up now, say goodbye, call `end_session`" addendum over the live Hume WebSocket via
`HumeAdapter.sendWrapUpNudge()` (`hume-adapter.ts:295-337`). This was built for B2B-19 (mid-session
wallet-cutoff warnings) and is a real, shipped, working mechanism — not something I'm proposing to
build. The columns (`wrap_up_pending`, `wrap_up_nudge_text`) already exist
(`supabase/migrations/083_b2b19_inline_content_and_minute_enforcement.sql:71-72`).

**The fix is: set those same two columns when Attendee tells us the participant left, instead of only
when the cutoff job tells us the wallet is running low.** No new delivery mechanism, no new WebSocket
handling, no new Hume capability — pure reuse. This is why I'm treating it as a technical fix per the
B2B-43/44/45 carve-out, not a new Feature Brief requiring the full BA gate — subject to the one caveat
in Section 5.

## 4. What's NOT built yet to make that fix land correctly — three real gaps found during verification

**4a. The webhook handler currently no-ops on "participant left."**
`app/api/attendee/webhook/route.ts`, `handlePartnerSessionEvent()`'s `participant_events.join_leave`
case (~line 480): `if (eventType !== 'participant_joined' || !participantName) break`. Any event whose
`event_type` isn't exactly the string `'participant_joined'` — including whatever value Attendee sends
for a participant leaving — currently does nothing at all, not even a distinct log line.

**4b. The exact `event_type` string Attendee sends for a "left" event is unverified in this codebase
— and there's real evidence the existing code's assumption may already be wrong.** Attendee's public
webhook docs (fetched live just now) describe `event_type` as one of `"join"`, `"leave"`,
`"speech_start"`, `"speech_stop"` — not `"participant_joined"`/`"participant_left"`, which is what
this codebase's B2C and B2B-11 code both assume. Tonight's real production event at 14:38:55 fired
`participant_events.join_leave`, and **no** "join greeting flag set" log line appears anywhere near
it — meaning that real event did not match `eventType === 'participant_joined'`. That's consistent
with either a genuine `'leave'`-type event or the vendor doc's naming being right and our code's
string being wrong. I can't pin the exact value from current logs, because the partner-path handler
never logs `event.data` for this trigger (unlike the B2C branch, which does dump the full payload on
`bot.state_change`). **This means the already-shipped B2B-11 join-greeting feature may itself be
silently non-functional in production** — a separate, likely higher-priority finding I'm flagging here
rather than burying, since it's the same root cause. I have not fixed or touched B2B-11's code; that's
outside this brief's scope, but it should not sit unflagged.

**4c. The wrap-up-nudge poll only runs for inline-content (Option 1) sessions.**
`PartnerRenderClient.tsx:335`: `if (!isInline) return` gates the entire wrap-up poll `useEffect`.
Template-mode (Option 2 / Designer) sessions have no equivalent poll running at all. The
join-greeting poll has no such gate and runs for both modes. The wrap-up-nudge API route itself
(`wrap-up-nudge/[clio_session_ref]/route.ts`) has nothing inline-specific in it — it just reads
generic `partner_sessions` columns — so lifting this gate is low-risk, but it's a real scope decision
I'm making explicit rather than silently expanding.

## 5. Recommended fix — two-step, gated on live verification

Given this codebase already has one likely-silently-broken feature from guessing a vendor payload
shape instead of confirming it (Section 4b), I'm not going to repeat that mistake by guessing the
`'leave'` value and shipping behavioral changes on top of it blind.

**Step 1 (ship now, zero behavioral risk):** In `handlePartnerSessionEvent()`'s
`participant_events.join_leave` case, add a diagnostic log of the raw `event.data` (mirroring the B2C
branch's existing `console.log('[attendee/webhook] state_change full payload:', ...)` pattern) whenever
`eventType !== 'participant_joined'`. This costs nothing and, on the very next live test, tells us the
real string value with certainty instead of a guess.

**Step 2 (ship once Step 1 confirms the real value from a live test):**
- Handle the confirmed "left" `event_type` value in that same case.
- Add a lightweight `active_participant_count` counter on `partner_sessions` (increment on join,
  decrement floored at 0 on leave) so the wrap-up nudge only fires when the count reaches 0 — i.e.,
  when the last real participant has left, not on the first of several. This matters: B2B-35 /
  HUME-SPEAK-01 confirm multi-participant sessions (primary user + other attendees) are a real,
  supported scenario in this product, not hypothetical. Firing on any single participant-left event
  would prematurely end sessions that still have an active human present. This is a plain counter, not
  a live roster/UI feature — it's a different, narrower thing than the roster-based detection Arun
  explicitly rejected as out of scope in B2B-36 for a different (name-personalization) feature.
- Set `wrap_up_pending = true` / `wrap_up_nudge_text = "The participant appears to have left the
  meeting. Wrap up now: say a brief goodbye and call the end_session tool."` when the counter hits 0.
- Remove the `isInline` gate on the wrap-up poll (Section 4c) so Option 2 sessions get this too.

Both steps reuse existing schema patterns and an existing, proven delivery mechanism. No new user-facing
screen, no new product/UX decision, no new Hume capability. Step 2's only "new" pieces are a counter
column and a string literal confirmed from real traffic — implementation detail in service of the
literal instruction Arun gave, not a product-shape decision.

## Known Constraints

- Never guess a vendor payload shape and ship behavior on it — this project has already been burned
  by that once (Section 4b); Step 1 exists specifically to not repeat it.
- No server-to-server "tell Hume to stop" call exists or is needed — confirmed the WS is client-side,
  in the bot's own browser tab, and closes via that tab's own lifecycle.
- Do not fire the wrap-up nudge on every participant-left event in multi-party sessions — must gate on
  "last participant left," per Section 5.

## Questions for BA

None — filed as a technical fix per the CEO/BA-chain carve-out (glue code + a counter column, reusing
an already-built, already-proven delivery mechanism; no screen, no copy, no new product behavior beyond
what Arun literally asked for). Flagging Section 4b (possible dead B2B-11 join-greeting feature) to
Arun directly as a separate, adjacent finding rather than folding a second unrelated fix into this one.
