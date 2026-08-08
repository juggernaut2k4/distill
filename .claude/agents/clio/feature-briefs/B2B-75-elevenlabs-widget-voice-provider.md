# Feature Brief: B2B-75 — ElevenLabs as a Widget-Only Voice Provider

From: CEO Agent (on behalf of Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-08-07

**ID rationale:** `B2B-75`. Highest slot currently in use is `B2B-74`. This is a real, shippable
production capability (new provider, new admin surface, new credential class, schema change), not a
bug fix or a polish pass — so it takes a formal numbered slot in `docs/b2b-pivot-status.md`, the
same as B2B-61 (which added OpenAI Realtime as the second provider) rather than an ad-hoc item.
This brief is deliberately modelled on B2B-61 because that brief solved the structurally identical
problem one provider ago.

---

## 1. What Arun Said

Verbatim / precise paraphrase:

- "we have clio voice agent build in elevenlabs already" — a real, configured Clio agent already
  exists in the ElevenLabs dashboard. This build **connects to that existing agent**; it does not
  create, provision, or define one.
- "remember this is not for inline mode. this for the widget solution" — **stated twice,
  emphatically.** Scope is the widget channel only.
- "add an option in admin dashboard to select elevenlabs also as a voice provider"
- "have a text box to enter elevenlabs api key and elevenlabs agent id"
- "for every conversation, you will have to clone the agent and use the parameterized prompt to
  pass to it, other values need not change" — **the cloning half of this was superseded** by Arun's
  own later, explicit confirmation in the same session: use ElevenLabs' native
  `conversation_config_override` at conversation-initiation time, **not** agent cloning. The
  "other values need not change" half **still holds and is binding**: only the prompt is
  overridden per conversation. Voice, model, and every other agent setting stay exactly as the
  base agent has them configured.
- "dont worry about concurrent users limit" — capacity/tier work is explicitly out of scope.

### 1.1 Ground truth added after first issue (2026-08-07, same day)

Arun subsequently supplied the official ElevenLabs deployment reference for the existing agent, plus
three further instructions. All of the following is binding and supersedes anything above that
conflicts with it:

- **Real agent ID: `agent_0701krp1ta48fswrff17ctb0520m`.** Not a placeholder. Arun: *"agent details
  are shared already as well so you can seed it now and i can update it from admin dashboard in
  future if needed."* It is a plain identifier, **not a secret** — seed it as the initial stored
  value. Only the API key stays Arun-entered.
- **Transport: WebRTC**, via a server-minted conversation token —
  `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=...`, header `xi-api-key`,
  server-side only. ElevenLabs recommends WebRTC and states it is lower latency. This is
  architecturally identical to `app/api/openai-realtime-token/route.ts`. See Decision D5.
- **The base agent is already Playground-validated.** Arun: *"this agent in elevenlabs is already
  tested directly using elevenlabs playground so i m positive if we just patchup the integration,
  then we should be good."* This de-risks the agent's **voice, model and persona** — which C3 says
  we do not override. It does **not** de-risk prompt behaviour, because the per-conversation
  override *replaces that validated prompt wholesale*. D3's prompt module remains fully required.
  Do not read this confidence as licence to thin it.
- **Build scope:** *"complete everything that you can build, leave only the testing part and
  entering the api key with me."* The build proceeds end-to-end once the spec is approved. The two
  carve-outs — the live test call, and entry of the real API key — are Arun's own steps **by
  design, not gaps in the build.**

### 1.2 Verified SDK facts (from `github.com/elevenlabs/packages`, `packages/client` source)

Use these verbatim rather than re-deriving: `onConnect({conversationId})`;
`onDisconnect(DisconnectionDetails)` — a discriminated union on `reason` of `"user" | "agent" |
"error"`, genuinely useful for separating a clean end from a failure; `onModeChange({mode})` with
`Mode = "speaking" | "listening"`; `onStatusChange({status})` with `Status` having **four** values
(`disconnected | connecting | connected | disconnecting`); `onError(message: string, context?)` — a
plain string, not an `Error`; `onMessage` payload carries `source: "user" | "ai"` (**`'ai'`**, not
`'agent'` — a separate `Role` type uses `"agent"`, do not conflate);
`sendFeedback(like: boolean | null, eventId?: number)`, which no-ops when `canSendFeedback` is
false; `connectionType` is optional in all three session-config variants.

`overrides` and `dynamicVariables` are siblings on `BaseSessionConfig`, intersected into **all
three** auth variants (`agentId` / `signedUrl` / `conversationToken`) — so overrides ride
regardless of transport. This is type-level confirmed, which is not the same as a live session:
acceptance coverage on a real call is still required.

An unregistered client-tool call is **not** silent — `onError` fires and an `is_error: true` result
is returned over the wire. A per-tool **"Wait for response"** dashboard toggle exists and must be
left **unticked** for all three of our tools, which are fire-and-forget.

---

## 2. The Problem Being Solved

Clio's widget channel today can run on Hume EVI or OpenAI Realtime, selected by a single
platform-wide admin toggle. Arun wants ElevenLabs as a **third selectable option for the widget**,
so he can evaluate its voice quality and conversational behaviour against the incumbents on real
sessions, using the Clio agent he has already built there.

The blocker is not the adapter — it is that ElevenLabs is currently a *dead end* in this codebase:
the package is on the explicitly-removed list, the credentials do not exist anywhere, and the one
existing provider toggle is shared with a channel that must not change.

---

## 3. What Success Looks Like

1. Arun opens `/dashboard/admin`, sees ElevenLabs offered alongside Hume and OpenAI Realtime,
   pastes in an API key and an agent ID, saves, and selects ElevenLabs **for the widget**.
2. He opens a widget session. It connects to his existing ElevenLabs Clio agent, greets correctly,
   teaches the real session content, advances pages, and ends cleanly — behaviourally equivalent
   to what the widget does today on OpenAI Realtime.
3. **The inline / meeting-bot channel (`partner-render`) behaves identically to before, bit for
   bit, no matter what is selected for the widget.** This is a hard success criterion, not a
   nice-to-have.
4. Re-visiting the admin page never shows the API key back in plaintext.

---

## 4. Known Constraints (binding — do not relax)

**C1 — Widget channel only.** Arun said this twice. `app/(with-clerk)/partner-render/` and the
meeting-bot pipeline are out of scope and must be untouched. See Decision D2 below, which makes
this structural rather than a convention someone can accidentally break later.

**C2 — Overrides, not cloning.** Per-conversation prompt customization uses ElevenLabs'
`conversation_config_override`, scoped to a single conversation. One base agent, one agent ID,
referenced by every widget session. Overrides are disabled by default on an ElevenLabs agent for
security and must be explicitly enabled per-field in the agent's settings — **this is a real,
one-time manual setup step Arun must perform in the ElevenLabs dashboard, and the spec must call it
out explicitly as such**, not assume it silently. If it is not done, the override is ignored and
the agent will run its own base prompt — which would look like a working session delivering the
wrong content. That failure mode needs to be visible, not silent.

**C3 — Only the prompt is overridden.** Voice, model, and all other agent config stay as-is on the
base agent. Do not override fields Arun did not ask to override.

**C4 — Credentials come from the admin UI, not env vars.** Arun asked specifically for text boxes.

**C5 — Security, non-negotiable.** The API key is an **outbound** credential — Clio must replay it
to ElevenLabs — so it must be **encrypted-and-retrievable, never hashed**. It must never be logged,
never returned in any API response, never reach client-side code after entry. Write-only from the
admin UI's perspective: an admin can overwrite it, never read it back. A masked indicator
("configured" / `••••a1b2`) is acceptable; the raw value must never round-trip to the browser. The
agent ID is **not** a secret — store it plaintext and show it normally.

**C6 — Do not modify `lib/voice/widget-prompt-rules.ts` or its exported functions.** It carries the
just-shipped v21 restructuring and is OpenAI-specific. See Decision D3.

**C7 — Concurrency/capacity is out of scope** by Arun's explicit instruction.

---

## 5. Decisions I Am Making as CEO (build to these; do not re-open)

These are resolved. I investigated the codebase before deciding; evidence is cited so the BA can
verify rather than trust.

### D1 — Platform-level, NOT per-partner.

**Decision:** one API key and one agent ID for the whole Clio platform, stored in a single
singleton config row, edited from `/dashboard/admin` behind `requireSuperAdmin()`.

**Why this is not ambiguous:** the brief asked me to escalate if genuinely unclear after checking
existing patterns. I checked; it resolves cleanly:
- `system_voice_config` (`supabase/migrations/104_b2b61_system_voice_config.sql`) is a singleton
  whose own migration comment states it is *"the first GLOBAL config table … Not
  partner_account_id-scoped by design."*
- `partner_accounts` has no voice-provider column and never has.
- Arun's phrasing is first-party and singular — *"we have clio voice agent build in elevenlabs
  already"*. It is his agent, not a partner's.
- *"select elevenlabs **also** as a voice provider"* — "also" means *add to the existing selector*,
  and that selector is already platform-level.

The admin-dashboard-vs-env-var point in the original framing is about **redeploy-free editing**,
which is real and honoured here, not about tenancy. A per-partner override remains a clean,
purely-additive change later if a partner ever brings their own ElevenLabs account; nothing in this
design forecloses it.

### D2 — A separate widget-scoped provider setting. This is the most important decision in the brief.

**The trap:** `getActiveVoiceProvider()` (`lib/voice/provider-config.ts`) is read by **two** call
sites, verified directly:
- `app/(with-clerk)/widget-render/[clio_session_ref]/page.tsx:92` — in scope
- `app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx:76` — **explicitly out of scope**

So the obvious implementation — adding `'elevenlabs'` to `system_voice_config.active_provider` —
would mean selecting ElevenLabs in the admin card **also routes inline/meeting-bot sessions to a
provider that has no adapter wiring and no prompt there.** That is a live production regression on
the exact channel Arun ruled out twice.

**Decision:** the widget gets its **own** provider setting, read only by `widget-render`.
`active_provider` keeps its current two-value domain and keeps driving `partner-render` completely
unchanged. Options B (one tri-state setting with defensive coercion in `partner-render`) and C
(per-partner) are rejected: B makes the setting's meaning silently channel-dependent and would show
"ElevenLabs" in the admin UI while the inline channel actually runs something else — precisely the
ambiguity this governance model exists to eliminate.

**Migration requirement, specific and easy to get wrong:** the new widget setting must be **seeded
by copying the current `active_provider` value**, never from a hardcoded default. The widget is
believed to be running OpenAI Realtime today (this session's entire v21 prompt work is
widget-specific and OpenAI-specific); seeding a literal `'hume'` would silently regress it on
deploy. Copying is correct under any current value.

### D3 — A new, self-contained ElevenLabs prompt module.

Follow the established one-prompt-file-per-provider pattern (the widget's OpenAI prompt and the
meeting-bot's OpenAI prompt template are already separate files). Create a **new** module for
ElevenLabs. **Adapt the rule *content*** of `widget-prompt-rules.ts` v21 — the merged HOW THIS
SESSION WORKS / HOW YOU SOUND AND BEHAVE structure, the G-rules, the atomic numbered sub-steps —
into it, since that content is hard-won and current. **Do not import from, re-export, generalise,
or edit `widget-prompt-rules.ts` itself.** Duplication is the correct trade here; this codebase has
made that call before (the Attendee webhook port, deliberately duplicated over a shared-handler
refactor) and for the same reason: protecting a working path from side effects.

### D4 — Use the official ElevenLabs SDK, and update the approved-library list.

`@11labs/client` / `elevenlabs` are currently on CLAUDE.md's **removed — do not use, flag if found
in new code** list, so re-introducing ElevenLabs needs an explicit governance update either way.
The removed adapter (`git show 7a0020a^:lib/voice/elevenlabs-adapter.ts`) was **93 lines** and
almost entirely SDK delegation, versus 428 for Hume and 1008 for the raw-WebSocket OpenAI adapter —
direct evidence the SDK collapses this work dramatically. The raw-WebSocket precedent for Hume and
OpenAI exists because those adapters were structural twins of already-SDK-free routes, not because
SDKs were rejected on principle.

**Decision:** use the current official ElevenLabs client package. The BA must confirm the exact
current package name and that it supports `conversation_config_override` and client tools; if it
does not, escalate to me rather than silently falling back to raw WebSocket. Adding it to CLAUDE.md's
approved list (and removing the stale "removed" line, with a dated note explaining the reversal) is
part of this build's definition of done.

### D5 — WebRTC transport, and the vanilla SDK wrapped in an adapter class (not the React hook).

**Transport.** ElevenLabs offers a WebSocket signed-URL path and a WebRTC conversation-token path,
and recommends WebRTC as lower latency. **Ship WebRTC.** The reasoning matters more than the
choice: the entire purpose of this build is Arun evaluating ElevenLabs' voice quality and
responsiveness against Hume and OpenAI. Shipping the higher-latency transport would have him
evaluating our transport decision rather than the vendor, invalidating the exercise. Under the SDK
this is a single field — `conversationToken` instead of `signedUrl` — so the adapter shape is
identical either way, and the WebSocket path stays documented as a one-field fallback.

**Integration shape.** Use the vanilla `@elevenlabs/client` wrapped in an `ElevenLabsAdapter` class
implementing `VoiceSessionAdapter`. The official `@elevenlabs/react` `useConversation()` hook is
**rejected**: `WidgetRenderClient.tsx` drives all providers through one imperative adapter
interface, and adopting a React hook for one provider only would fork that integration shape for no
gain. Less code is not worth an architecture that is uniform for two providers and special for the
third.

---

## 6. Prior Art the BA Must Read Before Designing

- `git show 7a0020a` — the full ElevenLabs removal commit (2026-07-13) and its message.
- `git show 7a0020a^:lib/voice/elevenlabs-adapter.ts` — the previous adapter, 93 lines. Its
  `onSpeakVerified` billing-signal logic is directly relevant and largely reusable.
- `git show 3d41f9b` — the old agent-pool + per-session KB injection approach. **Read as history,
  do not revive**: it is what `conversation_config_override` replaces.
- Commits `4172805`, `5637da6`, `9dfc509` — the server-side audio relay through Attendee. **Read
  only to recognise and avoid**: that was meeting-bot-channel plumbing, deleted, and is out of
  scope here.
- `lib/voice/adapter.ts` — the `VoiceSessionAdapter` interface, including the four *optional*
  extension points (`sendWrapUpNudge`, `waitForPlaybackCaughtUp`, `triggerRecoveryNudge`,
  `getOutputAnalyser`). The spec must state, per method, whether ElevenLabs implements it or
  deliberately does not — each has a documented reason for existing.
- `lib/voice/hume-adapter.ts`, `lib/voice/openai-realtime-adapter.ts` — the two live implementations.
- `lib/partner/crypto.ts` — `encryptOutboundToken` / `decryptOutboundToken` (AES-256-GCM,
  `v1:<iv>:<tag>:<data>`). **Reuse this; do not invent a new scheme.** Its own doc comment states
  the exact rule that applies here: outbound credentials must be encrypted-and-retrievable, never
  hashed. `encryptContentSourceCredential` is already an alias of it — direct precedent for
  extending it to a new credential class.
- `app/api/admin/configurator/outbound-config/route.ts` — the write-path to copy: GET returns only
  a boolean `*_set` flag, PATCH encrypts on the way in, the secret never comes back out.
- `app/api/admin/voice-config/route.ts` + `app/(with-clerk)/dashboard/admin/VoiceProviderCard.tsx`
  — the existing provider selector, API and UI. Extend these.
- `app/api/hume-token/route.ts`, `app/api/openai-realtime-token/route.ts` — the two per-provider
  credential endpoints. Note both read `process.env` only and are **not** partner-scoped; an
  ElevenLabs equivalent will be the first such route to read its credential from the **database**.

**Known implementation trap, verified, must be addressed explicitly in the spec:**
`WidgetRenderClient.tsx:335` opens `connect()` with `if (!humeConfigId) return`. This gates the
**entire** voice connect flow — *including the existing OpenAI Realtime branch* — on a Hume config
ID being present. A third provider hits the same gate and would silently never connect. The spec
must say exactly how this is handled.

---

## 7. Questions for the BA to Resolve (Section 11 must be empty on delivery)

1. **Exact schema change.** New columns on `system_voice_config`, or a new sibling singleton
   (`system_elevenlabs_config`)? Give the migration verbatim, with the correct next migration
   number, and honour D2's copy-don't-default seeding rule.
2. **Signed URL vs. public agent.** A private ElevenLabs agent requires a server-minted signed URL.
   Specify the new token route (structural twin of the two existing ones), how it reads and
   decrypts the key, its failure behaviour, and confirm it is correctly gated in `middleware.ts`.
3. **Where the override is sent, verbatim.** The exact conversation-initiation payload shape
   carrying the overridden prompt. **Verify against live ElevenLabs documentation and cite it** —
   do not rely on recalled API shapes.
4. **Tools.** The widget depends on `show_visual`, `advance_tab`, `end_session`. Specify how these
   map to ElevenLabs client tools, and whether they must be pre-declared on the base agent (if so,
   that is a second manual setup step for Arun, and it must be listed as prominently as C2's).
5. **Page-advance mechanism.** The widget's transition handling leans on OpenAI-specific signals
   (`transcriptGateMode: 'playback_complete'`, `waitForPlaybackCaughtUp`, `onUserSpeechStarted`).
   State precisely what works, what degrades, and what is knowingly unavailable on ElevenLabs. Be
   honest about gaps rather than assuming parity.
6. **Transcript capture and diagnostics.** `/api/partner/render/transcript-capture` is currently
   gated on `voiceProvider === 'openai_realtime'`. Does ElevenLabs feed it, and does the
   connection-health pill have a real signal? **No fake or decorative signals** — if there is no
   honest source, say so and leave it inert.
7. **Billing.** `onSpeakVerified` is the billing-start signal. Specify exactly what constitutes
   verified-speak on ElevenLabs, and how session duration is measured for the usage ledger.
8. **The `humeConfigId` gate** (Section 6). Exact fix.
9. **`partner_sessions.voice_provider`** has a CHECK constraint of `('hume','openai_realtime')`.
   The per-session snapshot write happens for the widget too. Confirm this needs widening and
   include it in the migration.
10. **Admin UI behaviour.** Full wireframe-level description: where credentials are entered,
    masking, validation, what happens when ElevenLabs is selected with no credentials saved
    (it must not be selectable — mirror the existing `openai_realtime_available` gating pattern),
    and the confirm-before-switch behaviour.
11. **Package name confirmation** per D4.

---

## 8. Explicitly Out of Scope

Inline / meeting-bot / `partner-render` channel. Agent cloning. Agent-pool revival. Server-side
audio relay. Concurrency and tier management. Per-partner ElevenLabs credentials. Any edit to
`lib/voice/widget-prompt-rules.ts`. Making ElevenLabs the *active* provider on deploy — it ships
**selectable but not selected**; Arun must enter credentials and choose it himself.

---

## 9. Rollout

Ships selectable, not active. Rollback is a single admin-UI selection back to the previous
provider, requiring no deploy — the same rollback story B2B-61 shipped with.
