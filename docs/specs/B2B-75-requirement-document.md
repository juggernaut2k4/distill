# B2B-75 — ElevenLabs as a Widget-Only Voice Provider — Requirement Document
Version: 1.1
Status: ✅ **APPROVED BY CEO AGENT — 2026-08-08. Cleared for build.**
Author: Business Analyst Agent
Date: 2026-08-07 (v1.0), revised 2026-08-08 (v1.1)
Feature Brief: `.claude/agents/clio/feature-briefs/B2B-75-elevenlabs-widget-voice-provider.md`
Closest structural model: `docs/specs/B2B-61-requirement-document.md` (added OpenAI Realtime as the second provider)

---

## CEO Approval — 2026-08-08

**Approved. Section 11 is empty. Build may proceed.**

Verified by the CEO Agent directly rather than accepted on the BA's report:

- §11 contains no open questions — it is a resolution log, all eleven brief questions closed.
- Migration 111 implements D2's copy-don't-default seeding correctly (`ADD COLUMN … NULL` →
  `UPDATE … SET widget_provider = active_provider` → `SET NOT NULL`, no `DEFAULT` anywhere). This
  was the single highest-risk silent-regression item in the build and it is right.
- `111` confirmed as the next free migration number (`110_b2b70_…` is current highest).
- All eleven CEO review-round items and both addendum items are present in the document.
- AT-15 asserts observable behaviour only, with no dependency on an undocumented error string.
- WebRTC conversation-token expiry is recorded as **undocumented**, with the fresh-mint-per-session
  mitigation making the unknown non-load-bearing.
- `@elevenlabs/client@1.17.0` and its transitive `livekit-client` independently confirmed by the
  CEO Agent via `npm view`: last published 2026-07-30 and 2026-07-23 respectively, neither
  deprecated, `livekit-client` declared under `dependencies` (not `peerDependencies`).

**Two carve-outs are Arun's own steps by design, not gaps in this build:** the live test call, and
entry of the real ElevenLabs API key. Everything else ships complete.

### Approval re-confirmed after v1.1 resubmission

The BA resubmitted with one **new design change made after the initial stamp** — §6.6.6, error
discrimination. Re-verified rather than left to ride on the earlier approval:

- **§6.6.6 is correct and its inclusion is endorsed.** `@elevenlabs/client` routes fatal connection
  errors, unregistered-tool calls, and throwing tool handlers through one `onError`, while
  `WidgetRenderClient`'s shared handler does `setStatus('error')` + `setConnectionHealth('red')`.
  Undiscriminated, a single transient tool fault on a healthy connection would paint the session as
  broken while Clio kept talking — and two of the three classes are our own code's faults, not the
  connection's. The `context.clientToolName` discriminator is the right mechanism, and the fix does
  not swallow anything: the fault still reaches `reportError` and the diagnostic timeline, and the
  SDK still returns `is_error: true` to the agent. Not supplying `onUnhandledClientToolCall` is
  also correct — it suppresses both the `onError` and the wire response, leaving the agent waiting
  on a result that never arrives. AT-23 asserts both directions.
- **AT-22** (`source` vs `role`) is a real trap worth its test: the capture route returns
  `200 { ok: false }` on Zod failure by design so it can never block a live call, so sending
  `'agent'` would silently drop every one of Clio's turns from the transcript.
- **§11 Q2's staleness is fixed** — it previously still described WebRTC as *rejected*, a leftover
  from v1.0 that I missed and the BA caught on its own sweep. It now reads correctly.
- Token expiry, `xi-api-key` provenance, and the `livekit-client` entry all land as directed.

**The BA correctly declined to edit `CLAUDE.md` itself**, writing the changes as developer
instructions in §6.11 instead. That is the right boundary and it holds for me too: the
approved-library decision is mine to make, but the governance file gets edited during the build
under Arun's normal flow, not by an agent on a peer's say-so.

Approval stands, now covering v1.1 in full.

**Standing gate that still applies:** per `.claude/agents/clio/ceo.md`, no merge without all three
QA gates, and **Gate 3 (live browser UI functional testing) cannot be waived**. A code-review-only
PASS is invalid. Note that Gate 3 here overlaps Arun's own live-test carve-out — the QA agent must
still perform every non-voice UI verification it can reach without a real API key (admin card
states, credential masking, disabled-tile gating, the inline-channel isolation proof in AT-8/AT-9),
and must report the voice-path items as explicitly deferred to Arun rather than marking them
passed.

---

## Revision History

**v1.1 (2026-08-08) — CEO review round 1.** Nine items raised; all nine resolved, each verified
against primary sources by this document's own author rather than accepted on relay. Summary:

1. **Real agent id seeded.** `agent_0701krp1ta48fswrff17ctb0520m` is now seeded by migration 111
   (§6.1). Admin-UI "not configured" states rewritten — the missing credential is the **API key
   only** (§4.2.3).
2. **Transport switched to WebRTC.** Reverses v1.0's Q2 resolution. The token endpoint's auth header
   is now confirmed verbatim from ElevenLabs' own server-side example (§6.4). WebSocket retained as
   a documented one-field fallback.
3. **`overrides` + auth-field coexistence upgraded from *reasoned* to *type-level confirmed*** —
   verified directly in the SDK's own `BaseSessionConfig` (§0.B, §6.5). AT-6 retained.
4. **Callback signatures corrected verbatim** from `types.ts` (§0.B, §6.6.4). Four corrections to
   v1.0, including `Status` having **four** values and `onDisconnect` carrying a
   `DisconnectionDetails` payload v1.0 assumed absent.
5. **Unregistered / failing client tools are loud, not silent** (§8) — and this surfaced **a real
   trap the review did not name**: the SDK routes client-tool failures through the *same* `onError`
   that carries fatal connection errors, which in `WidgetRenderClient` would kill a healthy session's
   UI. Discriminator and fix in §6.6.6.
6. **Third manual setup item added** — the per-tool **"Wait for response"** toggle must be left
   **unticked** (§12.1 step 3).
7. **AT-15 decoupled from any error string** — now asserts observable behaviour only (§7).
8. **`dynamicVariables` documented as considered-and-rejected** (§6.5.1).
9. **D3 strengthened, not weakened** — a new §6.10.1 states explicitly why Playground validation does
   not de-risk prompt behaviour.

Plus two findings of this revision's own: `livekit-client` is a **direct runtime dependency** of
`@elevenlabs/client` (§0.B, §6.11), and the `@elevenlabs/react` rejection is recorded (§6.11).

---

## 0. Verification Pass — every load-bearing claim re-checked against source and against live vendor documentation

Per this project's standing rule that specs must be grounded in real code and real docs, nothing below
is taken on faith. Two categories were verified: (A) the CEO brief's claims about this codebase, and
(B) every ElevenLabs API shape, which is verified against live documentation with the URL cited inline
(brief §7 Q3 explicitly forbids recalled API shapes — a wrong payload here produces a session that
connects and then teaches the wrong content).

### 0.A — Codebase claims (all confirmed by direct read)

- **`getActiveVoiceProvider()` has exactly two call sites — confirmed.**
  `lib/voice/provider-config.ts` exports one function returning `'hume' | 'openai_realtime'`.
  Callers: `app/(with-clerk)/widget-render/[clio_session_ref]/page.tsx:92` (in scope) and
  `app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx:76` (**out of scope**). The CEO's D2
  trap is real exactly as described: widening `active_provider`'s domain would route inline /
  meeting-bot sessions to a provider with no wiring there.
- **The `humeConfigId` gate — confirmed, and worse than the brief states.**
  `WidgetRenderClient.tsx:335` is `if (!humeConfigId) return`, gating the whole `connect()` body
  including the OpenAI branch. `humeConfigId` is additionally used as a boolean at **three further
  sites** the brief did not enumerate: line 224 (`useState(Boolean(humeConfigId))` for the connect
  warm-up overlay), line 624 (`if (!humeConfigId) return` guarding the elapsed-timer effect), and
  line 719 (`Boolean(humeConfigId) && (...)` gating the entire call-controls overlay — mute button,
  level pills, End-session button, connection pill). A fix that only touches line 335 produces a
  connected ElevenLabs session with **no visible controls and no timer**. All four sites are named in
  §6.7 and §10.A.
- **`lib/partner/crypto.ts` — confirmed.** `encryptOutboundToken`/`decryptOutboundToken`, AES-256-GCM,
  format `v1:<iv-hex>:<tag-hex>:<data-hex>`, null-on-corrupt-never-throws, key from
  `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY` with a dev fallback. `encryptContentSourceCredential` is
  already a plain `export const … = encryptOutboundToken` alias (lines 77-78) — direct precedent for
  extending it to a new credential class, exactly as the brief claims.
- **`app/api/admin/configurator/outbound-config/route.ts` — confirmed as the write-path precedent.**
  GET returns only `outbound_auth_token_set: Boolean(data?.outbound_auth_token_ciphertext)` (line 47);
  PATCH encrypts on the way in (line 71); the secret never comes back out.
- **`app/api/hume-token/route.ts` / `app/api/openai-realtime-token/route.ts` — confirmed.** Both read
  `process.env` only, both `export const dynamic = 'force-dynamic'`, both set
  `Cache-Control: no-store`, both normalise to `{ accessToken, expiresIn }`. Neither is
  partner-scoped. An ElevenLabs equivalent will indeed be the first token route reading its
  credential from the **database**.
  **Additionally confirmed, and carried into this spec as a hard requirement:** the OpenAI route
  carries a documented, live-diagnosed bug fix — `cache: 'no-store'` on the outbound `fetch()`,
  without which Next.js's Data Cache silently served the *same* token to repeated callers
  (route comment lines 22-30). The ElevenLabs route mints a per-session conversation token and has
  the same exposure — in fact a worse one, since its response also carries a `conversation_id`, so a
  cached response would hand concurrent participants a shared conversation identity as well as a
  shared credential. §6.4 requires the same `cache: 'no-store'`.
