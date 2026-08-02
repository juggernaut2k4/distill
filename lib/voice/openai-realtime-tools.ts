/**
 * B2B-61 Part A — local JSON Schema tool definitions for OpenAI Realtime.
 *
 * These did not exist anywhere in this repo before this change. Hume's equivalent tools
 * (`advance_tab`, `show_visual`, `end_session`) are configured entirely on Hume's own hosted
 * dashboard and referenced from lib/voice/hume-native/config-provisioner.ts only by opaque
 * {id, version} pairs — the actual parameter schemas have never lived in-repo. OpenAI Realtime
 * requires each tool's full JSON Schema to be sent locally in the `session.update` client event,
 * so this is genuinely new code, not a port of an existing definition.
 *
 * Call-timing / behavioral semantics are copied deliberately, not reinterpreted, from
 * lib/voice/hume-native/prompt-template.ts's BEHAVIORAL RULES (rules 3, 5, 8c, 13):
 *   - show_visual   → called at the moment a new section begins, BEFORE speaking about it
 *                      substantively. Does NOT advance the page by itself (B2B-58).
 *   - advance_tab   → the ONLY tool that advances to the next section.
 *   - end_session   → the ONLY way a call ends — never implied by a spoken goodbye alone.
 *
 * Tool schema shape confirmed 2026-07-31 against OpenAI's current Realtime docs
 * (developers.openai.com/api/docs/guides/realtime-conversations, fetched during this build):
 * flat `{ type: 'function', name, description, parameters }` — NOT the nested
 * `{ type: 'function', function: { name, ... } }` shape used by Chat Completions/Assistants.
 * This shape was confirmed against live documentation but NOT against a live socket connection
 * (no OPENAI_REALTIME_API_KEY was available in this environment during the build — see the spike
 * findings in lib/voice/openai-realtime-adapter.ts's top-of-file comment).
 */

export interface OpenAIRealtimeToolDef {
  type: 'function'
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required: string[]
  }
}

export const OPENAI_REALTIME_TOOLS: OpenAIRealtimeToolDef[] = [
  {
    type: 'function',
    name: 'show_visual',
    description:
      "Call this the moment you begin covering a new section, BEFORE you start speaking about it substantively — never after. This tool does not advance to the next section by itself; it only signals which section's visual should be shown right now. Pass whichever of section_index or topic_title you know.",
    parameters: {
      type: 'object',
      properties: {
        section_index: {
          type: 'integer',
          description: 'Zero-based index of the section now being covered, if known.',
        },
        topic_title: {
          type: 'string',
          description: 'The exact title of the section now being covered, used if the index is not known.',
        },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'record_verification_result',
    description:
      "Call this immediately after the participant answers this section's verification question — in its own turn, before you decide whether to move on. Never guess or skip this: it is how the system knows whether understanding was actually confirmed. Use 'correct' only when they genuinely demonstrated understanding. Use 'incorrect' for a wrong-but-understandable answer — the result tells you exactly what to do next (re-explain and ask again, or wrap up if the maximum attempts has been reached), and you must act on it immediately, in the same turn, without pausing. Use 'garbled' when you heard speech but could not understand it as an answer at all (not the same as a wrong answer) — repeated garbled results mean a likely audio/connection problem, and the result will tell you to end the session gracefully rather than keep guessing.",
    parameters: {
      type: 'object',
      properties: {
        result: {
          type: 'string',
          enum: ['correct', 'incorrect', 'garbled'],
          description: 'The outcome of the verification question just asked, for the section currently being taught.',
        },
      },
      required: ['result'],
    },
  },
  {
    type: 'function',
    name: 'advance_tab',
    description:
      "Call this only when — and only when — the current section's verification question has already been confirmed via record_verification_result (either 'correct', or 'incorrect' with the maximum attempts reached). Calling this before that will not advance the page — the system will tell you so, and you must continue teaching or clarifying the current section instead. This is the ONLY tool that ever advances to the next section; show_visual never does.",
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function',
    name: 'end_session',
    description:
      'Call this immediately after you deliver your closing goodbye, in that same turn, when the session is over. This is the ONLY way the call ends — it never ends automatically just because you said goodbye, so you must call this explicitly every time you close a session.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
]
