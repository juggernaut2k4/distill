# Clio

Personalized AI coaching for executives. A voice AI (powered by ElevenLabs) joins your Google Meet, teaches a structured session on a topic from your learning plan, and adapts to your role, industry, and experience level.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS + Framer Motion |
| Auth | Clerk |
| Database | Supabase (PostgreSQL) |
| Email | Resend |
| SMS | Twilio |
| Payments | Stripe |
| AI | Anthropic Claude (`claude-sonnet-4-6`) |
| Voice AI | ElevenLabs Conversational AI (`@11labs/client`) |
| Meeting Bot | Attendee.dev (default) or Recall.ai (legacy) |
| Scheduling | Inngest |

---

## Local Setup

### Prerequisites

- Node.js 18+
- npm 9+

### 1. Clone and install

```bash
git clone <repo-url>
cd distill
npm install --legacy-peer-deps
```

### 2. Environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and replace all `PLACEHOLDER_*` values with real credentials. See the full variable reference below.

### 3. Set up the database

Run the latest migration in your Supabase SQL editor (all files in `supabase/migrations/` in order).

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Run Inngest (for background jobs)

```bash
npx inngest-cli@latest dev
```

---

## Environment Variables

### Core services

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `RESEND_API_KEY` | Resend API key |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `INNGEST_EVENT_KEY` | Inngest event key |
| `INNGEST_SIGNING_KEY` | Inngest signing key |

### Voice AI (ElevenLabs)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | ElevenLabs conversational agent ID |
| `NEXT_PUBLIC_ELEVENLABS_VOICE_ID` | ElevenLabs voice ID (Siren by default) |
| `ELEVENLABS_API_KEY` | ElevenLabs API key — server-only, required for relay mode (AUD-01) |

### Meeting bot provider

| Variable | Values | Description |
|---|---|---|
| `MEETING_BOT_PROVIDER` | `attendee` (default) · `recall` · `agentcall` | Which bot service joins the Google Meet |
| `ATTENDEE_API_KEY` | — | Attendee.dev API key (when `MEETING_BOT_PROVIDER=attendee`) |
| `RECALL_API_KEY` | — | Recall.ai API key (when `MEETING_BOT_PROVIDER=recall`) |
| `ATTENDEE_WEBHOOK_SECRET` | — | Attendee.dev webhook signing secret (HMAC-SHA256) |

### Audio relay mode (AUD-01)

Controls how Attendee routes audio to ElevenLabs. Browser mode is the default (Vercel-compatible). Relay mode streams raw PCM16 audio server-side, cutting latency from ~800ms to ~150ms.

| Variable | Values | Description |
|---|---|---|
| `MEETING_BOT_AUDIO_MODE` | `browser` (default) · `relay` | Server-side: whether Attendee uses the relay or the headless browser |
| `NEXT_PUBLIC_MEETING_BOT_AUDIO_MODE` | `browser` (default) · `relay` | Client-side mirror — must match `MEETING_BOT_AUDIO_MODE` |
| `AUDIO_RELAY_WS_URL` | — | Full WebSocket URL of the relay endpoint, e.g. `wss://your-server.railway.app/api/audio-relay` |

**Both mode variables must match.** A mismatch causes the relay to run server-side while WalkthroughClient also tries to start ElevenLabs in the browser — two simultaneous sessions.

**Relay mode requires a persistent server** (Railway, Render, fly.io). Browser mode works on Vercel with no changes.

### Context injection mode (CTX-01)

Controls when per-tab scripts are injected into the ElevenLabs voice session.

| Variable | Values | Description |
|---|---|---|
| `CLIO_CONTEXT_MODE` | `all-upfront` (default) · `split` | Server-side: whether session_script is included in the system prompt at session start |
| `NEXT_PUBLIC_CLIO_CONTEXT_MODE` | `all-upfront` (default) · `split` | Client-side mirror — must match `CLIO_CONTEXT_MODE` |

**Both variables must be set to the same value.** A mismatch means the server omits the script but the client never injects it — Clio will coach from the knowledge base only.

| Mode | Behaviour |
|---|---|
| `all-upfront` | Full session brief + topic KB + all tab scripts sent as system prompt at session start. Zero behaviour change from pre-CTX-01. |
| `split` | Session brief + topic KB sent at start. Each tab's script injected via `sendContextualUpdate` at tab-advance time inside `show_visual`. Tab 1 injected immediately after session connects. |

### Voice provider (future)

| Variable | Values | Description |
|---|---|---|
| `CLIO_VOICE_PROVIDER` | `elevenlabs` (default) · `deepgram` | Which voice SDK handles the session. `deepgram` is a POC stub only — no real session is established. |

---

## Switching Meeting Bot Provider

The meeting bot system uses a pluggable provider pattern. All providers share the same `MeetingBotProvider` interface (`lib/meeting-bot/types.ts`).

