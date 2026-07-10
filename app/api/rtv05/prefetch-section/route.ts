import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateTemplateData, validateTemplateData } from '@/lib/templates/generator'
import type { TemplateName, TemplateSection } from '@/lib/templates/types'

/**
 * RTV-05 — POST /api/rtv05/prefetch-section
 *
 * New, isolated route (requirement doc Section 4.4 / 6.3). Only ever called
 * from WalkthroughClient.tsx's Hume-native tracker-hit block, and only when
 * this session's frozen `rtv05DisplayActiveRef.current` is true (Section
 * 4.3) — a session for which the server-side gate (Section 4.2) already
 * confirmed every non-bookend template is individually approved.
 *
 * Fire-and-forget from the caller's perspective: the caller stores this
 * route's promise in `rtv05StagedContentRef`, keyed by section_index, and
 * only awaits it later, at display time (Section 4.5). This route itself
 * never blocks the tracker-hit handler.
 *
 * Public, userId-keyed, no Clerk session — same convention as
 * /api/walkthrough-state/[userId] and /api/generate-visual (this is called
 * from the Recall.ai headless browser tab, which has no Clerk session).
 *
 * Never returns 5xx for a generation failure — always `{ ok: true | false }`
 * with 200, matching /api/generate-visual's existing "never error the agent
 * tool call" convention (Section 6.3), even though this route isn't itself a
 * tool call — the caller is the same fire-and-forget client code style.
 *
 * #20 compliance: the freshly-generated data is written only into this
 * session's own walkthrough_state row, via the new update_section_data
 * command on /api/walkthrough-state/[userId] (Section 6.3) — never into
 * topic_content_cache, template_library, or any table another session or
 * user could ever read. Each call here is a fresh Anthropic call, every
 * single time this route runs, for this session only.
 */

// RTV-05 Section 4.4 — one attempt, then exactly one retry, then give up.
// Mirrors RTV-04's own Layer-1 "one retry, then fall back" pattern for the
// identical generateTemplateData()/validateTemplateData() surface — the
// closest available precedent, given this phase's substantial pre-fetch lead
// time (the remaining duration of teaching the previous topic).
const RTV05_GENERATION_TIMEOUT_MS = 20_000
const RTV05_GENERATION_MAX_RETRIES = 1

const BOOKEND_TYPES = new Set(['SessionOverview', 'SessionSummary'])

const Body = z.object({
  userId: z.string().min(1),
  sectionIndex: z.number().int().min(0),
})

/**
 * inferRoleLevel — mirrors the identical fallback already inlined in
 * app/api/hume-native/provision-config/route.ts (lines ~215-217), reused
 * verbatim rather than re-derived, per Section 0's grounding note. Not
 * currently passed into generateTemplateData() (see file-level note below on
 * the UserContext shape mismatch) — computed here purely so this route's
 * query/fallback shape stays identical to provision-config's established
 * pattern, for whoever next extends either call site.
 */
function inferRoleLevel(role?: string | null): string {
  if (!role) return 'c-suite'
  const lower = role.toLowerCase()
  if (/developer|engineer|architect|specialist|analyst|scientist/.test(lower)) return 'specialist'
  if (/manager|lead|head/.test(lower)) return 'manager'
  if (/vp|svp|evp|director/.test(lower)) return 'vp-dir'
  return 'c-suite'
}

