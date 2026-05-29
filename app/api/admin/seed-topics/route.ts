import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { ALL_DOMAINS, ROLES } from '@/lib/learning/taxonomy'

export const maxDuration = 120

// Pre-compute which roles care about each domain (derived from taxonomy, not Claude)
function getRolesForDomain(domainId: string): string[] {
  return ROLES
    .filter((r) =>
      r.primaryDomains.includes(domainId) || r.otherDomains.includes(domainId)
    )
    .map((r) => r.id)
}

interface GeneratedTopic {
  title: string
  description: string
  maturity: string[]
  tags: string[]
}

async function generateTopicsForDomain(
  anthropic: Anthropic,
  domain: { id: string; label: string; description: string; tags: string[] },
  relevantRoles: string[] = []
): Promise<GeneratedTopic[]> {
  const executiveRoles = new Set(['ceo', 'coo', 'cfo', 'chro', 'cmo', 'hr', 'marketing', 'product-manager'])
  const technicalRoles = new Set(['cto', 'developer', 'data-engineer', 'data-scientist', 'ml-engineer', 'designer'])
  const hasExec = relevantRoles.some((r) => executiveRoles.has(r))
  const hasTech = relevantRoles.some((r) => technicalRoles.has(r))
  const audience = hasExec && !hasTech ? 'executive' : hasTech && !hasExec ? 'technical' : 'mixed'

  const audienceNote =
    audience === 'executive'
      ? `AUDIENCE: Senior business executives (CEO, COO, CFO etc). They do NOT write code or build systems.
Frame every topic as strategic intelligence: decisions, vendor evaluation, risk, ROI, governance, team enablement.
GOOD titles: "Evaluating AI Vendors Without Being Fooled", "AI Risk Frameworks Your Board Expects"
BAD titles: "Building Your First LLM App", "Coding Agents with Tool Use", "Fine-Tuning at Scale"
Make titles feel like something a CEO would forward to their EA and say "book this session".`
      : audience === 'technical'
        ? `AUDIENCE: Technical practitioners (engineers, developers, data scientists). Frame topics as hands-on skills they apply directly in their work.`
        : `AUDIENCE: Mixed — include both strategic/decision-maker topics AND hands-on practitioner topics, roughly 50/50.`

  const prompt = `Domain: ${domain.label}
Domain description: ${domain.description}
Related keywords: ${domain.tags.join(', ')}
Relevant roles: ${relevantRoles.join(', ')}

${audienceNote}

Generate exactly 7 practical learning topics for this domain.

Requirements:
- Each topic title: 4–9 words, specific and outcome-focused
- Each description: one sentence, 12–18 words, states the concrete skill or decision gained
- Maturity: which levels apply? Choose from: beginner, intermediate, advanced, expert
- Cover a range: 1–2 beginner, 2–3 intermediate, 1–2 advanced/expert
- Tags: 3–5 lowercase searchable keywords
- Topics must be immediately applicable to real work

IMPORTANT: One of the 7 must be a "Tools & Platforms" comparison topic:
- Compares 3–4 real tools/platforms in this domain (e.g. "Claude vs GPT-4o vs Gemini — Which AI for Your Team")
- Uses "vs" in the title
- Covers differentiators, pricing, best-fit scenarios
- Framed for someone evaluating options, not installing them

Return ONLY valid JSON with no extra text:
{"topics":[{"title":"...","description":"...","maturity":["beginner","intermediate"],"tags":["tag1","tag2"]},...]}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const data = JSON.parse(clean) as { topics?: unknown }

  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    throw new Error(`Empty topics for domain ${domain.id}`)
  }

  return (data.topics as GeneratedTopic[]).filter(
    (t) => typeof t.title === 'string' && t.title.trim().length > 0
  )
}

async function runBatch(
  anthropic: Anthropic,
  batch: typeof ALL_DOMAINS
): Promise<Array<{ domainId: string; topics: GeneratedTopic[] }>> {
  return Promise.all(
    batch.map(async (domain) => {
      const roles = getRolesForDomain(domain.id)
      const topics = await generateTopicsForDomain(anthropic, domain, roles)
      return { domainId: domain.id, topics }
    })
  )
}

/**
 * POST /api/admin/seed-topics
 * Seeds the topic_catalog table with 6 topics per domain (57 domains × 6 ≈ 342 rows).
 * Protected by x-admin-secret header.
 * Pass body { replace: true } to clear existing non-custom topics first.
 */
export async function POST(request: NextRequest) {
  // Accept either Clerk session auth OR the ElevenLabs shared secret header
  // (the latter allows server-to-server calls without a browser session)
  const { userId } = auth()
  const secret = process.env.ELEVENLABS_CUSTOM_LLM_SECRET
  const providedSecret = request.headers.get('x-admin-secret')
  const secretOk = secret && providedSecret === secret

  if (!userId && !secretOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as {
    replace?: boolean
    domains?: string[]  // optional: seed only these domain IDs (for re-running failures)
  }

  const supabase = createSupabaseAdminClient()
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const domainsToSeed = body.domains && body.domains.length > 0
    ? ALL_DOMAINS.filter((d) => body.domains!.includes(d.id))
    : ALL_DOMAINS

  if (body.replace) {
    if (body.domains && body.domains.length > 0) {
      // Clear only the specified domains
      await supabase.from('topic_catalog')
        .delete()
        .eq('is_custom', false)
        .in('domain_id', body.domains)
      console.log('[seed-topics] Cleared topics for domains:', body.domains)
    } else {
      await supabase.from('topic_catalog').delete().eq('is_custom', false)
      console.log('[seed-topics] Cleared all non-custom topics')
    }
  }

  const BATCH_SIZE = 5
  const results: Array<{ domainId: string; inserted: number; error?: string }> = []

  for (let i = 0; i < domainsToSeed.length; i += BATCH_SIZE) {
    const batch = domainsToSeed.slice(i, i + BATCH_SIZE)
    console.log(`[seed-topics] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(ALL_DOMAINS.length / BATCH_SIZE)}: ${batch.map((d) => d.id).join(', ')}`)

    let batchResults: Array<{ domainId: string; topics: GeneratedTopic[] }>
    try {
      batchResults = await runBatch(anthropic, batch)
    } catch (err) {
      console.error('[seed-topics] Batch failed:', err)
      for (const d of batch) results.push({ domainId: d.id, inserted: 0, error: String(err) })
      continue
    }

    for (const { domainId, topics } of batchResults) {
      const relevantRoles = getRolesForDomain(domainId)

      const rows = topics.map((t) => ({
        title: t.title,
        description: t.description,
        domain_id: domainId,
        relevant_roles: relevantRoles,
        relevant_maturity: Array.isArray(t.maturity) ? t.maturity : ['intermediate'],
        tags: Array.isArray(t.tags) ? t.tags : [],
        is_custom: false,
      }))

      const { error } = await supabase.from('topic_catalog').insert(rows)
      if (error) {
        console.error(`[seed-topics] Insert failed for domain ${domainId}:`, error)
        results.push({ domainId, inserted: 0, error: error.message })
      } else {
        results.push({ domainId, inserted: rows.length })
      }
    }
  }

  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0)
  const failed = results.filter((r) => r.error)

  console.log(`[seed-topics] Done. Inserted ${totalInserted} topics across ${results.length} domains. ${failed.length} domain(s) failed.`)

  return NextResponse.json({
    inserted: totalInserted,
    domains: results.length,
    failed: failed.length,
    details: results,
  })
}
