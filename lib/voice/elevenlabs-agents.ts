/**
 * 2026-08-10 — per Arun's direct instruction: three separate ElevenLabs agents, each configured
 * with its own voice, selectable at widget-session-creation time instead of always using the
 * single system-wide default in system_voice_config. Single source of truth for the 3 known
 * agent IDs — imported by the widget-session request schema (validation), the demo dispatch
 * route (voice -> agent_id mapping), and the demo UI (the 3-option selector).
 */

export interface ElevenLabsVoiceOption {
  voice: 'catherine_us_english' | 'anjura_hindi' | 'vani_tamil'
  label: string
  agentId: string
}

export const ELEVENLABS_VOICE_OPTIONS: ElevenLabsVoiceOption[] = [
  { voice: 'catherine_us_english', label: 'Catherine — US English', agentId: 'agent_0701krp1ta48fswrff17ctb0520m' },
  { voice: 'anjura_hindi', label: 'Anjura — Hindi', agentId: 'agent_4701kzq913nrep3s92229bwhkbdr' },
  { voice: 'vani_tamil', label: 'Vani — Tamil', agentId: 'agent_2201kzq90jdkeww9z4n1rn1vex2d' },
]

export const DEFAULT_ELEVENLABS_VOICE_OPTION = ELEVENLABS_VOICE_OPTIONS[0]

export const ELEVENLABS_AGENT_IDS = ELEVENLABS_VOICE_OPTIONS.map((o) => o.agentId) as [string, ...string[]]

export function getElevenLabsAgentIdForVoice(voice: string): string | null {
  return ELEVENLABS_VOICE_OPTIONS.find((o) => o.voice === voice)?.agentId ?? null
}
