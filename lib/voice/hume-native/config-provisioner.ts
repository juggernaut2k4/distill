/**
 * HUME-NATIVE-01 — Hume Config provisioning for native/supplemental-LLM mode.
 *
 * Isolated, new module. Only ever called from the new
 * app/api/hume-native/provision-config/route.ts, which itself only runs when
 * NEXT_PUBLIC_HUME_NATIVE_ENABLED is true. Never imported into any existing
 * production path — lib/voice/hume-adapter.ts and
 * app/api/clio/chat/completions/route.ts (LIVE-01's Custom-LLM bridge) are
 * untouched by this file.
 *
 * Provisions a Hume EVI Config via Hume's REST API with the Language Model
 * switched off Custom onto Hume's own native/supplemental option, carrying
 * the assembled upfront prompt as the Config's system prompt. One fresh
 * Config is created per session (never reused) to avoid stale-prompt bleed
 * between users.
 */

const HUME_CONFIGS_URL = 'https://api.hume.ai/v0/evi/configs'
const HUME_TOOLS_URL = 'https://api.hume.ai/v0/evi/tools'

export interface ProvisionNativeConfigParams {
  sessionId: string
  assembledPrompt: string
}

export interface ProvisionNativeConfigResult {
  configId: string
}

/**
 * Definition for a single user-defined tool, as required by Hume's
 * `POST /v0/evi/tools` API. Note there is no `id` field here — Hume assigns
 * that server-side on creation (confirmed via dev.hume.ai/reference for
 * Create tool: the request body accepts name/parameters/description/
 * fallback_content/version_description only; `id` is response-only, a
 * server-generated UUID).
 */
interface ToolDefinition {
  name: string
  description: string
  parameters: string
}

/**
 * Reference to an existing Hume tool, as required inside a Config's `tools`
 * array (`POST /v0/evi/configs`). Per Hume's docs, Config tools entries are
 * NOT inline tool definitions — they are `{ id, version }` references to
 * tools already created via the Tools API.
 */
interface ToolReference {
  id: string
  version: number
}

/**
 * Same wire-protocol tool_call / tool_response pattern already implemented
 * in hume-adapter.ts for CLM mode today. No new tool schema; this is the
 * identical show_visual / advance_tab / end_session set, just declared here
 * for native-mode Config provisioning.
 */
function buildToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'show_visual',
      description: 'Display the visual for a given session section on the shared screen.',
      parameters: JSON.stringify({
        type: 'object',
        properties: {
          section_index: { type: 'integer', description: '0-based index of the section to display (0 = Overview).' },
          topic_id: { type: 'string', description: 'Optional topic identifier for the section.' },
          topic_title: { type: 'string', description: 'Optional topic title for the section.' },
        },
      }),
    },
    {
      name: 'advance_tab',
      description: 'Advance to the next visualization tab within the current section.',
      parameters: JSON.stringify({
        type: 'object',
        properties: {
          direction: { type: 'string', description: 'Navigation direction, e.g. "next" or "previous".' },
        },
      }),
    },
    {
      name: 'end_session',
      description: 'End the coaching session gracefully after the final section has been summarized.',
      parameters: JSON.stringify({ type: 'object', properties: {} }),
    },
  ]
}

/**
 * Looks up an existing Hume tool by exact name via `GET /v0/evi/tools?name=`.
 * Hume's `name` filter is an exact-match lookup (per dev.hume.ai/reference for
 * List tools). Returns the most recent version's `{id, version}` if found, or
 * null if no tool with this name exists yet.
 */
async function findExistingToolByName(
  apiKey: string,
  name: string
): Promise<ToolReference | null> {
  const url = `${HUME_TOOLS_URL}?name=${encodeURIComponent(name)}&restrict_to_most_recent=true&page_size=1`
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-Hume-Api-Key': apiKey },
  })

  if (!res.ok) {
    // Non-fatal — treat as "not found" and fall through to creation. Hume's
    // create-tool call will surface any real auth/permission problem.
    console.error('[hume-native/config-provisioner] Tool lookup failed:', res.status)
    return null
  }

  const data = await res.json() as { tools_page?: Array<{ id: string; version: number; name: string }> }
  const match = data.tools_page?.find((t) => t.name === name)
  return match ? { id: match.id, version: match.version } : null
}

/**
 * Creates a new user-defined Hume tool via `POST /v0/evi/tools`. Hume
 * assigns the `id` server-side; we never invent one.
 */