- **`middleware.ts` — confirmed, with one finding.** Token routes are **not** in `isPublicRoute`, and
  do not need to be: `isApiRoute` short-circuits Clerk's page gate for anything under `/api/`
  (lines 149-151). But `TENANT_SCOPED_PATTERNS` (lines 48-60) lists `/^\/api\/hume-token$/` and
  **does not list `/api/openai-realtime-token`** — a real, pre-existing, currently-dormant gap
  (dormant because widget/partner render URLs are always built from `NEXT_PUBLIC_APP_URL` today).
  This spec adds the ElevenLabs pattern so the same gap is not created afresh, and flags the OpenAI
  omission for `BACKLOG.md` rather than fixing it here (out of scope, different channel's provider).
- **`partner_sessions.voice_provider` — confirmed.** Migration `106_voice_provider_per_session.sql`:
  `CHECK (voice_provider IS NULL OR voice_provider IN ('hume', 'openai_realtime'))`. The widget page
  **does** write it (`widget-render/page.tsx:97-103`). Widening is required (brief Q9 — confirmed).
- **`inngest/partner-session-insights-extractor.ts` — confirmed, and this is a live trap the brief
  did not name.** Line 265 branches on `session.voice_provider === 'openai_realtime'` to read the
  transcript from Redis; **every other value falls through to Hume's transcript API** (lines 269-272),
  which would be called with an ElevenLabs conversation id. This is the exact failure class migration
  106 was created to fix for OpenAI. Line 240 additionally hard-throws if `hume_chat_id` is null.
  Both addressed in §6.9.
- **`lib/voice/adapter.ts` — confirmed.** Four optional extension points (`sendWrapUpNudge`,
  `waitForPlaybackCaughtUp`, `triggerRecoveryNudge`, `getOutputAnalyser`) plus the required members.
  Per-method decisions in §6.6.
- **`git show 7a0020a^:lib/voice/elevenlabs-adapter.ts` — read in full (93 lines).** Its
  `onSpeakVerified` fires on the **first confirmed `isOpen()`** with a 200ms poll and a 10s give-up.
  **This is weaker than the bar `lib/voice/adapter.ts` states today** ("a REAL, working voice
  connection capable of producing audio… must NOT fire on … a merely-attempted connection"). Hume
  requires `chat_metadata` **plus** a first speaking event; OpenAI requires `session.updated` **plus**
  a first `response.output_audio.delta`. This spec therefore does **not** reuse the old logic as-is —
  §6.6 specifies a two-signal equivalent. Flagged explicitly because the brief called the old logic
  "largely reusable"; its *shape* is reusable, its *threshold* is not.
- **`git show 3d41f9b`, `4172805`, `5637da6`, `9dfc509`** — read as history only. The agent-pool +
  per-session KB injection approach (`lib/elevenlabs-pool.ts`, 209 lines, deleted) and the
  server-side audio relay (`server.ts`, `lib/voice/relay-handler.ts`, deleted) are both confirmed
  gone and are **not** revived. `conversation_config_override` replaces the former; the latter was
  meeting-bot plumbing and is out of scope.
- **Leftover ElevenLabs references, swept.** `.env.local.example` still contains
  `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`, `NEXT_PUBLIC_ELEVENLABS_VOICE_ID` and
  `ELEVENLABS_CUSTOM_LLM_SECRET` (the 7a0020a commit message itself records this as a known,
  permission-blocked follow-up). `ELEVENLABS_CUSTOM_LLM_SECRET` is **still actively read** by
  `app/api/admin/seed-topics/route.ts` and its own comment says the name is historical, not
  ElevenLabs-specific — so it must **not** be removed. Handled in §6.11.
- **Migration numbering — confirmed.** Highest present is `110_b2b70_meeting_url_nullable_for_widget_channel.sql`.
  **Next free number is 111.** (Re-verify at build time; other in-flight branches may claim it.)
- **`package.json` — confirmed.** No ElevenLabs package present. `@11labs/client` and `elevenlabs`
  were removed by 7a0020a and are on CLAUDE.md's *removed — do not use, flag if found in new code*
  list, so a governance update is required either way (D4).

### 0.B — ElevenLabs API verification (live docs, fetched during this spec's authoring, 2026-08-07)

Every shape used anywhere in this document was fetched, not recalled. Findings that changed the
design are called out.

| Item | Verified result | Source |
|---|---|---|
| Browser client package | **`@elevenlabs/client`** — 721,140 weekly downloads, latest 1.17.0. Clears CLAUDE.md's 100k+ bar and is the official vendor package. | `https://www.npmjs.com/package/@elevenlabs/client` |
| Old package status | `@11labs/client` is **deprecated**, registry message: *"This package is no longer maintained. Please use @elevenlabs/client for the latest version."* Last version 0.2.0. | `https://www.npmjs.com/package/@11labs/client` |
| Server SDK | `@elevenlabs/elevenlabs-js` — a **different** package, for REST. **Not adopted** (see §6.4). | `https://github.com/elevenlabs/elevenlabs-js` |
| React SDK | `@elevenlabs/react` (`useConversation()` hook) — **rejected**, see §6.11. | same |
| **`livekit-client` is a DIRECT runtime dependency** | `packages/client/package.json` `dependencies` block is exactly `{ "@elevenlabs/types": "workspace:*", "livekit-client": "2.16.1" }`. **Not a peerDependency** — there is no `peerDependencies` block at all. So WebRTC transport ships *inside* the approved SDK; the developer installs nothing extra. Governance consequence in §6.11. | `https://raw.githubusercontent.com/elevenlabs/packages/main/packages/client/package.json` |
| `conversation_config_override` supported by the browser client | **Yes** — via the `overrides` option on `startSession`. Full verbatim shape in §6.5. | `https://elevenlabs.io/docs/agents-platform/customization/personalization/overrides` |
| Client tools supported by the browser client | **Yes** — via the `clientTools` option on `startSession`. | `https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools` |
| Overrides disabled by default | **Confirmed verbatim:** *"For security reasons, overrides are disabled by default."* Enabled per-field under agent settings → **Security** tab. | same overrides URL |
| Behaviour when an override is sent but not enabled | **Confirmed verbatim:** *"For most fields, an error will be thrown if an override is provided when that field does not have overrides enabled."* (ASR keywords are the documented soft-fail exception; irrelevant here — this build overrides only the prompt.) | same overrides URL |
| `connectionType` | **Optional in all three config variants**, each inferring from which auth field is supplied. Docs: *"The connection type is automatically inferred based on the conversation mode. Voice conversations use WebRTC and text-only conversations use WebSocket by default."* This spec still passes it explicitly (§6.5) so transport is never inference-dependent. | `https://elevenlabs.io/docs/agents-platform/libraries/java-script` |
| **WebRTC conversation-token endpoint (the SHIPPED path)** | `GET https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=<id>`. Query params: `agent_id` (required), `participant_name` / `branch_id` / `environment` (optional). Response: `{ "token": string, "conversation_id": string }`. **Auth header `xi-api-key` — INFERRED FROM EXAMPLES, not doc-stated:** it appears in ElevenLabs' own server-side code example (quoted verbatim in §6.4) and matches the sibling signed-URL endpoint and every other convai endpoint, but no prose anywhere states it as required. Practically certain; labelled honestly. **Expiry: NOT STATED ANYWHERE.** | `https://elevenlabs.io/docs/agents-platform/libraries/java-script`, `https://elevenlabs.io/docs/api-reference/conversations/get-conversation-token` |
| ⚠️ **The 15-minute expiry belongs to the WebSocket endpoint ONLY** | `get-signed-url` documents 15 minutes. `/conversation/token` documents **no duration at all**, and several web sources conflate the two. **Do not carry the figure across.** This spec asserts no WebRTC TTL and is designed not to need one (§6.4). | `https://elevenlabs.io/docs/api-reference/conversations/get-conversation-token` (states none) vs `https://elevenlabs.io/docs/eleven-agents/customization/authentication` (states 15 min for the signed URL) |
| WebSocket signed-URL endpoint (documented fallback) | `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=<id>`, header `xi-api-key`, response `{ "signed_url": "wss://…" }`, **valid 15 minutes** for *initiation*. | `https://elevenlabs.io/docs/eleven-agents/customization/authentication` |
| WebRTC audio format | *"In WebRTC mode the input format and sample rate are hardcoded to `pcm` and `48000` respectively."* Entirely SDK-internal — this build never touches audio formats. Noted only so it is not mistaken for something to configure. | `https://elevenlabs.io/docs/agents-platform/libraries/java-script` |
| Post-hoc transcript API | **Exists**: `GET https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}`. Materially different from OpenAI, which has none. Design consequence in §6.9. | `https://elevenlabs.io/docs/api-reference/conversations/get` |
| Conversation methods confirmed present | `endSession()`, `getId()`, `setVolume({volume})`, `setMicMuted(bool)`, `getInputVolume()`, `getOutputVolume()`, `sendFeedback(bool)`, `sendContextualUpdate(string)`, `sendUserMessage(string)`, `sendUserActivity()`, `getInputByteFrequencyData()`, `getOutputByteFrequencyData()`, `changeInputDevice()`, `changeOutputDevice()`. | `https://elevenlabs.io/docs/agents-platform/libraries/java-script` |
| **Callback signatures — VERBATIM from `src/types.ts`** (four corrections to v1.0) | ```ts\nexport type Callbacks = {\n  onConnect?: (props: { conversationId: string }) => void;\n  onDisconnect?: (details: DisconnectionDetails) => void;\n  onError?: (message: string, context?: any) => void;\n  onMessage?: (props: MessagePayload) => void;\n  onAudio?: (base64Audio: string) => void;\n  onModeChange?: (prop: { mode: Mode }) => void;\n  onStatusChange?: (prop: { status: Status }) => void;\n  onCanSendFeedbackChange?: (prop: { canSendFeedback: boolean }) => void;\n  onUnhandledClientToolCall?: (params: ClientToolCallClientEvent["client_tool_call"]) => void;\n  onDebug?: (props: any) => void;\n};\n``` | `https://raw.githubusercontent.com/elevenlabs/packages/main/packages/client/src/types.ts` |
| **`Status` has FOUR values, not three** | `export type Status = "disconnected" \| "connecting" \| "connected" \| "disconnecting";` — v1.0's pill mapping assumed three. Corrected in §6.7c. | same |
| **`onDisconnect` carries a payload** (v1.0 assumed none) | `export type DisconnectionDetails =`<br>`  \| { reason: "error"; message: string; context: DisconnectionContext; closeCode?: number; closeReason?: string }`<br>`  \| { reason: "agent"; context?: DisconnectionContext; closeCode?: number; closeReason?: string }`<br>`  \| { reason: "user" }`<br>A discriminated union that cleanly separates a participant-ended session from an agent-ended one from a real failure. **Used**, not merely noted — §6.6.4, §6.6.7. | same |
| **`onMessage` payload — `source` is `'ai'`, and `role` is a separate field** | `export interface MessagePayload { message: string; event_id?: number; source: "user" \| "ai"; role: Role; }` with `export type Role = "user" \| "agent";`. **`source` and `role` are different fields with different vocabularies** — the adapter must read `source`, never `role`. Confirmed in §6.9. | same |
| `Mode` | `export type Mode = "speaking" \| "listening";` — as v1.0 had. | same |
| `sendFeedback` — real signature | `public sendFeedback(like: boolean \| null, eventId?: number)`. Guarded: `if (!this.canSendFeedback) { console.warn("Cannot send feedback: the conversation is not connected."); return; }` — **it no-ops rather than throwing.** Adapted at the boundary in §6.6.4. | `https://raw.githubusercontent.com/elevenlabs/packages/main/packages/client/src/BaseConversation.ts` |
| **Client-tool result / failure handling — loud, not silent** | Success sends `{ type: "client_tool_result", tool_call_id, result: formattedResult, is_error: false }`, where non-strings are `typeof result === "object" ? JSON.stringify(result) : String(result)`. An **unregistered** tool calls `onUnhandledClientToolCall` if supplied and returns; otherwise calls `onError(...)` **and** sends `is_error: true` with `"Client tool with name ${tool_name} is not defined on client"`. A **throwing** handler calls `onError("Client tool execution failed with following error: …", { clientToolName })` and sends `is_error: true`. **Both failure paths route through `onError` — see §6.6.6 for the trap this creates.** | same |
| **`isOpen()`** | **Does NOT exist** on `@elevenlabs/client`. The old 93-line adapter's entire `onSpeakVerified` logic was built on it. Design consequence in §6.6. | same |
| **AnalyserNode accessor** | **Does NOT exist.** Only `getOutputByteFrequencyData(): Uint8Array`. `VoiceSessionAdapter.getOutputAnalyser()` cannot be honestly implemented. Design consequence in §6.6. | same |
| **"Audio playback finished" event** | **Does NOT exist as a discrete event.** The nearest real signal is `onModeChange → 'listening'`. Treated as an explicitly-labelled proxy in §6.6, never as parity. | same |
| **"User started speaking" callback** | **Not exposed** as a browser-client callback. (`vad_score` exists at the raw-WebSocket protocol level only.) Degradation stated in §6.6. | `https://elevenlabs.io/docs/conversational-ai/customization/events/client-events` |
| **System-role inject + force a turn** | **No such primitive.** `sendContextualUpdate` delivers context but does not force a turn; `sendUserMessage` forces a turn but is attributed to the *user*. Degradation and the explicit rejection of `sendUserMessage` are in §6.6. | JS SDK URL above |

**`overrides` + auth-field coexistence — upgraded from *reasoned* to *type-level confirmed*.**
v1.0 flagged this as structurally reasoned but not found in a single doc sentence. It is now
confirmed directly in the SDK's own source. `overrides` and `dynamicVariables` are fields of
**`BaseSessionConfig`**, which all three session-config variants extend:

```ts
// BaseSessionConfig (excerpt)
overrides?: {
  agent?: { prompt?: ConversationConfigOverrideAgentPrompt; firstMessage?: string; language?: Language };
  tts?: { voiceId?: string; speed?: number; stability?: number; similarityBoost?: number };
  asr?: { keywords?: string[] };
  conversation?: { textOnly?: boolean };
};
dynamicVariables?: Record<string, string | number | boolean>;
userId?: string;

// The three variants — note the mutual exclusion is enforced at type level via `never`
PublicSessionConfig            { agentId: string;            connectionType?: ConnectionType; signedUrl?: never;  conversationToken?: never }
PrivateWebSocketSessionConfig  { signedUrl: string;          connectionType?: "websocket";    agentId?: never;    conversationToken?: never }
PrivateWebRTCSessionConfig     { conversationToken: string;  connectionType?: "webrtc";       agentId?: never;    signedUrl?: never }

type SessionConfig = PublicSessionConfig | PrivateWebSocketSessionConfig | PrivateWebRTCSessionConfig
```
Source: `https://raw.githubusercontent.com/elevenlabs/packages/main/packages/client/src/utils/BaseConnection.ts`

**Overrides therefore ride regardless of which auth path is used** — including
`conversationToken` (WebRTC), the path this build ships. This is now a type-level guarantee, not an
inference.

**AT-6 is nevertheless retained.** Type-level confirmation proves the field is *accepted and
transmitted*; it does not prove the ElevenLabs **server** honours it for this specific agent with
this specific Security-tab configuration. Only a real session proves that, and the failure it guards
against — a session that connects and sounds perfect while teaching the base agent's own material —
is the single most expensive silent failure in this build.

---

## 1. Purpose

Clio's widget channel can today run on Hume EVI or OpenAI Realtime, chosen by a single platform-wide
admin toggle. Arun has already built and configured a Clio voice agent inside ElevenLabs and wants to
evaluate its voice quality and conversational behaviour against the two incumbents on real widget
sessions. This feature makes ElevenLabs a **third selectable option for the widget channel only**,
with its credentials entered from the admin dashboard rather than baked into env vars, so switching
providers — and switching back — never requires a redeploy.

The blocker is not the adapter. It is that ElevenLabs is currently a dead end in this codebase: the
package sits on CLAUDE.md's *removed — flag if found in new code* list, no credential of that class
exists anywhere, and the one existing provider toggle is shared with a channel (`partner-render`, the
meeting-bot/inline path) that Arun ruled out of scope twice and that must not change.

**What failure looks like without it:** the evaluation cannot happen at all without a code change and
a deploy per provider swap — and the naive version of that change (adding `'elevenlabs'` to the
existing `active_provider` toggle) would silently route live meeting-bot sessions to a provider with
no adapter wiring and no prompt on that path. That is a production regression on the exact channel
this feature is forbidden to touch.

## 2. User Story

As the super-admin (Arun),
I want to save my ElevenLabs API key and agent ID in the admin dashboard and select ElevenLabs as the
voice provider **for the widget channel**,
So that I can hear my existing ElevenLabs Clio agent deliver a real session and compare it against
Hume and OpenAI Realtime — without a redeploy, and without any risk to meeting-bot sessions.

As a **widget session participant** (an end-user loading a reseller's embedded Clio widget),
I want the session to greet me, teach the material, move the pages, and end cleanly,
So that the experience is indistinguishable from a session on the current provider.

(Two user types only. The participant never sees, chooses, or knows about the provider. Partner
admins have no interaction with this feature whatsoever — see D1: this is platform-level, not
per-partner.)

## 3. Trigger / Entry Point

### 3.1 Admin configuration surface
- **Route:** `/dashboard/admin` — the existing super-admin home page
  (`app/(with-clerk)/dashboard/admin/page.tsx`). **No new route is created.**
- **Trigger:** a new card, `WidgetVoiceProviderCard`, mounts and fetches its own state
  (`GET /api/admin/widget-voice-config`) automatically on page load — the identical fetch-on-mount
  pattern `DemoAccessCard` and the existing `VoiceProviderCard` already use. Saves fire only on an
  explicit button click, gated by `window.confirm(...)` for a provider switch (§4).
- **Required state:** `page.tsx` already calls `requireSuperAdmin()` server-side before rendering
  anything (line 46-47), so an `internal_staff` or unauthenticated caller never reaches a page where
  this card could render. The new API route independently re-enforces `requireSuperAdmin()` on both
  verbs, exactly like every other route under `app/api/admin/`.

### 3.2 Live session surface
- **Route:** `/widget-render/[clio_session_ref]` — existing, public, no Clerk session, loaded inside
  a reseller's iframe. **No new route.**
- **Trigger:** page load. The server component reads the widget provider setting, and if it resolves
  to `'elevenlabs'`, `WidgetRenderClient` constructs an `ElevenLabsAdapter` instead of a Hume or
  OpenAI one.
- **Required state:** the session ref must resolve to a real `partner_sessions` row **with
  `delivery_channel = 'widget'`** — the existing guard at `page.tsx:85-89`, unchanged.

### 3.3 Manual setup Arun must complete first
See §12.1. Two of those steps are **mandatory before the first ElevenLabs session will work
correctly**, and one of them fails in a way that looks like success if skipped.

## 4. Screen / Flow Description

### 4.1 `/dashboard/admin` — card layout

Two cards, not one. The existing `VoiceProviderCard` stays **byte-for-byte unchanged** and continues
to control `system_voice_config.active_provider`, which drives `partner-render` only. A **new,
separate** `WidgetVoiceProviderCard` is rendered directly below it and controls the widget channel.

This separation is deliberate and is the visible expression of Decision D2: two channels, two
settings, two cards. A single card with a channel dropdown would recreate exactly the "the admin
picked ElevenLabs but the inline channel is actually running something else" ambiguity D2 exists to
eliminate.

Existing card's heading and subheading are amended in **copy only** (no logic change) so the two are
not confusable:
- Heading stays `"Live voice provider"`.
- Subheading changes from `"Controls which voice AI powers new live sessions across all partners."`
  to `"Controls which voice AI powers new meeting-bot sessions across all partners. The widget
  channel is configured separately below."`

> This is the **only** permitted edit to `VoiceProviderCard.tsx`. Its state, handlers, tiles, PATCH
> body, and route remain untouched.

### 4.2 New card — `WidgetVoiceProviderCard`

Container: `bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6` — the same outer wrapper
convention `DemoAccessCard` and `VoiceProviderCard` already use, not a new visual style.

Heading: `"Widget voice provider"` — white, `text-base font-semibold`.
Subheading: `"Controls which voice AI powers new widget-channel sessions. Meeting-bot sessions are
unaffected by this setting."` — `text-[#475569] text-xs`.

The card has two stacked regions, in this order:
1. **Provider selector** — three tiles.
2. **ElevenLabs credentials** — an API-key field and an agent-ID field.

The credentials region is placed **below** the selector but is what gates it, which is stated in copy
(§4.2.3) so the ordering never reads as a trap.

#### 4.2.1 State 1 — Initial load (before `GET /api/admin/widget-voice-config` returns)
- Heading and subheading as above.
- Body: `"Checking…"` — `text-[#94A3B8] text-sm`. Identical string and styling to `DemoAccessCard`'s
  and `VoiceProviderCard`'s own loading state.
- No tiles, no inputs, no buttons rendered.

#### 4.2.2 State 2 — Load error (GET fails or returns non-200)
- Heading and subheading unchanged.
- Body: `"Couldn't load widget voice settings. Try refreshing the page."` — `text-[#EF4444] text-sm`.
- No retry button — a page refresh is the recovery path, matching `DemoAccessCard`'s and
  `VoiceProviderCard`'s existing convention for this exact failure mode.
- Nothing interactive is rendered.

#### 4.2.3 State 3 — Loaded, nothing pending

**Provider selector.** Three tiles, laid out `flex flex-col gap-2` below `sm:` and
`sm:flex-row sm:gap-3` at `sm:` and above, each `sm:flex-1`:

- **Tile 1 — `"Hume EVI"`.** Always selectable.
- **Tile 2 — `"OpenAI Realtime"`.** Selectable iff `openai_realtime_available` is true (it is, today).
  If false: `opacity-40 cursor-not-allowed pointer-events-none`, caption
  `"Coming soon — adapter in development."` (`text-[#475569] text-[11px]`), no click handler.
- **Tile 3 — `"ElevenLabs"`.** Selectable iff `elevenlabs_available` is true (§6.3 — the code-level
  availability flag **and** both credentials present). If false, the tile renders
  `opacity-40 cursor-not-allowed pointer-events-none` with one of three captions, chosen by the API's
  own `elevenlabs_blocked_reason` field so the admin is never left guessing which credential is
  missing:
  - `elevenlabs_blocked_reason === 'api_key'` → caption `"Add an API key below to enable."`
    (`text-[#475569] text-[11px]`) — **this is the expected day-one state**, since migration 111
    seeds the agent id but never the key.
  - `elevenlabs_blocked_reason === 'agent_id'` → caption `"Add an agent ID below to enable."`
    — only reachable if an admin clears the seeded agent id.
  - `elevenlabs_blocked_reason === 'flag'` → caption `"Coming soon — adapter in development."`

Selected/active styling on every tile is the existing radio-tile convention reused verbatim from
`DemoAccessCard`'s `TOPUP_TIERS` and `VoiceProviderCard`: `border-[#7C3AED] bg-[#7C3AED]/10` when
selected, plain `border-[#222222]` otherwise; the currently-saved tile carries an `"ACTIVE"` badge
(`text-[10px] uppercase tracking-wide text-[#7C3AED]`).

Below the tiles, always shown: `"Sessions already in progress keep using their original provider —
only widget sessions started after you save switch to the new one."` — `text-[#94A3B8] text-xs`.

**ElevenLabs credentials.** Separated from the selector by a `border-t border-[#222222] mt-4 pt-4`
divider. Sub-heading `"ElevenLabs credentials"` — `text-white text-sm font-medium`, with the caption
`"Stored encrypted. The API key can be replaced but never viewed again."` —
`text-[#475569] text-[11px] mb-3`.

- **Field 1 — API key.**
  - Label: `"API key"` — `text-[#94A3B8] text-xs mb-1`.
  - Input: `type="password"`, `autoComplete="off"`, full width,
    `bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-white text-sm`.
  - Placeholder depends on saved state:
    - `elevenlabs_api_key_set === true` → placeholder `"Configured — enter a new key to replace"`,
      and a green status line directly beneath: `"✓ Configured"` — `text-[#10B981] text-[11px] mt-1`.
    - `elevenlabs_api_key_set === false` → placeholder `"xi-…"`, and a muted status line beneath:
      `"Not configured"` — `text-[#475569] text-[11px] mt-1`.
  - **The field is always rendered empty on load and after every successful save.** The stored key is
    never fetched, never returned by the API, and never populates this input (C5).
- **Field 2 — Agent ID.**
  - Label: `"Agent ID"` — `text-[#94A3B8] text-xs mb-1 mt-3`.
  - Input: `type="text"`, full width, same styling as Field 1.
  - Placeholder: `"agent_…"`.
  - **Pre-filled with the saved value** — the agent ID is not a secret (C5) and is shown normally.
    **On a fresh deploy this is already populated** with the seeded real agent id (§6.1), so the
    admin's only required action is entering the API key.
  - Below it, a muted caption: `"Clio's agent in your ElevenLabs workspace. Change this only if you
    rebuild the agent."` — `text-[#475569] text-[11px] mt-1`.
- **`"Save credentials"` button** — appears only when at least one field has been edited from its
  loaded state. Styling `bg-[#7C3AED] text-white text-sm font-semibold rounded-lg px-4 py-2.5 mt-3`,
  `w-full` below `sm:` and `sm:w-auto` above.
  - **No `window.confirm` on this button.** Saving credentials is additive and does not change what
    any live or future session runs on; the confirm step is reserved for the provider switch, which
    does. Stated explicitly so it does not read as an omission.

#### 4.2.4 State 4 — Pending provider change
Clicking an *enabled* tile that is not the currently-saved `widget_provider` sets a local
`pendingProvider` and fires **no network request**.
- The clicked tile shows `border-[#7C3AED] bg-[#7C3AED]/10` with a `"SELECTED"` badge.
- The still-saved tile drops `"ACTIVE"` and shows plain caption `"Currently active"` —
  `text-[#94A3B8] text-[11px]` — so current and pending are visible simultaneously.
- A **`"Save provider"`** button appears below the informational line, same styling as
  `"Save credentials"`.
- Clicking the saved tile again clears `pendingProvider` and the button disappears (back to State 3).
  A no-op PATCH can therefore never be sent from the UI.

#### 4.2.5 State 5 — Saving
Triggered only after `"Save provider"` is clicked **and** the `window.confirm(...)` is accepted (§5),
or immediately on `"Save credentials"`.
- All tiles and both inputs become `pointer-events-none` / `disabled`.
- The clicked button is disabled and its label swaps to `"Saving…"` — the identical
  disabled/label-swap convention `DemoAccessCard` and `VoiceProviderCard` already use.

#### 4.2.6 State 6 — Save success
- The PATCH response becomes the new source of truth. **Non-optimistic**: the displayed `"ACTIVE"`
  tile and the `"✓ Configured"` status only change once a 200 has actually been received.
- `pendingProvider` clears; both inputs reset (**API key input cleared to empty**, agent-ID input
  refilled from the response's `elevenlabs_agent_id`); both buttons disappear.
- A green line appears above the tiles, `text-[#10B981] text-xs`, clearing after 4 seconds via a
  local `setTimeout`:
  - after a provider save: `"Saved — new widget sessions will now use {ProviderLabel}."`
  - after a credentials save: `"ElevenLabs credentials saved."`
- **If a credentials save has just made ElevenLabs selectable**, Tile 3's disabled styling and
  caption are dropped in the same render — the response carries the recomputed `elevenlabs_available`
  and `elevenlabs_blocked_reason`, so no second fetch and no page refresh is needed.

#### 4.2.7 State 7 — Save error
- The displayed saved state does **not** change. `pendingProvider` and any typed input are preserved
  exactly, so the admin can retry without re-entering anything.
- Inline error line below the tiles / above the buttons, `text-[#EF4444] text-xs`:
  - generic failure → `"Couldn't save — try again."`
  - HTTP 400 with `error === 'elevenlabs_api_key_missing'` →
    `"Add an API key before selecting ElevenLabs."`
  - HTTP 400 with `error === 'elevenlabs_agent_id_missing'` →
    `"Add an agent ID before selecting ElevenLabs."`
  - HTTP 400 with `error === 'elevenlabs_not_available'` →
    `"ElevenLabs isn't available yet."`
- The button returns to its enabled label. Clicking it again re-opens the confirm (provider save
  only) and retries.

### 4.3 Live widget session flow — ElevenLabs selected

Every participant-visible state is **identical to today's OpenAI Realtime widget session**. The
provider is invisible to the participant. For completeness, the full sequence:

1. **Page load.** Black screen with the spinning connect warm-up overlay
   (`WidgetRenderClient.tsx:763-772`, unchanged). Inline content pages are mounted but hidden behind
   it.
2. **Mic permission.** The browser's own permission prompt (`getUserMedia`), unchanged.
3. **Token fetch.** `GET /api/elevenlabs-token` returns a single-use WebRTC conversation token and
   the agent ID. Nothing visible.
4. **Connection.** `Conversation.startSession({ conversationToken, connectionType: 'webrtc',
   overrides, clientTools, … })`. Connection pill shows `"Connecting"` with an amber dot.
5. **Speak-verified.** The moment ElevenLabs confirms both a real conversation **and** the agent
   actually entering speaking mode, the warm-up overlay fades out and the content pages become
   visible. Connection pill turns green, `"Connected"`. The elapsed timer starts ticking.
6. **Session runs.** Clio greets, asks the icebreaker, gives the overview, calls `show_visual` for
   page 1, teaches each page, calls `advance_tab` at each topic boundary, answers off-page questions
   via `show_visual`, and closes.
7. **End.** Clio says the goodbye and calls `end_session`. The page replaces the whole stack with the
   `"Thanks for joining. / This session has ended."` screen (`WidgetRenderClient.tsx:781-790`,
   unchanged). `/api/partner/render/end-session` is posted with the elapsed duration.
8. **Voice failure at any point.** `status: 'error'` → the warm-up overlay is dismissed so content is
   still readable, the connection pill turns red / `"Disconnected"`, and the existing bottom-right
   toast `"Voice connection issue — content is still visible."` appears. Unchanged behaviour.

## 5. Visual Examples

**State 1 — Initial load**
```
┌───────────────────────────────────────────────────────────────┐
│  Widget voice provider                                         │
│  Controls which voice AI powers new widget-channel sessions.    │
│  Meeting-bot sessions are unaffected by this setting.           │
│                                                                  │
│  Checking…                                                       │
└───────────────────────────────────────────────────────────────┘
```

**State 2 — Load error**
```
┌───────────────────────────────────────────────────────────────┐
│  Widget voice provider                                         │
│  Controls which voice AI powers new widget-channel sessions.    │
│  Meeting-bot sessions are unaffected by this setting.           │
│                                                                  │
│  Couldn't load widget voice settings. Try refreshing the page.   │
└───────────────────────────────────────────────────────────────┘
```

**State 3 — Loaded; OpenAI active; ElevenLabs blocked on the missing API key (the real day-one
state: migration 111 seeds the agent id, so only the key is outstanding)**
```
┌───────────────────────────────────────────────────────────────┐
│  Widget voice provider                                         │
│  Controls which voice AI powers new widget-channel sessions.    │
│  Meeting-bot sessions are unaffected by this setting.           │
│                                                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │ Hume EVI     │ │ OpenAI       │ │ ElevenLabs           │    │
│  │              │ │ Realtime     │ │ Add an API key below │    │
│  │ (plain       │ │ ACTIVE       │ │ to enable.           │    │
│  │  border)     │ │ (purple)     │ │ (greyed, no click)   │    │
│  └──────────────┘ └──────────────┘ └──────────────────────┘    │
│                                                                  │
│  Sessions already in progress keep using their original          │
│  provider — only widget sessions started after you save          │
│  switch to the new one.                                          │
│  ─────────────────────────────────────────────────────────────  │
│  ElevenLabs credentials                                          │
│  Stored encrypted. The API key can be replaced but never         │
│  viewed again.                                                   │
│                                                                  │
│  API key                                                         │
│  [ xi-…                                                       ]  │
│  Not configured                                                  │
│                                                                  │
│  Agent ID                                                        │
│  [ agent_0701krp1ta48fswrff17ctb0520m                         ]  │
│  Clio's agent in your ElevenLabs workspace. Change this only     │
│  if you rebuild the agent.                                       │
└───────────────────────────────────────────────────────────────┘
```

**State 3b — Credentials saved; ElevenLabs now selectable; OpenAI still active**
```
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │ Hume EVI     │ │ OpenAI       │ │ ElevenLabs           │    │
│  │              │ │ Realtime     │ │                      │    │
│  │ (plain)      │ │ ACTIVE       │ │ (plain, clickable)   │    │
│  └──────────────┘ └──────────────┘ └──────────────────────┘    │
│  ─────────────────────────────────────────────────────────────  │
│  ElevenLabs credentials                                          │
│  API key                                                         │
│  [ Configured — enter a new key to replace                    ]  │
│  ✓ Configured                                                    │
│                                                                  │
│  Agent ID                                                        │
│  [ agent_0701krp1ta48fswrff17ctb0520m                         ]  │
└───────────────────────────────────────────────────────────────┘
```

**State 4 — Pending provider change (ElevenLabs selected, not yet saved)**
```
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │ Hume EVI     │ │ OpenAI       │ │ ElevenLabs           │    │
│  │              │ │ Realtime     │ │ SELECTED             │    │
│  │ (plain)      │ │ Currently    │ │ (purple border/tint) │    │
│  │              │ │ active       │ │                      │    │
│  └──────────────┘ └──────────────┘ └──────────────────────┘    │
│                                                                  │
│  Sessions already in progress keep using their original          │
│  provider — only widget sessions started after you save          │
│  switch to the new one.                                          │
│                                                                  │
│  [ Save provider ]                                               │
```

**State 5 — Saving**
```
│  [ Saving… ]     (disabled; tiles and both inputs locked)        │
```

**State 6 — Save success**
```
│  Saved — new widget sessions will now use ElevenLabs.            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │ Hume EVI     │ │ OpenAI       │ │ ElevenLabs           │    │
│  │ (plain)      │ │ Realtime     │ │ ACTIVE               │    │
│  └──────────────┘ └──────────────┘ └──────────────────────┘    │
```
(Green line clears automatically after 4 seconds.)

**State 7 — Save error**
```
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐    │
│  │ Hume EVI     │ │ OpenAI       │ │ ElevenLabs           │    │
│  │ (plain)      │ │ Currently    │ │ SELECTED             │    │
│  │              │ │ active       │ │                      │    │
│  └──────────────┘ └──────────────┘ └──────────────────────┘    │
│                                                                  │
│  Couldn't save — try again.                                      │
│  [ Save provider ]                                               │
```

**Confirm dialog (native `window.confirm`, fires before any provider PATCH):**
```
This changes the voice provider for new widget sessions immediately
after saving. Meeting-bot sessions and sessions already in progress
are not affected. Continue?
                                            [ Cancel ]  [ OK ]
```

**Existing card, after its copy-only amendment (for contrast — logic unchanged):**
```
┌───────────────────────────────────────────────────────────────┐
│  Live voice provider                                           │
│  Controls which voice AI powers new meeting-bot sessions        │
│  across all partners. The widget channel is configured          │
│  separately below.                                              │
│                                                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ Hume EVI (default)  │  │ OpenAI Realtime     │              │
│  │ ACTIVE              │  │                     │              │
│  └─────────────────────┘  └─────────────────────┘              │
└───────────────────────────────────────────────────────────────┘
```

## 6. Data Requirements

### 6.1 Migration — `supabase/migrations/111_b2b75_widget_voice_provider_and_elevenlabs.sql`

`111` is the next free number (`110_b2b70_meeting_url_nullable_for_widget_channel.sql` is current
highest — re-verify at build time). **Verbatim:**

```sql
-- =============================================================================
-- B2B-75 — ElevenLabs as a widget-only voice provider
-- Requirement Doc: docs/specs/B2B-75-requirement-document.md
-- Feature Brief: .claude/agents/clio/feature-briefs/B2B-75-elevenlabs-widget-voice-provider.md
--
-- Three changes, one migration:
--
--   1. system_voice_config.widget_provider — a SEPARATE provider setting for the
--      widget channel. This is the whole point of the feature's Decision D2:
--      active_provider is read by BOTH app/(with-clerk)/widget-render/.../page.tsx
--      AND app/(with-clerk)/partner-render/.../page.tsx, so widening its domain to
--      include 'elevenlabs' would route inline/meeting-bot sessions to a provider
--      with no adapter wiring and no prompt on that path. active_provider keeps its
--      existing two-value domain and keeps driving partner-render, completely
--      unchanged. widget_provider is read ONLY by widget-render.
--
--   2. ElevenLabs platform credentials on the same singleton row. The API key is an
--      OUTBOUND credential (Clio replays it to ElevenLabs), so it is stored
--      ENCRYPTED-AND-RETRIEVABLE via lib/partner/crypto.ts's AES-256-GCM
--      encryptOutboundToken() -- never hashed. The agent id is NOT a secret and is
--      stored plaintext.
--
--   3. partner_sessions.voice_provider CHECK widened to accept 'elevenlabs', since
--      widget-render/page.tsx writes this per-session snapshot for the widget channel
--      too (migration 106), and inngest/partner-session-insights-extractor.ts reads it
--      to decide which transcript path to use.
-- =============================================================================

-- ── 1. Widget-scoped provider setting ────────────────────────────────────────
--
-- Deliberately added NULLABLE with NO DEFAULT, then backfilled by COPYING the
-- current active_provider value, then set NOT NULL. A `NOT NULL DEFAULT 'hume'`
-- would silently seed the wrong value: the widget is believed to be running
-- OpenAI Realtime today (the entire widget-v21 prompt work is widget-specific and
-- OpenAI-specific), so a hardcoded default would regress it the moment this
-- deploys. Copying is correct under ANY current value of active_provider, which a
-- literal default can never be.
ALTER TABLE system_voice_config
  ADD COLUMN IF NOT EXISTS widget_provider TEXT NULL;

UPDATE system_voice_config
  SET widget_provider = active_provider
  WHERE widget_provider IS NULL;

ALTER TABLE system_voice_config
  ALTER COLUMN widget_provider SET NOT NULL;

ALTER TABLE system_voice_config
  ADD CONSTRAINT system_voice_config_widget_provider_check
  CHECK (widget_provider IN ('hume', 'openai_realtime', 'elevenlabs'));

-- ── 2. ElevenLabs platform credentials (singleton, platform-level per D1) ────
ALTER TABLE system_voice_config
  ADD COLUMN IF NOT EXISTS elevenlabs_api_key_ciphertext TEXT NULL;

ALTER TABLE system_voice_config
  ADD COLUMN IF NOT EXISTS elevenlabs_agent_id TEXT NULL;

-- Seed Arun's REAL, already-built, Playground-validated Clio agent. Per his direct
-- instruction: "agent details are shared already as well so you can seed it now and
-- i can update it from admin dashboard in future if needed."
--
-- An agent id is a plain identifier, NOT a secret (Known Constraint C5), so it is
-- stored plaintext and committed here in the open exactly like any other non-secret
-- configuration constant. The API key is NOT seeded and never will be -- it stays
-- empty until Arun enters it in the admin card.
--
-- Guarded on IS NULL so re-running this migration can never clobber a value Arun has
-- since changed from the admin dashboard.
UPDATE system_voice_config
  SET elevenlabs_agent_id = 'agent_0701krp1ta48fswrff17ctb0520m'
  WHERE elevenlabs_agent_id IS NULL;

-- ── 3. Per-session provider snapshot: widen to accept the new value ─────────
ALTER TABLE partner_sessions
  DROP CONSTRAINT IF EXISTS partner_sessions_voice_provider_check;

ALTER TABLE partner_sessions
  ADD CONSTRAINT partner_sessions_voice_provider_check
  CHECK (voice_provider IS NULL OR voice_provider IN ('hume', 'openai_realtime', 'elevenlabs'));

-- ── Comments ────────────────────────────────────────────────────────────────
COMMENT ON COLUMN system_voice_config.widget_provider IS 'B2B-75: which voice provider NEW WIDGET-CHANNEL sessions use. Read ONLY by app/(with-clerk)/widget-render/[clio_session_ref]/page.tsx via lib/voice/provider-config.ts''s getWidgetVoiceProvider(). Deliberately separate from active_provider, which is ALSO read by partner-render/[clio_session_ref]/page.tsx and must keep its two-value domain so the inline/meeting-bot channel can never be routed to a provider it has no wiring for (Requirement Doc D2/§6.1). Seeded at migration time by COPYING active_provider, never from a hardcoded default.';
COMMENT ON COLUMN system_voice_config.elevenlabs_api_key_ciphertext IS 'B2B-75: ElevenLabs API key, encrypted at the application layer with lib/partner/crypto.ts''s encryptOutboundToken() (AES-256-GCM, v1:<iv>:<tag>:<data>). An OUTBOUND credential Clio must replay to ElevenLabs when minting a per-session conversation token, therefore encrypted-and-retrievable and NEVER hashed. Decrypted server-side only, inside app/api/elevenlabs-token/route.ts. Never returned by any API response, never logged, never sent to the browser.';
COMMENT ON COLUMN system_voice_config.elevenlabs_agent_id IS 'B2B-75: the id of Arun''s pre-existing, pre-configured, Playground-validated Clio agent in the ElevenLabs dashboard. Seeded by this migration with the real value (agent_0701krp1ta48fswrff17ctb0520m) per Arun''s direct instruction; editable from /dashboard/admin thereafter. NOT a secret -- stored plaintext, returned by GET /api/admin/widget-voice-config and shown normally in the admin UI. One base agent is referenced by every widget session; per-conversation customization uses conversation_config_override, never agent cloning (Known Constraint C2).';
COMMENT ON CONSTRAINT partner_sessions_voice_provider_check ON partner_sessions IS 'B2B-75: widened from (hume, openai_realtime) to include elevenlabs. Widget sessions write this snapshot at render time and inngest/partner-session-insights-extractor.ts reads it to route transcript retrieval; without this the widget render page''s own voice_provider write would fail for ElevenLabs sessions.';
```

**Notes for the developer:**
- No `DEFAULT` on `widget_provider` is intentional: `system_voice_config` is a hard singleton
  (fixed-PK `CHECK` from migration 104), so no further row will ever be inserted — a missing default
  makes a stray insert fail loudly rather than silently pick a value.
- The existing `update_system_voice_config_updated_at` trigger already covers these new columns; it
  is not redefined.
- RLS policy from migration 104 (`service role full access`) already covers the whole table; no new
  policy needed.

### 6.2 Reads

- **`GET /api/admin/widget-voice-config`** — `requireSuperAdmin()`-gated. Selects the singleton row.
  Response:
  ```json
  {
    "widget_provider": "openai_realtime",
    "elevenlabs_agent_id": "agent_0701krp1ta48fswrff17ctb0520m",
    "elevenlabs_api_key_set": false,
    "openai_realtime_available": true,
    "elevenlabs_available": false,
    "elevenlabs_blocked_reason": "api_key",
    "updated_at": "2026-08-07T00:00:00.000Z"
  }
  ```
  - `elevenlabs_api_key_set` is `Boolean(row.elevenlabs_api_key_ciphertext)` — **the key itself is
    never decrypted on this path and never leaves the server.** This deliberately mirrors
    `outbound-config/route.ts`'s `outbound_auth_token_set` exactly.
    A `••••a1b2` last-four hint (permitted by C5) was considered and **rejected**: it would require
    either decrypting the live secret on every admin page load, or storing a plaintext fragment of it
    in a new column. A boolean carries the same operator information ("is it set?") with zero secret
    material crossing the boundary, and matches the named precedent route.
  - `elevenlabs_blocked_reason` is `null` when available, otherwise `'flag' | 'api_key' | 'agent_id'`
    (§6.3) — it exists so the card's disabled-tile caption is server-decided and names the *specific*
    missing credential, rather than being re-derived client-side from separate booleans.
  - The example above is the **expected day-one state**: the agent id is present (seeded by migration
    111), the API key is not.
- **Server-side session-time read** — new function in the **existing** `lib/voice/provider-config.ts`:
  ```ts
  export type WidgetVoiceProvider = 'hume' | 'openai_realtime' | 'elevenlabs'
  export async function getWidgetVoiceProvider(): Promise<WidgetVoiceProvider>
  ```
  Same `createSupabaseAdminClient()` + `.eq('id', SINGLETON_ID).maybeSingle()` shape as the existing
  `getActiveVoiceProvider()`, reading `widget_provider`. **Fail-open to `'hume'`** on a missing row or
  read error, identical posture and reasoning to the existing function (a config-read hiccup must
  degrade, never break a live session render).
  **`getActiveVoiceProvider()` itself is not modified in any way.** Its return type stays
  `'hume' | 'openai_realtime'`, and `partner-render/page.tsx` keeps calling it, unchanged.
- **Server-side credential read for the render page** — new function in the same file:
  ```ts
  export async function getElevenLabsAgentId(): Promise<string | null>
  ```
  Returns `elevenlabs_agent_id` (plaintext, non-secret). Returns `null` on any error.
  **There is no server-side helper that returns the decrypted API key to a page component.** The key
  is decrypted in exactly one place — the token route (§6.4).

### 6.3 Availability flag — `lib/voice/provider-availability.ts` (existing file, one addition)

```ts
/**
 * B2B-75. Gates whether the "ElevenLabs" option in the WIDGET voice-provider
 * selector is offered at all — in the UI
 * (app/(with-clerk)/dashboard/admin/WidgetVoiceProviderCard.tsx) and,
 * defense-in-depth, in PATCH /api/admin/widget-voice-config itself.
 *
 * Ships `true`: unlike B2B-61's OpenAI flag (which shipped `false` because the
 * adapter genuinely did not exist yet), this build ships the adapter complete,
 * and the real gate on selecting ElevenLabs is whether Arun has actually saved
 * credentials — a condition that cannot be satisfied by accident. Per the
 * feature brief §8 the feature ships "selectable but not selected."
 *
 * Flip to `false` to withdraw the option entirely without a migration.
 */
export const ELEVENLABS_ADAPTER_AVAILABLE = true
```

Derived availability, computed server-side in the API route (never trusted from the client):
```
elevenlabs_available =
  ELEVENLABS_ADAPTER_AVAILABLE
  && Boolean(elevenlabs_api_key_ciphertext)
  && Boolean(elevenlabs_agent_id)

elevenlabs_blocked_reason =
  !ELEVENLABS_ADAPTER_AVAILABLE              ? 'flag'
  : !Boolean(elevenlabs_api_key_ciphertext)  ? 'api_key'
  : !Boolean(elevenlabs_agent_id)            ? 'agent_id'
  : null
```
Order matters: `'flag'` outranks both credential reasons, and `'api_key'` is checked before
`'agent_id'` because the seeded agent id (§6.1) makes the missing key the overwhelmingly likely
cause — the caption should name the credential the admin actually has to go and fetch.

### 6.4 New token route — `app/api/elevenlabs-token/route.ts`

Structural twin of `app/api/hume-token/route.ts` and `app/api/openai-realtime-token/route.ts`:
`export const dynamic = 'force-dynamic'`, `Cache-Control: no-store` on every response, typed error
envelopes, secrets never in an error message.

**One structural difference, stated because it is genuinely new:** this is the first token route
whose credential comes from the **database** rather than `process.env`. It therefore additionally
calls `createSupabaseAdminClient()` and `decryptOutboundToken()`.

```
GET /api/elevenlabs-token
```

Behaviour, in order:
1. Read the `system_voice_config` singleton (`elevenlabs_api_key_ciphertext`, `elevenlabs_agent_id`).
2. If either is null/empty → `500 { error: 'ElevenLabs credentials not configured' }`.
   Log `[elevenlabs-token] ElevenLabs credentials not configured` — **the ciphertext must not be
   logged.**
3. `decryptOutboundToken(ciphertext)`. If it returns `null` (corrupt ciphertext, or the encryption
   key changed) → `500 { error: 'ElevenLabs credentials could not be read' }`. Log the failure
   **without any part of the ciphertext or plaintext.**
4. Mint a **WebRTC conversation token**. ElevenLabs' own server-side example, quoted verbatim from
   `https://elevenlabs.io/docs/agents-platform/libraries/java-script`, is the source for the auth
   header this route uses. **Note the honest status of that header: it is inferred from the official
   example, not stated as required in any prose** (§0.B). It matches the sibling signed-URL endpoint
   and every other convai endpoint, so it is practically certain — but it is an inference, and the
   spec labels it as one rather than overclaiming:
   ```js
   const response = await fetch(
     `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${process.env.AGENT_ID}`,
     { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } }
   );
   ```
   This route's version, with the repo's own conventions applied:
   ```ts
   const res = await fetch(
     `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
     { method: 'GET', headers: { 'xi-api-key': apiKey }, cache: 'no-store' }
   )
   ```
   **`cache: 'no-store'` is mandatory and non-negotiable.** The OpenAI token route carries a
   documented live-diagnosed bug (its own comment, lines 22-30) where Next.js's fetch Data Cache
   silently served the identical token to every caller for the token's lifetime. **This risk is
   strictly higher here than for the WebSocket path**: the WebRTC response includes a
   `conversation_id`, so a cached response would hand concurrent participants not just the same
   credential but the same conversation identity — which would corrupt the per-session
   `hume_chat_id` write and, through it, transcript retrieval. Do not omit this.
5. Non-2xx → `502 { error: 'Failed to obtain ElevenLabs conversation token' }`. Log the status and
   the response body text but **never the key**.
6. Parse `{ token: string; conversation_id: string }`. If `token` is missing → `502 { error:
   'Unexpected response from ElevenLabs conversation-token endpoint' }`.
7. Success → `200 { conversationToken: token, agentId }`, `Cache-Control: no-store`.
   **The API key is never part of any response, in any branch.**
   `conversation_id` is deliberately **not** returned: the adapter receives the authoritative
   conversation id from the SDK's own `onConnect({ conversationId })` callback, and returning a
   second source of the same identity would invite the two to drift.

#### WebRTC is the shipped transport — decision and reasoning

v1.0 specified the WebSocket signed URL, on the grounds that the WebRTC token endpoint's auth header
could not be verified. **That verification gap is now closed** (the verbatim server-side example
above), so the reason for the v1.0 choice no longer exists.

Shipping WebRTC, because:
- **It is what the feature is for.** The purpose of this build is Arun evaluating ElevenLabs' voice
  quality and responsiveness against Hume and OpenAI Realtime. ElevenLabs documents WebRTC as the
  lower-latency transport and the **default for voice conversations** (*"Voice conversations use
  WebRTC and text-only conversations use WebSocket by default."*). Shipping the slower transport
  would mean Arun is evaluating our transport choice rather than the vendor — which invalidates the
  exercise.
- **It costs one field.** `conversationToken` and `signedUrl` are sibling fields on mutually
  exclusive variants of the same `SessionConfig` union (§0.B). The adapter's shape, callbacks, tool
  wiring, and every line of `WidgetRenderClient` are identical either way.
- **No new dependency.** `livekit-client` — the WebRTC transport — is a **direct runtime dependency
  already inside `@elevenlabs/client`** (§0.B), not a peer dependency and not a separate install.
  Governance treatment in §6.11.

#### WebRTC token expiry is UNDOCUMENTED — and the design is built not to care

**Do not assume 15 minutes.** That figure is documented for the **signed-URL / WebSocket** endpoint
(`/v1/convai/conversation/get-signed-url`) and **not** for the WebRTC conversation-token endpoint,
whose API reference states no duration at all. Several third-party sources conflate the two. This
spec asserts **no TTL for the WebRTC token**.

**Containment — why the unknown is not load-bearing.** The token is minted server-side immediately
before each session connect, used exactly once, and never stored, cached, reused, pre-minted, or
refreshed:
- **If the real expiry turns out to be short** (seconds), it is harmless: the gap between mint and
  use is a single client round trip on the same page load.
- **If it turns out to be long** (hours), it grants no extra exposure: the token never leaves the
  browser that requested it, is never persisted, and is discarded when the page unloads.

So the design is correct under either answer, which is why this ships without the figure. **It only
becomes load-bearing if a future change wants to pre-mint or reuse a token — at which point the TTL
must be established first.** Recorded as a first-live-call observation in §13.4.1, not a blocker.

**Documented fallback — WebSocket signed URL.** If WebRTC proves unusable in a real session (e.g. a
network environment that blocks it), the switch is exactly two changes and no structural work:
1. In `app/api/elevenlabs-token/route.ts`, call
   `GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=…` (same
   `xi-api-key` header, same `cache: 'no-store'`) and return `{ signedUrl: body.signed_url, agentId }`.
   That URL is valid **15 minutes** for initiation; the conversation may run longer.
2. In `lib/voice/elevenlabs-adapter.ts`, pass `signedUrl` + `connectionType: 'websocket'` instead of
   `conversationToken` + `connectionType: 'webrtc'`.
Nothing else changes — not the overrides, not the tools, not the callbacks, not `WidgetRenderClient`.

`connectionType` is passed **explicitly** at the call site (§6.6.2) even though the SDK would infer
it, so a future change to ElevenLabs' inference rules can never silently switch our transport.

### 6.5 The override payload — verbatim, with citation

This is the single most failure-prone shape in the build. Per the feature brief, it is quoted from
live documentation, not recalled.

**Browser SDK form** — from
`https://elevenlabs.io/docs/agents-platform/customization/personalization/overrides` (verbatim from
the docs' own example; camelCase, as the SDK expects):

```javascript
const conversation = await Conversation.startSession({
  overrides: {
      agent: {
          prompt: {
              prompt: `The customer's bank account balance is ${customer_balance}. They are based in ${customer_location}.`,
              llm: "gpt-4o",
              toolIds: [ "tool_7101k5zvyjhmfg983brhmhkd98n6" ],
              knowledgeBase: [ { type: "file", name: "Unladen Swallow Facts", id: "5xM3yVvZQKV0EfqQpLrJ", usageMode: "auto" } ],
          },
          firstMessage: `Hi ${customer_name}, how can I help you today?`,
          language: "en"
      },
      tts: { voiceId: "custom_voice_id", stability: 0.7, speed: 1.1, similarityBoost: 0.9 },
      conversation: { textOnly: true },
      asr: { keywords: ["Acme Corp", "Contoso"] }
  },
})
```

**Wire form** — `conversation_initiation_client_data`, from
`https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket` (snake_case). The
browser client builds this itself from the `overrides` object above; it is included only so a
developer debugging a live socket can recognise it:

```json
{
  "type": "conversation_initiation_client_data",
  "conversation_config_override": {
    "agent": { "prompt": { "prompt": "…" } }
  }
}
```

**The confirmed nesting path for the system prompt is `overrides.agent.prompt.prompt`** (SDK) /
`conversation_config_override.agent.prompt.prompt` (wire). Not `overrides.agent.prompt`, not
`overrides.prompt`.

**What this build sends — exactly this and nothing else (Known Constraint C3):**

```ts
overrides: {
  agent: {
    prompt: { prompt: elevenlabsVoiceInstructions }
  }
}
```

**Do not send** `llm`, `toolIds`, `knowledgeBase`, `firstMessage`, `language`, any `tts` field, any
`conversation` field, or any `asr` field. Arun asked for the prompt to be overridden and said
explicitly that "other values need not change" — voice, model, and every other agent setting stay
exactly as his base agent has them configured. Sending an extra field is not merely unnecessary: per
the same doc page, **an override for a field whose Security toggle is off throws an error**, so each
unnecessary field is an additional way to break every session.

#### 6.5.1 `dynamicVariables` — considered and deliberately rejected

`dynamicVariables?: Record<string, string | number | boolean>` is confirmed as a top-level sibling of
`overrides` on `BaseSessionConfig` (§0.B). It enables a theoretically cleaner design: leave the
Playground-validated base prompt in place with `{{placeholder}}` tokens, and inject only the
per-session content as variables — no wholesale prompt replacement at all.

**We are not doing that.** Two reasons, recorded here so the next person does not rediscover this as
an apparent gap in the design:
1. **Arun explicitly decided prompt override.** The feature brief's C2 settles the mechanism as
   `conversation_config_override`.
2. **It would make Clio's behaviour depend on a prompt this codebase does not control.** The base
   agent's prompt lives in the ElevenLabs dashboard and can be edited there at any time by anyone
   with access. A design that requires it to contain specific placeholder tokens, in specific
   positions, with specific semantics, would break silently the moment someone edits it — and would
   break in the worst possible way: a session that connects and speaks fluently while dropping the
   session content. Overriding the prompt whole means the prompt Clio runs is always the one this
   repo assembled, reviewable in version control.

`dynamicVariables` is therefore **not sent**. The prompt is fully assembled server-side and
overridden whole; there are no template variables left for ElevenLabs to substitute.

### 6.6 New adapter — `lib/voice/elevenlabs-adapter.ts`

Implements `VoiceSessionAdapter` (`lib/voice/adapter.ts`) at the same bar as `HumeAdapter` and
`OpenAIRealtimeAdapter`. `lib/voice/adapter.ts` gains **one new optional member** (§6.6.4) and is
otherwise untouched. `hume-adapter.ts` and `openai-realtime-adapter.ts` are **not modified at all.**

#### 6.6.1 Config

```ts
export interface ElevenLabsAdapterConfig {
  /** Server-minted WebRTC conversation token from app/api/elevenlabs-token/route.ts.
   *  The raw API key is NEVER passed to the browser and never appears in this interface.
   *  (WebSocket fallback: replace with `signedUrl: string` — see §6.4.) */
  conversationToken: string
  /** The fully-assembled, widget-only ElevenLabs prompt (lib/voice/widget-elevenlabs-prompt-rules.ts),
   *  computed server-side in widget-render/page.tsx. Sent as overrides.agent.prompt.prompt. */
  instructions: string
  /** Session ref — logging/reporting parity with Hume's and OpenAI's `userId`. */
  userId: string
  onConnect: (sessionId: string) => void
  onDisconnect: () => void
  onError: (message: string) => void
  onModeChange: (mode: 'listening' | 'speaking') => void
  onMessage: (text: string, source: 'user' | 'ai') => void
  tools: Record<string, (params: Record<string, unknown>) => Promise<string>>
  /** Same optional diagnostic hook shape OpenAIRealtimeAdapter already uses, so
   *  WidgetRenderClient's existing voice-diagnostic-capture plumbing is reused unchanged. */
  onDiagnostic?: (label: string, detail: Record<string, unknown>) => void
  reportError?: (message: string) => void
}
```

**No `mediaStream` field.** The `@elevenlabs/client` SDK captures and streams microphone audio
itself once permission has been granted; there is no documented way to hand it a pre-existing
`MediaStream`. `WidgetRenderClient`'s existing `getUserMedia` call is retained (it must still run to
obtain permission before `startSession`, and it feeds the mic-level analyser tap), but that stream is
simply **not passed** to this adapter. Consequence, stated plainly: an ElevenLabs session holds two
concurrent microphone captures — the SDK's, and the client's read-only analyser tap. This is
supported by browsers and the tap is never routed to a destination
(`WidgetRenderClient.tsx:351-359`), but it means `setMicMuted` mutes the SDK's stream only; the tap
keeps producing data. The mic pill is already gated on `!isMuted`
(`WidgetRenderClient.tsx:738`), so the visible behaviour is correct — noted so it is not
later misread as a bug.

#### 6.6.2 Construction

```ts
static async create(config: ElevenLabsAdapterConfig): Promise<ElevenLabsAdapter>
```
Calls `Conversation.startSession({ … })` from `@elevenlabs/client` with:
- `conversationToken: config.conversationToken`
- `connectionType: 'webrtc'` (explicit, per §6.4)
- `overrides: { agent: { prompt: { prompt: config.instructions } } }` (exactly §6.5, nothing more)
- `clientTools: <mapped from config.tools>` (§6.6.3)
- `userId: config.userId` — a real field on `BaseSessionConfig` (§0.B); pass `clioSessionRef` so
  ElevenLabs-side conversation records correlate to Clio sessions
- `onConnect`, `onDisconnect`, `onMessage`, `onError`, `onStatusChange`, `onModeChange`,
  `onCanSendFeedbackChange` (§6.6.4)

**Fields on `BaseSessionConfig` that are deliberately NOT set:** `dynamicVariables` (§6.5.1),
`customLlmExtraBody`, `textOnly`, `toolMockConfig`, `useWakeLock`, `connectionDelay`, `environment`,
`origin`, `authorization`, and **`livekitUrl`** — that last one is a LiveKit room-URL override,
exactly what it looks like; the SDK resolves the correct room from the conversation token on its own
and there is no reason to override it. Listed explicitly because `BaseSessionConfig` is a wide
optional surface and "we didn't set it" should be a decision on the record, not an oversight.

**Adapting the SDK's callback signatures to this codebase's `VoiceSessionAdapter` config** — these
are not the same shapes, and v1.0 had four of them wrong. The exact mapping:

| SDK callback (verbatim, §0.B) | Adapter's action |
|---|---|
| `onConnect({ conversationId })` | store `conversationId`; call `config.onConnect(conversationId)` (this codebase's callback takes a bare string) |
| `onDisconnect(details: DisconnectionDetails)` | see §6.6.7 — the `reason` discriminant drives diagnostics; then `config.onDisconnect()` |
| `onModeChange({ mode })` | `config.onModeChange(mode)`; drives the speak-verified gate and the playback proxy |
| `onStatusChange({ status })` | track `isOpen()`; emit `el_status_change`; **four possible values** |
| `onError(message, context?)` | **discriminate before surfacing — §6.6.6** |
| `onMessage({ message, source, role, event_id })` | `config.onMessage(message, source)` — **read `source`, never `role`** (§6.9) |
| `onCanSendFeedbackChange({ canSendFeedback })` | track the flag for `sendFeedback` |

#### 6.6.3 Tool mapping

`config.tools` is `Record<string, (params) => Promise<string>>` — already exactly the shape
`clientTools` expects (`{ toolName: async (params) => …}`), so the mapping is a direct pass-through,
not a translation layer. The three tools are `show_visual`, `advance_tab`, `end_session`.

**Each tool's return string is handed back to the agent as the tool result** — the same contract the
Hume and OpenAI adapters already honour, which is why the handlers already return
`'Visual is showing.'` / `'Advanced.'` / `'Session ended.'`.

**These three tools MUST be pre-declared on the base agent in the ElevenLabs dashboard.** They cannot
be introduced purely at runtime: the docs state the agent-side configuration is what tells the model
a tool exists, and that *"The tool and parameter names in the agent configuration are case-sensitive
and must match those registered in your code."*
(`https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools`). This is manual setup
step 2 in §12.1 and is as load-bearing as enabling the prompt override.

#### 6.6.4 `VoiceSessionAdapter` members — per-method decision

Required members:

| Member | ElevenLabs implementation |
|---|---|
| `injectContext(text)` | `conversation.sendContextualUpdate(text)`. Real, functional (unlike Hume, where it is a permanent no-op because Hume rejects `session_settings.system_prompt` under a Custom-LLM config). |
| `endSession()` | See §6.6.5. |
| `setVolume(v)` | `void conversation.setVolume({ volume: v })`; also cache `v` locally for `getOutputVolume()`. The SDK's method returns a Promise; the interface is `void`, so it is fire-and-forget with a `.catch(() => {})`. |
| `setMicMuted(muted)` | `conversation.setMicMuted(muted)`. |
| `getInputVolume()` | Returns `0`. **The SDK's own `getInputVolume()` is async** (`await conversation.getInputVolume()`); the interface member is synchronous and returns `number`, so the async value cannot be returned from it. Mirrors `OpenAIRealtimeAdapter.getInputVolume()`, which also returns `0`. Neither `WidgetRenderClient` nor `PartnerRenderClient` calls this member — the level pills read `getOutputAnalyser()`/frequency data instead. Returning a stale cached number would be a fabricated reading, so a constant `0` is the honest choice. |
| `getOutputVolume()` | Returns the locally-tracked `outputVol` (set by `setVolume`, default `1.0`). Same approach and same reason as `OpenAIRealtimeAdapter`. |
| `sendFeedback(like)` | `conversation.sendFeedback(like)` — **a real implementation, unlike Hume's and OpenAI's no-ops**, since ElevenLabs genuinely exposes it. The SDK's real signature is `sendFeedback(like: boolean \| null, eventId?: number)`; this codebase's interface member is `sendFeedback(like: boolean)`, so the adapter passes `like` through and omits `eventId` (the SDK defaults it to its own `currentEventId`). The `null`-to-clear case is unreachable through this interface — do not add a parameter for it. **The SDK already guards internally** (`if (!this.canSendFeedback) { console.warn(…); return }`), so it no-ops rather than throwing; the adapter additionally tracks `canSendFeedback` via `onCanSendFeedbackChange` and skips the call entirely, purely to avoid a console warning on every no-op. No current call site invokes this member. |
| `getId()` | Returns the conversation id captured from `onConnect({ conversationId })`. |
| `isOpen()` | **`@elevenlabs/client` exposes no `isOpen()`.** (This is what the deleted 93-line adapter was built on, and it no longer exists.) Implemented as a locally-tracked boolean, `true` only on `onStatusChange → 'connected'`, `false` on `'connecting'`, `'disconnecting'` and `'disconnected'`, and on `onDisconnect`. **`Status` has four values, not three** (§0.B) — `'disconnecting'` must be handled or a session mid-teardown would still report itself open to the join-greeting poll. |
| `onSpeakVerified(cb)` | **Two-signal, matching the bar `adapter.ts` states — deliberately stricter than the deleted adapter.** Fires exactly once, only when BOTH (a) `onConnect` has fired with a real ElevenLabs-assigned conversation id, AND (b) the first `onModeChange → 'speaking'` has occurred. Fires immediately for a late subscriber if verification already happened. Never fires on a merely-attempted connection. **The old adapter's `isOpen()`-poll logic is explicitly NOT reused**: it fired on socket-open alone, which is below the billing-integrity bar `adapter.ts` now documents and below what both live adapters do (Hume: `chat_metadata` + first speaking event; OpenAI: `session.updated` + first audio delta). |

Optional extension points — **one line per method, as the brief requires**:

| Member | Decision | Reason |
|---|---|---|
| `sendWrapUpNudge(text)` | **Implemented**, as `conversation.sendContextualUpdate(text)`; returns `true` if the connection is open and the send did not throw, `false` otherwise. | Real and correctly attributed. **Honest limitation:** unlike OpenAI's `session.update`, `sendContextualUpdate` delivers context but does **not** force the agent to take a turn — the note lands and influences the agent's *next natural* turn. `sendUserMessage()` *would* force a turn, and is **deliberately rejected**: it is attributed to the participant, so the instruction text would enter the conversation as the participant's own words and the model would react to it as speech. That is worse than the delay. |
| `waitForPlaybackCaughtUp()` | **Implemented**, as: resolve immediately if the tracked mode is not `'speaking'`; otherwise resolve on the next `onModeChange → 'listening'`, **bounded by a 3000 ms timeout**. | **Explicitly a proxy, not parity.** ElevenLabs exposes no audio queue and no "playback finished" event (§0.B) — `onModeChange → 'listening'` is the only real signal in the vicinity, and the docs do not state whether it fires at generation-complete or playback-complete. Bounded at 3 s (not OpenAI's 8 s) so the worst case is a 3-second delayed page move rather than a visible stall. If it turns out to be generation-complete, behaviour is identical to Hume's today (which does not implement this at all) — so this is strictly no-worse-than-current, never worse. **Revert path: delete the method.** Optional chaining at `WidgetRenderClient.tsx:419` makes its absence a real no-op with no other change. AT-11 in §7 exists to settle this on the first live session. |
| `triggerRecoveryNudge(text)` | **Implemented**, as `conversation.sendContextualUpdate(text)`; returns `true`/`false` on the same open-and-didn't-throw basis. | Same honest limitation as `sendWrapUpNudge` — the note is delivered, an immediate turn is not forced. This affects the idle check-in (`IDLE_TIMEOUT_CHECKIN_TEXT`) and the 60-minute cap (`MAX_CALL_DURATION_NUDGE_TEXT`). **Still strictly better than Hume**, which does not implement this method at all, so those two mechanisms are complete no-ops on the current default provider today. Note also that the *idle* nudge's trigger is itself OpenAI-only (see the next row), so in practice only the max-duration note reaches this method on ElevenLabs. |
| `getOutputAnalyser()` | **NOT implemented — deliberately absent.** | `@elevenlabs/client` exposes **no `AnalyserNode`** and no access to its internal playback graph (§0.B). The only real output signal is `getOutputByteFrequencyData(): Uint8Array`. Returning a synthetic `AnalyserNode`, or wiring one to nothing, would be a decorative signal — banned. Replaced by a genuine alternative, below. |

**New optional interface member** (`lib/voice/adapter.ts`, purely additive, breaks nothing):

```ts
/**
 * B2B-75 — optional, provider-agnostic accessor for real output-audio frequency data,
 * for adapters whose SDK exposes the data but not the AnalyserNode producing it.
 *   Hume / OpenAI: not implemented — both build their own gainNode -> analyser ->
 *     destination graph and expose the AnalyserNode directly via getOutputAnalyser().
 *   ElevenLabs:    implemented — @elevenlabs/client owns its playback graph and exposes
 *     only getOutputByteFrequencyData(), never an AnalyserNode.
 * Callers should prefer getOutputAnalyser() and fall back to this. Both carry the SAME
 * real signal from the same real audio — this is an accessor difference, not a fidelity
 * difference, and neither is a decorative/simulated animation source.
 * @returns real byte frequency data, or null if playback isn't running yet.
 */
