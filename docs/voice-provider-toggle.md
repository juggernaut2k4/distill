# Voice Provider Toggle — ElevenLabs ↔ Hume EVI 3

**Status:** Hume EVI 3 implemented. ElevenLabs is the default.
**Commit:** `191a179` — feat(voice): add Hume EVI 3 adapter with VOICE_PROVIDER toggle

---

## How the toggle works

One environment variable controls which voice provider the bot uses:

```
NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs   ← default, turn-based
NEXT_PUBLIC_VOICE_PROVIDER=hume         ← bidirectional, barge-in
```

Set this in `.env.local` for local dev and in Vercel environment settings for production.

---

## Switch to Hume EVI 3

Add to `.env.local` and Vercel env:

```
NEXT_PUBLIC_VOICE_PROVIDER=hume
NEXT_PUBLIC_HUME_API_KEY=PLACEHOLDER_HUME_API_KEY
NEXT_PUBLIC_HUME_CONFIG_ID=4e0c7e15-bb03-40b2-aded-21813f19fc8d
```

The Hume config (ID above) is set up with:
- **Voice:** Ellie (`21289f74-417c-422c-be9f-b8f84ee07d44`)
- **Language model:** Custom — points to `https://distill-peach.vercel.app/api/clio/chat/completions`
- **Tools:** `show_visual` (section_index, topic_id, topic_title) + `end_session`
- **Web search:** Off
- **Built-in hangup:** Not used (we handle end_session ourselves)

---

## Switch back to ElevenLabs

Either set the toggle back:
```
NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs
```

Or remove `NEXT_PUBLIC_VOICE_PROVIDER` entirely — it defaults to `elevenlabs`.

The HUME_API_KEY and HUME_CONFIG_ID vars can stay in place; they are ignored when the provider is `elevenlabs`.

---

## What changed in the codebase

| File | Change |
|---|---|
| `lib/voice/hume-adapter.ts` | **New file.** HumeAdapter class implementing VoiceSessionAdapter. Native WebSocket to `wss://api.hume.ai/v0/evi/chat`. Handles bidirectional audio (MediaRecorder → Hume → AudioContext), tool calls, barge-in, reconnect. |
| `lib/voice/index.ts` | Exports HumeAdapter and HumeAdapterConfig. |
| `app/dashboard/walkthrough/WalkthroughClient.tsx` | Hume connect branch added before the ElevenLabs block. ElevenLabs code is completely untouched. |

---

## What is the same regardless of provider

- `lib/voice/elevenlabs-adapter.ts` — untouched
- `/api/clio/chat/completions` — Hume calls this same endpoint (OpenAI-compatible)
- `lib/clio-context-builder.ts` — coaching scripts unchanged
- `show_visual` / `end_session` behaviour — identical (slide advances, session cleanup)
- Attendee.dev bot — still joins Google Meet and runs the headless browser
- All visual templates, session DB, Inngest timer — unchanged

---

## Key differences in behaviour

| | ElevenLabs | Hume EVI 3 |
|---|---|---|
| Interruptions | ❌ Clio finishes before listening | ✅ User can interrupt mid-sentence |
| Latency (first audio) | 2–4s | ~1–1.8s |
| LLM | Claude (via /api/clio/chat/completions) | Claude (same endpoint) |
| Voice | Siren (`eXpIbVcVbLo8ZJQDlDnl`) | Ellie (`21289f74-417c-422c-be9f-b8f84ee07d44`) |
| Emotion detection | ❌ | ✅ Adapts to vocal tone |
| Keep-alive needed | ✅ (EL disconnects after ~15s silence) | ❌ (Hume holds connection) |
| sendUserMessage | ✅ Used for pending_transcript | ❌ Not used (audio goes direct) |

---

## Hume dashboard

Config is managed at [platform.hume.ai](https://platform.hume.ai).
To update the custom LLM URL (e.g. after domain change to hello-clio.com):
- Go to EVI → Configs → edit config `4e0c7e15-bb03-40b2-aded-21813f19fc8d`
- Update the Language Model URL field

---

*Implemented: 2026-06-30 | Provider research: docs/research/voice-providers-bidirectional.md*
