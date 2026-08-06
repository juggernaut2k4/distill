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
      "Call this the moment you begin covering a new section, BEFORE you start speaking about it substantively — never after. This tool does not advance to the next section by itself; it only signals which section's visual should be shown right now. Pass whichever of section_index or topic_title you know. Calling this is a silent action: say nothing to announce, introduce, or accompany it.",
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
    name: 'advance_tab',
    // "and a brief summary" was removed 2026-08-06: widget-prompt-rules.ts v17 already dropped that
    // obligation from the answer turn (recap now fuses into the next turn's opening instead), but
    // this description still stated the old precondition — a live contradiction the model was
    // reading. Description is deliberately mechanical-only (when to call it); speaking behavior is
    // governed by each channel's own prompt, not this shared tool definition.
    description:
      "Call this when — and only when — you judge the current section is fully covered: content taught, verification question asked and answered, and your response to that answer given. This is the ONLY tool that ever advances to the next section; show_visual never does. Use your own judgment on timing. Calling this is a silent action: say nothing to announce, introduce, or accompany it.",
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
