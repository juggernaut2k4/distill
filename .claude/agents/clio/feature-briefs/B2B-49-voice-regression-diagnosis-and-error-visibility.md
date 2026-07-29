# Feature Brief: B2B-49 — Voice Regression: Narrowed Root Cause, Honest Gap, Diagnostic Fix First

From: CEO (Arun)
To: Developer Agent / Orchestrator
Priority: P0
Date: 2026-07-29

## What Arun Said

"There seems to be a voice issue due to which Clio is not able to speak. Instead of writing new
code or trying to create new things, I want you to understand what changes you made now that broke
this because this feature was working perfectly earlier. I don't want you to again code something
new instead I want you to make sure this was working as earlier."

Explicit constraint: this is a **regression**, not a new feature. Find what broke it, restore prior
behavior. Do not design anything new. Also standing tonight-only constraint: do not touch
`lib/partner/live-render.ts`'s `isFirstPartyDemoPageUrl()`/`resolveInlineSessionRender()` first-party
branch or `PartnerRenderClient.tsx`'s `page.sourceUrl` iframe branch (B2B-48, commit `d02a7e1`).

## Bottom line, stated the way Arun asked for tonight

**I narrowed the failure to a specific, small window with real evidence — but I cannot name the
exact rejection reason without either Arun's own browser console output from tonight's test, or one
more live attempt with a small, safe, purely-diagnostic logging change shipped first.** I am not
guessing at a fix. Below is exactly what I ruled in, ruled out, and still don't know.

## Evidence gathered (Vercel runtime logs, `dpl_75PpBzZoaS8KE2KyEzKTbumF1vp6`, both of tonight's real
test sessions: `bda511d3-8711-47da-acc2-5b0aa7475317` and `82007a10-0b0e-40b8-b406-eae50b507aff`)

This is **new evidence beyond what the Orchestrator's recon handed me** — I queried Vercel logs
directly rather than trusting the earlier absence-of-error-log inference, and found positive
confirmation that narrows things further:

