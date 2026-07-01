# Bidirectional Voice Provider Research — Gemini Live & Hume AI

**Context:** Clio currently uses ElevenLabs Conversational AI (turn-based) via the Attendee.dev bot.
ElevenLabs cannot listen and speak simultaneously — users cannot interrupt Clio mid-sentence.
This document captures two production-ready bidirectional alternatives for a future voice stack upgrade.

**Decision status:** Hume EVI 3 **implemented** (2026-06-30, commit `191a179`).
Toggle via `NEXT_PUBLIC_VOICE_PROVIDER=hume`. ElevenLabs remains the default.
See `docs/voice-provider-toggle.md` for full toggle instructions and rollback steps.

---

## Option 1 — Google Gemini Live API

### What it is
WebSocket-based bidirectional streaming API. Sends audio in and receives audio out simultaneously
with built-in barge-in (interruption) support. Backed by the Gemini model family (2.5 Flash / Pro).

### Key capabilities
| Feature | Detail |
|---|---|
| Bidirectional | ✅ Listen and speak simultaneously |
| Barge-in | ✅ User can interrupt Clio at any time |
| Languages | 70+ supported (real-time voice-to-voice translation included) |
| Tool use | ✅ Function calling + Google Search built in |
| Audio transcripts | ✅ Text transcripts of both input and output |
| Affective dialog | ✅ Adapts response style to user's emotional expression |
| Live translation | ✅ Real-time voice-to-voice in 70+ languages |
| Input formats | Audio, text, video |
| Output formats | Audio, text |

### Pricing (June 2026)
| Model | Input | Output |
|---|---|---|
| Gemini 2.5 Flash Live | $1 / 1M tokens | Audio billed at 25 tokens/sec output |
| Gemini 3.5 Flash TTS | $6 / 1M output tokens | — |
| Audio input tokenisation | 32 tokens per second of raw audio | — |

Gemini Live is reported as **~32x cheaper than OpenAI Realtime** at scale.

### How it would fit Clio
- Same WebSocket pattern as ElevenLabs — the `VoiceSessionAdapter` in `lib/voice/` could wrap it
- Attendee.dev virtual mic → Gemini Live WS (same flow as today)
- The custom LLM endpoint (`/api/clio/llm`) would be retired — Gemini handles LLM + STT + TTS in one call
- `show_visual` and `end_session` client tools would need to be re-implemented as Gemini function calls

### Trade-offs
| Pro | Con |
|---|---|
| Significantly cheaper than OpenAI Realtime | Voice quality/character less customisable than ElevenLabs Siren |
| 70-language support opens international markets | Loses the Anthropic Claude LLM (Clio's coaching personality lives there) |
| Affective dialog is a natural fit for coaching | Tighter Google ecosystem coupling |
| Built-in Google Search for real-time context | Requires rework of `/api/clio/llm` custom LLM pipeline |

### Docs
- [Gemini Live API overview](https://ai.google.dev/gemini-api/docs/live-api)
- [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Gemini 2.5 Flash Live on Google Cloud](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-live-api)
- [Pricing breakdown](https://the-rogue-marketing.github.io/google-gemini-tts-speech-audio-api-pricing-may-2026/)

---

## Option 2 — Hume AI EVI (Empathic Voice Interface)

### What it is
Speech-to-speech model that reads the user's **vocal tone, rhythm, and timbre** in real-time
and adapts Clio's response style and emotional register accordingly. Built for conversations
where how someone sounds matters as much as what they say. Currently on EVI 3.

### Key capabilities
| Feature | Detail |
|---|---|
| Bidirectional | ✅ Speech-to-speech, not turn-based |
| Emotion detection | ✅ Reads nuanced vocal modulations (stress, confusion, confidence) |
| Adaptive tone | ✅ Adjusts Clio's response style based on user's emotional state |
| LLM compatibility | ✅ Works with Claude, GPT-4o, Gemini, Llama, Grok, Kimi K2 |
| Voice cloning | ✅ Clone any voice from < 30-second recording |
| Custom voices | ✅ 200K+ voice library or design new voices from text description |
| Barge-in | ✅ Interrupt model at any time |

### Pricing (2026)
| Tier | Monthly | EVI usage | Additional |
|---|---|---|---|
| Free | $0 | 5 min / month | 10K chars (~10 min audio) |
| Starter | $3 | 40 min / month | +$0.07 / additional minute |
| Enterprise | Custom | Unlimited | SOC 2, GDPR, HIPAA; dedicated Slack support |

### Why it's interesting for Clio specifically
Clio is a **coaching** product. Coaching is inherently about reading the room:
- If a participant sounds confused, Clio should slow down and re-explain
- If they sound confident, Clio should advance faster
- If they sound disengaged, Clio should ask a question

EVI 3 does this automatically from vocal tone — without the participant having to say "I'm confused."
This is something neither ElevenLabs, OpenAI Realtime, nor Gemini Live offer.

Voice cloning also means we could preserve the Siren voice character by cloning it into EVI 3.

### Trade-offs
| Pro | Con |
|---|---|
| Only provider with real emotional intelligence | Pricing at scale (enterprise custom) is unknown |
| Adapts coaching pace to participant state | Less direct control over system prompting than ElevenLabs |
| Can clone Siren voice — preserves Clio's character | Smaller company / less API maturity than Google or OpenAI |
| Works with Claude as the LLM — no pipeline rewrite | EVI 3 is newer; fewer community examples |
| SOC 2 + HIPAA for enterprise clients | Voice cloning quality at < 30s needs validation |

### Docs
- [EVI overview](https://dev.hume.ai/docs/empathic-voice-interface-evi/overview)
- [EVI 3 announcement](https://www.hume.ai/blog/announcing-evi-3-api)
- [Hume pricing](https://www.hume.ai/pricing)

---

## Side-by-side summary

| | ElevenLabs (current) | Gemini Live | Hume EVI 3 | OpenAI Realtime |
|---|---|---|---|---|
| Bidirectional | ❌ | ✅ | ✅ | ✅ |
| Interruptions | ❌ | ✅ | ✅ | ✅ |
| Emotion detection | ❌ | Partial (affective) | ✅ Full | ❌ |
| Siren voice preserved | ✅ | ❌ | ✅ (clone) | ❌ |
| Claude as LLM | ✅ (custom endpoint) | ❌ (Gemini) | ✅ | ❌ (GPT-4o) |
| Cost at scale | Medium | Lowest | Unknown (enterprise) | Highest |
| Fit with VoiceSessionAdapter | ✅ | Medium | Medium | ✅ |
| API maturity | ✅ GA | ✅ GA | ✅ GA (EVI 3) | ✅ GA |

---

## Recommendation

**Short term:** Keep ElevenLabs. The double-response bug is fixed. Turn-based Q&A works.

**Medium term (if interruption feedback grows):** Spike Hume EVI 3 first — it's the only option
that preserves the Siren voice character AND keeps Claude as the LLM. The emotional intelligence
is a natural fit for coaching.

**Long term:** Wait for GPT-Bidi-1 API release. If OpenAI ships bidirectional with API access,
it will likely be the cleanest integration path given the existing OpenAI usage in the codebase.

---

*Researched: 2026-06-30 | Next review: when GPT-Bidi-1 API ships or user interruption complaints reach 3+ in a sprint*