async function generateWithRetry(
  templateType: TemplateName,
  subtopicTitle: string,
  sessionTitle: string,
  userContext: { role: string; industry: string; maturity: string },
  adjacentTopics: { previous?: string; next?: string }
): Promise<TemplateSection['data']> {
  const attempt = (): Promise<TemplateSection['data']> =>
    Promise.race([
      generateTemplateData(templateType, subtopicTitle, sessionTitle, userContext, adjacentTopics),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('RTV-05 prefetch generation timed out')),
          RTV05_GENERATION_TIMEOUT_MS
        )
      }),
    ])

  let lastErr: unknown
  for (let i = 0; i <= RTV05_GENERATION_MAX_RETRIES; i++) {
    try {
      return await attempt()
    } catch (err) {
      lastErr = err
      console.warn(
        `[rtv05/prefetch-section] Generation attempt ${i + 1}/${RTV05_GENERATION_MAX_RETRIES + 1} failed:`,
        err instanceof Error ? err.message : err
      )
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('RTV-05 prefetch generation failed')
}

export async function POST(request: NextRequest) {
  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await request.json())
  } catch (err) {
    console.error('[rtv05/prefetch-section] Invalid body:', err)
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const { userId, sectionIndex } = body
  const supabase = createSupabaseAdminClient()

  // Section 4.4 step 4 — re-read fresh from the DB. Never trust a
  // client-supplied type/meta for a content decision (this codebase's
  // established convention, per Section 0's grounding note).
  const { data: stateRow, error: stateErr } = await supabase
    .from('walkthrough_state')
    .select('sections')
    .eq('user_id', userId)
    .maybeSingle()

  if (stateErr || !stateRow) {
    console.warn('[rtv05/prefetch-section] No walkthrough_state found for user:', userId, stateErr?.message)
    return NextResponse.json({ ok: false })
  }

  const sections = (stateRow.sections ?? []) as TemplateSection[]

  // Section 4.4 step 1 / 4.4 step 4 — re-confirm in-bounds and non-bookend.
  // Redundant with the client's own check (Section 4.4 step 1), cheap, and
  // closes any theoretical gap if the client-side check were ever bypassed.
  // Bookends (SessionOverview/SessionSummary) are never live-generated
  // (Section 4.6, acceptance test 9) — their data is fixed, deterministic
  // content already correctly populated at plan time.
  if (sectionIndex >= sections.length) {
    console.log('[rtv05/prefetch-section] section_index out of bounds — no-op:', sectionIndex, 'of', sections.length)
    return NextResponse.json({ ok: false })
  }

  const target = sections[sectionIndex]
  if (BOOKEND_TYPES.has(target.type)) {
    console.log('[rtv05/prefetch-section] target is a bookend — no-op (never live-generated):', target.type)
    return NextResponse.json({ ok: false })
  }

  // Builds UserContext by querying users for role, industry, ai_maturity,
  // role_level — identical query shape to provision-config/route.ts's
  // existing self-heal path (lines ~195-196), applying the same
  // inferRoleLevel(role) fallback when role_level is null (lines ~215-217).
  //
  // NOTE (disclosed implementation detail, not a product decision): the
  // live generateTemplateData()/lib/templates/generator.ts UserContext type
  // is `{ role, industry, maturity, domain?, proficiency? }` — it has no
  // roleLevel field (confirmed by reading lib/templates/generator.ts lines
  // 59-65, and by lib/session-plan.ts's own established call site, which
  // passes only `{ role, industry, maturity }`). role_level is queried and
  // inferRoleLevel() is computed here to keep the query shape identical to
  // provision-config's pattern as instructed, but only role/industry/maturity
  // are actually passed into generateTemplateData() — passing roleLevel as
  // well would not type-check against that function's real signature.
  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('role, industry, ai_maturity, role_level')
    .eq('id', userId)
    .maybeSingle()

  if (userErr) {
    console.warn('[rtv05/prefetch-section] Failed to load user context, proceeding with defaults:', userErr.message)
  }

  const roleLevel = userRow?.role_level ?? inferRoleLevel(userRow?.role)
  void roleLevel // computed for parity with provision-config's pattern; not consumed by generateTemplateData's UserContext shape (see note above)

  const userContext = {
    role: userRow?.role ?? 'executive',
    industry: userRow?.industry ?? 'business',
    maturity: userRow?.ai_maturity ?? 'beginner',
  }

  const adjacentTopics = {
    previous: sections[sectionIndex - 1]?.meta.subtopicTitle,
    next: sections[sectionIndex + 1]?.meta.subtopicTitle,
  }

  let generated: TemplateSection['data']
  try {
    generated = await generateWithRetry(
      target.type,
      target.meta.subtopicTitle,
      target.meta.sessionTitle,
      userContext,
      adjacentTopics
    )
  } catch (err) {
    // Section 8 — on failure after retries exhausted: return { ok: false }.
    // Does not write anything — sections[idx].data is left exactly as it
    // already was (the plan-time content). This is the documented, bounded
    // fallback the display step (Section 4.5) relies on.
    console.error('[rtv05/prefetch-section] Generation failed after retries for section', sectionIndex, ':', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false })
  }

  // RTV-04's existing Layer-1 char-budget/floor enforcement — validated
  // before accepting, exactly as plan-time content is (Section 4.4).
  // validateTemplateData() never throws (falls back to mock data
  // internally on an under-floor result it cannot repair), so this call
  // always returns a value to write.
  const validated = await validateTemplateData(target.type, generated, target.meta.subtopicTitle)

  // Section 6.3 — write via the new update_section_data command on
  // /api/walkthrough-state/[userId], the single authoritative write path for
  // this mutation (same route WalkthroughClient.tsx itself calls for
  // scroll_to) — avoids duplicating that route's fetch/splice/write-back
  // logic in two places.
  try {
    const writeRes = await fetch(`${request.nextUrl.origin}/api/walkthrough-state/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'update_section_data',
        section_index: sectionIndex,
        data: validated,
      }),
    })
    if (!writeRes.ok) {
      console.error('[rtv05/prefetch-section] update_section_data write failed with status:', writeRes.status)
      return NextResponse.json({ ok: false })
    }
  } catch (err) {
    // Section 8 — update_section_data write fails (network/DB error): logged
    // non-fatal. sections[idx].data simply remains whatever it was before —
    // the display step's fallback (Section 4.5 step 3) covers this
    // identically to a generation failure.
    console.error('[rtv05/prefetch-section] update_section_data write threw:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false })
  }

  console.log('[rtv05/prefetch-section] Pre-fetch succeeded for section', sectionIndex, '(', target.type, ')')
  return NextResponse.json({ ok: true })
}
