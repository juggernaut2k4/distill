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
 * EXPLICIT-RECONSTRUCTION APPROACH (fourth provisioning fix — see git history
 * for the prior field-by-field approach, the tools-management approach that
 * self-managed a separate Hume Tools API lifecycle, and the two
 * clone-and-spread approaches that preceded this one and broke because of
 * it): the base Config referenced by NEXT_PUBLIC_HUME_CONFIG_ID is fetched
 * via `GET /v0/evi/configs/{id}` (getExistingConfig) purely as a source of
 * *values* to carry forward — its body is never spread wholesale into the
 * POST payload again, because Hume's GET (`ReturnConfig`) and POST
 * (`PostedConfig`) schemas are NOT symmetrical for every field. Verified
 * directly against Hume's Fern-generated Python SDK type definitions
 * (github.com/HumeAI/hume-python-sdk, src/hume/empathic_voice/types/), which
 * mirror the same OpenAPI definition dev.hume.ai's Create Config reference is
 * generated from:
 *
 *   - `voice`: GET returns a richer object (description, tags, type, etc.)
 *     than POST accepts. POST only accepts `{ provider, id }` (or
 *     `{ provider, name }`). Spreading the GET shape in causes POST to
 *     reject/drop the field, which surfaces as
 *     `400: "Attempting to create an EVI3 config without specifying a
 *     voice. Voice spec is required."` — this was the confirmed root cause
 *     of the second provisioning bug. Fixed by explicitly reconstructing
 *     `{ provider: 'HUME_AI', id: '21289f74-417c-422c-be9f-b8f84ee07d44' }`
 *     ("Ellie", the known-good production voice).
 *   - `language_model`: GET reports this back as `{ provider, model }`, but
 *     POST's schema (`posted_language_model`) expects `{ model_provider,
 *     model_resource, temperature? }` — different key names entirely, so a
 *     naive spread silently produces a body POST doesn't recognize. Fixed by
 *     explicitly reconstructing `{ model_provider: 'ANTHROPIC',
 *     model_resource: 'claude-sonnet-4-6' }`.
 *   - `tools` / `builtin_tools`: POST's `tools` array takes minimal
 *     `{id, version}` references (`posted_user_defined_tool_spec`) into
 *     pre-created Hume Tools, which round-trips fine from GET — but built-in
 *     tools (`hang_up`, `web_search`) live in a wholly separate top-level
 *     field, `builtin_tools` (`posted_builtin_tool`, shape
 *     `{ name, fallback_content? }`), NOT inside `tools`. There is no GET/POST
 *     shape asymmetry for either field — GET's per-entry shape for
 *     `builtin_tools` (`{ name, fallback_content? }`) already matches what
 *     POST expects exactly, and GET's per-entry shape for `tools`
 *     (`{ id, version, ...other GET-only keys }`) already matches the minimal
 *     `{id, version}` reference POST expects once the extra GET-only sibling
 *     keys (e.g. `name`, `parameters`) are dropped. So, mirroring the
 *     `builtin_tools` fix, `tools` is now dynamically reconstructed from
 *     `baseConfig.tools` (captured before destructuring, already in scope from
 *     `getExistingConfig()` — no extra API call needed) instead of a hardcoded
 *     literal. Hardcoding is exactly what silently dropped `web_search` from
 *     `builtin_tools` previously, and what silently excluded the base
 *     config's third custom tool (confirmed live, id
 *     `6fc0bfde-1f63-44a1-b752-3507b5b5d30d`, believed to be `defer_question`
 *     based on the CLM prompt's rule 9) from every cloned config's `tools`
 *     array before this fix — that tool existed on the base config the whole
 *     time but was never carried into native-mode clones because only two
 *     specific ids were ever hardcoded. Whatever custom tools exist on the
 *     base config at clone time are now automatically included, and any
 *     future tool added to the account will automatically propagate too, with
 *     no code change required. If `baseConfig.tools` is ever missing or
 *     malformed, this falls back to the previous hardcoded two-tool list
 *     (`advance_tab`, `show_visual`) as a safety net, mirroring the
 *     `builtin_tools` fallback below.
 *   - `event_messages`: this is the newly-found asymmetry. Hume's GET
 *     response (`ReturnEventMessageSpecs`) includes a fourth key,
 *     `on_resume_chat`, alongside `on_new_chat`, `on_inactivity_timeout`,
 *     `on_max_duration_timeout` — confirmed via a live GET of the base
 *     config, which returns all four. POST's schema (`PostedEventMessageSpecs`)
 *     declares only THREE keys: `on_new_chat`, `on_inactivity_timeout`,
 *     `on_max_duration_timeout` — `on_resume_chat` does not exist as a
 *     modeled field anywhere in POST's request schema. A blind spread of the
 *     GET body therefore ships an undeclared key inside `event_messages`
 *     that POST's schema has no slot for. Fixed by explicitly reconstructing
 *     only the three POST-valid keys with the base config's known-good
 *     values (`on_new_chat: { enabled: true, text: '' }`, the other two left
 *     at their base disabled state).
 *   - `turn_detection`, `interruption`, `nudges`, `timeouts`: field-for-field
 *     identical between `Posted*` and `Return*` types in the SDK (same key
 *     names, same nesting, same types on both sides) — there is no
 *     structural asymmetry here. However, this is still explicitly
 *     reconstructed rather than spread, both as defense-in-depth (the same
 *     "spread now, discover asymmetry later" failure mode already hit voice/
 *     language_model/builtin_tools/event_messages) and because it directly
 *     explains the observed symptom: `timeouts.max_duration` showing
 *     `enabled: true, duration_secs: 1800` in a clone even though the base
 *     config has `max_duration.enabled: false` — 1800 seconds (30 minutes)
 *     is documented in Hume's own SDK docstring as the hard WebSocket
 *     ceiling EVI falls back to once ANY part of a config's timeout/turn
 *     handling fails to apply as posted, which lines up with `event_messages`
 *     (a sibling field in the same POST body) being silently invalid on
 *     every prior clone.
 *
 * `webhooks` continues to be inherited from the base config via spread
 * (empty array in the base config, same shape both directions) alongside
 * `evi_version`, `ellm_model`, and `prompt`'s non-text fields. Only `name`
 * (must be unique per session) and `prompt` (the assembled per-session
 * prompt) are session-specific overrides on top of that inherited base.
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
  // POST (webhooks, ellm_model, evi_version). See module doc comment above
  // for why voice, language_model, tools/builtin_tools, event_messages,
  // timeouts, turn_detection, interruption, and nudges are NOT taken from
  // this spread and are reconstructed explicitly instead.
  let baseConfig: Record<string, unknown>
  try {
    baseConfig = await getExistingConfig(apiKey, baseConfigId)
  } catch (err) {
    console.error('[hume-native/config-provisioner] Failed to fetch base config:', err instanceof Error ? err.message : err)
    throw new Error('Failed to fetch existing Hume Config to clone')
  }

  // Drop GET-only/identity fields that POST /v0/evi/configs does not accept,
  // plus every field we reconstruct explicitly below (voice, language_model,
  // tools, builtin_tools, event_messages, timeouts, turn_detection,
  // interruption, nudges) so the inherited spread can never silently
  // reintroduce their incompatible GET shapes or stray GET-only keys (e.g.
  // event_messages.on_resume_chat).
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
    event_messages: _baseEventMessages,
    timeouts: _baseTimeouts,
    turn_detection: _baseTurnDetection,
    interruption: _baseInterruption,
    nudges: _baseNudges,
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
    // Dynamically reconstructed from the base config's actual tools (captured
    // in baseConfig before destructuring above) rather than a hardcoded list
    // of two specific ids — see module doc comment. This ensures every custom
    // tool on the base config (including any added later, e.g. a third tool
    // such as `defer_question`) is automatically carried into every native
    // clone. Falls back to the previous hardcoded two-tool list only if the
    // base config's field is ever missing/malformed.
    tools: Array.isArray(baseConfig.tools)
      ? (baseConfig.tools as Array<{ id: string; version: number }>).map((tool) => ({
          id: tool.id,
          version: tool.version,
        }))
      : [
          { id: '4f15c0c2-9af1-421c-8040-ad34b6345234', version: 1 }, // advance_tab
          { id: '65a3d139-2f7b-4e26-9fce-caeb7fa78e05', version: 1 }, // show_visual
        ],
    // Dynamically reconstructed from the base config's actual builtin_tools
    // (captured in baseConfig before destructuring below) rather than a
    // hardcoded literal — see module doc comment. Falls back to the single
    // known-required `hang_up` tool only if the base config's field is ever
    // missing/malformed, never producing an empty/undefined tools list.
    builtin_tools: Array.isArray(baseConfig.builtin_tools)
      ? (baseConfig.builtin_tools as Array<{ name: string; fallback_content?: string }>).map(
          (tool) => ({
            name: tool.name,
            ...(tool.fallback_content ? { fallback_content: tool.fallback_content } : {}),
          })
        )
      : [{ name: 'hang_up' }],
    // Reconstructed explicitly — GET's event_messages includes a fourth key,
    // on_resume_chat, that POST's PostedEventMessageSpecs schema does not
    // declare. Only the three POST-valid keys are sent, with the base
    // config's known-good values.
    event_messages: {
      on_new_chat: { enabled: true, text: '' },
      on_inactivity_timeout: { enabled: false, text: null },
      on_max_duration_timeout: { enabled: false, text: null },
    },
    // Reconstructed explicitly as defense-in-depth (field names are
    // identical between GET/POST here, but see module doc comment for why
    // this is still not spread from the GET response).
    timeouts: {
      inactivity: { enabled: true, duration_secs: 120 },
      max_duration: { enabled: false },
    },
    turn_detection: {
      end_of_turn_silence_ms: 800,
      speech_detection_threshold: 0.5,
      prefix_padding_ms: 300,
    },
    interruption: {
      min_interruption_ms: 800,
    },
    nudges: {
      enabled: true,
      interval_secs: 3,
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
