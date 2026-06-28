# AUD-01: Server-Side Audio Relay

**Status:** Ready for build  
**Toggle:** `MEETING_BOT_AUDIO_MODE=browser|relay`  
**Risk:** Zero — browser mode is unchanged; relay mode is opt-in

---

## 1. Problem

In the current browser mode, Attendee's headless Chromium browser calls `getUserMedia({ audio: true })` but receives silence. Participant speech reaches ElevenLabs via a 13-hop path:

```
Participant speaks
  → Attendee captures audio
  → Attendee transcribes (Whisper/Nova)
  → Attendee fires transcript.update webhook
  → POST /api/attendee/webhook
  → Write pending_transcript to walkthrough_state (DB)
  → WalkthroughClient polls /api/walkthrough-state/:userId every 1s
  → Read pending_transcript
  → POST PATCH /api/walkthrough-state/:userId (clear pending_transcript)
  → WalkthroughClient calls conv.sendUserMessage(text)
  → ElevenLabs receives text
  → ElevenLabs calls /api/clio/llm
  → LLM generates response
  → ElevenLabs converts response to audio
  → ElevenLabs plays audio in headless browser
  → Attendee captures audio from browser speaker
  → Participant hears Clio
```

Total latency: ~800–1500ms for participant speech to reach ElevenLabs. Speech is transcribed text, not raw audio — ElevenLabs cannot detect prosody, pauses, or tone.

---

## 2. Solution

Relay mode streams raw PCM16 audio bidirectionally between Attendee and ElevenLabs via a server-side WebSocket relay. Attendee's own STT is replaced by ElevenLabs' STT, and TTS audio goes back to Attendee directly.

```
New path (relay mode):
  Participant speaks
    → Attendee streams PCM16 audio to our relay WS
    → Relay forwards user_audio_chunk to ElevenLabs WS
    → ElevenLabs STT + LLM (/api/clio/llm) + TTS
    → ElevenLabs streams audio frames back to relay
    → Relay sends realtime_audio.bot_output to Attendee
    → Attendee plays audio into the meeting
    → Participant hears Clio
```

Total latency: ~150–300ms (3 hops, no DB writes, no polling).

---

## 3. Toggle

| Variable | Values | Description |
|---|---|---|
| `MEETING_BOT_AUDIO_MODE` | `browser` (default) · `relay` | Server-side: whether Attendee uses the relay or headless browser |
| `NEXT_PUBLIC_MEETING_BOT_AUDIO_MODE` | `browser` (default) · `relay` | Client-side mirror — must match |

**Both must be set to the same value.** A mismatch means the relay runs but WalkthroughClient also tries to start ElevenLabs — causing two simultaneous sessions.

---

## 4. New Environment Variables

| Variable | Description |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs API key (server-only) — used to fetch signed WS URL for relay sessions |
| `AUDIO_RELAY_WS_URL` | Full WebSocket URL of the relay endpoint, e.g. `wss://your-server.railway.app/api/audio-relay` |

---

## 5. Architecture

### 5.1 Relay Endpoint

The relay WebSocket server runs at `/api/audio-relay` on a custom Next.js server (`server.ts`). This is required because Vercel serverless functions cannot accept inbound WebSocket connections (Vercel functions are invoked, not connected to).

**Relay mode requires a persistent server environment** — Railway, Render, fly.io, or a VPS. Browser mode remains fully Vercel-compatible.

### 5.2 Per-Connection Flow

```
Attendee connects to wss://relay/api/audio-relay?userId=xxx&sessionId=yyy
  → Relay reads userId, sessionId from query params
  → Relay fetches user first name from Supabase
  → Relay gets ElevenLabs signed WS URL via REST API
  → Relay connects to ElevenLabs WS
  → Relay sends conversation_initiation_client_data with:
      - prompt: "You are Clio, an AI business coach. DISTILL_USER_ID: {userId}"
      - first_message: "Welcome, {firstName}! ..."
      - voice_id: NEXT_PUBLIC_ELEVENLABS_VOICE_ID
      - dynamic_variables: { user_id: userId }
  
  [Audio bridge — runs for duration of session]
  Attendee → relay: { trigger: "realtime_audio.mixed", data: { chunk: "<base64 PCM16>" } }
  Relay → ElevenLabs: { user_audio_chunk: "<base64 PCM16>" }
  ElevenLabs → relay: { type: "audio", audio_event: { audio_base_64: "...", event_id: N } }
  Relay → Attendee: { trigger: "realtime_audio.bot_output", data: { chunk: "...", sample_rate: 16000 } }
  
  [Tool call handling — server-side]
  ElevenLabs → relay: { type: "client_tool_call", client_tool_call: { tool_name: "show_visual", ... } }
  Relay → Supabase: UPDATE walkthrough_state SET current_section_index = N WHERE user_id = userId
  Relay → ElevenLabs: { type: "client_tool_result", result: "<script content for section N>" }
  
  [Session end]
  ElevenLabs → relay: { type: "client_tool_call", tool_name: "end_session" }
  Relay → Supabase: UPDATE sessions SET status = 'complete' WHERE id = sessionId
  Relay → ElevenLabs: client_tool_result → close WS
  Relay → Attendee: close WS
```