### Switch to Attendee.dev (recommended)

```bash
MEETING_BOT_PROVIDER=attendee
ATTENDEE_API_KEY=<your-attendee-api-key>
ATTENDEE_WEBHOOK_SECRET=<your-webhook-signing-secret>
```

Attendee.dev joins the meeting, loads the walkthrough page in headless Chromium, and routes meeting audio through ElevenLabs via the page's microphone/speaker. Webhooks are verified with HMAC-SHA256.

**Webhook endpoint:** `POST /api/attendee/webhook`

Attendee fires:
- `bot.state_change` — bot joining/leaving (used to update session status)
- `transcript.update` — participant speech (forwarded to ElevenLabs via `sendUserMessage`)
- `participant_events.join_leave` — join/leave events (used to greet participants by name)

### Switch to Recall.ai (legacy)

```bash
MEETING_BOT_PROVIDER=recall
RECALL_API_KEY=<your-recall-api-key>
```

**Webhook endpoint:** `POST /api/webhooks/recall` (legacy, maintained for backwards compat)

### Mock mode (no API key)

If `ATTENDEE_API_KEY` starts with `PLACEHOLDER` or is empty, the provider logs what it would send and returns a mock bot ID. The rest of the session flow continues normally.

---

## Context Injection Architecture (CTX-01)

Clio's voice session uses a custom LLM endpoint (`/api/clio/llm`) that fetches context from the database on every turn. The `CLIO_CONTEXT_MODE` toggle controls whether tab scripts are also included in the initial system prompt or injected on-demand.

### All-upfront mode (default)

```
POST /api/recall/bot
  └── buildAllClioDocs() → session_brief + topic_KB + all_tab_scripts
        → stored in walkthrough_state.clio_session_context
  └── ElevenLabs session starts
        → /api/clio/llm fetches full context on every turn
        → show_visual fires → scroll_to → returns script content to LLM
```

### Split mode

```
POST /api/recall/bot
  └── buildAllClioDocs(mode='split') → session_brief + topic_KB only
        → stored in walkthrough_state.clio_session_context
  └── ElevenLabs session starts
        → Tab 1 script injected immediately via sendContextualUpdate
  └── show_visual({ section_index: N }) fires
        → training_scripts[N-1] injected via sendContextualUpdate before scroll_to
        → if script not ready: fallback string injected, Clio coaches from KB
```

**Index mapping in split mode:**
- `section_index: 0` = Session Overview — no training script, injection skipped
- `section_index: 1` = first content tab → `training_scripts[0]`
- `section_index: N` (N ≥ 1) → `training_scripts[N-1]`

### Audio relay architecture (AUD-01)

Server-side relay mode streams raw PCM16 audio between Attendee and ElevenLabs, cutting latency from ~800ms to ~150ms by eliminating the transcript webhook chain.

```
Browser mode (default):
  Participant speaks → Attendee Whisper STT → transcript.update webhook
    → DB write → WalkthroughClient poll → sendUserMessage → ElevenLabs
    (~800ms, 13 hops)

Relay mode (MEETING_BOT_AUDIO_MODE=relay):
  Participant speaks → Attendee PCM16 → relay WS → ElevenLabs STT+LLM+TTS
    → relay WS → Attendee speaker
    (~150ms, 3 hops)
```

```
server.ts                   Custom Next.js server — WebSocket upgrade at /api/audio-relay
lib/voice/relay-handler.ts  AudioRelayHandler — Attendee ↔ ElevenLabs audio bridge
                            Handles show_visual (DB write) and end_session server-side
lib/meeting-bot/attendee.ts Browser mode: voice_agent_settings (headless browser)
                            Relay mode:   websocket_settings.audio (no headless browser)
```

### Voice provider abstraction (lib/voice/)

All direct calls on the ElevenLabs `Conversation` object are wrapped behind a `VoiceSessionAdapter` interface. This makes it straightforward to test an alternative provider (e.g. Deepgram) by swapping the adapter without touching `WalkthroughClient`.

```
lib/voice/
  adapter.ts            VoiceSessionAdapter interface
  elevenlabs-adapter.ts Wraps @11labs/client Conversation
  deepgram-adapter.ts   POC stub (logs + no-ops)
  relay-handler.ts      Server-side Attendee ↔ ElevenLabs bridge (AUD-01)
  index.ts              createVoiceAdapter(provider, conversation) factory
```

`sendUserMessage` (transcript forwarding, ElevenLabs-specific) is kept on a separate `elevenLabsConvRef` — it is not part of the adapter interface because it has no Deepgram equivalent in this build. In relay mode, ElevenLabs handles STT directly from the audio stream, so `sendUserMessage` is not called at all.

---

## Project Structure