1. **`GET /api/hume-token` returned 200 exactly once per session** (20:04:48 and 20:19:01). This
   matters because of code order: `PartnerRenderClient.tsx`'s `connect()` function
   (lines 174-278) has `if (!humeConfigId) return` as its literal first line — before
   `getUserMedia()`, before the token fetch. A hit on `/api/hume-token` is only reachable if
   `humeConfigId` was truthy. **This independently proves server-side Hume Config provisioning
   succeeded for both sessions tonight** — not inferred from absence of an error log (the
   Orchestrator's method), but from a positive downstream side effect. The "silent-skip because
   `humeConfigId` was null" hypothesis in the Orchestrator's recon is now ruled out with direct
   evidence, not just absence of a log line.
2. **`GET/PATCH /api/partner/render/join-greeting/{id}` and `/wrap-up-nudge/{id}` fired continuously
   for the full session** (279 and 244 log lines respectively across the two sessions, every ~2s,
   for the session's whole duration). These are two independent client-side `useEffect` poll loops
   in `PartnerRenderClient.tsx` with their own `setInterval`, unrelated to the voice-connect
   `useEffect`. **This proves the React component itself mounted and ran normally for the whole
   call** — this is not a page-load, hydration, or component-crash problem. The render/content side
   of the session worked exactly as expected.
3. **Zero hits, in the entire session window, for `POST /api/partner/render/session-chat-id`.** This
   is the call `PartnerRenderClient.tsx`'s `onConnect` callback fires once Hume sends a
   `chat_metadata` message over the WebSocket (`lib/voice/hume-adapter.ts` lines 150-155,
   `handleMessage()`'s `'chat_metadata'` case → `this.config.onConnect(this.sessionId)`). Zero calls
   means Hume's `chat_metadata` message never arrived at the client for either session.
4. **Zero hits, in the entire session window, for `/api/webhooks/hume`.** This is Hume's own
   server-to-server webhook (`chat_started`/`chat_ended`, registered per-config in
   `lib/voice/hume-native/config-provisioner.ts`'s `webhooks` field). Zero calls means **Hume's own
   backend never considered a chat session to have started**, independent of and corroborating
   finding 3 — this isn't just "the client didn't hear back," Hume's own webhook infrastructure
   agrees no chat ever started.

**Conclusion from 1–4 together:** the failure is isolated to a specific window —
after the Hume access token was successfully obtained and the Config was successfully provisioned
server-side (both proven, not assumed), and before Hume ever sent `chat_metadata` back over the
WebSocket opened by `HumeAdapter.openConnection()` (`lib/voice/hume-adapter.ts` line 60,
`wss://api.hume.ai/v0/evi/chat?access_token=...&config_id=...&evi_version=3&custom_session_id=...`).
Either the WebSocket handshake itself failed (`ws.onerror`/`ws.onclose` before `ws.onopen`), or it
opened but Hume never progressed the chat far enough to emit `chat_metadata` (e.g. a config-level
rejection surfaced only at the EVI/WS layer, not at the REST Config-creation layer that already
succeeded).

## The real gap this surfaced: that failure is invisible to us today, by construction

This is the part Arun most needs to hear plainly, because it explains why I can't just read the
answer off a log: **none of `HumeAdapter`'s failure paths report anywhere the server can see.**

- `lib/voice/hume-adapter.ts` line 106: `ws.onerror` → rejects the connect promise with a
  generic `Error('Hume WebSocket connection failed')` — no code, no reason, and this rejection is
  only ever `console.error`'d by the caller (see next bullet). Never sent anywhere.
- `lib/voice/hume-adapter.ts` lines 119-126: `ws.onclose` on an auth/policy error (code 1008) or
  after exhausting reconnects logs `console.error(...)` with the **real WS close code and reason
  string** — this is exactly the piece of information that would name the actual rejection — but
  only to the browser console. It calls `this.config.onError(...)`, which in
  `PartnerRenderClient.tsx` (line 260-263) is just `console.error(...); setStatus('error')`. Never
  sent anywhere.
- `PartnerRenderClient.tsx` lines 274-277 (the `connect()` function's outer `catch`): also just
  `console.error(...); setStatus('error')`. Never sent anywhere.

Compare this to the *existing, working* diagnostic pattern already built two nights ago
(`reportClientError()`, `PartnerRenderClient.tsx` lines 12-23, wired to `window.onerror` and
`unhandledrejection` at lines 127-143, and to `InlinePageErrorBoundary.componentDidCatch()` at
lines 44-46) — built for exactly this reason: "the meeting-bot's headless browser has no accessible
devtools console... this reports it to Vercel runtime logs instead of leaving it a guess" (the
file's own 2026-07-27 comment, describing a different crash class but the identical underlying
problem). **That mechanism exists and works — it was simply never wired into `HumeAdapter`'s own
three failure paths.** That is the actual, concrete "what changed" answer to part of Arun's
question, if reframed slightly: nothing regressed the connection mechanism itself as far as I can
tell from static analysis (see "Ruled out" below) — but we've never had visibility into this
specific failure mode, tonight's test is the first time it was hit while this gap existed, and nobody
would have seen it before either.

## What I ruled out, with evidence, not assumption

- **`humeConfigId` silent-skip / provisioning failure** — ruled out directly (finding 1 above).
- **B2B-47 (multiple root layouts) or B2B-48 (opaque-origin iframe fix)** — ruled out. Verified via
  `git show 2b36aa0 -- PartnerRenderClient.tsx` and `git show d02a7e1 -- PartnerRenderClient.tsx`:
  B2B-47 only *created* the file at its new path (pure move, the voice `useEffect` at lines 174-287
  is byte-identical to before the move — confirmed by diffing against the file's prior location).
  B2B-48's only edit to this file is the new `page.sourceUrl` iframe branch (lines 419-433) — the
  voice-connect `useEffect` (which has its own empty `[]` dependency array, deliberately isolated)
  is untouched by either commit. Same file, same conclusion, independently re-derived rather than
  trusted from the Orchestrator's recon.
- **`/api/hume-token`'s own logic** — unchanged since `5d3c0e7` (a cache-busting fix from before this
  week). The 200 response itself (finding 1) also proves `HUME_API_KEY`/`HUME_SECRET_KEY` are valid
  and Hume's OAuth token service is reachable and healthy right now — this is not an expired-key or
  Hume-account-down scenario.
- **`lib/voice/hume-native/config-provisioner.ts`** (the REST Config-creation logic) — unchanged
  since `5e7c2b8` (2026-07-13), well before this week's work. Not a candidate for "what changed."

## What I could NOT rule out — named, not guessed at

These are hypotheses only, each independently testable, none adopted as "the fix":

1. Something in the reconstructed Hume Config body (`config-provisioner.ts`) that Hume's REST
   Config-creation endpoint accepts (2xx, returns a config id — proven) but that Hume's separate EVI
   WebSocket layer rejects at chat-start time. REST creation and WS chat-start are different Hume
   systems; a field can be accepted by one and rejected by the other. Untested.
2. A Hume-account-level concurrency/quota limit being hit — plausible given tonight's session also
   surfaced a likely-related duplicate-bot-dispatch question under Item 3/B2B-44's still-open "still
   stuck" finding. Untested, no evidence either way.
3. An intermittent Hume platform issue on their end, unrelated to any Clio change. Untested, no way
   to confirm from our side alone.
4. The assembled prompt text itself (`lib/voice/hume-native/prompt-template.ts`, last structural
   edit `e369867`/B2B-41, two nights ago, `v9`→`v10`) tripping some EVI-layer validation not enforced
   at Config-creation time. The base template is 34,626 characters before per-session assembly
   (participant name, industry clause, partner guidance); no known Hume length limit was found
   documented in this repo's own Hume research, so this is a weak hypothesis, not a strong one — but
   named rather than silently dropped, since it's the one thing that changed structurally on the
   live-prompt content path this week.

## Recommendation — two tracks, not one guess-fix

**Track A — ship now, no BA gate (pure diagnostic logging, zero behavior change).** Wire
`reportClientError()` into the three silent failure paths named above:
`HumeAdapter`'s `ws.onerror` rejection, its `ws.onclose` code-1008/reconnect-exhausted branch (via
`onError`), and `PartnerRenderClient.tsx`'s `connect()` outer `catch`. This adds zero new behavior —
it only makes an existing, currently-invisible failure visible in Vercel logs, exactly matching the
precedent already set for the render-crash class two nights ago. This qualifies for the same "pure
technical fix, no BA gate" treatment CLAUDE.md's carve-out already applied to B2B-43 through B2B-48
tonight — arguably an even easier case, since there is no behavior change to review at all, only a
new `fetch()` call on paths that already exist. **This does not touch either of tonight's protected
files/branches** (`isFirstPartyDemoPageUrl()`/`resolveInlineSessionRender()`,
`PartnerRenderClient.tsx`'s `sourceUrl` branch) — it only touches `HumeAdapter`'s failure-path
methods and the separate `connect()` catch block.

**Track B — the actual regression fix, explicitly blocked, not scoped yet.** Cannot be scoped until
either (a) Arun has the browser console output from tonight's test already sitting in his own
DevTools/browser history (fastest possible path — if he can paste the `ws.onclose`/`ws.onerror`
console lines, or even just the WS close code, that alone likely resolves this without needing
Track A's redeploy-and-retest cycle at all), or (b) Track A ships and a fresh live test produces the
real close code/reason server-side. Once either lands, this brief will be revised with an actual
named root cause and a scoped fix — not before.

## Files referenced (Track A only — no fix code written yet)

- `lib/voice/hume-adapter.ts` (lines 105-108 `ws.onerror`, 110-135 `ws.onclose`, both need a
  `reportClientError`-equivalent call — this file has no existing import of that function since it's
  currently `PartnerRenderClient.tsx`-local; simplest path is passing a report callback through
  `HumeAdapterConfig`, or exporting `reportClientError` from a shared module both files import)
- `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` (lines 12-23
  `reportClientError` definition — candidate to extract to a shared module — and lines 274-277 the
  `connect()` catch block)

## Next

Awaiting Arun's answer on Track A (should be an easy yes — it's pure logging) and, separately, a
direct ask: does he have the browser console output from tonight's test already? That could shortcut
the whole Track B cycle.