getOutputFrequencyData?(): Uint8Array | null
```

`ElevenLabsAdapter.getOutputFrequencyData()` returns `conversation.getOutputByteFrequencyData()`,
or `null` if the call throws or the conversation is not yet open. `WidgetRenderClient`'s level-sampling
interval gains a fallback branch (§6.7).

#### 6.6.5 `endSession()` and the goodbye-cutoff risk

```
async endSession(): Promise<void>
```
1. Set an internal `intentionalClose = true` so `onDisconnect` is not surfaced as an error.
2. **Await the same bounded mode wait `waitForPlaybackCaughtUp()` uses** (resolve immediately if not
   speaking; otherwise on the next `'listening'`, capped at 3000 ms).
3. `await conversation.endSession()`.
4. Never throw — wrap in `try/catch` and log; teardown is best-effort, exactly as
   `WidgetRenderClient.endSessionOnce()` already assumes (it wraps the call in its own `try/catch`).

Step 2 exists because this is a known, expensively-learned failure class in this codebase:
`OpenAIRealtimeAdapter.endSession()` carries a long comment describing a real live session where the
spoken goodbye was cut off mid-sentence because teardown ran the instant the tool call resolved. The
widget's `end_session` handler calls `endSessionOnce()` immediately
(`WidgetRenderClient.tsx:441-445`), so the same race exists here. The mode wait is the only real
signal available to guard it.

#### 6.6.6 Error discrimination — a trap in the SDK's error routing

**This is a real defect risk the CEO review surfaced the ingredients for but did not name, and it
would produce a confusing, hard-to-diagnose bug in production.**

`@elevenlabs/client` routes **three different classes of problem through the same `onError`
callback** (all three verified in `BaseConversation.ts`, §0.B):
1. Fatal connection/protocol errors.
2. A client tool the agent called that is **not registered** —
   `onError("Client tool with name ${tool_name} is not defined on client", { clientToolName })`.
3. A registered client tool whose handler **threw** —
   `onError("Client tool execution failed with following error: …", { clientToolName })`.

`WidgetRenderClient`'s shared `onError` handler (lines 499-505) does this:
```ts
onError: (message: string) => { setStatus('error'); setConnectionHealth('red'); revealContentAfterWarmup(); clearPostToolNudge() }
```
So a **single transient tool failure on a perfectly healthy connection** would flip the whole session
into the error state — red "Disconnected" pill, "Voice connection issue" toast — while Clio carries
on talking normally. The participant sees a broken-looking session that is not broken. Worse, it is
self-inflicted: cases 2 and 3 are *our* code's problems, not the connection's.

**Required behaviour.** `ElevenLabsAdapter` must discriminate before surfacing anything, using the
SDK's own `context` argument, which carries `clientToolName` for exactly and only the two tool cases:

```ts
onError: (message: string, context?: unknown) => {
  // B2B-75. `clientToolName` is the discriminator that separates a TOOL fault from a
  // CONNECTION fault (see below). It is NOT part of any documented public contract — it was
  // read directly out of @elevenlabs/client 1.17.0, src/BaseConversation.ts, where the SDK
  // attaches it as the second argument to onError for exactly two cases: an unregistered tool
  // name, and a tool handler that threw.
  //
  // If a future SDK version renames or drops this field, this check silently stops matching
  // and every tool fault falls back to being surfaced as a connection fault — i.e. today's
  // pre-fix behaviour. That is a SAFE direction to fail (loud, not silent), which is why it is
  // not guarded further. But the symptom is confusing: a sudden wave of red "Disconnected"
  // pills on sessions whose audio is actually fine, appearing right after a dependency bump.
  // If you are reading this while debugging exactly that, start here.
  const toolName = (context as { clientToolName?: string } | undefined)?.clientToolName
  if (toolName) {
    // Tool-level failure. The connection is fine. Report it loudly to diagnostics so it is
    // never silent, but do NOT tear the session's UI into the error state.
    this.config.onDiagnostic?.('el_tool_error', { toolName, message })
    this.config.reportError?.(`ElevenLabs client tool error (${toolName}): ${message}`)
    return
  }
  this.config.onDiagnostic?.('el_error', { message })
  this.config.onError(message)   // genuine connection/protocol failure — surface it
}
```

This is **not** swallowing an error: the failure reaches `reportError` (the same client-error
reporting sink both existing adapters use) and the per-session diagnostic timeline. It simply stops a
tool-level fault from impersonating a connection-level one. AT-23 asserts it.

Note the SDK sends `is_error: true` back to the agent on both tool-failure paths regardless, so the
model is always told the tool failed and can react — this discrimination affects only what the
*participant's screen* does.

`onUnhandledClientToolCall` is deliberately **not** supplied: doing so would suppress both the
`onError` call and the `is_error: true` wire response, leaving the agent waiting on a tool result
that never arrives. The default path is the correct one here.

#### 6.6.7 Diagnostics emitted

To reuse `WidgetRenderClient`'s existing `voice-diagnostic-capture` plumbing unchanged, the adapter
emits via `onDiagnostic`:

| Label | Detail | When |
|---|---|---|
| `el_status_change` | `{ status: 'connected' \| 'connecting' \| 'disconnecting' \| 'disconnected' }` | every `onStatusChange` |
| `el_mode_change` | `{ mode: 'speaking' \| 'listening' }` | every `onModeChange` |
| `el_error` | `{ message }` | `onError` **without** a `clientToolName` (§6.6.6) |
| `el_tool_error` | `{ toolName, message }` | `onError` **with** a `clientToolName` (§6.6.6) |
| `el_disconnect` | `{ reason, closeCode, closeReason, message }` — the `DisconnectionDetails` union flattened | `onDisconnect`. **`reason` is the useful part**: `'user'` (participant ended), `'agent'` (Clio ended, i.e. the normal `end_session` path), `'error'` (real failure, carries `message`). This is strictly better than the boolean `intentional` flag v1.0 specified, and it comes free from the SDK |
| `tool_call` | `{ name, params, result }` | after every client-tool handler returns — same label and shape `OpenAIRealtimeAdapter` already emits, so the diagnostic timeline reads identically across providers |
| `el_override_rejected` | `{ message }` | on a connection-level error occurring during initiation, i.e. the window in which a rejected prompt override would surface (§8). Emitted **in addition to** `el_error`, never instead of it |

#### 6.6.8 Reconnection

**None implemented.** Hume and OpenAI each run a bounded manual reconnect loop because each owns its
raw `WebSocket`. `@elevenlabs/client` owns its own transport; adding a second reconnect loop on top
would fight it. A terminal disconnect surfaces via `onStatusChange → 'disconnected'` / `onDisconnect`
and is reported to `onError`/`onDiagnostic` exactly like any other connection failure, producing the
existing red-pill + `"Voice connection issue — content is still visible."` degradation.

Token expiry is **not** a mid-session risk under either transport: the WebRTC token is minted
immediately before use and used once (and its TTL is undocumented, so nothing depends on it — §6.4),
and the WebSocket fallback's 15-minute window governs *initiation* only.

### 6.7 `WidgetRenderClient.tsx` — the exact changes

Five changes. Everything else in the file is untouched, and **`PartnerRenderClient.tsx` is not
touched at all.**

**(a) Props widened.**
```ts
export interface WidgetRenderClientProps {
  clioSessionRef: string
  inlinePages: WidgetInlinePageProp[]
  humeConfigId: string | null
  voiceProvider: 'hume' | 'openai_realtime' | 'elevenlabs'   // widened
  openaiVoiceInstructions: string | null
  elevenlabsAgentId: string | null                            // new
  elevenlabsVoiceInstructions: string | null                  // new
}
```
`elevenlabsAgentId` is passed for the gate below and for diagnostics. It is **not** a secret. The API
key is never a prop.

**(b) The `humeConfigId` gate — brief §7 Q8, resolved.**

Add, immediately after the props destructure:
```ts
// B2B-75. `humeConfigId` was doing double duty as "is voice configured at all" for EVERY provider,
// including OpenAI Realtime — a latent gate a third provider would silently trip. Replaced by an
// explicit per-provider precondition. Deliberately byte-equivalent for 'hume' and 'openai_realtime'
// (both still require humeConfigId, exactly as today) so no existing behaviour changes; only the
// 'elevenlabs' arm is new.
const voiceEnabled =
  voiceProvider === 'elevenlabs' ? Boolean(elevenlabsAgentId) : Boolean(humeConfigId)
