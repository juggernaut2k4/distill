/**
 * TMPL-01 — generateStyleFix() (requirement doc Section 4.1 / 6).
 *
 * Proposes a runtime style-override fix for one Heatmap/Overlay template row,
 * scoped by construction to that template's fixed slot allowlist. Reuses the
 * exact @anthropic-ai/sdk client/mock-guard pattern already established in
 * lib/templates/generator.ts (module-level `isPlaceholder` check, same MODEL
 * constant, `console.log('[MOCK ...]')` fallback when the API key is a
 * placeholder) — not a new AI integration pattern.
 *
 * This module has NO file-system access, NO git/deploy tooling, and never
 * writes to the database itself — it only returns a proposed JSON object (or
 * an explicit "cannot address this" / "malformed" signal) for its caller (the
 * Inngest fix-loop function) to validate via validateStyleOverrides() and
 * persist. That structural fact is what makes this feature safe by
 * construction (Section 0/4.1), independent of anything this module does.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  APPROVED_COLOR_TOKENS,
  describeSlotAllowlist,
  STYLE_OVERRIDE_SLOTS,
  type FixLoopTemplateName,
  type StyleOverrides,
} from './styleOverrideSlots'

// ─── CLIENT ───────────────────────────────────────────────────────────────────
// Identical mock-guard pattern to lib/templates/generator.ts — do not diverge.

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'

// ─── TYPES ────────────────────────────────────────────────────────────────────

/**
 * One prior rejected attempt in the current fix cycle, fed back to the model
 * so each retry can genuinely self-diagnose rather than blindly repeating the
 * same mistake (Section 4.2: "What each retry sees").
 */
export interface PriorFixAttempt {
  /** The raw object the model proposed last time, or null if it was malformed JSON / unparsable. */
  proposedOverrides: Record<string, unknown> | null
  /** Why it was rejected: unknown key, out-of-range/non-approved value, malformed JSON, or the model's own "unable to address" report. */
  rejectionReason: string
}

export type StyleFixOutcome =
  | { kind: 'proposed'; overrides: Record<string, unknown>; summary: string }
  | { kind: 'out_of_scope'; reason: string }
  | { kind: 'malformed'; raw: string }

// ─── MOCK ─────────────────────────────────────────────────────────────────────

/**
 * Realistic, always-schema-valid mock fix used when ANTHROPIC_API_KEY is a
 * placeholder — mirrors generator.ts's getMockData() convention. Deliberately
 * proposes values that pass validateStyleOverrides() so the mock loop
 * converges on the first attempt rather than exercising the retry path.
 */
