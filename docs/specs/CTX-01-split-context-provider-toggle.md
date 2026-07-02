# Split Context + Voice Provider Toggle — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-06-28

---

## 1. Purpose

Clio currently injects the full session context — session brief, topic knowledge base, and all tab
scripts — as one system prompt at session start. This works, but it creates two structural
constraints: the session cannot start until every tab's script is generated, and there is no
mechanism to adjust a later tab's coaching approach based on how earlier tabs went.

This feature introduces a two-mode context system controlled by environment variables. The two
modes are `all-upfront` (current behaviour, unchanged) and `split` (new: brief + KB at start,
each tab's script injected at tab-advance time). A second toggle future-proofs the architecture
for testing an alternative voice provider (Deepgram) without committing to a full migration.

Without this feature, every tab must finish generating before Arun can start a session. The
split mode removes that bottleneck: a session can begin as soon as Tab 1 is ready, with
remaining tabs generating in the background.

---

## 2. User Story

As an engineer running Clio in a development or staging environment,
I want to flip an environment variable to switch between full-upfront and split context injection,
so that I can test the split mode as a side-by-side POC without breaking the existing production
behaviour.

As a product owner (Arun),
I want a session to become startable as soon as Tab 1 content is ready,
so that I am not blocked waiting for all tabs to generate before I can begin coaching.

---

## 3. Trigger / Entry Point

### Toggle 1 — context mode

- Variable name: `CLIO_CONTEXT_MODE` (server-side) and `NEXT_PUBLIC_CLIO_CONTEXT_MODE` (client-side mirror)
- Set in `.env.local` (development) and Vercel environment variables (production/preview)
- Both variables must be set to the same value; a mismatch is an operational error
- Permitted values: `all-upfront` | `split`
- Default (variable absent or empty): `all-upfront`
- Read at two call sites:
  - `app/api/recall/bot/route.ts` — determines whether `session_script` is included in the system prompt passed to `buildAllClioDocs`
  - `app/dashboard/walkthrough/WalkthroughClient.tsx` — determines whether `injectContext` is called inside the `show_visual` client tool handler

### Toggle 2 — voice provider

- Variable name: `CLIO_VOICE_PROVIDER` (server-side only)
- Permitted values: `elevenlabs` | `deepgram`
- Default: `elevenlabs`
- Read in: `app/api/recall/bot/route.ts`
- Client-side: not exposed; the adapter factory (`lib/voice/index.ts`) is instantiated server-side and its output flows to the client only as the `Conversation` handle (ElevenLabs) or a WebSocket handle (Deepgram, future)
- `deepgram` value is reserved for future use; selecting it in this build renders a `DeepgramAdapter` stub that logs and no-ops

### Session start gate (split mode only)

- The gate check lives in `WalkthroughClient.tsx` or the plan approval flow — not in the Inngest pipeline
- In `all-upfront` mode: existing gate — all sub_sessions must have `content_status = 'ready'`
- In `split` mode: session can start when `training_scripts[0]` is non-null AND `sections[0]` exists in `walkthrough_state`
- The Inngest pipeline behaviour does not change in either mode; it still generates all tabs

---

## 4. Screen / Flow Description

This feature has no new screens. All changes are in server-side logic and a client-side code
branch inside `WalkthroughClient.tsx`. The user-visible session experience is identical in both
modes.

### Flow A — `all-upfront` mode (no change to existing behaviour)

1. User clicks "Start Session" on the plan approval page.
2. `POST /api/recall/bot` is called with `meetingUrl`, `sessionId`, `skippedTopics`.
3. Server reads `CLIO_CONTEXT_MODE`. Value is `all-upfront` (or absent).
4. `buildAllClioDocs` is called with all training scripts included. `system_prompt` contains `session_brief + topic_context + session_script`.
5. `walkthrough_state` is upserted with `clio_session_context = system_prompt` and `session_script = docs.session_script`.
6. ElevenLabs session starts via `Conversation.startSession`. Context is fetched server-side by `/api/clio/llm` on every turn.
7. `show_visual` fires when Clio calls it. No `injectContext` call is made. The script for each section was already in the system prompt.

### Flow B — `split` mode

#### At session start (`POST /api/recall/bot`)

1. User clicks "Start Session" on the plan approval page.
2. `POST /api/recall/bot` is called.
3. Server reads `CLIO_CONTEXT_MODE`. Value is `split`.
4. `buildAllClioDocs` is called with a `mode: 'split'` signal. `session_script` is omitted from `system_prompt`. System prompt = `session_brief + topic_context` only.
5. `walkthrough_state` is upserted. `clio_session_context` contains the split-mode prompt. `training_scripts` array is stored in full as before (pipeline has generated all available tabs).
6. ElevenLabs session starts. Clio has brief + KB but no script yet.
7. Immediately after `startSession` resolves successfully, `adapter.injectContext(tab1Script)` is called with Tab 1's formatted script block. Clio now has the script for the first section it will cover.

#### At each tab advance (`show_visual` client tool, split mode only)

1. Clio calls `show_visual({ section_index: N })`.
2. `WalkthroughClient` checks `NEXT_PUBLIC_CLIO_CONTEXT_MODE`. Value is `split`.
3. Script lookup: `trainingScriptsRef.current[N - 1]` (0-based index; section 1 = index 0; the overview at index 0 has no training script and is skipped).

   Note: Tab indices for injection map as follows:
   - `section_index: 0` = Overview — no training script, skip `injectContext`
   - `section_index: 1` = first content tab → `training_scripts[0]`
   - `section_index: N` (N ≥ 1) → `training_scripts[N - 1]`

4. If the script is non-null: format it using the same label/structure as `buildSessionScript` produces for a single section. Call `adapter.injectContext(formattedScript)`.
5. If the script is null (still generating): call `adapter.injectContext("[Context for this section is loading — coach from the TOPIC KNOWLEDGE BASE for now.]")`.
6. After `injectContext` completes (or is skipped for overview), the existing `show_visual` handler proceeds normally: fires `scroll_to`, returns the script content string to the LLM.

---

## 5. Visual Examples

There are no new user-facing screens. The session page appearance is identical in both modes.

The only observable runtime difference is a console log entry:

```
[split mode] Tab 1 script injected at session start (1 of 3)
[split mode] Tab 2 script injected at show_visual section_index=2
[split mode] Tab 3 script injected at show_visual section_index=3
[split mode] Fallback injected for section_index=4 — script not ready
```

---

## 6. Data Requirements

### Environment variables — additions to `.env.local.example`

```
# Clio context mode — controls when tab scripts are injected into the voice session.
# all-upfront (default): full session_brief + topic_context + session_script at start.
# split: session_brief + topic_context at start; each tab's script injected at tab-advance.
CLIO_CONTEXT_MODE=all-upfront
NEXT_PUBLIC_CLIO_CONTEXT_MODE=all-upfront

# Clio voice provider — controls which voice SDK handles the session.
# elevenlabs (default): ElevenLabs Conversational AI (@11labs/client).
# deepgram: Deepgram Voice Agent (stub only — out of scope for this build).
CLIO_VOICE_PROVIDER=elevenlabs
```

### New files (no database changes)

**`lib/voice/adapter.ts`**

Exports the `VoiceSessionAdapter` interface:

```typescript
export interface VoiceSessionAdapter {
  /** Inject additional context text mid-session.
   *  ElevenLabs: calls conversation.sendContextualUpdate(text)
   *  Deepgram: sends UpdateInstructions WebSocket message (stub in this build)
   */
  injectContext(text: string): void

  /** End the voice session cleanly. */
  endSession(): Promise<void>

  /** Set speaker output volume (0.0 – 1.0). */
  setVolume(volume: number): void

  /** Mute or unmute the user's microphone input. */
  setMicMuted(muted: boolean): void

  /** Returns the current input (microphone) volume level. */
  getInputVolume(): number

  /** Returns the current output (speaker) volume level. */
  getOutputVolume(): number

  /** Send a thumbs-up or thumbs-down feedback signal to the provider. */
  sendFeedback(like: boolean): void

  /** Returns the provider-assigned session/conversation ID. */
  getId(): string

  /** Returns true if the underlying connection is currently open. */
  isOpen(): boolean
}
```

**`lib/voice/elevenlabs-adapter.ts`**

Concrete implementation wrapping the existing `Conversation` object from `@11labs/client`.

- Constructor: `new ElevenLabsAdapter(conversation: Conversation)`
- `injectContext(text)` → `this.conversation.sendContextualUpdate(text)`
- `endSession()` → `this.conversation.endSession()`
- `setVolume(v)` → `this.conversation.setVolume({ volume: v })`
- `setMicMuted(m)` → `this.conversation.setMicMuted(m)`
- `getInputVolume()` → `this.conversation.getInputVolume()`
- `getOutputVolume()` → `this.conversation.getOutputVolume()`
- `sendFeedback(like)` → `this.conversation.sendFeedback(like)`
- `getId()` → `this.conversation.getId()`
- `isOpen()` → `this.conversation.isOpen()`

**`lib/voice/deepgram-adapter.ts`**

Stub implementation. Every method logs `[DeepgramAdapter STUB]` and does nothing. The file is
clearly marked with a top-of-file comment: `// POC STUB — Deepgram Voice Agent not implemented.
Out of scope for CTX-01 build.`

**`lib/voice/index.ts`**

Exports the interface and both implementations. Exports a factory:

```typescript
export function createVoiceAdapter(
  provider: 'elevenlabs' | 'deepgram',
  conversation: Conversation | null
): VoiceSessionAdapter
```

When `provider === 'elevenlabs'` and `conversation` is non-null: returns `new ElevenLabsAdapter(conversation)`.
When `provider === 'deepgram'`: returns `new DeepgramAdapter()` regardless of `conversation`.
When `provider === 'elevenlabs'` and `conversation` is null: throws `Error('ElevenLabsAdapter requires a Conversation instance')`.

### Files to modify

**`lib/clio-context-builder.ts`**

Add a `mode` parameter to `buildAllClioDocs`:

```typescript
export function buildAllClioDocs(
  input: BuildDocsInput,
  mode: 'all-upfront' | 'split' = 'all-upfront'
): ClioSessionDocs
```

When `mode === 'split'`:
- `session_script` is still computed by calling `buildSessionScript` (so the field is populated in `ClioSessionDocs` and stored in `walkthrough_state.session_script` for reference)
- `session_script` is excluded from the `parts` array that is joined into `system_prompt`
- `system_prompt` = `session_brief + "\n\n---\n\n" + topic_context` (+ learnerProfile if present)

When `mode === 'all-upfront'` (default): behaviour unchanged.

The `ClioSessionDocs` return type does not change. `session_script` is always populated.

**`app/api/recall/bot/route.ts`**

At the call site for `buildAllClioDocs`:

```typescript
const contextMode = (process.env.CLIO_CONTEXT_MODE ?? 'all-upfront') as 'all-upfront' | 'split'
docs = buildAllClioDocs({ ... }, contextMode)
```

No other changes to this file.

**`app/dashboard/walkthrough/WalkthroughClient.tsx`**

Replace `conversationRef: useRef<Conversation | null>` with `adapterRef: useRef<VoiceSessionAdapter | null>`.

After `Conversation.startSession` resolves and the `conv` object is available:
- Call `createVoiceAdapter('elevenlabs', conv)` to wrap it
- Store in `adapterRef.current`

Replace all existing direct calls on `conv` / `conversationRef.current` with calls on `adapterRef.current`:
- `conv.endSession()` → `adapterRef.current?.endSession()`
- `conv.sendContextualUpdate(...)` → `adapterRef.current?.injectContext(...)`
- `conv.sendUserMessage(...)` — this is an ElevenLabs-specific method not on the adapter interface; keep a separate `elevenLabsConvRef` for `sendUserMessage` calls since this is specific to the transcript-forwarding mechanism and out of scope for Deepgram in this build

Add the split-mode injection logic inside the `show_visual` client tool handler, after the
`section_index` is resolved and before the `scroll_to` fetch:

```typescript
const contextMode = process.env.NEXT_PUBLIC_CLIO_CONTEXT_MODE ?? 'all-upfront'
if (contextMode === 'split' && idx > 0) {
  // idx 0 = Overview — no training script
  const scriptIndex = idx - 1  // section_index 1 → training_scripts[0]
  const scripts = trainingScriptsRef.current
  const script = scripts[scriptIndex] ?? null
  const formattedScript = script
    ? formatSingleSectionScript(sections[idx], script, idx, sections.length)
    : '[Context for this section is loading — coach from the TOPIC KNOWLEDGE BASE for now.]'
  adapterRef.current?.injectContext(formattedScript)
}
```

`formatSingleSectionScript` is a new helper extracted from the logic in `buildSessionScript`
in `lib/clio-context-builder.ts`. It takes a single section and its script and returns the
same string format that `buildSessionScript` would produce for that section in isolation, so
the LLM context is consistent whether it received the script upfront or via injection.

Add the Tab 1 injection call immediately after session connect in `all-upfront` mode this block is already present as the reconnect notice. Add a split-mode branch:

```typescript
if (isReconnect) {
  adapterRef.current?.injectContext(
    'The WebSocket connection briefly dropped and reconnected. Do not re-introduce yourself — continue the session naturally from where you left off.'
  )
} else if (contextMode === 'split') {
  // Inject Tab 1 script immediately so Clio has it for the opening section
  const tab1Script = trainingScriptsRef.current[0] ?? null
  const sections = sectionsRef.current
  const tab1Section = sections[1] ?? null  // index 0 is overview
  if (tab1Script && tab1Section) {
    const formatted = formatSingleSectionScript(tab1Section, tab1Script, 1, sections.length - 1)
    adapterRef.current?.injectContext(formatted)
    console.log('[split mode] Tab 1 script injected at session start')
  }
}
```

### Data that does not change

- `walkthrough_state` table schema: no changes
- `topic_content_cache` table schema: no changes
- `training_scripts` column: populated as before, regardless of mode
- `session_script` column in `walkthrough_state`: still written in both modes (it is the source for injection in split mode)
- Inngest pipeline: no changes; generates all tabs regardless of mode

---

## 7. Success Criteria (Acceptance Tests)

### All-upfront mode (regression — must still pass)

1. Given `CLIO_CONTEXT_MODE` is unset, when `POST /api/recall/bot` is called, then `walkthrough_state.clio_session_context` contains the string `=== SESSION SCRIPT ===`.

2. Given `CLIO_CONTEXT_MODE=all-upfront`, when `Conversation.startSession` resolves in `WalkthroughClient`, then `adapterRef.current?.injectContext` is NOT called at session start (no split-mode injection).

3. Given `CLIO_CONTEXT_MODE=all-upfront`, when Clio calls `show_visual({ section_index: 2 })`, then `adapterRef.current?.injectContext` is NOT called inside the `show_visual` handler.

4. Given `CLIO_CONTEXT_MODE=all-upfront`, when `buildAllClioDocs` is called, then the returned `system_prompt` contains all three document sections (SESSION BRIEF, TOPIC KNOWLEDGE BASE, SESSION SCRIPT).

5. Given `CLIO_VOICE_PROVIDER=elevenlabs` and a live `Conversation` object, when `createVoiceAdapter('elevenlabs', conv)` is called, then `adapter.injectContext('test')` calls `conv.sendContextualUpdate('test')` exactly once.

### Split mode

6. Given `CLIO_CONTEXT_MODE=split`, when `POST /api/recall/bot` is called, then `walkthrough_state.clio_session_context` does NOT contain the string `=== SESSION SCRIPT ===`.

7. Given `CLIO_CONTEXT_MODE=split`, when `buildAllClioDocs` is called with `mode='split'`, then the returned `system_prompt` contains `=== SESSION BRIEF ===` and `=== TOPIC KNOWLEDGE BASE ===` but not `=== SESSION SCRIPT ===`.

8. Given `CLIO_CONTEXT_MODE=split` and `NEXT_PUBLIC_CLIO_CONTEXT_MODE=split`, when the ElevenLabs session connects for the first time (not a reconnect), then `adapterRef.current?.injectContext` is called once with a string containing `SECTION 1` content before `show_visual` is called.

9. Given `NEXT_PUBLIC_CLIO_CONTEXT_MODE=split` and `training_scripts[1]` is non-null, when Clio calls `show_visual({ section_index: 2 })`, then `adapterRef.current?.injectContext` is called with a string containing `SECTION 2` before the `scroll_to` fetch fires.

10. Given `NEXT_PUBLIC_CLIO_CONTEXT_MODE=split` and Clio calls `show_visual({ section_index: 0 })` (Overview), then `adapterRef.current?.injectContext` is NOT called (overview has no training script).

11. Given `NEXT_PUBLIC_CLIO_CONTEXT_MODE=split` and `training_scripts[2]` is null (still generating), when Clio calls `show_visual({ section_index: 3 })`, then `adapterRef.current?.injectContext` is called with the exact string `"[Context for this section is loading — coach from the TOPIC KNOWLEDGE BASE for now.]"`.

12. Given `CLIO_VOICE_PROVIDER=deepgram`, when `createVoiceAdapter('deepgram', null)` is called, then the returned adapter's `injectContext` method logs `[DeepgramAdapter STUB]` and does not throw.

### Env var consistency

13. Given `CLIO_CONTEXT_MODE=split` and `NEXT_PUBLIC_CLIO_CONTEXT_MODE=all-upfront` (mismatch), the server will omit `session_script` from the system prompt but the client will not call `injectContext` on tab advance — this is a misconfiguration; the developer is responsible for keeping both in sync. No runtime error is thrown; the mismatch is detectable via the console log `[split mode] Tab 1 script injected...` being absent.

---

## 8. Error States

### Env var absent or invalid

- `CLIO_CONTEXT_MODE` absent or set to an unrecognised value → treat as `all-upfront`; log `[recall/bot] CLIO_CONTEXT_MODE unrecognised ("X") — defaulting to all-upfront`
- `NEXT_PUBLIC_CLIO_CONTEXT_MODE` absent → treat as `all-upfront`; no log required (client-side)
- `CLIO_VOICE_PROVIDER` absent or invalid → treat as `elevenlabs`; log `[recall/bot] CLIO_VOICE_PROVIDER unrecognised — defaulting to elevenlabs`

### Script not ready (split mode)

- `training_scripts[N-1]` is null when `show_visual` fires for section N → inject fallback string: `"[Context for this section is loading — coach from the TOPIC KNOWLEDGE BASE for now.]"`
- Clio's LLM receives this and falls back to coaching from the topic KB, which is already in the system prompt
- No error surface to the user; session continues

### Tab 1 script not ready at session start (split mode)

- `trainingScriptsRef.current[0]` is null when the ElevenLabs session connects → do not call `injectContext` at all; log `[split mode] Tab 1 script not ready at session start — skipping initial injection`
- Clio coaches from KB until `show_visual({ section_index: 1 })` fires and triggers a subsequent injection attempt

### `injectContext` throws (e.g. WebSocket closed)

- Wrap `adapterRef.current?.injectContext(...)` in a try/catch in `WalkthroughClient`
- On error: log `[split mode] injectContext failed: <error message>`; do not rethrow
- Session continues; Clio coaches from KB

### `createVoiceAdapter` called with `'elevenlabs'` and null conversation

- Throws `Error('ElevenLabsAdapter requires a Conversation instance')`
- This surfaces as a failed session start; the existing reconnect logic handles it via the `onError` / retry path

### Deepgram selected (stub)

- Every method on `DeepgramAdapter` returns `undefined` (void) or `0` (number) and logs `[DeepgramAdapter STUB] <method> called`
- No real voice session is established; this is expected behaviour in this build

---

## 9. Edge Cases

### Reconnect mid-session (split mode)

When the ElevenLabs WebSocket drops and reconnects (`isReconnect === true`), the reconnect path sends the existing reconnect notice via `injectContext`. It does NOT re-inject Tab 1's script, because the ElevenLabs session context is managed server-side by `/api/clio/llm` on every turn — the custom LLM fetches fresh context from `walkthrough_state` on each request. The scripts that were injected via `sendContextualUpdate` before the drop are part of the ElevenLabs conversation history and persist across reconnects.

If the session has advanced past Tab 1 when the drop occurs, the tab-advance injection for that tab already happened and is in the conversation history. No re-injection is needed on reconnect.

### Session launched before split mode was enabled

If `walkthrough_state` was written with a full `clio_session_context` (all-upfront) but the client loads with `NEXT_PUBLIC_CLIO_CONTEXT_MODE=split`, the client will attempt to inject Tab 1's script at session start and will inject scripts on tab advance — resulting in duplicate script delivery. This is a deployment configuration error. The rule is: both env vars must match, and a running session must be terminated before switching modes.

### Very short session (single tab)

- `sections` has 2 entries: [Overview, Tab 1]
- `training_scripts` has 1 entry: `[tab1Script]`
- At session start, Tab 1 script is injected
- Clio calls `show_visual({ section_index: 1 })` — script is injected again (same content, idempotent; ElevenLabs treats duplicate context updates as additional context, not replacements)
- Acceptable; no special handling needed

### Session with 0 training scripts (content not yet generated)

- `trainingScriptsRef.current` is empty or all-null
- At session start in split mode: no injection; log and continue
- On every `show_visual` call: fallback string is injected
- Clio coaches entirely from KB; session is functional but less scripted

### Large system prompt in split mode

- Split mode system prompt = brief + topic KB only, omitting session_script
- This is guaranteed to be smaller than the all-upfront prompt
- The `MAX_PROMPT_CHARS = 12_000` cap in `WalkthroughClient` was applied to the full prompt; in split mode the prompt is smaller, so truncation of `topic_context` may be relaxed
- No change to the cap logic is required in this build; it remains as a safety guard

### Provider env var set to `deepgram` in production

- `DeepgramAdapter` is returned; all methods are no-ops
- No voice session is established; the walkthrough page loads but Clio is silent
- This is a configuration error; no user-facing error message is shown beyond the existing `agentStatus: 'disconnected'` indicator
- Out of scope to add a guard for this in this build

---

## 10. Out of Scope

The following are explicitly NOT part of this build:

1. **Deepgram Voice Agent implementation.** `DeepgramAdapter` is a stub with console.log bodies only. No real Deepgram WebSocket session is opened.

2. **Dynamic session start gate in the Inngest pipeline or plan approval API.** The pipeline continues to generate all tabs before marking content ready. The session-start gate change (allow start when Tab 1 is ready) is a client-side flag check in the plan approval UI — it is documented as an intended outcome of this feature but is NOT implemented in this build. The spec records the intended behaviour for a follow-on task.

3. **Re-injection on reconnect.** The system relies on the custom LLM at `/api/clio/llm` fetching fresh context from `walkthrough_state` on every turn. Replaying injected scripts on reconnect is not required.

4. **`sendUserMessage` on the adapter interface.** This method is specific to ElevenLabs' transcript-forwarding mechanism (used to relay participant speech from Recall.ai transcripts). It is not generalisable to Deepgram in the same pattern. `WalkthroughClient` keeps a separate `elevenLabsConvRef` for this call. Adding `sendUserMessage` to the `VoiceSessionAdapter` interface is deferred until Deepgram is implemented.

5. **UI toggle for context mode.** There is no admin UI for switching modes. Changes require an environment variable update and redeployment.

6. **Persistent injection history.** Injected scripts are not stored or tracked in `walkthrough_state`. If needed for debugging, they are visible in the ElevenLabs conversation transcript.

7. **Any changes to non-session pages** — topics, dashboard, knowledge base, plan page, onboarding. Zero impact.

8. **Any database migrations.** No new tables, columns, or schema changes.

---

## 11. Open Questions

None. All decisions were provided in the feature brief and are authoritative.

---

## 12. Dependencies

### Must exist before build starts

- `@11labs/client` is already installed and in use in `WalkthroughClient.tsx`
- `lib/clio-context-builder.ts` exists with `buildAllClioDocs`, `buildSessionScript`, `buildSessionBrief`, `buildTopicContext`
- `app/api/recall/bot/route.ts` exists and calls `buildAllClioDocs`
- `app/dashboard/walkthrough/WalkthroughClient.tsx` exists and holds `conversationRef` as a raw `Conversation` object
- `walkthrough_state` table has `training_scripts`, `session_brief`, `topic_context`, `session_script`, `clio_session_context` columns (confirmed present in existing code)

### Build order

1. Create `lib/voice/adapter.ts` (interface only — no SDK dependency)
2. Create `lib/voice/elevenlabs-adapter.ts` (wraps `Conversation`)
3. Create `lib/voice/deepgram-adapter.ts` (stub)
4. Create `lib/voice/index.ts` (factory + re-exports)
5. Modify `lib/clio-context-builder.ts` — add `mode` parameter to `buildAllClioDocs`
6. Modify `app/api/recall/bot/route.ts` — read `CLIO_CONTEXT_MODE`, pass to `buildAllClioDocs`
7. Modify `app/dashboard/walkthrough/WalkthroughClient.tsx` — replace `conversationRef` with `adapterRef`, add split-mode injection logic
8. Update `.env.local.example` — add four new entries with defaults

Steps 1–4 have no dependencies on each other and can be written in parallel.
Step 5 depends on nothing. Steps 6 and 7 depend on steps 1–5.
Step 8 can be done at any point.
