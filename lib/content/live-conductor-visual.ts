/**
 * LIVE-01 — live visual generation for the script-less conductor path.
 *
 * Per Section 11 Resolved Question 5, this deliberately does NOT go through the
 * 22-template system (lib/templates/selector.ts, lib/templates/generator.ts,
 * components/templates/renderers/*.tsx) — those stay fully intact for the old
 * pre-generated path. This is a new, simple, generic shape: headline + up to
 * 3-4 items + a "so what" line, generated live at the moment of tab transition.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LiveConductorContent, LiveConductorTab } from './live-conductor-content'
import type { UserContext } from './session-content-generator'
import { LIVE_CONDUCTOR_VISUAL_MAX_ATTEMPTS } from './live-conductor-prompt'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface LiveConductorVisualData {
  headline: string
  items: string[]     // up to 3-4 items
  so_what: string
}

// ─── AGENDA (tab 1 only) ──────────────────────────────────────────────────────

/**
 * Item 2, 2026-07-04 — Arun's explicit product direction: tab 1 of every live
 * conductor session should show a session AGENDA (the list of tabs/topics to
 * be covered), not per-topic content. Tabs 2+ keep showing real per-lesson
 * content exactly as already built (generateLiveVisual / generateLiveVisualWithTimeout,
 * unchanged).
 *
 * Deliberately NOT routed through generateLiveVisual/Anthropic — the tab titles
 * are static data already known the moment the session starts
 * (content.tabs[].subtopic_title), so this is a pure, synchronous, deterministic
 * transform. No LLM call, no latency risk, nothing to time out or fail.
 *
 * Reuses the existing generic LiveConductorVisualData shape / renderer
 * (LiveConductorVisual.tsx) as-is — headline + up to 4 items + so_what — rather
 * than building a new visual mode, per the feasibility check: the shape already
 * fits an agenda naturally (headline = session framing, items = tab titles).
 */
export function buildAgendaVisual(content: LiveConductorContent): LiveConductorVisualData {
  return {
    headline: "Today's session",
    items: content.tabs.slice(0, 4).map((tab) => tab.subtopic_title),
    so_what: "Let's get started.",
  }
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

/**
 * Generates a simple, generic visual for the given tab's content, framed for
 * the user's role/industry so the same tab content produces a genuinely
 * different visual for different professions (Section 11, Known Constraint 5).
 *
 * Callers (lib/voice/live-conductor-bridge.ts) are expected to race this
 * against LIVE_CONDUCTOR_TRANSITION_BUFFER_MS and fall back to text-only if it
 * doesn't resolve in time — that timeout/race lives at the call site, not here.
 * This function itself still guards against thrown errors and never rejects
 * unhandled; on any failure it returns null so the caller's fallback path is a
 * simple null check.
 */
export async function generateLiveVisual(
  tab: LiveConductorTab,
  userContext: UserContext
): Promise<LiveConductorVisualData | null> {
  const article = tab.article

  if (!anthropic) {
    console.log('[MOCK] live-conductor-visual: returning mock visual for tab', tab.subtopic_slug)
    return {
      headline: tab.subtopic_title.slice(0, 60),
      items: article.sections.key_facts.slice(0, 4).length > 0
        ? article.sections.key_facts.slice(0, 4)
        : [article.sections.overview.slice(0, 80)],
      so_what: article.role_relevance,
    }
  }

  const prompt = `You are generating a simple on-screen visual for a live AI voice coaching session.

USER CONTEXT
Role: ${userContext.role}
Industry: ${userContext.industry}

CURRENT TAB: ${tab.subtopic_title}
Overview: ${article.sections.overview}
Key facts: ${article.sections.key_facts.join(' | ')}
Enterprise implications: ${article.sections.enterprise_implications}
Role relevance: ${article.role_relevance}
Industry angle: ${article.industry_angle}

TASK
Produce a simple visual with exactly:
- headline: max 8 words, the title for this visual
- items: 3-4 short items (max ~12 words each) that would appear on screen — the most important
  points for a ${userContext.role} in ${userContext.industry} to see for this specific tab
- so_what: max 30 words, personalised insight starting with "As a ${userContext.role},"

Frame this for the specific role/industry above — the same tab content should look meaningfully
different for a different profession, not generic.

Return ONLY valid JSON, no markdown, no commentary:
{
  "headline": "...",
  "items": ["...", "...", "..."],
  "so_what": "..."
}`

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })
    let raw = (message.content[0] as { type: string; text: string }).text.trim()
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(raw) as { headline?: string; items?: string[]; so_what?: string }

    const headline = parsed.headline?.trim() || tab.subtopic_title.slice(0, 60)
    const items = Array.isArray(parsed.items) && parsed.items.length > 0
      ? parsed.items.slice(0, 4)
      : article.sections.key_facts.slice(0, 4)
    const soWhat = parsed.so_what?.trim() || article.role_relevance

    return { headline, items, so_what: soWhat }
  } catch (err) {
    console.error('[live-conductor-visual] generateLiveVisual failed for tab', tab.subtopic_slug, ':', err)
    return null
  }
}

/**
 * 2026-07-04 — Arun's explicit instruction: replace the previous single hard
 * 10s timeout with a retry loop. Each attempt races generateLiveVisual against
 * `timeoutMs` (per-attempt budget, not a total budget); if an attempt doesn't
 * resolve in time, it is abandoned and a fresh attempt is started, up to
 * `maxAttempts` total. The first attempt to succeed returns immediately — we
 * do not wait for all attempts once one has produced a result. If every
 * attempt fails or times out, this resolves to null, same as before (the
 * caller's fallback path is unchanged: null → "text-only for this tab",
 * Section 11, Resolved Q6). No visual shown, Clio keeps talking normally, no
 * fallback to the old template pipeline.
 *
 * Worst case latency is now maxAttempts * timeoutMs (e.g. 10 * 4s = ~40s)
 * rather than the previous fixed 10s. Arun is explicitly fine with this longer
 * worst case in exchange for a much higher chance of a real visual landing.
 *
 * Note: with a worst case around 40s, Clio's natural transition/segue speech
 * (the mechanism the prompt in live-conductor-prompt.ts relies on to "cover"
 * generation latency) will not literally cover the entire window on a
 * multi-retry run — flagging this per Arun's request, not silently treating it
 * as a non-issue. Per Arun's explicit approval this is acceptable as-is; no
 * prompt changes were made here since that is out of scope for this change.
 */
export async function generateLiveVisualWithTimeout(
  tab: LiveConductorTab,
  userContext: UserContext,
  timeoutMs: number,
  maxAttempts: number = LIVE_CONDUCTOR_VISUAL_MAX_ATTEMPTS
): Promise<LiveConductorVisualData | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await Promise.race([
        generateLiveVisual(tab, userContext),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ])
      if (result) {
        return result
      }
      console.log(
        `[live-conductor-visual] attempt ${attempt}/${maxAttempts} timed out or returned null for tab`,
        tab.subtopic_slug
      )
    } catch (err) {
      // Defensive: generateLiveVisual already catches internally and returns null,
      // but guard the race itself too so an unhandled rejection can never surface.
      console.error(
        `[live-conductor-visual] attempt ${attempt}/${maxAttempts} unexpected error for tab`,
        tab.subtopic_slug,
        ':',
        err
      )
    }
  }

  console.error(
    `[live-conductor-visual] all ${maxAttempts} attempts failed for tab`,
    tab.subtopic_slug,
    '— falling back to null (text-only)'
  )
  return null
}
