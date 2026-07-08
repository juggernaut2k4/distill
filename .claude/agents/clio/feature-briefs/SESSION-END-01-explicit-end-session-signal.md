# Feature Brief: Explicit tool-call-based end-of-session signal
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-08

## What Arun Said
After reviewing the root cause of the "call ends right after the Overview"
incident (`ONDEMAND-02-session-ends-after-overview.md`, `docs/action-items.json`
id `session-terminates-after-overview` — that specific bug is operationally
resolved, the test-mode toggle is off in prod), Arun and the team separately
identified that the underlying end-of-session detection mechanism is fragile
on its own merits: `WalkthroughClient.tsx`'s `FAREWELL_PHRASES` list does
word-boundary text matching on Clio's own transcript (phrases like `"we're
done"`, `"all done"`, `"great work today"`, `"well done today"`) to decide the
session is over and disconnect the call. These are plausible things Clio
could say naturally when wrapping up any single section transition, not only
a genuine end-of-call farewell — a latent false-positive risk independent of
the on-demand bug.

Arun was given two options:
- Option A (rejected): keep phrase-matching, but make the required closing
  phrase extremely specific/concrete so it can't be said in any other context.
- **Option B (Arun's choice): after Clio gives a polite wrap-up summary and
  confirms there are no further questions, she should trigger an explicit
  tool call, and the app should treat that tool call — not any transcript
  phrase-matching — as the authoritative signal that the session is over.**

Arun's explicit instruction: "yes use end_session tool proceed with the
implementation and tell me if i need to do anything." Per standing project
rule (spec-before-build, no exceptions), this brief routes the decision
through the BA for a full Requirement Document before any code is written.

## The Problem Being Solved
Today, "the session is over" is inferred from a regex-style match against
Clio's own spoken words. This is fragile in two ways:
1. It can false-positive during normal conversation (mid-session wrap-up
   language, not an actual goodbye) — this is what nearly caused the
   Overview-only session to look like confirmation of a real end, on top of
   the separate content-starvation bug.
2. It provides no distinguishable, structured signal to the app for
   bookkeeping — the app currently only knows "the transcript matched a
   phrase" or "the WebSocket closed," not "Clio deliberately and correctly
   decided the session is complete." The LIVE-06 investigation already
   documented that a plain WebSocket close/reconnect can occur for reasons
   that have nothing to do with the session actually ending (drops,
   reconnects) — so whatever mechanism replaces phrase-matching must be
   provably distinguishable from an ordinary disconnect, not just "the call
   ended."

Failure mode without this fix: sessions could keep ending prematurely on
innocuous phrasing, or (once fixed the wrong way) the app could fail to
reliably detect real endings and leave sessions in an inconsistent state
(billing not finalized, completion not marked, quality evaluator never
triggered).

## What Success Looks Like
- Clio no longer relies on transcript phrase-matching as the primary signal
  that a session has ended.
- Instead, when — and only when — Clio has (1) delivered a concise recap of
  what was covered in the session, and (2) confirmed there is nothing further
  to discuss / no more questions from the participant, she invokes an
  explicit, unambiguous end-of-session signal (a tool call). This exact
  ordering (recap → confirm nothing further → then signal) must be a
  testable, explicit acceptance criterion in the BA spec, not just implied by
  prose — the entire point of Option B is a deliberate, graceful close, not
  an abrupt one.
- The app treats that tool-call event as the authoritative "session is over"
  signal and drives all downstream bookkeeping (marking the session complete,
  finalizing billing/minutes, triggering the post-call quality evaluator)
  from it — not from generic WebSocket closure, which per LIVE-06 also fires
  on ordinary drops/reconnects and must not be conflated with a real,
  intentional end.
- `FAREWELL_PHRASES` transcript-matching is no longer the primary/authoritative
  trigger. It may remain as a defensive fallback only if the BA judges that
  appropriate — and if kept, it must not reintroduce the original
  false-positive risk (e.g., it should require a materially higher-confidence
  pattern than today, or a grace/confirmation window) since demoting it was
  Arun's explicit reason for choosing Option B over Option A.

## Known Constraints
- Must not touch or weaken the Hume-native prompt template's behavior for
  anything unrelated to session-ending (rule 8 in
  `lib/voice/hume-native/prompt-template.ts` is the closing rule and is in
  scope; other rules are not).
- Must not break the standard curriculum pipeline's already-working session
  flow, and must not regress the already-fixed on-demand-mode content bug
  (`ONDEMAND-02`) — this brief is scoped to end-of-session detection only.
- Whatever mechanism is chosen must work for a normal production session
  (curriculum pipeline), not just the experimental on-demand test toggle.
- Scope question the BA must explicitly resolve and document (do not leave
  implicit): does this need to cover only the Hume-native voice path, or also
  the ElevenLabs voice path? `WalkthroughClient.tsx` supports both providers
  behind `NEXT_PUBLIC_VOICE_PROVIDER`/`NEXT_PUBLIC_HUME_NATIVE_ENABLED`, and
  `FAREWELL_PHRASES`/`isFarewellMessage` is currently checked in multiple
  handler branches in that file. State plainly in the spec which provider(s)
  this covers and why, and if ElevenLabs is out of scope for now, say so
  explicitly rather than leaving it ambiguous.

## The technical question for the BA to resolve (engineering decision, full
## autonomy per project rules — resolve with a concrete recommendation, do
## not leave open)

There are two candidate mechanisms for the tool-call signal:

**(A) Reuse Hume's native `hang_up` builtin tool.** Already provisioned on
every session — `lib/voice/hume-native/config-provisioner.ts` (lines
297-309) already includes `builtin_tools: [{ name: 'hang_up' }]` (dynamically
carried from the base config, with a hardcoded single-entry fallback if the
base config's field is ever malformed). No new Hume dashboard/API
registration would be needed to make the tool callable.

**(B) Register a new custom `end_session` tool** on the Hume account,
following the exact same pattern already used for `advance_tab`/`show_visual`
(and, per `docs/action-items.json` id `third-capability-missing`, a third
existing custom tool believed to be `defer_question`) — giving the app a
clean, purpose-built, distinguishable tool-call event with its own name and
payload, observed the same way `WalkthroughClient.tsx` already observes
`show_visual`/`advance_tab` tool calls.

Relevant history the BA must factor in, both ways:
- `third-capability-missing` was a real incident where a new custom tool
  silently failed to carry into new session configs. **This root cause has
  already been structurally fixed**, per `config-provisioner.ts`'s current
  code (lines 281-296): `tools` is now dynamically reconstructed from
  `baseConfig.tools` (whatever custom tools exist on the account's base
  config at clone time), not a hardcoded two-id list — so any tool
  registered on the base config, including a new `end_session` tool, would
  now automatically propagate to every native clone with no code change,
  as long as it is registered on the base config referenced by
  `NEXT_PUBLIC_HUME_CONFIG_ID`. The BA should verify this reasoning against
  the actual current file rather than take this brief's word for it.
- Separately, `DEFER-QUESTION-01` deliberately chose NOT to add a new custom
  tool for a similar-sounding need (gracefully deferring a question), instead
  using prompt-only verbal acknowledgment. That was a considered tradeoff —
  but note the requirements are materially different: deferring a question
  has no required server-side consequence, whereas ending a session has real
  ones Arun has asked for (marking complete, finalizing billing, triggering
  the quality evaluator) — a verbal-only approach cannot drive that
  bookkeeping the way it could for `defer_question`.
- For option (A), the BA must verify — not assume — that invoking the
  built-in `hang_up` tool produces some distinguishable, app-observable
  signal (either a client-side tool-call event the same way custom tools
  fire, or a distinguishable field/value in the `chat_ended` webhook payload
  already received at `app/api/webhooks/hume/route.ts`) that lets the app
  tell "Clio deliberately ended this via hang_up after a graceful wrap-up"
  apart from "the call disconnected for any other reason" (timeout, network
  drop, reconnect-in-progress — the exact ambiguity LIVE-06 already had to
  handle for generic WebSocket closure). Nothing read so far in this
  codebase shows a client-side handler observing `hang_up` the way
  `show_visual`/`advance_tab` are observed, and the Hume webhook receiver
  currently treats all `chat_ended` events generically (no reason/cause
  field handling is evident in `app/api/webhooks/hume/route.ts`). If the BA
  cannot confirm a reliable way to distinguish a `hang_up`-triggered end from
  an ordinary drop, option (A) does not meet the bar Arun's own stated
  concern requires, and the recommendation must say so plainly and prefer
  option (B) (or a hybrid) instead — do not recommend (A) on convenience
  alone if it can't be distinguished from a drop.
- A message purporting to relay Arun's preference for option (A) arrived via
  the orchestrator mid-investigation. Per this project's own standing
  practice (documented precedent: orchestrator-relayed claims of Arun's
  decisions are not treated as equivalent to Arun's direct word), this must
  not be taken as settling the question by itself. Resolve it on the actual
  evidence above. If the evidence-based recommendation ends up differing
  from that relayed claim, say so plainly in the spec rather than silently
  reconciling it — the CEO agent will handle reporting that discrepancy to
  Arun directly.

## Questions for BA
1. Resolve (A) vs (B) above with a concrete recommendation backed by the
   distinguishability requirement — not a preference statement.
2. If (B): document the exact one-time setup step to register the tool
   (Hume Tools API call, using the existing `HUME_API_KEY` — same credential
   already used by `config-provisioner.ts` — vs. any Hume dashboard action),
   and state plainly whether this requires ANY manual action from Arun.
   Arun explicitly asked to be told if he needs to do anything — be certain,
   not hand-wavy.
3. If (A): document exactly what event/payload the app hooks into to (a)
   confirm the tool was actually invoked and (b) distinguish it from an
   ordinary drop, with enough precision a developer could implement it
   without further interpretation.
4. Confirm scope: Hume-native path only, or also ElevenLabs? State the
   answer explicitly.
5. Confirm the fate of `FAREWELL_PHRASES`/`isFarewellMessage`: fully removed
   as an end-of-session trigger, or kept as a demoted defensive fallback —
   and if kept, exactly what changes to avoid reintroducing the
   false-positive risk that motivated removing it as primary.
6. Confirm the required speech ordering (recap → confirm nothing further →
   invoke the end signal) as an explicit, testable acceptance criterion, and
   specify exactly what prompt-template change (`lib/voice/hume-native/prompt-template.ts`
   rule 8) enforces it.