```
app/
  api/
    recall/bot/         POST: create bot, build context docs, write to walkthrough_state
    attendee/webhook/   POST: Attendee.dev webhook (state, transcript, participants)
    clio/llm/           POST: custom LLM endpoint — fetches context + handles tool calls
    walkthrough-state/  GET/POST/PATCH: session state polling
    inngest/            Inngest function registry
  dashboard/
    walkthrough/        WalkthroughClient — ElevenLabs session, split-mode injection
    plan/               Learning plan approval + session start
    knowledge-base/     Per-session KB viewer
  walkthrough/[userId]/ Public walkthrough page (loaded by the meeting bot)

lib/
  voice/                VoiceSessionAdapter + ElevenLabs/Deepgram adapters (CTX-01)
  meeting-bot/          Provider abstraction (Recall, Attendee, AgentCall)
  clio-context-builder.ts  Builds session_brief, topic_context, session_script
  content/              AI content generation pipeline
  learning/             User learning profile + profile context builder
  session-plan.ts       Session plan helpers
  supabase.ts           Server + browser Supabase clients

inngest/
  session-content-pipeline.ts  Generates tab content (visuals + scripts) per session
  session-designer-auto.ts     Auto-fires content generation after plan approval
  daily-delivery.ts            Daily email/SMS delivery cron
  feedback-processor.ts        Processes feedback, updates AI Readiness Score

docs/specs/             BA requirement documents for all shipped features
```

---

## Running Tests

```bash
# Unit + integration (Vitest)
npm test

# E2E (Playwright — app must be running on port 3000)
npm run dev         # terminal 1
npm run test:e2e    # terminal 2
```

---

## Deployment

The project deploys to [Vercel](https://vercel.com). Push to `main`.

Set all environment variables in the Vercel project dashboard under **Settings → Environment Variables**.

### Webhooks to configure

| Service | Endpoint |
|---|---|
| Attendee.dev | `https://yourdomain.com/api/attendee/webhook` |
| Stripe | `https://yourdomain.com/api/webhooks/stripe` |
| Clerk | `https://yourdomain.com/api/webhooks/clerk` |
| Inngest | Auto-configured via Inngest dashboard |

### Switching providers in production

To switch from Recall to Attendee (or back) in Vercel:

1. Update `MEETING_BOT_PROVIDER` in Vercel environment variables
2. Add the provider-specific key (`ATTENDEE_API_KEY` or `RECALL_API_KEY`)
3. Redeploy — no code changes required

To enable split context mode:

1. Set `CLIO_CONTEXT_MODE=split` and `NEXT_PUBLIC_CLIO_CONTEXT_MODE=split`
2. Redeploy — existing sessions are unaffected until a new bot is created

### Enabling relay audio mode (AUD-01)

Relay mode streams raw PCM16 audio directly from Attendee to ElevenLabs server-side, bypassing the transcript webhook chain. Latency drops from ~800ms to ~150ms.

**Relay mode cannot run on Vercel** — it requires a persistent WebSocket server. Deploy to Railway, Render, or fly.io instead.

```bash
# On your persistent server (Railway / Render / fly.io)
MEETING_BOT_AUDIO_MODE=relay
NEXT_PUBLIC_MEETING_BOT_AUDIO_MODE=relay
ELEVENLABS_API_KEY=sk_...
AUDIO_RELAY_WS_URL=wss://your-server.railway.app/api/audio-relay

# Start with the custom server (not `next start`)
npm run start:relay
```

How it works (hybrid design):
- Attendee still loads the walkthrough page in headless Chromium (`voice_agent_settings`) — screen share works as normal in the meeting
- WalkthroughClient detects relay mode and skips ElevenLabs startup — the page is a visual renderer only
- Attendee ALSO streams raw PCM16 audio to `AUDIO_RELAY_WS_URL` (`websocket_settings.audio`)
- The relay forwards audio to ElevenLabs' conversational AI WebSocket
- ElevenLabs STT + LLM (`/api/clio/llm`) + TTS runs server-side
- TTS audio is sent back to Attendee via `realtime_audio.bot_output` — injected directly into the meeting
- `show_visual` tool calls update `walkthrough_state` in the DB → the headless browser page polls and scrolls → bot screen-shares the updated visual

To revert to browser mode: unset `MEETING_BOT_AUDIO_MODE` (or set to `browser`) and redeploy.

---

## Plan Tiers

| Plan | Price | Features |
|---|---|---|
| Free Trial | $0 / 7 days | 1 email/day, onboarding, learning plan |
| Starter | $12/mo or $99/yr | Daily email, weekly digest, AI Readiness Score |
| Pro | $25/mo or $199/yr | Email + SMS, Ask Anything, voice sessions |
| Executive | $49/mo or $399/yr | Everything + dedicated number, priority onboarding |
