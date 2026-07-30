# Feature Brief: B2B-52 — Widen Hume WS Reconnect Tolerance (Mitigation, Not a Root-Cause Fix)

From: CEO (Arun)
To: Business Analyst Agent / Orchestrator
Priority: P1
Date: 2026-07-30

## What Arun Said

Arun reported live, mid-test: "clio joins the meeting but says issue with voice" — this is a
follow-up investigation dispatched to the CEO agent to diagnose that report and recommend next
steps. This brief captures the one concrete, scoped, technical mitigation that came out of that
investigation. It is explicitly NOT the Track B root-cause fix that B2B-49 is still blocked on —
see that brief for the open root-cause question.

## The Problem Being Solved

Tonight (2026-07-29/30), the B2B-49 Track A diagnostic (shipped, commit `999a2ca`) has now caught
the same Hume EVI WebSocket failure signature three separate times within about one hour:
session `54fcf6cc` (03:25 UTC), `b65fbbe6` (04:14 UTC), and `e97f9feb` (04:19 UTC — Arun's live test
just now, confirmed ended at 04:22 via Attendee's bot.state_change webhook fallback, ~1.9 minutes
long, voice never connected for its entire duration). All three show the identical pattern: a
successful `/api/hume-token` 200 (proving token + config provisioning worked), followed by repeated
`ws.onerror` on `HumeAdapter`'s WebSocket, most ending in `ws.onclose` code 1006 ("abnormal
closure," no reason given), all within `HumeAdapter`'s existing `MAX_RECONNECT = 3` /
1s→2s→4s-backoff window — call it roughly 7 seconds of total retry budget before giving up and
surfacing the "Voice connection issue" banner (`PartnerRenderClient.tsx` lines 451-455 / 479-483 —
this on-screen text, visible in the bot's shared screen content, is what Arun saw and described
verbally as "says issue with voice"; confirmed by direct source read, not inferred).

Critically: earlier tonight (20:04, 20:18, 23:53, 02:51 UTC) the exact same code connected
successfully with zero relevant glitches. No commit since B2B-49 Track A (`999a2ca`) has touched
`lib/voice/hume-adapter.ts`, `lib/voice/hume-native/config-provisioner.ts`, or
`lib/voice/hume-native/prompt-template.ts` (verified via `git log`). This is confirmed NOT a code
regression — it is intermittent Hume-side WS instability, most plausibly tied to the volume of rapid
back-to-back test sessions run against this one partner reference tonight (12+ sessions in ~8 hours,
with a dense cluster of ~7 attempts, several also hitting an unrelated `bot_dispatch_failed` mode, in
the final hour alone) — consistent with a Hume-account-level concurrency/rate limit, per B2B-49's
untested hypothesis #2.

Given that, the current ~7-second total retry budget may simply be too short to ride out a brief
Hume-side hiccup or rate-limit cooldown window.

## What Success Looks Like

`HumeAdapter`'s reconnect logic gives a longer, still-bounded runway before giving up and surfacing
the error banner — enough to plausibly ride through a transient Hume-side blip — without masking a
genuinely dead connection indefinitely or changing anything about the connect sequence, token
handling, or Config provisioning logic itself. Zero change to prompt content, Config body, or any
other code path already ruled out in B2B-49.

## Known Constraints

- This is a mitigation, not the Track B root-cause fix — do not present it or ship it as "the fix
  for the voice regression." B2B-49's Track B remains open pending either Arun's own browser console
  output or a Hume-side answer (support ticket / dashboard check).
- Must not touch `lib/partner/live-render.ts`'s `isFirstPartyDemoPageUrl()` /
  `resolveInlineSessionRender()`, or `PartnerRenderClient.tsx`'s `page.sourceUrl` iframe branch
  (B2B-48, commit `d02a7e1`) — same standing tonight-only constraint as B2B-49.
- Do not change the "Voice connection issue — content is still visible." banner copy or the
  fallback-to-visual-only behavior itself — only the retry budget before that state is reached.
- Full CEO → BA → Dev gate applies as normal; this is not a "pure diagnostic, no BA gate" case like
  B2B-49 Track A was (this does change behavior — the length of the retry window — so it needs a
  real spec, however small).

## Questions for BA

1. What is the right widened retry ceiling? Recommend evaluating something in the 5-6 attempts /
   up to ~20-30s total range, but this should be a deliberate BA judgment call with a stated
   rationale (e.g., long enough to plausibly clear a rate-limit cooldown, short enough that a
   genuinely-in-meeting exec isn't staring at a frozen "connecting" state for a minute-plus).
2. Should the on-screen state during extended retry differ from today's (today: presumably
   `status: 'connecting'` throughout, then flips straight to `'error'` after the last attempt) — or
   is silent extended retrying with no visible change acceptable?
3. Confirm exact current values to change: `MAX_RECONNECT = 3` and the backoff schedule
   (`lib/voice/hume-adapter.ts`, referenced in B2B-49 around the `ws.onerror`/`ws.onclose` handling,
   lines ~105-135) — BA to verify exact line numbers/current constants before writing the spec.
4. Should this wait on Arun's explicit go-ahead before BA starts, given it's a P1 mitigation for an
   issue whose root cause is still unconfirmed? (CEO recommends: yes — flagging in the report back
   to Arun rather than auto-starting the BA spec.)
