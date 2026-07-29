# Feature Brief: B2B-50 — Meeting-Bot Termination Robustness (Bot Never Actively Told to Leave)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-29

## What Arun Said

"When I end the call, the bot is still there in the Google Meet. We need to find a solution for it.
When we end the call or kick the bot from the call, the bot should register as end call and
communicate to Clio as well as Hume should be aware of it. Taking the transcript and everything
needs to be aligned. When balance is out then also similar situations might come, so CEO agent
brainstorm on all possible instances and find a robust way to handle it. We should not keep the bot
in the call and consume our minutes, the user will be frustrated if that is possible so we need to
resolve it."

Separately, on Item 3 ("bot is joining" never clears): "after clicking learn with AI, it says bot is
joining but then after a few seconds the page should refresh but now the page still continues to
show the message that the bot is joining. So it is blocking user to launch the bot again." — **I am
folding this into this brief rather than writing it up separately; see "Item 3 is very likely not a
fourth, independent bug" below for why.**

## The problem being solved

There is exactly one place today that actively commands the meeting-bot vendor (Attendee) to leave
a Google Meet — and it is used in exactly one of the several ways a session can end. Every other
termination path relies on Attendee noticing on its own that the meeting ended and telling us, which
only happens if a human manually removes the bot or the meeting itself ends — not when Clio/the
participant decide the *session* is over. Confirmed directly against live code, not assumed:

### The one place `deleteBot()` (bot-leave) is called today, and it works

`lib/meeting-bot/attendee.ts` line 30, `deleteBot(botId)`, calls `POST {BASE_URL}/bots/{botId}/leave`
— a real, working, already-proven mechanism. It is called from exactly two places, both already
shipped and correct for their scenario:

- `inngest/partner-trial-cutoff.ts` line 47 — test-mode trial-minutes exhausted.
- `inngest/partner-live-cutoff.ts` line 249 — live-mode wallet balance exhausted.

**Arun's "when balance is out" scenario is already correctly handled** — both cutoff jobs call
`deleteBot()` before force-ending the session, non-fatal on failure, then run the same
force-completion sequence. This is the proven pattern the rest of this brief reuses, not reinvents.

### The gap: every other termination path never calls it

`lib/partner/live-render.ts`'s `handleSessionEnd()` (line 722) — the single function that marks a
`partner_sessions` row terminal, cancels cutoff jobs, and fires billing/webhook events — **never
calls `getMeetingBotProvider().deleteBot()`**, confirmed by direct read of the full function body.
It has two callers:

1. **`app/api/partner/render/end-session/route.ts`** — hit by `PartnerRenderClient.tsx`'s
   `endSessionOnce()` (lines 380-401), itself triggered by: the Hume `end_session` tool call (both
   `inlineTools.end_session` and `templateTools.end_session`, lines 204-208 and 224-228 — fires when
   Clio/the participant conversationally end the call, including the new B2B-41 rule 13 for
   participant-initiated endings) **or** the component's own unmount/cleanup (line 284, e.g. the
   browser tab closing). **Neither path tells Attendee to remove the bot.** The bot keeps sitting in
   the Google Meet, visible to participants, consuming minutes, until something else notices.