function getMockFix(templateName: FixLoopTemplateName): StyleFixOutcome {
  if (templateName === 'Heatmap') {
    return {
      kind: 'proposed',
      overrides: {
        'cell-gap': 6,
        'intensity-2': APPROVED_COLOR_TOKENS[2], // #06B6D4
      },
      summary: 'Increased spacing between cells for more breathing room and reinforced the mid-intensity color for clearer contrast.',
    }
  }
  return {
    kind: 'proposed',
    overrides: {
      'callout-width': 240,
      'zone-color-purple': APPROVED_COLOR_TOKENS[0], // #7C3AED
    },
    summary: 'Widened the callout cards slightly for better readability and reaffirmed the purple zone marker color.',
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

/**
 * Proposes a style-override fix for `templateName` based on Arun's free-text
 * feedback, the template's current sample_data and currently-applied
 * style_overrides (for incremental refinement — Section 9 edge case), and the
 * history of this cycle's prior rejected attempts (if any).
 *
 * Returns one of three outcomes (Section 4.1/8):
 *   - 'proposed'    — a candidate override object + a human-readable summary
 *                      of what changed. NOT yet validated — the caller must
 *                      run validateStyleOverrides() before ever persisting or
 *                      showing this to Arun.
 *   - 'out_of_scope' — the model itself reports the feedback implies a
 *                      layout/content change, not a styling change, and isn't
 *                      expressible through this template's approved slots.
 *                      This is an immediate terminal case — the caller should
 *                      not retry.
 *   - 'malformed'    — the model's response wasn't valid JSON. Treated like any
 *                      other failed attempt by the caller (logged, retried,
 *                      counts toward the attempt cap).
 *
 * Never throws for expected LLM-output problems (malformed JSON). It MAY
 * throw for a genuine Anthropic API/network failure — the caller is
 * responsible for catching that and treating it as a failed attempt
 * (Section 8), exactly like generator.ts's own callers do.
 */
export async function generateStyleFix(
  templateName: FixLoopTemplateName,
  sampleData: unknown,
  currentOverrides: StyleOverrides,
  feedbackText: string,
  priorAttempts: PriorFixAttempt[] = []
): Promise<StyleFixOutcome> {
  if (isPlaceholder || !anthropic) {
    console.log('[MOCK STYLE-FIX]', templateName, '— feedback:', feedbackText)
    return getMockFix(templateName)
  }

  const slotAllowlist = describeSlotAllowlist(templateName)

  const historyBlock =
    priorAttempts.length > 0
      ? `\n\nPRIOR ATTEMPTS IN THIS CYCLE (each was rejected — do not repeat the same mistake):\n${priorAttempts
          .map(
            (a, i) =>
              `Attempt ${i + 1}: proposed ${a.proposedOverrides ? JSON.stringify(a.proposedOverrides) : '(unparsable output)'}\n  Rejected because: ${a.rejectionReason}`
          )
          .join('\n')}`
      : ''

  const systemPrompt = `You are a precise visual-styling assistant for the "${templateName}" template in Clio, an AI coaching platform for senior executives.

You NEVER edit code, layout, content, or copy. You may ONLY propose new values for a fixed, pre-declared set of style "slots" listed below. This is a closed-set styling task, not a general content-editing task.

ALLOWED STYLE SLOTS FOR ${templateName} (the only keys you may ever return):
${slotAllowlist}

Rules:
1. Read the reviewer's feedback and decide whether it can be addressed ENTIRELY by changing one or more of the allowed slots above.
2. If yes: return ONLY valid JSON of the exact shape { "overrides": { "<slot>": <value>, ... }, "summary": "<one sentence, in plain English, describing what you changed and why>" }. Only include slots you are actually changing — omit anything unchanged. Color values must be copied verbatim from the approved list above; never invent a hex value. Integer values must be a whole number within the stated range.
3. If the feedback requires something outside this closed set — a layout change, a new element, a content/copy change, adding or removing zones/cells, or anything not listed as an allowed slot — return ONLY valid JSON of the shape { "out_of_scope": true, "reason": "<one sentence explaining, in plain English, why this can't be expressed as a style override>" }. Do not attempt a partial or approximate fix in this case.
4. Return ONLY the JSON object. No markdown, no code fences, no explanation outside the JSON.`

  const userPrompt = `Current sample data for this template:
${JSON.stringify(sampleData, null, 2)}

Currently-applied style overrides (may be empty — this is a fresh cycle, or refine further on top of these):
${JSON.stringify(currentOverrides, null, 2)}

Reviewer's feedback:
"${feedbackText}"${historyBlock}

Propose a fix (or report out-of-scope) per the rules above.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return { kind: 'malformed', raw: rawText }
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'out_of_scope' in parsed &&
    (parsed as { out_of_scope: unknown }).out_of_scope === true
  ) {
    const reason = (parsed as { reason?: unknown }).reason
    return {
      kind: 'out_of_scope',
      reason: typeof reason === 'string' && reason.length > 0
        ? reason
        : 'This feedback implies a layout/content change, not a styling change, and isn\'t expressible through this template\'s approved style slots.',
    }
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'overrides' in parsed &&
    typeof (parsed as { overrides: unknown }).overrides === 'object' &&
    (parsed as { overrides: unknown }).overrides !== null
  ) {
    const summary = (parsed as { summary?: unknown }).summary
    return {
      kind: 'proposed',
      overrides: (parsed as { overrides: Record<string, unknown> }).overrides,
      summary: typeof summary === 'string' && summary.length > 0 ? summary : 'Applied a style adjustment based on the feedback.',
    }
  }

  // Recognizable JSON, but not either expected shape — treat like malformed
  // output rather than guessing at intent.
  return { kind: 'malformed', raw: rawText }
}

export { STYLE_OVERRIDE_SLOTS }
