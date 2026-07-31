/**
 * B2B-61 Part B. Gates whether the "OpenAI Realtime" option in the admin
 * voice-provider toggle (system_voice_config) is selectable at all — both in
 * the UI (app/(with-clerk)/dashboard/admin/VoiceProviderCard.tsx) and,
 * defense-in-depth, in the PATCH /api/admin/voice-config route itself.
 *
 * Owned by Part A (the OpenAI Realtime adapter build, tracked separately in
 * the B2B-61 feature brief) — flip to `true` only once
 * lib/voice/openai-realtime-adapter.ts is live-call verified end-to-end
 * (per the feature brief's own spike-first requirement). This file has no
 * other purpose and should not accumulate unrelated flags.
 */
export const OPENAI_REALTIME_ADAPTER_AVAILABLE = false