### 5.3 ElevenLabs WebSocket Protocol

| Direction | Message | Purpose |
|---|---|---|
| Relay → ElevenLabs | `{ user_audio_chunk: "<base64>" }` | Stream participant audio |
| ElevenLabs → Relay | `{ type: "audio", audio_event: { audio_base_64: "..." } }` | TTS audio frames |
| ElevenLabs → Relay | `{ type: "client_tool_call", ... }` | Tool calls (show_visual, end_session) |
| Relay → ElevenLabs | `{ type: "client_tool_result", ... }` | Tool responses |
| ElevenLabs → Relay | `{ type: "ping", ping_event: { event_id: N } }` | Keepalive |
| Relay → ElevenLabs | `{ type: "pong", event_id: N }` | Keepalive response |

### 5.4 Audio Format

Both Attendee and ElevenLabs use **PCM16 16kHz mono**. No transcoding is required. The relay passes base64 chunks through without decoding.

### 5.5 Visual Rendering

In relay mode:
- The meeting bot does NOT load a headless browser page (no `voice_agent_settings`)
- The user views visuals in their own browser at `/walkthrough/{userId}`
- WalkthroughClient polls `walkthrough_state` (unchanged), sees `current_section_index` updates written by the relay
- Visual animations, tab navigation, section scrolling all work identically to browser mode

---

## 6. Files Changed

| File | Change | Mode affected |
|---|---|---|
| `server.ts` (new) | Custom Next.js server with WebSocket upgrade handling | relay only |
| `lib/voice/relay-handler.ts` (new) | AudioRelayHandler: Attendee ↔ ElevenLabs bridge | relay only |
| `lib/meeting-bot/types.ts` | `createBot` gains optional 4th param `sessionId?: string` | both |
| `lib/meeting-bot/attendee.ts` | relay mode: use `websocket_settings.audio` instead of `voice_agent_settings` | relay only |
| `lib/meeting-bot/recall.ts` | Accept and ignore new `sessionId` param | no change |
| `lib/meeting-bot/agentcall.ts` | Accept and ignore new `sessionId` param | no change |
| `app/api/recall/bot/route.ts` | Pass `sessionId` as 4th arg to `createBot` | no change |
| `app/dashboard/walkthrough/WalkthroughClient.tsx` | relay mode: skip ElevenLabs session startup, keep visual polling | relay only |
| `package.json` | Add `ws`, `@types/ws`; add `start:relay` script | relay only |
| `.env.local.example` | Document 4 new env vars | both |

---

## 7. Attendee Bot Creation

### Browser mode (current, unchanged)
```json
{
  "voice_agent_settings": { "url": "<walkthroughUrl>" },
  "webhooks": [{ "triggers": ["bot.state_change", "transcript.update", "participant_events.join_leave"] }]
}
```

### Relay mode (new)
```json
{
  "websocket_settings": { "audio": { "url": "wss://relay/api/audio-relay?userId=xxx&sessionId=yyy", "sample_rate": 16000 } },
  "webhooks": [{ "triggers": ["bot.state_change", "participant_events.join_leave"] }]
}
```

Note: `transcript.update` webhook is omitted in relay mode — ElevenLabs handles STT directly from the audio stream.

---

## 8. WalkthroughClient Change

Minimal: one guard at the top of the `useEffect` that starts the ElevenLabs session.

```typescript
// relay mode: ElevenLabs runs server-side — skip browser session startup
const audioMode = process.env.NEXT_PUBLIC_MEETING_BOT_AUDIO_MODE ?? 'browser'
if (audioMode === 'relay') return
```

All visual rendering, section polling, and tab navigation remain completely unchanged.

---

## 9. Deployment Notes

### Running with relay mode (non-Vercel server)
```bash
MEETING_BOT_AUDIO_MODE=relay \
NEXT_PUBLIC_MEETING_BOT_AUDIO_MODE=relay \
ELEVENLABS_API_KEY=sk_... \
AUDIO_RELAY_WS_URL=wss://your-server.com/api/audio-relay \
node server.js
```

### Browser mode (Vercel, unchanged)
```bash
# No changes needed — deploy normally to Vercel
# MEETING_BOT_AUDIO_MODE is unset or "browser"
```

### Custom server start script
```bash
npm run start:relay   # builds then starts custom server
npm run dev:relay     # dev mode with custom server
```

---

## 10. What Does NOT Change

- Topic generation pipeline
- Plan creation and approval
- Session creation and scheduling
- Content generation (visuals + scripts)
- Knowledge base
- The LLM endpoint (`/api/clio/llm`) — ElevenLabs still calls it on every turn
- CTX-01 split/all-upfront context mode
- Recall.ai provider (relay mode is Attendee-only)
- AgentCall provider
- Auth, billing, onboarding
- All other API routes

---

## 11. Known Limitation

Relay mode requires a persistent WebSocket server. Vercel cannot host this. Options:
- Railway (recommended — simple deploy, WebSocket support)
- Render
- fly.io
- Any VPS with Node.js

The browser mode remains the Vercel-compatible default. Set `MEETING_BOT_AUDIO_MODE=relay` only when deploying to a persistent server environment.
