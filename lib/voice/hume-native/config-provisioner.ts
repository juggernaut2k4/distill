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
 *
 * CLONE-BASE APPROACH (fix, see git history for the prior field-by-field
 * approach): rather than declaring every Config field from scratch — which
 * previously caused missing-voice and missing-tools bugs one at a time — this
 * module fetches the existing, known-working production Config referenced by
 * NEXT_PUBLIC_HUME_CONFIG_ID (the Custom-LLM config already serving real
 * sessions today) via `GET /v0/evi/configs/{id}` and uses its full body as
 * the starting template. Only `language_model` and `prompt` are overridden;
 * `voice`, `event_messages`, timeouts, etc. are inherited as-is.
 *
 * `tools` is the one field NOT blindly inherited: the production config only
 * carries `show_visual` + `end_session` (its CLM flow never needed
 * `advance_tab`, since the Custom-LLM bridge drives section-advance itself).
 * Hume-native mode's prompt (see prompt-template.ts) explicitly instructs the
 * model to call `advance_tab`, so that tool must still be resolved
 * independently. The resolution logic below is now version-aware (see
 * resolveToolReferences) so it also self-heals `show_visual` / `end_session`
 * if their schemas ever drift from what buildToolDefinitions() declares.
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
        required: ['direction'],
        properties: {
          direction: {
            type: 'string',
            enum: ['next', 'previous'],
            description: 'Navigation direction: "next" or "previous".',
          },
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
 * Full tool-version record as returned by Hume's List/Get tool endpoints,
 * including the `parameters` string so we can diff it against our current
 * buildToolDefinitions() output.
 */
interface ExistingToolVersion {
  id: string
  version: number
  name: string
  parameters: string
}

/**
 * Looks up an existing Hume tool by exact name via `GET /v0/evi/tools?name=`.
 * Hume's `name` filter is an exact-match lookup (per dev.hume.ai/reference for
 * List tools). Returns the most recent version's full record (including
 * `parameters`, so callers can detect schema drift) if found, or null if no
 * tool with this name exists yet.
 */
async function findExistingToolByName(
  apiKey: string,
  name: string
): Promise<ExistingToolVersion | null> {
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

  const data = await res.json() as {
    tools_page?: Array<{ id: string; version: number; name: string; parameters: string }>
  }
  const match = data.tools_page?.find((t) => t.name === name)
  return match ? { id: match.id, version: match.version, name: match.name, parameters: match.parameters } : null
}

/**
 * Creates a brand-new user-defined Hume tool via `POST /v0/evi/tools`. Only
 * used the first time a tool name is ever seen. Hume assigns the `id`
 * server-side; we never invent one.
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
 * Publishes a NEW VERSION of an already-existing Hume tool via
 * `POST /v0/evi/tools/{id}` (per dev.hume.ai: Tools are versioned — each
 * update to a Tool's definition is published as a new version under the
 * same tool id, rather than mutating a version in place). This is the fix
 * for the stale-tool-reference bug: previously, once a tool named
 * `advance_tab` existed on Hume's side from an earlier (broken) attempt,
 * findExistingToolByName() would find and reuse it forever, even after we
 * fixed its schema locally in buildToolDefinitions() — because the code
 * only ever created a tool if none existed by that name, and never
 * re-published an updated definition against an existing one.
 */
async function publishNewToolVersion(
  apiKey: string,
  toolId: string,
  tool: ToolDefinition
): Promise<ToolReference> {
  const res = await fetch(`${HUME_TOOLS_URL}/${toolId}`, {
    method: 'POST',
    headers: {
      'X-Hume-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    // The update-tool-version endpoint takes the same tool-definition shape
    // as create (description/parameters/fallback_content/version_description);
    // `name` is fixed by the tool id and not part of this body.
    body: JSON.stringify({
      description: tool.description,
      parameters: tool.parameters,
    }),
  })

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '(unreadable response body)')
    console.error('[hume-native/config-provisioner] Tool version publish failed:', res.status, errorBody)
    throw new Error(`Hume tool version publish failed for "${tool.name}" with status ${res.status}: ${errorBody}`)
  }

  const data = await res.json() as { id: string; version: number }
  return { id: data.id, version: data.version }
}

/**
 * Normalizes a JSON-Schema parameters string for structural comparison —
 * parses and re-stringifies with sorted keys so that whitespace or key-order
 * differences (which carry no semantic meaning) never trigger a false-
 * positive "drift" and an unnecessary new tool version.
 */
function normalizeParameters(parameters: string): string {
  try {
    const sortKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeys)
      if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
          .sort()
          .reduce((acc, key) => {
            acc[key] = sortKeys((value as Record<string, unknown>)[key])
            return acc
          }, {} as Record<string, unknown>)
      }
      return value
    }
    return JSON.stringify(sortKeys(JSON.parse(parameters)))
  } catch {
    // If either string fails to parse as JSON, fall back to raw comparison —
    // any difference (including whitespace) will conservatively trigger a
    // new version, which is safe (just an extra version), never unsafe.
    return parameters
  }
}

