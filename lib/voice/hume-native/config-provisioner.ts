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

export interface ProvisionNativeConfigParams {
  sessionId: string
  assembledPrompt: string
}

export interface ProvisionNativeConfigResult {
  configId: string
}

/**
 * Tool definitions attached to the Config — same wire-protocol tool_call /
 * tool_response pattern already implemented in hume-adapter.ts for CLM mode
 * today. No new tool schema; this is the identical show_visual / advance_tab /
 * end_session set, just declared here for native-mode Config provisioning.
 */
function buildToolDefinitions() {
  return [
    {
      type: 'function',
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
      type: 'function',
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
      type: 'function',
      name: 'end_session',
      description: 'End the coaching session gracefully after the final section has been summarized.',
      parameters: JSON.stringify({ type: 'object', properties: {} }),
    },
  ]
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

  const body = {
    evi_version: '3',
    name: `hume-native-session-${sessionId}`,
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
    tools: buildToolDefinitions(),
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
