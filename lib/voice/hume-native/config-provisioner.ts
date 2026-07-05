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
 * SIMPLIFIED CLONE-AND-OVERRIDE-TWO-FIELDS APPROACH (see git history for the
 * prior field-by-field approach, and the subsequent tools-management approach
 * that self-managed a separate Hume Tools API lifecycle): the base Config
 * referenced by NEXT_PUBLIC_HUME_CONFIG_ID is now fully set up by hand in
 * Hume's dashboard — voice, language model, both custom tools
 * (`advance_tab` and `show_visual`), the built-in `hang_up` tool, and
 * `event_messages` are all already correct there, with only `prompt` left
 * blank/null for this module to fill in per session. So provisioning is now
 * just: fetch that base Config via `GET /v0/evi/configs/{id}`
 * (getExistingConfig), spread its body as-is into the new Config, and
 * override ONLY `name` (must be unique per session) and `prompt` (the
 * assembled per-session prompt). `tools`, `language_model`, `voice`,
 * `event_messages`, timeouts, etc. are all inherited untouched — there is no
 * need for this module to create, look up, version, or manage tools via
 * Hume's Tools API at all; the clone carries them over for free.
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

  // Clone base: fetch the existing production config as our starting
  // template (see getExistingConfig doc comment above). Every field —
  // voice, language_model, tools (advance_tab, show_visual, built-in
  // hang_up), event_messages, timeouts, etc. — is already correctly
  // configured on this base Config directly in Hume's dashboard, and is
  // inherited as-is below.
  let baseConfig: Record<string, unknown>
  try {
    baseConfig = await getExistingConfig(apiKey, baseConfigId)
  } catch (err) {
    console.error('[hume-native/config-provisioner] Failed to fetch base config:', err instanceof Error ? err.message : err)
    throw new Error('Failed to fetch existing Hume Config to clone')
  }

  // Clone the base config's body, keeping every field (voice, language_model,
  // tools, event_messages, timeouts, etc.) as-is, and overriding only what
  // genuinely must differ per session: `name` (must be unique per session —
  // see 09dd72d) and `prompt` (our assembled per-session prompt, replacing
  // the base's blank/null prompt). `id`/`version`/timestamps/etc. from the
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
