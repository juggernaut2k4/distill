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
 * EXPLICIT-RECONSTRUCTION APPROACH (third provisioning fix — see git history
 * for the prior field-by-field approach, the tools-management approach that
 * self-managed a separate Hume Tools API lifecycle, and the clone-and-spread
 * approach that preceded this one and broke because of it): the base Config
 * referenced by NEXT_PUBLIC_HUME_CONFIG_ID is fetched via
 * `GET /v0/evi/configs/{id}` (getExistingConfig) purely as a source of
 * *values* to carry forward — its body is never spread wholesale into the
 * POST payload again, because Hume's GET and POST schemas are NOT
 * symmetrical for every field:
 *
 *   - `voice`: GET returns a richer object (description, tags, type, etc.)
 *     than POST accepts. POST only accepts `{ provider, id }` (or
 *     `{ provider, name }`). Spreading the GET shape in causes POST to
 *     reject/drop the field, which surfaces as
 *     `400: "Attempting to create an EVI3 config without specifying a
 *     voice. Voice spec is required."` — this was the confirmed root cause
 *     of the second provisioning bug. Fixed here by explicitly reconstructing
 *     `{ provider: 'HUME_AI', id: '21289f74-417c-422c-be9f-b8f84ee07d44' }`
 *     ("Ellie", the known-good production voice).
 *   - `language_model`: GET reports this back as `{ provider, model }`, but
 *     POST's schema (`posted_language_model`) expects `{ model_provider,
 *     model_resource, temperature? }` — different key names entirely, so a
 *     naive spread silently produces a body POST doesn't recognize. Fixed
 *     here by explicitly reconstructing `{ model_provider: 'ANTHROPIC',
 *     model_resource: 'claude-sonnet-4-6' }`.
 *   - `tools`: POST's `tools` array takes minimal `{id, version}` references
 *     (`posted_user_defined_tool_spec`) into pre-created Hume Tools, which
 *     round-trips fine from GET — but built-in tools (`hang_up`, `web_search`)
 *     live in a wholly separate top-level field, `builtin_tools`
 *     (`posted_builtin_tool`, shape `{ name, fallback_content? }`), NOT
 *     inside `tools`. Confirmed via Hume's Create Config API reference
 *     (dev.hume.ai). Fixed here by explicitly reconstructing both fields:
 *     `tools` as `{id, version}` refs for `advance_tab` and `show_visual`,
 *     and `builtin_tools` as `{ name: 'hang_up' }`.
 *
 * Everything else — `event_messages`, `interruption`, `turn_detection`,
 * `nudges`, `timeouts`, `webhooks`, `ellm_model` — has no evidence of
 * GET/POST asymmetry and continues to be inherited from the base config via
 * spread, same as `evi_version`. Only `name` (must be unique per session)
 * and `prompt` (the assembled per-session prompt) are session-specific
 * overrides on top of that inherited base.
 */

const HUME_CONFIGS_URL = 'https://api.hume.ai/v0/evi/configs'

export interface ProvisionNativeConfigParams {
  sessionId: string
  assembledPrompt: string
}

export interface ProvisionNativeConfigResult {
  configId: string
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

  // Fetch the existing production config purely as a source of values to
  // carry forward for the fields that DO round-trip cleanly between GET and
  // POST (event_messages, interruption, turn_detection, nudges, timeouts,
  // webhooks, ellm_model, evi_version). See module doc comment above for why
  // voice, language_model, and tools/builtin_tools are NOT taken from this
  // spread and are reconstructed explicitly instead.
  let baseConfig: Record<string, unknown>
  try {
    baseConfig = await getExistingConfig(apiKey, baseConfigId)
  } catch (err) {
    console.error('[hume-native/config-provisioner] Failed to fetch base config:', err instanceof Error ? err.message : err)
    throw new Error('Failed to fetch existing Hume Config to clone')
  }

  // Drop GET-only/identity fields that POST /v0/evi/configs does not accept,
  // plus the fields we reconstruct explicitly below (voice, language_model,
  // tools, builtin_tools) so the inherited spread can never silently
  // reintroduce their incompatible GET shapes.
  const {
    id: _baseId,
    version: _baseVersion,
    version_description: _baseVersionDescription,
    created_on: _baseCreatedOn,
    modified_on: _baseModifiedOn,
    voice: _baseVoice,
    language_model: _baseLanguageModel,
    tools: _baseTools,
    builtin_tools: _baseBuiltinTools,
    ...inheritedFields
  } = baseConfig

  const body = {
    ...inheritedFields,
    evi_version: baseConfig.evi_version ?? '3',
    name: `hume-native-session-${sessionId}-${Date.now()}`,
    prompt: {
      text: assembledPrompt,
    },
    // Explicitly reconstructed — see module doc comment for why these
    // cannot be safely spread from the GET response.
    voice: {
      provider: 'HUME_AI',
      id: '21289f74-417c-422c-be9f-b8f84ee07d44', // "Ellie"
    },
    language_model: {
      model_provider: 'ANTHROPIC',
      model_resource: 'claude-sonnet-4-6',
    },
    tools: [
      { id: '4f15c0c2-9af1-421c-8040-ad34b6345234', version: 1 }, // advance_tab
      { id: '65a3d139-2f7b-4e26-9fce-caeb7fa78e05', version: 1 }, // show_visual
    ],
    builtin_tools: [
      { name: 'hang_up' },
    ],
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