```

Replace `humeConfigId`-as-boolean at **all four** sites (§0.A):
- line 224 — `useState(Boolean(humeConfigId))` → `useState(voiceEnabled)`
- line 335 — `if (!humeConfigId) return` → `if (!voiceEnabled) return`
- line 624 — `if (!humeConfigId) return` → `if (!voiceEnabled) return`; the effect's dep array
  `[humeConfigId]` → `[voiceEnabled]`
- line 719 — `Boolean(humeConfigId) && (...)` → `voiceEnabled && (...)`

**TypeScript consequence the developer will hit:** removing `if (!humeConfigId) return` removes the
narrowing that currently lets `configId: humeConfigId` (line 575) type-check against
`HumeAdapterConfig.configId: string`. Add an explicit guard **inside** the Hume branch:
```ts
if (!humeConfigId) throw new Error('Hume selected but no config id was resolved for this session')
```
This is caught by the surrounding `try/catch` (line 592) and produces the existing
`status: 'error'` degradation. Do **not** use a non-null assertion.

**(c) Adapter construction — a third branch.**
```ts
if (voiceProvider === 'elevenlabs') {
  const tokenRes = await fetch('/api/elevenlabs-token')
  if (!tokenRes.ok) throw new Error(`ElevenLabs token fetch failed: ${tokenRes.status}`)
  const { conversationToken } = (await tokenRes.json()) as { conversationToken: string; agentId: string }
  if (cancelled) return

  adapter = await ElevenLabsAdapter.create({
    conversationToken,
    instructions: elevenlabsVoiceInstructions ?? '',
    userId: clioSessionRef,
    tools,
    onDiagnostic: (label, detail) => {
      if (label === 'el_status_change') {
        // Status has FOUR values (§0.B). 'disconnecting' is a normal teardown step, not a fault —
        // mapping it to red would flash a false "Disconnected" during every clean session end.
        const status = (detail as { status?: string }).status
        if (status === 'connected') setConnectionHealth('green')
        else if (status === 'connecting') setConnectionHealth('yellow')
        else if (status === 'disconnected') setConnectionHealth('red')
        // 'disconnecting' — deliberately leaves the pill unchanged
      } else if (label === 'el_error' || label === 'el_override_rejected') {
        setConnectionHealth('red')
      }
      // NOTE: 'el_tool_error' deliberately does NOT touch connectionHealth — a tool fault is not a
      // connection fault (§6.6.6). It is still captured below like every other diagnostic.
      fetch('/api/partner/render/voice-diagnostic-capture', { /* identical body to the OpenAI branch */ })
        .catch(() => {})
    },
    reportError: (message) => reportClientError(clioSessionRef, 'elevenlabs-adapter-error', message),
    ...sharedCallbacks,
  })
} else if (voiceProvider === 'openai_realtime') {
  /* existing branch, byte-for-byte unchanged */
} else {
  /* existing Hume branch, byte-for-byte unchanged apart from the guard in (b) */
}
```
No `mediaStream` is passed (§6.6.1). `micStream` is still obtained (permission + analyser tap) and
still passed to the two existing branches unchanged.

**Note on the connection-health pill:** this is a **real** signal for ElevenLabs — `onStatusChange`
is a first-class provider event, so the pill is honest here, unlike Hume (which has no equivalent
live hook and stays `'green'`). No fabricated states.

**Note on `onDisconnect`:** `sharedCallbacks.onDisconnect` (line 498) takes no arguments and sets
`status: 'ended'`. The SDK passes a `DisconnectionDetails` object, which JavaScript simply ignores
against a zero-arity function — so `sharedCallbacks` needs **no change**. The adapter consumes the
payload itself for diagnostics (§6.6.7) before invoking `config.onDisconnect()`. Stated because it
looks like a signature mismatch and is not one.

**(d) Transcript capture gate widened.**
Line 449, `if (voiceProvider === 'openai_realtime' && text.trim())` → `if (voiceProvider !== 'hume' && text.trim())`.
The nested phrase-triggered-advance block keeps its own `PHRASE_TRIGGERED_ADVANCE_ENABLED` guard
(currently `false`), so widening the outer condition has no effect on it.
Rationale for widening rather than adding a second condition: Hume's transcripts are retrieved
post-hoc from Hume's own API; every non-Hume provider needs live capture (see §6.9 for why
ElevenLabs uses live capture despite *having* a post-hoc API).

**(e) Bot level pill — frequency-data fallback.**
The 80 ms sampling interval (lines 361-365) gains one branch:
```ts
const botAnalyser = adapterRef.current?.getOutputAnalyser?.()
if (botAnalyser) {
  setBotLevels(sampleAnalyserBars(botAnalyser))
} else {
  const freq = adapterRef.current?.getOutputFrequencyData?.()
  if (freq) setBotLevels(sampleFrequencyBars(freq))
}
```
`sampleFrequencyBars(data: Uint8Array): number[]` is a new local helper alongside the existing
`sampleAnalyserBars`: it computes the mean of the frequency bins, normalises to 0-1, and applies the
same `[0.75, 1, 0.75]` centre-weighted taper and the same `0.12` idle floor, so the pill's visual
language is identical across providers. **This is a real amplitude readout of real audio**, computed
from a different (but equally real) accessor — not a decorative animation. When neither accessor is
available the pill simply sits at its idle floor, which is the existing behaviour when an analyser
isn't ready.

### 6.8 `widget-render/[clio_session_ref]/page.tsx` — the exact changes

1. `getActiveVoiceProvider()` → **`getWidgetVoiceProvider()`** (line 92). This is the D2 switch, and
   after it `getActiveVoiceProvider()` has exactly one caller left: `partner-render/page.tsx`.
2. The existing per-session snapshot write (`voice_provider`, lines 97-103) is **unchanged** — it now
   writes `'elevenlabs'` where applicable, which migration 111's widened `CHECK` permits.
3. Resolve the agent id and pick the prompt:
   ```ts
   const elevenlabsAgentId =
     voiceProvider === 'elevenlabs' ? await getElevenLabsAgentId() : null

   const openaiVoiceInstructions =
     voiceProvider === 'openai_realtime' ? assembleWidgetOpenAIPrompt({ …existing args… }) : null

   const elevenlabsVoiceInstructions =
     voiceProvider === 'elevenlabs' ? assembleWidgetElevenLabsPrompt({ …same args… }) : null
   ```
   Both assemblers take the identical input object (§6.10), so this is a provider switch, not two
   different data pipelines. `promptConfig` and `sessionContent` are computed once and shared.
   **`buildInlineSessionContent(session, pages, 'widget')` keeps its `'widget'` variant argument
   unchanged** — its stage direction states per-page facts only, with no provider-specific content,
   so it is correct for ElevenLabs as-is. The `'meeting_bot'` default remains untouched.
4. **Fail-closed on missing credentials.** If `voiceProvider === 'elevenlabs'` and
   `elevenlabsAgentId` is null, log
   `[widget-render] widget provider is elevenlabs but no agent id is configured — rendering without voice`
   and pass `elevenlabsAgentId={null}`. `voiceEnabled` (§6.7b) then resolves `false`, so the page
   renders content with no voice — the same degradation a missing `humeConfigId` already produces.
   **It must never silently fall back to a different provider**: a session that quietly runs on Hume
   while the admin believes it is on ElevenLabs is exactly the ambiguity this governance model exists
   to prevent.
5. Pass the two new props into `<WidgetRenderClient>`.

### 6.9 Transcript capture and the insights extractor — brief §7 Q6, resolved

**ElevenLabs does have a post-hoc transcript API** (`GET /v1/convai/conversations/{id}`) — a real
difference from OpenAI, which has none, and the reason B2B-63 introduced Redis-backed live capture in
the first place.

**Decision: use live capture anyway** (extend the existing gate), not the post-hoc API. Reasons:
- The live path already exists, is proven, and is a **one-condition change** (§6.7d) plus a
  one-condition change in the extractor. The post-hoc path would need a new extractor branch that
  decrypts the API key inside an Inngest job, a new outbound call, and error handling for a
  transcript that is not yet ready.
- **The availability delay after call end could not be verified** (§0.B). The extractor runs shortly
  after a session ends. Building on an unverified timing window is precisely the class of assumption
  this spec is required to avoid.
- It keeps one transcript mechanism for both non-Hume providers rather than three mechanisms for
  three providers.

The post-hoc API is recorded in §10.B as a clean future option if the live path ever proves lossy.

**Required change in `inngest/partner-session-insights-extractor.ts` — this is a live trap, not a
nicety.** Line 265 currently reads:
```ts
if (session.voice_provider === 'openai_realtime') {
```
Every other value falls through to Hume's transcript API (lines 269-272). An ElevenLabs session would
therefore call Hume's API with an ElevenLabs conversation id and fail — the exact failure migration
106 was created to fix for OpenAI. Change to:
```ts
// B2B-75: 'elevenlabs' joins 'openai_realtime' on the live-capture (Redis) path. NULL and 'hume'
// remain on Hume's own transcript API. Written as an explicit two-value check rather than
// `!== 'hume'` so a future fourth provider must make a deliberate choice here rather than silently
// inheriting one.
if (session.voice_provider === 'openai_realtime' || session.voice_provider === 'elevenlabs') {
```
The `hume_chat_id`-is-null hard throw at line 240 needs **no change**: `WidgetRenderClient`'s
`onConnect` already POSTs the provider-assigned conversation id to
`/api/partner/render/session-chat-id` (lines 490-496), and `ElevenLabsAdapter` supplies ElevenLabs'
own conversation id through that same callback. The column name is Hume-legacy; its content is
already provider-agnostic.

`app/api/partner/render/transcript-capture/route.ts` itself needs **no change** — it is
provider-agnostic and validates `{ clio_session_ref, source, text }` where
`source: z.enum(['user', 'ai'])`.

**A naming trap the adapter must not fall into.** `MessagePayload` carries **two** speaker fields
with **different vocabularies** (§0.B):
```ts
export interface MessagePayload { message: string; event_id?: number; source: "user" | "ai"; role: Role }
export type Role = "user" | "agent"
```
`source` is `'user' | 'ai'` — which matches this codebase's `VoiceSessionAdapter.onMessage`
signature and the capture route's Zod enum **exactly**. `role` is `'user' | 'agent'` and does not.
The adapter must read **`source`**. Reading `role` would send `'agent'` to the capture route, fail
its Zod validation, and — because that route returns `200 { ok: false }` on validation failure by
design, so it can never block a live call — **silently drop every one of Clio's turns from the
transcript**, leaving extraction to run against user turns only. This is a genuinely silent failure
and is asserted by a unit test in §13.

**Connection-health pill — brief §7 Q6, second half:** ElevenLabs has a **real** signal
(`onStatusChange`), specified in §6.7c. Nothing is fabricated, and nothing is left decoratively
"green" the way Hume's is.

### 6.10 New prompt module — `lib/voice/widget-elevenlabs-prompt-rules.ts` (D3)

A **new, self-contained** module. It **does not import from, re-export, generalise, or edit**
`lib/voice/widget-prompt-rules.ts`, which carries the just-shipped v21 restructuring and is
explicitly protected by Known Constraint C6.

- Exports `WIDGET_ELEVENLABS_PROMPT_VERSION = 'widget-el-v1'`.
- Exports `assembleWidgetElevenLabsPrompt(input: AssembleWidgetElevenLabsPromptInput): string` whose
  input interface is **field-for-field identical** to `AssembleWidgetOpenAIPromptInput`
  (`profileContext`, `intentContext`, `sessionContent`, `assistantName?`, `promptBehavior?`,
  `audienceDescription?`, `participantName?`, `endUserIndustry?`, `conversationLanguage?`), so
  `page.tsx` passes the same object to either assembler.
- **Rule content is adapted from `widget-prompt-rules.ts` v21** — the merged
  HOW THIS SESSION WORKS / HOW YOU SOUND AND BEHAVE structure, the G1-G23 rules, the atomic numbered
  sub-steps (1a-1h, 3a-3i, 4a-4d, 6a-6h), the placeholder-substitution assembly, the
  partner-configured-guidance block, and the language instruction. That content is hard-won across
  21 documented revisions and must be carried over, not reinvented.
- **Three adaptations, and only these three**, each required by a documented ElevenLabs capability
  difference:
  1. **G22 (the participant-has-gone-quiet note) is removed.** Its trigger is OpenAI's
     `idle_timeout_ms` → `input_audio_buffer.timeout_triggered`, an OpenAI-only platform signal with
     no ElevenLabs equivalent exposed to the browser client. A rule describing a note that can never
     arrive is dead instruction text that only adds contradiction surface.
  2. **G23 (the maximum-session-length note) is kept**, since
     `MAX_CALL_DURATION_MS`'s client-side timer is provider-independent — but the module's
     doc-comment must record that on ElevenLabs the note arrives via `sendContextualUpdate` and does
     **not** force an immediate turn (§6.6.4), so the goodbye may land on the model's next natural
     turn rather than instantly.
  3. **The remaining G-rules are renumbered contiguously** after G22's removal, and every internal
     cross-reference (`HOW THIS SESSION WORKS`'s "a note that the maximum call length has been
     reached (G23)" line, and rule 3f's own cross-reference) is updated to match. A dangling
     reference to a removed rule is exactly the class of contradiction v21's audit was built to
     eliminate.
- Everything else — tone, pacing, the tool-narration ban, the fused-utterance pattern, the closing
  enforcement — carries over verbatim in substance.

**Duplication is the correct trade here and is a precedent, not a shortcut**: this codebase made the
identical call for the Attendee webhook port, deliberately duplicating over a shared-handler
refactor, for the same reason — protecting a working path from side effects. `widget-prompt-rules.ts`
must end this build byte-for-byte identical to how it started.

#### 6.10.1 What the Playground validation does and does not de-risk — read before scoping this module

Arun has already built and tested this agent in the ElevenLabs Playground, and is confident that
*"if we just patch up the integration, then we should be good."* That confidence is well-founded and
this document does **not** assume a long behavioural tuning cycle ahead. But it is important to be
precise about what it covers, because the natural misreading of it would cause the exact silent
failure this whole brief exists to prevent.

**What Playground validation genuinely de-risks:** the agent's **voice, model, latency, turn-taking
and persona configuration** — everything selected in the ElevenLabs dashboard. This build overrides
**none** of it (C3), so all of it carries straight through to production exactly as tested. That is
real de-risking and it removes the largest category of unknown from this integration.

**What it does not de-risk:** prompt behaviour. `overrides.agent.prompt.prompt` **replaces the
Playground-validated prompt wholesale at connection time.** Every widget session runs *this repo's*
assembled prompt, not the one Arun tested. The base agent's own prompt is never executed in a widget
session — not as a fallback, not as a prefix, not as a merge.

**Therefore this prompt module is exactly as necessary as it was before that validation existed.**
Nobody should read "already tested in the Playground" as licence to skip it, thin it, or replace it
with a short instruction and trust the base agent to carry the structure. Doing so produces sessions
with a validated voice delivering unstructured content — which is precisely the silent-success
failure mode (it sounds perfect and teaches the wrong thing) that AT-6 and Known Constraint C2 exist
to catch.

The corollary is the encouraging half: because the prompt is the *only* thing being overridden, prompt
content is also the only plausible source of behavioural surprise. If a live session sounds wrong,
this module is the first and most likely place to look — not the transport, not the adapter, not the
agent config.

### 6.11 Governance and configuration files

- **`CLAUDE.md`** — required, part of the definition of done (D4):
  - **Amend — do not delete — the removal history.** In the *Removed from the approved list under the
    pivot* section, keep the record that `@11labs/client` / `elevenlabs` were removed on 2026-07-13
    and why, and append a dated note: **B2B-75 (2026-08-08) reverses that removal for the widget
    channel only**; the successor package name is **`@elevenlabs/client`** (the old
    `@11labs/client` is deprecated upstream); this is a deliberate re-introduction of the vendor, not
    a revival of the 2026-07-13 removal's architecture (no agent pool, no server-side audio relay,
    no `NEXT_PUBLIC_VOICE_PROVIDER` env toggle). The history stays legible; only its status changes.
  - Add to the approved list:
    `@elevenlabs/client` — official ElevenLabs Conversational-AI browser client, 721k+ weekly
    downloads, approved 2026-08-07 per B2B-75. Scoped to the **widget channel only**.
  - **Add a second, explicit approved-list line for `livekit-client`** — per the CEO's direct
    decision (2026-08-08). We add exactly **one** top-level package (`@elevenlabs/client`);
    `livekit-client` is **never separately installed by us**. The entry exists anyway, and must
    record these three facts:
    1. It arrives **transitively**, as a direct runtime dependency of `@elevenlabs/client`
       (`"livekit-client": "2.16.1"` in that package's own `dependencies` — not a peer dependency,
       §0.B), providing the WebRTC transport.
    2. It is the **official LiveKit SDK**, actively maintained (2.21.0 published 2026-07-23), not
       deprecated.
    3. **Its version is on ElevenLabs' release schedule, not ours** — we do not control when it
       bumps.
    Fact 3 is the reason the entry is worth having despite being a no-action item today: a future CVE
    or breaking change in `livekit-client` would reach this codebase through a dependency nobody here
    chose directly, and the next person should find that already written down rather than rediscover
    it mid-incident.
  - Record two deliberate non-adoptions in the same note:
    - `@elevenlabs/elevenlabs-js` (server SDK) — **not added.** The token route makes a single
      documented REST call and is a structural twin of the two existing `fetch()`-based token routes,
      matching how every voice-provider credential route in this repo is already built.
    - `@elevenlabs/react` (the official `useConversation()` hook) — **not added.** It would break the
      imperative adapter-class pattern `WidgetRenderClient.tsx` relies on for all three providers
      (`adapterRef.current?.…`, `VoiceSessionAdapter`-typed refs, `onSpeakVerified` registration,
      the optional extension points) and force a different integration shape for one provider only.
      The vanilla client wrapped in an `ElevenLabsAdapter` class keeps all three providers behind one
      interface, which is the entire reason that interface exists.
  - Add `ELEVENLABS_ADAPTER_AVAILABLE` to the same note so the flag is discoverable.
- **`.env.local.example`** — the stale `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` and
  `NEXT_PUBLIC_ELEVENLABS_VOICE_ID` entries are removed (the 7a0020a commit message itself records
  this as an owed, permission-blocked follow-up, and leaving a stale `NEXT_PUBLIC_` agent-id
  placeholder next to a feature that now stores the agent id in the database is actively confusing).
  **`ELEVENLABS_CUSTOM_LLM_SECRET` is NOT removed** — it is still read by
  `app/api/admin/seed-topics/route.ts`, whose own comment states the name is historical and the
  secret is generic, not ElevenLabs-specific. **No new env var is introduced by this feature**;
  credentials come from the admin UI per C4.
- **`docs/b2b-pivot-status.md`** — add `B2B-75` to the Live Status table, per the Orchestrator's
  standing real-time-update rule.
- **`BACKLOG.md`** — log the pre-existing, out-of-scope observation that
  `/api/openai-realtime-token` is missing from `middleware.ts`'s `TENANT_SCOPED_PATTERNS`
  (§0.A). Do not fix it in this build.

### 6.12 Writes

`PATCH /api/admin/widget-voice-config` — `requireSuperAdmin()`-gated. Zod:
```ts
const PatchSchema = z.object({
  widget_provider: z.enum(['hume', 'openai_realtime', 'elevenlabs']).optional(),
  elevenlabs_agent_id: z.string().trim().min(1).max(200).optional(),
  elevenlabs_api_key: z.string().trim().min(1).max(500).optional(),
}).refine(
  (v) => v.widget_provider !== undefined || v.elevenlabs_agent_id !== undefined || v.elevenlabs_api_key !== undefined,
  { message: 'No fields to update' }
)
```
Validation failure → `400 { error: 'Validation failed', details: parsed.error.flatten() }` — the same
envelope `voice-config/route.ts` and `theme/route.ts` already use.

Server-side gates, in this order, **all before any write**:
1. If `widget_provider === 'openai_realtime'` and `!OPENAI_REALTIME_ADAPTER_AVAILABLE` →
   `400 { error: 'openai_realtime_not_available' }`.
2. If `widget_provider === 'elevenlabs'` and `!ELEVENLABS_ADAPTER_AVAILABLE` →
   `400 { error: 'elevenlabs_not_available' }`.
3. If `widget_provider === 'elevenlabs'`, evaluate credential presence against the **post-write**
   state — i.e. `(incoming agent id ?? stored agent id)` and
   `(incoming api key ?? stored ciphertext)` — so a single request that supplies the key *and*
   selects ElevenLabs in one round trip is accepted. If either resolves empty, reject with
   `400 { error: 'elevenlabs_api_key_missing' }` or `400 { error: 'elevenlabs_agent_id_missing' }`
   (same precedence as §6.3's `blocked_reason`) **and write nothing**.
   In practice the agent id is seeded by migration 111, so `elevenlabs_agent_id_missing` is only
   reachable if an admin has explicitly cleared it.

These gates exist because a disabled tile is a UI affordance, not a security boundary — a direct API
call must be rejected identically. Same defense-in-depth reasoning as
`voice-config/route.ts`'s existing `OPENAI_REALTIME_ADAPTER_AVAILABLE` check.

Write, as one `UPDATE ... WHERE id = '00000000-0000-0000-0000-000000000001'`:
- `widget_provider` if supplied.
- `elevenlabs_agent_id` if supplied.
- `elevenlabs_api_key_ciphertext = encryptOutboundToken(elevenlabs_api_key)` if supplied. **The
  plaintext key is never logged, never stored, and never echoed.**

Response `200`: the same shape as GET (§6.2), recomputed post-write, so the card can update
`elevenlabs_available` / `elevenlabs_blocked_reason` without a second request.
Unexpected DB failure → `500 { error: 'Failed to save.' }` — generic, never leaking DB detail
(CLAUDE.md's secrets/internals rule).

## 7. Success Criteria (Acceptance Tests)

**Happy path**

✓ **AT-1.** Given a super-admin loads `/dashboard/admin`, when both cards mount, then "Live voice
provider" shows the saved `active_provider` and "Widget voice provider" shows the saved
`widget_provider`, and the two values are displayed independently of each other.

✓ **AT-2.** Given the admin enters a valid ElevenLabs API key and agent ID and clicks "Save
credentials", when the PATCH returns 200, then the API-key input is cleared to empty, the status line
reads "✓ Configured", the agent-ID input shows the saved value, and the ElevenLabs tile becomes
selectable in the same render with no page refresh.

✓ **AT-3.** Given ElevenLabs is selectable, when the admin clicks its tile, confirms the
`window.confirm(...)`, and the PATCH returns 200, then the ElevenLabs tile shows "ACTIVE",
`system_voice_config.widget_provider` is `'elevenlabs'`, and `system_voice_config.active_provider` is
**unchanged**.

✓ **AT-4.** Given `widget_provider = 'elevenlabs'`, when a widget session at
`/widget-render/<ref>` loads, then `GET /api/elevenlabs-token` returns a `conversationToken`, the
conversation connects over WebRTC, the warm-up overlay fades only after speak-verification, and the
elapsed timer, connection pill, mute button and level pills are all visible and functional.

✓ **AT-5.** Given a connected ElevenLabs session, when it runs to completion, then Clio greets by the
participant's name, asks the icebreaker, gives the overview, moves the screen at each topic boundary,
answers an off-page question by moving the screen and returning, says a real spoken goodbye, calls
`end_session`, and the page replaces the stack with "Thanks for joining."

✓ **AT-6.** **(The override actually landed.)** Given a connected ElevenLabs session, when Clio
speaks her first turn, then the content she teaches is the material from **this session's**
`SESSION CONTENT` — not the base agent's own dashboard-configured prompt. Verified by asserting she
names a topic that exists only in this session's content. *This test exists because a failure here
produces a session that connects and sounds perfect while teaching entirely the wrong material.*

✓ **AT-7.** Given a completed ElevenLabs session, when the insights extractor runs, then it reads the
transcript from Redis (not Hume's API), `partner_sessions.voice_provider` is `'elevenlabs'`, and
`partner_session_insights` is written with a non-zero `transcript_event_count`.

**Channel isolation — the brief's hardest criterion**

✓ **AT-8.** **(The inline channel is provably unaffected.)** Given `widget_provider = 'elevenlabs'`
and `active_provider = 'openai_realtime'`, when a `/partner-render/<ref>` meeting-bot session is
rendered, then `getActiveVoiceProvider()` returns `'openai_realtime'`, `PartnerRenderClient`
constructs an `OpenAIRealtimeAdapter`, and `partner_sessions.voice_provider` for that session is
`'openai_realtime'`. Repeat with `active_provider = 'hume'` and assert `HumeAdapter`. **In neither
case does the string `'elevenlabs'` appear anywhere in the partner-render request path.**

✓ **AT-9.** Given the full diff for this feature, when `app/(with-clerk)/partner-render/**`,
`lib/voice/widget-prompt-rules.ts`, `lib/voice/hume-adapter.ts` and
`lib/voice/openai-realtime-adapter.ts` are diffed against their pre-change state, then **every one of
them is byte-for-byte identical.** (A `git diff --stat` assertion, checkable at review time.)

✓ **AT-10.** Given `PATCH /api/admin/voice-config` (the *existing* route) is called with
`{ "active_provider": "elevenlabs" }` by a super-admin, then it returns `400` (its Zod enum rejects
the value) and `active_provider` is unchanged. The two settings' domains stay separate at the API
layer, not only by convention.

**Live-signal verification**

✓ **AT-11.** **(Settles the `waitForPlaybackCaughtUp` proxy — §6.6.4.)** Given a live ElevenLabs
session with diagnostics captured, when `advance_tab` fires, then compare the `el_mode_change →
listening` timestamp against the moment the agent's audio actually finished playing (observed by ear
or by the `tool_call` / `el_mode_change` diagnostic sequence). If `'listening'` reliably follows
audio completion, the proxy is confirmed. If it precedes it, record the finding and delete the method
per the named revert path — do not leave an unverified gate claiming a guarantee it does not provide.

**Negative cases — all required**

✓ **AT-12.** *(API key absent — the day-one state.)* Given the agent id is seeded but no API key is
saved, when the card loads, then the ElevenLabs tile is
`opacity-40 cursor-not-allowed pointer-events-none` with the caption "Add an API key below to
enable.", and cannot be clicked, focused or selected.

✓ **AT-13.** *(API key absent, UI bypassed.)* Given no API key is saved, when a super-admin sends
`PATCH /api/admin/widget-voice-config` with `{ "widget_provider": "elevenlabs" }` directly, then the
response is `400 { error: 'elevenlabs_api_key_missing' }` and the `system_voice_config` row is
**unchanged**.

✓ **AT-14.** *(Credentials wrong.)* Given a saved-but-invalid API key, when
`GET /api/elevenlabs-token` is called, then it returns `502` with
`{ error: 'Failed to obtain ElevenLabs signed URL' }`, **the API key appears nowhere in the response
body, the response headers, or the server log line**, and the session degrades to
`status: 'error'` with content still readable and the "Voice connection issue" toast shown.

✓ **AT-15.** *(Override not enabled on the agent.)* Given the base agent's Security tab does **not**
have System-prompt overrides enabled, when a widget session connects, then **the session fails
visibly** — the connection does not reach the speak-verified state, the warm-up overlay is dismissed
into the voice-error state, and the connection pill is red — **and Clio does not deliver any content
under the base agent's own prompt.**

> **Assert observable behaviour only. Do NOT assert any specific error string or status code.**
> ElevenLabs' docs state prose (*"an error will be thrown"*) but **no verbatim error message or
> status code is documented anywhere** — checked across the docs, changelog, and the linked GitHub
> issue. Writing a string match here would produce a test that passes today and silently rots the
> moment the vendor rewords a message.
>
> **Capture the real error text on the first live run of this test and fold it into this document as
> a v1.2 note** — at that point it becomes useful for *diagnosis* (recognising the failure in a log),
> which is a different job from *assertion*.

✓ **AT-22.** *(The `source`/`role` trap — §6.9.)* Given the adapter receives an `onMessage` payload,
when it forwards the turn, then it forwards the payload's **`source`** value (`'user' | 'ai'`) and
never its `role` value (`'user' | 'agent'`). Asserted directly against a payload where the two
differ, because forwarding `role` would be silently dropped by the capture route's Zod enum and lose
every one of Clio's turns from the transcript.

✓ **AT-23.** *(Tool failures must not impersonate connection failures — §6.6.6.)* Given a connected
session, when a client tool handler throws (or the agent calls an unregistered tool name) and the SDK
fires `onError` with a `context.clientToolName`, then: the adapter emits `el_tool_error`, calls
`reportError`, and **does not** call `config.onError`; `status` stays `'listening'`/`'speaking'`; the
connection pill stays green; and no "Voice connection issue" toast appears. Conversely, given an
`onError` **without** a `clientToolName`, then `config.onError` **is** called and the session does
enter the error state.

✓ **AT-24.** *(WebRTC transport is actually used.)* Given a widget session on ElevenLabs, when
`startSession` is called, then it is called with `conversationToken` and `connectionType: 'webrtc'`,
and with neither `signedUrl` nor `agentId` present in the options object.

✓ **AT-25.** *(The seeded agent id is live on a fresh deploy.)* Given migration 111 has run against a
database where `elevenlabs_agent_id` was null, when an admin loads `/dashboard/admin`, then the Agent
ID field is pre-filled with `agent_0701krp1ta48fswrff17ctb0520m`, `elevenlabs_api_key_set` is
`false`, and the ElevenLabs tile's caption reads "Add an API key below to enable." Re-running the
migration against a row whose agent id has since been changed must **not** overwrite it.

✓ **AT-16.** *(Token route failure.)* Given `GET /api/elevenlabs-token` returns a non-200 for any
reason, when `connect()` runs, then the thrown error is caught by the existing handler,
`reportClientError` is called, `status` becomes `'error'`, the warm-up overlay is dismissed so
content is readable, and the page does not crash or hang on the spinner.

✓ **AT-17.** *(Credentials never round-trip.)* Given an API key is saved, when the admin reloads
`/dashboard/admin` and inspects the `GET /api/admin/widget-voice-config` response, then the response
contains `elevenlabs_api_key_set: true` and **no field anywhere in it contains any portion of the key
or its ciphertext**. The rendered API-key input's `value` is the empty string.

✓ **AT-18.** *(Auth.)* Given a caller without a `super_admin` session (unauthenticated, or an
`internal_staff` session), when they call `GET` or `PATCH /api/admin/widget-voice-config`, then the
request is rejected (`401`/`403` per `requireSuperAdmin()`'s existing behaviour) and nothing is
returned or changed.

✓ **AT-19.** *(Migration seeding — D2's copy-don't-default rule.)* Given `active_provider` is
`'openai_realtime'` before migration 111 runs, when it runs, then `widget_provider` is
`'openai_realtime'` — **not** `'hume'`. Re-run the assertion with `active_provider = 'hume'` and
assert `widget_provider = 'hume'`. *A hardcoded default would silently regress the widget on deploy.*

✓ **AT-20.** *(In-flight sessions.)* Given a widget session is already running on OpenAI Realtime,
when the admin switches `widget_provider` to `'elevenlabs'` and saves, then the running session
continues on OpenAI Realtime to completion, and only sessions rendered after the save use ElevenLabs.

✓ **AT-21.** *(Existing card untouched in behaviour.)* Given the "Live voice provider" card, when the
admin uses it, then its two tiles, confirm dialog, PATCH body, target route and persisted column are
all exactly as before this feature — the only difference visible anywhere is its subheading copy.

## 8. Error States

| Failure | User-visible behaviour | Notes |
|---|---|---|
| `GET /api/admin/widget-voice-config` fails on mount | Card shows "Couldn't load widget voice settings. Try refreshing the page." in red; nothing interactive renders; no auto-retry | Matches `DemoAccessCard` / `VoiceProviderCard` convention exactly |
| `PATCH` fails (network or non-2xx) | Displayed saved state does **not** change; pending selection and typed input preserved; specific inline red message per §4.2.7; button re-enabled | Non-optimistic by design — same reasoning as B2B-61 §11 |
| `PATCH` rejected: API key missing | "Add an API key before selecting ElevenLabs." | Only reachable via a direct API call; the UI's disabled tile prevents it |
| `PATCH` rejected: agent ID missing | "Add an agent ID before selecting ElevenLabs." | Only reachable if an admin explicitly cleared the seeded agent id, then bypassed the UI |
| `PATCH` rejected: availability flag off | "ElevenLabs isn't available yet." | Same |
| Wrong-role / unauthenticated API caller | Standard `requireSuperAdmin()` 401/403 envelope | The card itself is unreachable by such a caller (`page.tsx`'s own gate) |
| **ElevenLabs credentials not configured at session time** | Content pages render; **no voice**; no call-controls overlay; no timer. Server log: `[widget-render] widget provider is elevenlabs but no agent id is configured — rendering without voice` | Identical degradation to a missing `humeConfigId` today. **Never falls back to another provider** (§6.8.4) |
| **Token route 500 (credentials unreadable / decrypt failed)** | `status: 'error'`; warm-up dismissed; content readable; red pill "Disconnected"; "Voice connection issue — content is still visible." toast | The ciphertext and plaintext appear in no log line |
| **Token route 502 (ElevenLabs rejected the key)** | Same as above | Response body from ElevenLabs is logged for diagnosis; the key never is |
| **Override rejected — the C2 failure** | Connection fails during initiation; adapter emits `el_error` **and** `el_override_rejected`; pill red; session shows the voice-error state. **The session does not proceed on the base agent's own prompt.** | Per the docs, ElevenLabs *"throws an error"* rather than silently ignoring the override, so this is loud by the vendor's own design. **No verbatim message or status code is documented** — AT-15 asserts behaviour only and never a string |
| **A client tool the agent calls is not registered** | **Loud, three ways at once**, all verified in `BaseConversation.ts`: (1) `onError("Client tool with name ${tool_name} is not defined on client", { clientToolName })`; (2) `{ type: "client_tool_result", …, result: <same message>, is_error: true }` goes back over the wire, so the **agent itself is told** and can recover verbally; (3) the adapter emits `el_tool_error`. **The session UI stays healthy** (§6.6.6) | Reachable only via name drift between the dashboard tools and `config.tools`. Case-sensitivity is called out in §12.1 step 2. `onUnhandledClientToolCall` is deliberately not supplied — it would suppress both (1) and (2) |
| **A registered client tool's handler throws** | `onError("Client tool execution failed with following error: …", { clientToolName })`; `is_error: true` sent back to the agent; adapter emits `el_tool_error`; **session UI stays healthy** | Same discrimination path as the row above. Note the existing handlers are defensive already (`show_visual` returns a string even when the jump is rate-limited), so this is a backstop, not an expected path |
| **Successful tool result** | `{ type: "client_tool_result", tool_call_id, result: formattedResult, is_error: false }`, where non-strings are `JSON.stringify`'d and everything else `String()`-ed | Our three handlers already return plain strings, so no conversion occurs. Documented so a future handler returning an object is not a surprise |
| **Mid-session disconnect** | `onStatusChange → 'disconnected'` → red pill; `onDisconnect` → `status: 'ended'`; `endSessionOnce()` runs and posts the elapsed duration | No manual reconnect loop (§6.6.6) — the SDK owns its transport |
| **Slow token route / slow connect** | The existing 6-second warm-up timeout (`WidgetRenderClient.tsx:337`) dismisses the overlay so content is readable even if voice never arrives | Unchanged, provider-independent |
| **Mic permission denied** | `getUserMedia` throws → caught by the existing handler → `status: 'error'` + content readable | Unchanged, provider-independent |
| Two admins save near-simultaneously | Last write wins | Conscious choice, same as B2B-61 §9: a `requireSuperAdmin()`-only singleton is a low-concurrency surface; `updated_at` gives the audit trail. Optimistic locking would be over-engineering |

## 9. Edge Cases

- **Migration runs when `active_provider` is `'openai_realtime'`** — `widget_provider` is seeded
  `'openai_realtime'`, preserving today's believed widget behaviour. This is the entire reason for
  the nullable-then-backfill-then-NOT-NULL sequence (§6.1, AT-19).
- **Admin saves credentials but never selects ElevenLabs** — nothing changes for any session. The
  feature ships "selectable but not selected" (brief §8), and this is the expected day-one state.
- **Admin switches away from ElevenLabs, leaving credentials saved** — credentials persist; the tile
  stays selectable; no cleanup. Switching back needs no re-entry.
- **Admin replaces the API key while ElevenLabs is the active widget provider** — the new ciphertext
  applies to the next token mint. Sessions already connected are unaffected (their signed URL is
  already issued). No session is interrupted.
- **`PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY` changes between save and read** — `decryptOutboundToken`
  returns `null` (never throws, by its own contract); the token route returns `500`; the session
  degrades to content-only. Recovery: re-enter the key in the admin card. Explicitly not silent.
- **A widget session whose `voice_provider` was written as `'elevenlabs'` while the admin later
  switches to Hume** — the extractor reads the **stored per-session snapshot**, never the current
  toggle, so it still uses the Redis path. This is exactly the invariant migration 106's own column
  comment establishes, and it is preserved.
- **Sessions predating migration 111** — `voice_provider` is `NULL` or `'hume'`/`'openai_realtime'`;
  the widened `CHECK` accepts all existing values and no backfill is needed.
- **First page's `show_visual` never fires** — the participant sees page 1 anyway (it is the initial
  `displayedIndex`). Unchanged, provider-independent.
- **Participant mutes for the whole session** — the SDK's stream is muted, so the agent hears
  nothing; the mic pill sits neutral grey. The idle-silence check-in does **not** fire on ElevenLabs
  (no equivalent trigger, §6.10), so the session simply waits until the 60-minute cap. Stated as a
  known, accepted degradation relative to OpenAI, not a defect introduced here.
- **Mobile / narrow viewport.** The three provider tiles stack vertically (`flex-col`, full width)
  below `sm:` and sit side-by-side (`sm:flex-row`, each `sm:flex-1`) above. Both credential inputs are
  full-width at every breakpoint. Both buttons are `w-full` below `sm:` and `sm:w-auto` above. **No
  hardcoded pixel-width caps anywhere**, per the standing responsive rule. `clamp()` is deliberately
  not introduced: every text size reuses the existing fixed Tailwind scale, matching `DemoAccessCard`
  and `VoiceProviderCard` sitting immediately above on the same page — introducing interpolated
  sizing on one card in isolation would visually diverge from its siblings for no benefit. The rule's
  actual target (no pixel-width layout caps) is fully satisfied; this is a reasoned scope call on the
  `clamp()` half, identical to the one B2B-61 §9 made and the CEO approved.
- **A second admin changes the setting in another tab** — no realtime sync, no polling. The open tab
  shows what it last fetched until reloaded. Matches both sibling cards' existing behaviour;
  an intentional non-goal for a low-traffic internal control.
- **Very long API key or agent id** — bounded by Zod (`max(500)` / `max(200)`), rejected with the
  standard 400 validation envelope.
- **Whitespace-padded paste into either credential field** — `z.string().trim()` strips it before
  encryption/storage, so a trailing newline from a clipboard paste cannot silently produce a
  401 from ElevenLabs later.

## 10. Out of Scope & Complete Files-Changed List

### 10.A — Files Changed (exhaustive, in build order)

The CEO's QA gate checks the implementation against this list at source level. Anything not listed
here must not be modified.

**Create (8):**

| # | Path | What |
|---|---|---|
| 1 | `supabase/migrations/111_b2b75_widget_voice_provider_and_elevenlabs.sql` | §6.1, verbatim |
| 2 | `lib/voice/widget-elevenlabs-prompt-rules.ts` | §6.10 — new self-contained prompt module |
| 3 | `lib/voice/elevenlabs-adapter.ts` | §6.6 — `ElevenLabsAdapter implements VoiceSessionAdapter` |
| 4 | `app/api/elevenlabs-token/route.ts` | §6.4 — WebRTC conversation-token mint (`GET /v1/convai/conversation/token`, `xi-api-key`, server-side only), DB-sourced credential. **Not** the WebSocket signed-URL path — that remains documented as the one-field fallback only. _(Stale "signed-URL" label in this row corrected by CEO at approval; §6.4 itself is correct.)_ |
| 5 | `app/api/admin/widget-voice-config/route.ts` | §6.2 GET + §6.12 PATCH |
| 6 | `app/(with-clerk)/dashboard/admin/WidgetVoiceProviderCard.tsx` | §4.2, §5 |
| 7 | `tests/unit/elevenlabs-adapter.test.ts` | §13 |
| 8 | `tests/integration/widget-voice-config-api.test.ts` | §13 |

**Modify (10):**

| # | Path | Exact change |
|---|---|---|
| 9 | `package.json` | Add `@elevenlabs/client` (current stable). No other dependency added or removed |
| 10 | `lib/voice/adapter.ts` | Add **one** optional member, `getOutputFrequencyData?(): Uint8Array \| null`, with the doc comment in §6.6.4. Nothing else changes |
| 11 | `lib/voice/provider-availability.ts` | Add `ELEVENLABS_ADAPTER_AVAILABLE = true` (§6.3). `OPENAI_REALTIME_ADAPTER_AVAILABLE` untouched |
| 12 | `lib/voice/provider-config.ts` | Add `WidgetVoiceProvider` type, `getWidgetVoiceProvider()`, `getElevenLabsAgentId()` (§6.2). **`getActiveVoiceProvider()` is not modified** |
| 13 | `app/(with-clerk)/widget-render/[clio_session_ref]/page.tsx` | §6.8 — five changes: provider read swap, agent-id resolve, conditional prompt assembly, fail-closed log, two new props |
| 14 | `app/(with-clerk)/widget-render/[clio_session_ref]/WidgetRenderClient.tsx` | §6.7 — five changes: props, `voiceEnabled` + 4 gate sites + Hume narrowing guard, third adapter branch, transcript gate widened, frequency-data fallback + `sampleFrequencyBars` helper |
| 15 | `inngest/partner-session-insights-extractor.ts` | §6.9 — **one condition** at line 265 widened to include `'elevenlabs'`. Nothing else |
| 16 | `middleware.ts` | Add `/^\/api\/elevenlabs-token$/` to `TENANT_SCOPED_PATTERNS` (§0.A). Nothing else |
| 17 | `app/(with-clerk)/dashboard/admin/page.tsx` | One import + one `<WidgetVoiceProviderCard />` line below `<VoiceProviderCard />`. Nothing else |
| 18 | `app/(with-clerk)/dashboard/admin/VoiceProviderCard.tsx` | **Copy-only**: the subheading string (§4.1). No logic, state, handler, route or markup-structure change |

**Documentation / configuration (4):**

| # | Path | Change |
|---|---|---|
| 19 | `CLAUDE.md` | §6.11 — remove the ElevenLabs "removed" line with a dated reversal note; add `@elevenlabs/client` to the approved list with scope and the `@elevenlabs/elevenlabs-js` non-adoption note |
| 20 | `.env.local.example` | §6.11 — remove `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` and `NEXT_PUBLIC_ELEVENLABS_VOICE_ID`. **Keep `ELEVENLABS_CUSTOM_LLM_SECRET`** |
| 21 | `docs/b2b-pivot-status.md` | Add B2B-75 to the Live Status table |
| 22 | `BACKLOG.md` | Log the pre-existing `/api/openai-realtime-token` middleware omission (observation only, not fixed here) |

**Explicitly NOT modified — assert byte-for-byte identical at review (AT-9):**
`app/(with-clerk)/partner-render/**` (every file), `lib/voice/widget-prompt-rules.ts`,
`lib/voice/hume-adapter.ts`, `lib/voice/openai-realtime-adapter.ts`,
`lib/voice/openai-realtime-tools.ts`, `lib/voice/openai-realtime-prompt-template.ts`,
`lib/partner/live-render.ts`, `lib/partner/crypto.ts`, `app/api/hume-token/route.ts`,
`app/api/openai-realtime-token/route.ts`, `app/api/admin/voice-config/route.ts`,
`app/api/partner/render/transcript-capture/route.ts`,
`supabase/migrations/104_b2b61_system_voice_config.sql`,
`supabase/migrations/106_voice_provider_per_session.sql`.

### 10.B — Out of Scope

- **The inline / meeting-bot / `partner-render` channel entirely.** `active_provider` keeps its
  two-value domain and its existing behaviour.
- **Agent cloning** — superseded by `conversation_config_override` (C2).
- **Agent-pool revival** (`lib/elevenlabs-pool.ts`, deleted in 7a0020a) and **server-side audio
  relay** (`server.ts`, `lib/voice/relay-handler.ts`, deleted) — read as history, not revived.
- **Concurrency, tier and capacity management** — explicitly ruled out by Arun.
- **Per-partner ElevenLabs credentials** — platform-level only (D1). Purely additive later if a
  partner ever brings their own account; nothing here forecloses it.
- **Any edit to `lib/voice/widget-prompt-rules.ts`** (C6).
- **Overriding voice, model, TTS settings, first message, language, knowledge base, or tool IDs on
  the ElevenLabs agent** — only `agent.prompt.prompt` is overridden (C3).
- **Making ElevenLabs the active widget provider on deploy** — it ships selectable, not selected.
- **WebRTC transport** — the WebSocket signed-URL path is used (§6.4). WebRTC remains available as a
  future change if latency ever warrants it.
- **ElevenLabs' post-hoc transcript API** — recorded as a clean future option if live capture proves
  lossy (§6.9), not built now.
- **Fixing `/api/openai-realtime-token`'s middleware omission** — logged to `BACKLOG.md`, not fixed.
- **Any change to the billing model.** Widget session duration is measured client-side from
  `connectStartRef` and posted to `/api/partner/render/end-session` — provider-independent, unchanged
  (§11 Q7 rationale).
- **An audit log / change history UI** for either provider setting.
- **Cross-tab realtime sync** of either card's displayed state.
- **A new `/design-review` pass.** Per CLAUDE.md's division-of-labour rule, that runs after this
  CEO/BA-approved screen is built, as a separate polish pass, and is not part of this spec.

## 11. Open Questions

**None.** All eleven questions the CEO brief raised in §7 are resolved in this document, each with
its reasoning and its evidence:

1. **Exact schema change** — resolved: three new columns on the existing `system_voice_config`
   singleton plus a widened `partner_sessions.voice_provider` CHECK, migration `111`, given verbatim
   in §6.1. A sibling `system_elevenlabs_config` table was considered and rejected: it would double
   the route, card, RLS and read-helper plumbing for no isolation benefit, and D1 already establishes
   one platform singleton for voice config. D2's copy-don't-default seeding is implemented as an
   explicit nullable → `UPDATE … SET widget_provider = active_provider` → `SET NOT NULL` sequence,
   with no `DEFAULT` anywhere, and is asserted by AT-19.
2. **Server-minted credential vs public agent** — resolved: a private agent with a **server-minted
   WebRTC conversation token**, from the new `app/api/elevenlabs-token/route.ts` (§6.4). A public
   agent (bare `agentId` in the browser) is rejected outright — it would make Arun's agent callable
   by anyone.
   **This reverses v1.0's transport choice, on the CEO's decision and with the verification gap now
   closed.** v1.0 chose the WebSocket signed URL because the WebRTC token endpoint's auth header
   could not be confirmed; it is now sourced from ElevenLabs' own server-side example (§6.4), and
   labelled honestly as *inferred from examples, not doc-stated*. WebRTC is shipped because it is the
   vendor's documented default and lower-latency path for voice — and this feature exists for Arun to
   evaluate the vendor's voice quality, so shipping the slower transport would have him evaluating
   our transport choice instead. The WebSocket signed URL remains documented as a **two-change
   fallback** (§6.4).
   **Token expiry is undocumented for the WebRTC endpoint** — the 15-minute figure belongs to the
   signed-URL endpoint only and is explicitly not carried across; the design is built not to depend
   on it (mint fresh, use once, never store), so it is correct under any real TTL.
   Failure behaviour is fully specified (500/502 branches, key never logged or returned). Middleware
   is confirmed correct — `/api/*` bypasses Clerk's page gate, and the route is added to
   `TENANT_SCOPED_PATTERNS` for parity with `/api/hume-token`. `cache: 'no-store'` is mandated,
   carrying forward the OpenAI route's documented live-diagnosed caching bug — and it matters *more*
   here, since a cached response would also duplicate `conversation_id` across participants.
3. **Where the override is sent, verbatim** — resolved and **cited** in §6.5. Path confirmed as
   `overrides.agent.prompt.prompt` (SDK) /
   `conversation_config_override.agent.prompt.prompt` (wire), from
   `elevenlabs.io/docs/agents-platform/customization/personalization/overrides` and
   `elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket`, fetched live during this
   spec's authoring. The exact payload this build sends — and the explicit list of fields it must not
   send — is specified. **Additionally upgraded to type-level confirmation in v1.1**: `overrides`
   lives on `BaseSessionConfig`, which all three auth variants extend, so overrides ride regardless
   of auth path — including the WebRTC `conversationToken` path this build ships (§0.B). AT-6 is
   retained anyway, because type-level acceptance is not server-side honouring.
4. **Tools** — resolved: `show_visual`, `advance_tab`, `end_session` map 1:1 from the existing
   `config.tools` record to the SDK's `clientTools` option (§6.6.3). They **must** be pre-declared on
   the base agent, with case-sensitive matching names and parameters — manual setup step 2 in §12.1,
   listed as prominently as C2's, with the exact parameter schema for `show_visual`. **A third manual
   step was added in v1.1**: the per-tool **"Wait for response"** option must be left **unticked** on
   all three (§12.1 step 3) — ticking it makes the agent wait on a result that carries no meaning,
   inserting dead air at page transitions and the closing, and presenting as a pacing/prompt problem.
   Tool failure handling is fully specified from SDK source (§8) and is **loud, not silent** — with
   the caveat that both tool-failure paths share `onError` with fatal connection errors, requiring the
   discrimination specified in §6.6.6.
5. **Page-advance mechanism** — resolved honestly, with the gaps named rather than papered over
   (§6.6.4). `advance_tab` itself works identically (it is a model-called tool).
   `waitForPlaybackCaughtUp()` is implemented as an **explicitly-labelled proxy** on
   `onModeChange → 'listening'` with a 3-second cap, because ElevenLabs exposes no audio queue and no
   playback-complete event; it is stated as strictly no-worse-than-Hume, carries a named one-line
   revert path, and AT-11 exists to settle it against a real session rather than assume it.
   `transcriptGateMode` has no ElevenLabs analogue and is not simulated. `onUserSpeechStarted` is
   **not available** — the consequence (the post-tool-call nudge is no longer cancelled by the
   participant starting to speak; it is still cancelled by the model starting to speak, via
   `onModeChange`) is stated plainly.
6. **Transcript capture and diagnostics** — resolved (§6.9). Live capture via the existing Redis
   path, with the reasoning for preferring it over ElevenLabs' (genuinely existing) post-hoc API, and
   the required one-condition fix to `inngest/partner-session-insights-extractor.ts` — a live trap
   the brief did not name, which would otherwise send every ElevenLabs session's extraction to Hume's
   API. The connection-health pill has a **real** signal here (`onStatusChange`), specified in §6.7c.
   Nothing decorative or simulated is introduced anywhere.
7. **Billing** — resolved (§6.6.4). Verified-speak on ElevenLabs is the two-signal condition
   `onConnect` (real provider-assigned conversation id) **AND** first `onModeChange → 'speaking'`,
   matching the bar `lib/voice/adapter.ts` states and both live adapters. The deleted 93-line
   adapter's `isOpen()`-poll is **explicitly not reused** — it fired on socket-open alone, below that
   bar, and `isOpen()` no longer exists on the current SDK anyway. Session duration for the usage
   ledger is unchanged and provider-independent: `WidgetRenderClient`'s `connectStartRef` →
   `duration_minutes` → `POST /api/partner/render/end-session` → `handleSessionEnd(...)`.
8. **The `humeConfigId` gate** — resolved (§6.7b), including the **three additional sites** beyond
   the one the brief named, the explicitly byte-equivalent treatment of the two existing providers,
   and the TypeScript narrowing consequence with its exact fix.
9. **`partner_sessions.voice_provider` CHECK** — confirmed it needs widening (the widget page does
   write it) and included in migration 111 as a `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` pair.
10. **Admin UI behaviour** — resolved at wireframe level (§4, §5): a **separate** card rather than an
    extension of the existing one (making D2's channel separation visible in the UI itself, and
    leaving `VoiceProviderCard`'s logic untouched), seven fully-described states, exact copy, exact
    Tailwind classes reused from the named sibling-card precedents, password-type write-only API-key
    field that never round-trips, plaintext agent-ID field, server-decided disabled-tile captions via
    `elevenlabs_blocked_reason` (mirroring and extending the `openai_realtime_available` gating
    pattern), and `window.confirm` on the provider switch but deliberately not on a credentials save,
    with that asymmetry's reason stated. **Revised in v1.1** now that the real agent id is seeded by
    migration 111: the day-one blocked state is *API key missing only*, `blocked_reason` splits into
    `'api_key' | 'agent_id' | 'flag'` so the caption names the specific missing credential, and the
    agent-ID field ships pre-filled.
11. **Package name confirmation** — resolved: **`@elevenlabs/client`**, confirmed on npm (721k weekly
    downloads, latest 1.17.0), confirmed as the named successor to the now-deprecated
    `@11labs/client`, and confirmed to support **both** `conversation_config_override` (via the
    `overrides` option) **and** client tools (via the `clientTools` option) — each verified against
    live documentation with the URL cited in §0.B. **No escalation to the CEO is required on D4.**
    Two deliberate non-adoptions are recorded in §6.11: the server-side `@elevenlabs/elevenlabs-js`,
    and `@elevenlabs/react`'s `useConversation()` hook (which would break the imperative
    adapter-class pattern all three providers share). **One transitive dependency is disclosed and
    given its own CLAUDE.md entry** per the CEO's direct decision: `livekit-client@2.16.1`, a direct
    runtime dependency of `@elevenlabs/client` supplying the WebRTC transport — we install exactly
    one top-level package, but its version rides on ElevenLabs' release schedule rather than ours,
    which is why the entry exists (§6.11).

Nothing in this document requires escalation to Arun beyond the CEO's own review and approval of the
spec itself.

**Three items are deliberately recorded as unverifiable-until-first-live-call rather than guessed**
(§13.4.1): the vendor's override-rejection error text, the WebRTC token's TTL, and whether
`xi-api-key` is strictly required on the token endpoint. None is a blocker, none is load-bearing, and
in each case the design is correct under every possible answer — which is why they sit in an
observation list rather than in this section.

## 12. Dependencies

### 12.1 ⚠️ MANUAL SETUP — Arun must complete these in the ElevenLabs dashboard

**These are not footnotes. Steps 1-3 each fail in a way that looks like something else.** Complete
all four before the first ElevenLabs widget session.

Target agent: **`agent_0701krp1ta48fswrff17ctb0520m`** — already seeded into the database by
migration 111, so it is pre-filled in the admin card and you do not need to type it anywhere.

> **STEP 1 — Enable the System-prompt override on the base agent. MANDATORY.**
> ElevenLabs disables overrides by default: *"For security reasons, overrides are disabled by
> default."* Go to the Clio agent → **Settings → Security tab** → enable the **System prompt**
> override toggle.
> **Enable only that one.** This build overrides only `agent.prompt.prompt` (C3), and every extra
> enabled field is surface area for an unintended future override.
> **If this is skipped:** ElevenLabs *"throws an error"* when the override arrives, so the session
> fails loudly rather than quietly teaching the base agent's own prompt. AT-15 asserts this. Loud
> failure is the intended and verified behaviour — but the session will not run until this is done.
> Source: `https://elevenlabs.io/docs/agents-platform/customization/personalization/overrides`

> **STEP 2 — Pre-declare the three client tools on the base agent. MANDATORY.**
> Go to the agent's **Tools** section → **Add Tool** → **Tool Type: Client**, three times. Names and
> parameter identifiers are **case-sensitive and must match the code exactly**:
>
> | Tool name | Parameters | Description to enter |
> |---|---|---|
> | `show_visual` | `section_index` (Number, **not** required); `topic_title` (String, **not** required) | "Call this the moment you begin covering a new section, before you start speaking about it substantively. It only signals which section's visual to show; it does not advance to the next section. Pass whichever of section_index or topic_title you know. Calling this is a silent action: say nothing to announce, introduce, or accompany it." |
> | `advance_tab` | none | "Call this when — and only when — the current section is fully covered: content taught, verification question asked and answered, and your response to that answer given. This is the only tool that ever advances to the next section. Calling this is a silent action: say nothing to announce, introduce, or accompany it." |
> | `end_session` | none | "Call this immediately after you deliver your closing goodbye, in that same turn, when the session is over. This is the only way the call ends — it never ends automatically just because you said goodbye." |
>
> Descriptions are carried over from `lib/voice/openai-realtime-tools.ts`, which the widget channel
> already uses; per OpenAI's and ElevenLabs' own developer guidance, per-tool descriptions are
> followed more closely than general prompt rules, so keeping them aligned matters.
> **If this is skipped:** the agent does not know the tools exist. It will talk, but the screen will
> never move and the session will never end itself.
> Source: `https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools`

> **STEP 3 — Leave "Wait for response" UNTICKED on all three tools. MANDATORY.**
> Each client tool in the ElevenLabs dashboard has a **"Wait for response"** option. Docs: *"When you
> want your agent to receive data back from a client tool, ensure that you tick the Wait for response
> option."*
> **All three of our tools are fire-and-forget** — `show_visual`, `advance_tab` and `end_session`
> return a bare acknowledgement string (`"Visual is showing."`, `"Advanced."`, `"Session ended."`)
> that carries no information the model needs in order to decide what to say next. Every one of them
> should have this option **left unticked**.
> **If this is ticked:** the agent pauses its turn waiting on a result that, when it arrives, tells it
> nothing — inserting a dead gap into the conversation at exactly the moments that matter most (a
> page transition, the closing). Symptomatically this looks like a pacing or prompt problem, which is
> the worst possible place to be looking.
> **Not specified:** there is also a `response_timeout_secs` setting (default 30 s) whose
> applicability to *client* tools (as opposed to MCP/server tools) **could not be confirmed** from
> the documentation. Since "Wait for response" is unticked, no timeout should ever come into play —
> leave it at its default and do not tune it. Flagged as unconfirmed rather than specified.
> Source: `https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools`

> **STEP 4 — Create (or copy) an ElevenLabs API key, and paste it into the admin card.**
> ElevenLabs dashboard → Profile → API Keys → paste into the **API key** field at
> `/dashboard/admin` → "Save credentials". It is encrypted at rest and can never be read back —
> keep your own copy.
> **This is the only credential you need to enter.** The agent ID is already there.
> Then select the **ElevenLabs** tile and click "Save provider".

**Do not** change the agent's voice, model, or any other setting — this build deliberately overrides
nothing but the prompt (C3), so whatever is configured there is what the participant hears.

### 12.2 Code / infrastructure dependencies

- `requireSuperAdmin()` — `lib/internal-admin/auth.ts`. Exists, reused unmodified.
- `createSupabaseAdminClient()` — `lib/supabase.ts`. Exists, reused unmodified.
- `encryptOutboundToken` / `decryptOutboundToken` — `lib/partner/crypto.ts`. Exist, reused
  **unmodified**. No new alias is added: the semantics ("an outbound credential Clio replays
  outward") are already exactly what the existing doc comment describes, so an
  `encryptVoiceProviderCredential` alias would add a name without adding meaning.
- `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY` — must be a real value in production for the stored key to
  be genuinely protected. The dev fallback in `crypto.ts` still encrypts (never plaintext) but is not
  safe for a real key. **This is the one environment prerequisite**, and it already exists for
  B2B-02/B2B-19; no new env var is introduced.
- `update_updated_at_column()` trigger — already attached to `system_voice_config` by migration 104;
  covers the new columns automatically.
- Migration `111` must be applied before `GET`/`PATCH /api/admin/widget-voice-config`,
  `getWidgetVoiceProvider()`, or any widget session render can function.
- Upstash Redis (`@upstash/redis`, `KV_REST_API_URL`/`KV_REST_API_TOKEN`) — already provisioned for
  B2B-63. ElevenLabs sessions reuse it for live transcript capture; nothing new is provisioned.
- `@elevenlabs/client` must be installed **and** CLAUDE.md's approved-library list updated in the
  same change — a new dependency that is still on the *removed — flag if found in new code* list
  would fail the project's own governance check at review.
- No dependency on B2B-61 Part A or Part B beyond what already shipped; both are live.

## 13. Test Plan

### 13.0 The build/verify split — explicit, per Arun's instruction

Arun's instruction is *"complete everything that you can build, leave only the testing part and
entering the api key with me."* That splits cleanly, and the split is **by design, not a gap in the
build**:

| | Owner | Contents |
|---|---|---|
| **Automated — must be written and must pass before the build is called done** | Developer | Everything in §13.1-§13.3. All of it is provable without a real ElevenLabs API key, using a mocked SDK and mocked outbound `fetch`. **No automated test is skipped or marked pending on the grounds that a key is unavailable.** |
| **Live verification — Arun's, and only Arun's** | Arun | §13.4, four items. Requires a real key and a real session |
| **API-key entry** | Arun | §12.1 step 4. The developer never possesses or enters a key |

The developer's definition of done is: §13.1-§13.3 written and green, everything in §10.A built, and
§12.1 documented for Arun. **Nothing in the build waits on the key.**

### 13.1 Unit (`tests/unit/`)
- `elevenlabs-adapter.test.ts`, against a mocked `@elevenlabs/client`:
  - `startSession` is called with `overrides` **exactly** equal to
    `{ agent: { prompt: { prompt: instructions } } }` — assert no `tts`, `conversation`, `asr`,
    `llm`, `toolIds`, `knowledgeBase`, `firstMessage` or `language` key is present anywhere in the
    object (C3, and the direct cause of the AT-15 failure mode if violated).
  - **`dynamicVariables` is not present in the options object at all** (§6.5.1).
  - `conversationToken` and `connectionType: 'webrtc'` are passed; **`signedUrl` and `agentId` are
    absent**; **no API key appears anywhere in the options object** (AT-24).
  - **`onMessage` forwards `source`, never `role`** — feed a payload where they differ
    (`{ source: 'ai', role: 'agent' }`) and assert `config.onMessage(text, 'ai')` (AT-22).
  - **`onError` discrimination** (AT-23): with `context.clientToolName` present → `el_tool_error` +
    `reportError`, and `config.onError` **not** called; without it → `config.onError` called.
  - **`isOpen()` handles all four `Status` values**, including `'disconnecting'` → `false`.
  - **`onDisconnect` payload** is flattened into `el_disconnect` with the correct `reason` for each
    of the three `DisconnectionDetails` variants.
  - `onSpeakVerified` fires **only** after both `onConnect` and the first
    `onModeChange('speaking')` — asserted in both orders, and asserted **not** to fire on
    `onConnect` alone, nor on `onStatusChange('connected')` alone.
  - `isOpen()` tracks `onStatusChange` transitions correctly.
  - `waitForPlaybackCaughtUp()` resolves immediately when not speaking, on the next `'listening'`
    when speaking, and **within the 3000 ms cap** when `'listening'` never arrives.
  - `endSession()` waits for the mode gate before calling `conversation.endSession()`, and never
    throws when the underlying call rejects.
  - Each tool handler's return string is propagated back as the tool result.
  - `getOutputAnalyser` is `undefined` on the instance; `getOutputFrequencyData()` returns the SDK's
    bytes and `null` when the SDK throws.
- `provider-config.test.ts`: `getWidgetVoiceProvider()` returns each of the three values, and
  fail-opens to `'hume'` on a missing row and on a thrown error. `getActiveVoiceProvider()`'s
  behaviour is asserted unchanged (a regression guard on D2's separation).
- `widget-elevenlabs-prompt-rules.test.ts`: assembles without throwing on minimal input; the output
  contains the session content and the participant name; **contains no reference to a removed
  G-rule number** (the §6.10 renumbering guard); G-rule numbering is contiguous.

### 13.2 Integration (`tests/integration/`)
- `widget-voice-config-api.test.ts`:
  - Full auth matrix on GET and PATCH (401 no session, 403 `internal_staff`, 200 `super_admin`).
  - GET's response **never** contains the ciphertext or the plaintext key, under any stored state
    (AT-17).
  - PATCH `{ widget_provider: 'elevenlabs' }` with no stored API key → `400
    elevenlabs_api_key_missing`, row unchanged (AT-13). Separately, with the agent id cleared →
    `400 elevenlabs_agent_id_missing`.
  - PATCH supplying the API key **and** selecting ElevenLabs in one request → `200` (the post-write
    evaluation rule in §6.12 gate 3).
  - PATCH with `ELEVENLABS_ADAPTER_AVAILABLE = false` → `400 elevenlabs_not_available`, row
    unchanged.
  - PATCH with an empty body → `400` with the Zod envelope.
  - After a key PATCH, the stored `elevenlabs_api_key_ciphertext` **round-trips through
    `decryptOutboundToken` to the original plaintext** and is not equal to the plaintext (i.e. it is
    genuinely encrypted, not stored raw).
- `elevenlabs-token-route.test.ts` (mocked outbound `fetch`): 500 when credentials are absent; 500
  when decryption returns null; 502 on a non-2xx from ElevenLabs; 502 on a missing `token` field; 200
  with `{ conversationToken, agentId }` on success. **In every branch, assert the API key appears in
  neither the response body nor any captured log line.** Assert the outbound call targets
  `/v1/convai/conversation/token`, carries `cache: 'no-store'` and the `xi-api-key` header, and that
  the response body does **not** include `conversation_id` (§6.4).
- `insights-extractor.test.ts`: a session with `voice_provider = 'elevenlabs'` takes the Redis
  transcript path and **never** calls Hume's transcript API. Existing `'hume'`, `NULL`, and
  `'openai_realtime'` cases are asserted unchanged.

### 13.3 E2E (Playwright, `tests/e2e/`)
- `admin-widget-voice-provider.test.ts`: load `/dashboard/admin` as super-admin; assert **both** cards
  render with independent values; assert the ElevenLabs tile is disabled with the "Add an API key
  below to enable." caption while the agent id is present and the key is not; save a mocked key and
  assert the tile becomes enabled in-place without a
  reload; select ElevenLabs → confirm dialog accept → success message; a mocked PATCH failure run
  asserting the active tile does not change and the retry path works; assert the API-key input's
  `value` is `''` after every successful save; 375 px viewport render asserting the three tiles stack
  with no horizontal page scroll.

### 13.4 Live verification — Arun's, requires a real API key

**Not a gap in the build.** These four cannot be automated because they need a real key and a real
conversation. Everything else (§13.1-§13.3) is written, green, and shipped before these begin.

1. Run one real widget session end to end and confirm AT-4, AT-5 and **AT-6** (the override actually
   landed — Clio teaches *this session's* material, not the base agent's).
2. Temporarily untick the System-prompt override toggle on the agent and confirm **AT-15** — the
   session fails visibly rather than silently running the base prompt. Re-tick afterwards.
3. Capture the diagnostic timeline and settle **AT-11** (`waitForPlaybackCaughtUp` proxy).
4. With `widget_provider = 'elevenlabs'`, run one real meeting-bot session and confirm **AT-8** — the
   inline channel is bit-for-bit unaffected. The brief's hardest success criterion; must be proven on
   a real session, not only by unit test.

#### 13.4.1 Observations to capture on the first live call and fold back in as a v1.2 note

Three things this document deliberately does **not** assert, because they are undocumented by the
vendor. None is a blocker; each becomes useful once observed once. Record them, do not design around
them in advance:

| Observation | Why it is unknown | What to record |
|---|---|---|
| **The real override-rejection error text** (§0.B, AT-15) | ElevenLabs documents only prose (*"an error will be thrown"*); no message or status code appears in the docs, changelog, or the linked GitHub issue | The exact `onError` message string, for **diagnosis** (recognising it in a log). It never becomes a test assertion — §7 AT-15's note explains why |
| **WebRTC conversation-token expiry** (§0.B, §6.4) | The API reference states no TTL. The documented 15 minutes belongs to the *signed-URL / WebSocket* endpoint and must not be carried across | Whether a token still connects after a delay, and roughly how long. Contained today by minting fresh per connect (§6.4) — this only ever becomes load-bearing if someone later wants to pre-mint or reuse |
| **Whether `xi-api-key` is strictly required on the token endpoint** (§0.B) | It appears in every official code example but is never stated as required in prose | Nothing to change — we send it regardless. Recorded only so the inference is closed out |