async function createTool(apiKey: string, tool: ToolDefinition): Promise<ToolReference> {
  const res = await fetch(HUME_TOOLS_URL, {
    method: 'POST',
    headers: {
      'X-Hume-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tool),
  })

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '(unreadable response body)')
    console.error('[hume-native/config-provisioner] Tool creation failed:', res.status, errorBody)
    throw new Error(`Hume tool creation failed for "${tool.name}" with status ${res.status}: ${errorBody}`)
  }

  const data = await res.json() as { id: string; version: number }
  return { id: data.id, version: data.version }
}

/**
 * Resolves the `{id, version}` references Hume's Config API expects for its
 * `tools` array. Idempotent: looks up each tool by name first (so repeated
 * provisioning calls, e.g. across sessions, don't create duplicate tools on
 * Hume's side) and only creates it if it doesn't exist yet.
 */
async function resolveToolReferences(apiKey: string): Promise<ToolReference[]> {
  const definitions = buildToolDefinitions()
  const refs: ToolReference[] = []
  for (const def of definitions) {
    const existing = await findExistingToolByName(apiKey, def.name)
    refs.push(existing ?? (await createTool(apiKey, def)))
  }
  return refs
}

/**
 * Creates a fresh Hume Config in native/supplemental-LLM mode for one session.
 *
 * Error handling (per BA spec 4.3): if the Hume API call fails (non-2xx), this
 * throws rather than silently falling back to Custom-LLM mode — this is an
 * explicit trial and a silent fallback would corrupt the test. Callers (the
 * provision-config route) must surface this as a hard failure to the caller,
 * not swallow it. HUME_API_KEY is never logged; only the response status and
 * body (no secrets) are logged on failure.
 */
export async function provisionNativeConfig(
  params: ProvisionNativeConfigParams
): Promise<ProvisionNativeConfigResult> {
  const apiKey = process.env.HUME_API_KEY
  if (!apiKey) {
    throw new Error('[hume-native/config-provisioner] HUME_API_KEY is not configured')
  }

  const { sessionId, assembledPrompt } = params

  // Config's `tools` array only accepts `{id, version}` references to
  // pre-existing Hume tools — not inline definitions. Resolve (creating if
  // needed, idempotently by name) before building the config body.
  let toolRefs: ToolReference[]
  try {
    toolRefs = await resolveToolReferences(apiKey)
  } catch (err) {
    console.error('[hume-native/config-provisioner] Failed to resolve tool references:', err instanceof Error ? err.message : err)
    throw new Error('Failed to provision required Hume tools')
  }

  const body = {
    evi_version: '3',
    name: `hume-native-session-${sessionId}`,
    prompt: {
      text: assembledPrompt,
    },
    // Required by Hume's EVI3 config schema — omitting this causes
    // "Attempting to create an EVI3 config without specifying a voice."
    // Same voice ("Ellie") as the existing production Custom-LLM config
    // (NEXT_PUBLIC_HUME_CONFIG_ID, see docs/voice-provider-toggle.md), so
    // native-mode Clio sounds identical to the current Clio. Ellie is a
    // Hume Voice Library preset, hence provider: HUME_AI (per dev.hume.ai
    // Configs API: voice is `{ id | name, provider: "HUME_AI" | "CUSTOM_VOICE" }`).
    voice: {
      provider: 'HUME_AI',
      id: '21289f74-417c-422c-be9f-b8f84ee07d44',
    },
    // Hume's native/supplemental Language Model option — explicitly NOT
    // CUSTOM_LANGUAGE_MODEL. This is the mode switch that puts Hume's own
    // LLM in charge of the whole conversation for this Config.
    language_model: {
      model_provider: 'ANTHROPIC',
      model_resource: 'claude-sonnet-4-6',
    },
    tools: toolRefs,
  }

  let res: Response
  try {
    res = await fetch(HUME_CONFIGS_URL, {
      method: 'POST',
      headers: {
        'X-Hume-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[hume-native/config-provisioner] Network error calling Hume Configs API:', err instanceof Error ? err.message : err)
    throw new Error('Failed to reach Hume Configs API')
  }

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '(unreadable response body)')
    console.error('[hume-native/config-provisioner] Hume Config provisioning failed:', res.status, errorBody)
    throw new Error(`Hume Config provisioning failed with status ${res.status}: ${errorBody}`)
  }

  const data = await res.json() as { id?: string; config_id?: string }
  const configId = data.id ?? data.config_id
  if (!configId) {
    console.error('[hume-native/config-provisioner] Hume Config response missing id/config_id:', JSON.stringify(data).slice(0, 300))
    throw new Error('Hume Config response did not include a config id')
  }

  return { configId }
}