2. **`app/api/attendee/webhook/route.ts`'s `handlePartnerSessionEvent()`** — a `bot.state_change:
   ended`/`fatal_error` event from Attendee itself, i.e. **the bot has already left** (or crashed) by
   the time this fires. This is correctly a no-op with respect to `deleteBot()` (nothing to command,
   the bot is already gone) — but per the Orchestrator's recon, this fallback observably takes
   45-70 seconds to fire after the bot actually leaves, and — more importantly — **nothing today
   proactively causes the bot to leave when a human manually removes it or walks out of the
   meeting**. `participant_events.join_leave` (the event that *would* tell us a participant left) is
   currently "no-op, correlated+logged only" (B2B-10's own documented scope, confirmed still true by
   direct read of the `case 'participant_events.join_leave':` block, line 476/312) — it does not
   trigger `handleSessionEnd()` or `deleteBot()` today.

**Net effect, matching exactly what Arun observed live tonight:** if a call ends any way *other*
than the wallet running out, nobody tells Attendee to remove the bot. It sits in the meeting until
Attendee's own independent detection (bot left the meeting on its own, or crashed) eventually fires
`bot.state_change`, which for a bot nobody told to leave may never happen promptly, or at all, until
someone manually removes it in the Meet UI.

## Item 3 is very likely not a fourth, independent bug

Traced directly: `app/api/demo/[slug]/performance/route.ts` computes `session_state: 'in_progress'`
whenever `partner_sessions.status` is `'requested'` or `'bot_active'` (lines 87-96), and only reports
a terminal state once `status` becomes `'completed'`/`'failed'` — which only happens via
`handleSessionEnd()`. `DemoTopicClient.tsx`'s auto-clear polling (shipped `e6bafc8`, two nights ago,
confirmed byte-identical today — zero diff across B2B-44's move to `app/(demo)/demo/[slug]/` and
B2B-47/B2B-48, verified via `git show -M` and direct diff) is itself working exactly as designed: it
polls this same status and correctly refuses to clear "Bot is joining" while `status` is still
`'bot_active'`. **If the bot is never told to leave (this brief's core gap) and Attendee's own
fallback hasn't fired yet, `status` genuinely never leaves `'bot_active'` — so the page is correctly
reporting reality, not malfunctioning.** This also matches B2B-44's own commit message, which already
flagged this exact symptom as deferred and unresolved two nights ago ("Issue 5's 'still stuck' half
... deferred pending Arun's own timing/timestamp confirmation — not force-resolved without
evidence") — this is very likely the same still-open issue recurring, not a new regression.

**Recommendation: do not build anything separate for Item 3.** Ship this brief's fix, then have Arun
re-run the exact same live test. If proactive bot-leave (below) causes `handleSessionEnd()` to fire
promptly on a normal end, `partner_sessions.status` flips to `'completed'` within seconds, and the
demo page's existing 10s poll clears "Bot is joining" on its own — no new code needed for the symptom
itself. If it's still stuck after that, it's a genuinely new, different bug worth its own
investigation — but building for that now would be exactly the kind of unevidenced guess Arun asked
this team to stop doing tonight.

## What success looks like

- However a session ends — participant says goodbye, host manually removes the bot from the Meet,
  the browser tab closes/crashes, or the wallet/trial minutes run out (already working) — the
  meeting-bot vendor is proactively commanded to leave within a few seconds, not left to notice on
  its own.
- Hume's live WebSocket connection and the session's transcript are left in a consistent, correctly
  terminated state for every one of those scenarios — not just the client-initiated one.
- The demo/partner render page's own "bot is joining"/session-status UI reflects reality promptly
  once a session actually ends, restoring the ability to relaunch without a manual refresh.

## Known constraints

- Reuse the proven `deleteBot()` pattern from the two cutoff jobs — do not design a new Attendee
  interaction from scratch.
- `partner_sessions.provider_bot_id` already exists and is populated at dispatch time
  (`lib/partner/session-init.ts` line 66) — confirmed live. `getPartnerSession()`
  (`lib/partner/live-render.ts` line 186) does **not** currently select it — this is a small,
  additive schema-read change, not a migration.
- Do not touch the two cutoff jobs' own `deleteBot()` call sites — they are correct and proven; this
  brief closes the gap everywhere else, ideally by adding the call inside `handleSessionEnd()` itself
  so every current and future caller gets it for free (client-initiated end, and the
  Attendee-webhook fallback path — where it would be a safe, cheap no-op/expected-failure since the
  bot's typically already gone by the time that fallback fires).
- Per Arun's explicit ask, this needs a full brainstorm of every termination path, not just the one
  observed live tonight — enumerate at minimum: participant-initiated end (Hume `end_session` tool
  call — mostly working already, missing only the `deleteBot()` call), host/participant manually
  removes the bot or leaves the meeting without saying goodbye (`participant_events.join_leave` is
  currently a no-op — needs a decision on whether/how to correlate "the human(s) left" with "the
  session should end," since a multi-participant meeting's `join_leave` semantics need care — don't
  end a session because one of several participants left), browser tab closes/crashes on the
  participant's side (component unmount already calls `endSessionOnce()` — confirm this covers it,
  or whether `beforeunload` reliability is a real gap), Attendee-side crash/`fatal_error` (already
  handled, no-op on `deleteBot()` correctly since bot's already gone), wallet/trial exhaustion
  (already correctly handled, do not touch).
- Hume-side consistency: today, closing the Hume WebSocket is only ever done client-side
  (`HumeAdapter.endSession()`, called from `endSessionOnce()`). For a **server-initiated** removal
  (the cutoff jobs, or this brief's new proactive `deleteBot()` calls from a webhook-driven path with
  no live client to call `endSession()` on), there is currently no mechanism to also close the Hume
  side from the server — BA must investigate whether removing the bot from the meeting naturally
  starves Hume's audio input (causing Hume's own inactivity timeout, `timeouts.inactivity` in
  `config-provisioner.ts`, already set to 120s) enough to end the chat cleanly, or whether an explicit
  server-side Hume-close call is needed for transcript/billing alignment. This is the one piece of
  the brief that's a genuine open technical question, not a known gap with a known reuse pattern —
  flag for the BA to resolve with evidence (check Hume's REST API for an admin/server-side "end this
  chat" call, distinct from the WS close the client already does), not to guess at.
- Never touch `isFirstPartyDemoPageUrl()`/`resolveInlineSessionRender()`'s first-party branch or
  `PartnerRenderClient.tsx`'s `sourceUrl` iframe branch (tonight's B2B-48 protection) — this brief's
  changes are entirely in session-termination logic, nowhere near either.

## Questions for BA

1. Full termination-path matrix (participant end / host-kick / tab-close / crash / wallet-exhausted)
   with, for each: what detects it, what calls `deleteBot()`, what happens to the Hume connection,
   what happens to the transcript/billing record — Arun's own framing ("brainstorm on all possible
   instances").
2. Whether `handleSessionEnd()` should call `deleteBot()` internally (single choke point, every
   caller benefits) vs. each caller doing it explicitly before calling `handleSessionEnd()` (matches
   today's cutoff-job pattern more literally, but risks a future caller forgetting it) — recommend
   the internal-choke-point approach for exactly that reason, but leave it to the BA to confirm no
   caller has a reason to skip it.
3. `participant_events.join_leave` correlation design for multi-participant meetings — when should a
   "someone left" event actually end the session vs. not.
4. The Hume-side server-initiated-close open question above.
5. Whether Item 3's symptom should get an explicit acceptance test in this spec (re-verify after the
   fix ships) rather than being separately built.
