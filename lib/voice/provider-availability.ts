/**
 * B2B-61 Part B. Gates whether the "OpenAI Realtime" option in the admin
 * voice-provider toggle (system_voice_config) is selectable at all — both in
 * the UI (app/(with-clerk)/dashboard/admin/VoiceProviderCard.tsx) and,
 * defense-in-depth, in the PATCH /api/admin/voice-config route itself.
 *
 * Flipped to `true` 2026-07-31 after a real live connectivity spike against
 * OpenAI's Realtime API (real ephemeral token minted via the production
 * /api/openai-realtime-token route, real WebSocket, real session.update,
 * real tool-call round trip, real barge-in event) confirmed the adapter's
 * assumptions — audio format (audio/pcm @ 24000Hz), tool-call event shapes
 * (response.output_item.done / function_call_arguments.delta+done), and
 * interruption (input_audio_buffer.speech_started) all matched what
 * lib/voice/openai-realtime-adapter.ts expects. Two real bugs surfaced by the
 * spike were fixed and re-verified live before this flip: (1) the
 * 'openai-beta.realtime-v1' WS subprotocol triggered a hard
 * beta_api_shape_disabled error under the current GA API — removed; (2) the
 * token route's outbound fetch to OpenAI lacked `cache: 'no-store'`, so
 * Next.js's Data Cache was silently serving the same (often already-used)
 * ephemeral token to repeated callers — fixed. This file has no other
 * purpose and should not accumulate unrelated flags.
 */
export const OPENAI_REALTIME_ADAPTER_AVAILABLE = true

/**
 * B2B-75 (docs/specs/B2B-75-requirement-document.md §6.3). Gates whether the
 * "ElevenLabs" option in the WIDGET voice-provider selector is offered at all —
 * in the UI (app/(with-clerk)/dashboard/admin/WidgetVoiceProviderCard.tsx) and,
 * defense-in-depth, in PATCH /api/admin/widget-voice-config itself.
 *
 * Ships `true`: unlike B2B-61's OpenAI flag above (which shipped `false` because
 * the adapter genuinely did not exist yet), this build ships the adapter
 * complete, and the real gate on selecting ElevenLabs is whether Arun has
 * actually saved credentials — a condition that cannot be satisfied by accident.
 * Per the feature brief §8 the feature ships "selectable but not selected."
 *
 * Flip to `false` to withdraw the option entirely without a migration.
 *
 * Scope reminder: this gates the WIDGET channel only. `active_provider` — which
 * drives the inline / meeting-bot channel — keeps its two-value domain and is
 * never affected by this flag (Decision D2).
 */
export const ELEVENLABS_ADAPTER_AVAILABLE = true