/**
 * Resolves the `{id, version}` references Hume's Config API expects for its
 * `tools` array. For each tool we need:
 *   1. If no tool with this name exists on Hume yet, create it fresh.
 *   2. If one exists, compare its stored `parameters` against our current
 *      buildToolDefinitions() output. If they match, reuse the existing
 *      version as-is (no-op — avoids spamming Hume with redundant versions
 *      on every single session provision). If they differ — e.g. we fixed
 *      the schema locally after an earlier broken tool was created — publish
 *      a NEW VERSION via publishNewToolVersion() and use that version's
 *      reference. This makes the resolver self-healing: a code-level schema
 *      fix now always propagates to Hume on the very next provisioning call,
 *      with no manual cleanup required on Hume's side.
 */
async function resolveToolReferences(apiKey: string): Promise<ToolReference[]> {
  const definitions = buildToolDefinitions()
  const refs: ToolReference[] = []
  for (const def of definitions) {
    const existing = await findExistingToolByName(apiKey, def.name)
    if (!existing) {
      refs.push(await createTool(apiKey, def))
      continue
    }

    const isStale = normalizeParameters(existing.parameters) !== normalizeParameters(def.parameters)
    if (isStale) {
      console.warn(
        `[hume-native/config-provisioner] Tool "${def.name}" schema has drifted from Hume's stored version ${existing.version} — publishing a new version.`
      )
      refs.push(await publishNewToolVersion(apiKey, existing.id, def))
    } else {
      refs.push({ id: existing.id, version: existing.version })
    }
  }
  return refs
}

/**
 * Fetches the existing, known-working production Hume Config referenced by
 * NEXT_PUBLIC_HUME_CONFIG_ID via `GET /v0/evi/configs/{id}` — same call
 * pattern already used for diagnostics in app/api/debug/hume-chat/route.ts.
 * This is the "clone base" for native-mode provisioning: rather than
 * declaring every Config field from scratch (the prior approach, which hit
 * missing-voice and missing-tools bugs one at a time), we start from a body
 * Hume has already accepted and is actively serving in production, and only
 * override the fields that must differ for native mode.
 *
 * Hume's `GET /v0/evi/configs/{id}` returns the config wrapped in a
 * `{id, name, evi_version, prompt, voice, language_model, tools,
 * event_messages, ...}` shape (no version-list wrapper) when fetched by
 * config id directly — matching what the existing debug route already reads.
 */
async function getExistingConfig(apiKey: string, configId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${HUME_CONFIGS_URL}/${configId}`, {
    method: 'GET',
    headers: { 'X-Hume-Api-Key': apiKey },
  })

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '(unreadable response body)')
    console.error('[hume-native/config-provisioner] Failed to fetch existing base config:', res.status, errorBody)
    throw new Error(`Failed to fetch existing Hume Config ${configId} with status ${res.status}: ${errorBody}`)
  }

  return (await res.json()) as Record<string, unknown>
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

  const baseConfigId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID
  if (!baseConfigId) {
    throw new Error('[hume-native/config-provisioner] NEXT_PUBLIC_HUME_CONFIG_ID is not configured — required as the clone base for native-mode provisioning')
  }

  const { sessionId, assembledPrompt } = params

  // Clone base: fetch the existing production Custom-LLM config as our
  // starting template (see getExistingConfig doc comment above).
  let baseConfig: Record<string, unknown>
  try {
    baseConfig = await getExistingConfig(apiKey, baseConfigId)
  } catch (err) {
    console.error('[hume-native/config-provisioner] Failed to fetch base config:', err instanceof Error ? err.message : err)
    throw new Error('Failed to fetch existing Hume Config to clone')
  }

  // Config's `tools` array only accepts `{id, version}` references to
  // pre-existing Hume tools — not inline definitions. The base config's own
  // `tools` field (show_visual + end_session, CLM-flow only — see module
  // doc comment) does NOT include `advance_tab`, which hume-native mode's
  // prompt explicitly requires. So we still resolve tools ourselves rather
  // than inheriting the base config's `tools` verbatim; the resolver is now
  // version-aware and self-healing (see resolveToolReferences above), which
  // also covers show_visual/end_session if their schemas ever drift.
  let toolRefs: ToolReference[]
  try {
    toolRefs = await resolveToolReferences(apiKey)
  } catch (err) {
    console.error('[hume-native/config-provisioner] Failed to resolve tool references:', err instanceof Error ? err.message : err)
    throw new Error('Failed to provision required Hume tools')
  }

  // Clone the base config's body, keeping every field (voice, event_messages,
  // timeouts, etc.) as-is, and overriding only what genuinely must differ for
  // native mode: `name` (must be unique per session — see 09dd72d), `prompt`
  // (our assembled per-session prompt, replacing the base's CLM prompt),
  // `language_model` (native/supplemental instead of Custom), and `tools`
  // (adds advance_tab, per above). `id`/`version`/timestamps/etc. from the
  // GET response are dropped since POST /v0/evi/configs creates a new config
  // and does not accept those fields.
  const {
    id: _baseId,
    version: _baseVersion,
    version_description: _baseVersionDescription,
    created_on: _baseCreatedOn,
    modified_on: _baseModifiedOn,
    ...inheritedFields
  } = baseConfig

  const body = {
    ...inheritedFields,
    evi_version: baseConfig.evi_version ?? '3',
    name: `hume-native-session-${sessionId}-${Date.now()}`,
    prompt: {
      text: assembledPrompt,
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
