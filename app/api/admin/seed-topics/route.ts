import { NextRequest, NextResponse } from 'next/server'
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
  domain: { id: string; label: string; description: string; tags: string[] }
): Promise<GeneratedTopic[]> {
  const prompt = `Domain: ${domain.label}
Domain description: ${domain.description}
Related keywords: ${domain.tags.join(', ')}

Generate exactly 6 practical learning topics for professionals in this domain.

Requirements:
- Each topic title: 4–8 words, specific and outcome-focused
- Each description: one sentence, 12–18 words, states the concrete skill gained
- Maturity: which proficiency levels apply? Choose from: beginner, intermediate, advanced, expert
  (beginner = first steps, intermediate = building skill, advanced = deep mastery, expert = frontier/strategic)
- Cover a range: include 1–2 beginner topics, 2–3 intermediate, 1–2 advanced/expert
- Tags: 3–5 lowercase searchable keywords specific to this topic
- Topics must be practical and job-applicable, not academic theory

Return ONLY valid JSON with no extra text:
{"topics":[{"title":"...","description":"...","maturity":["beginner","intermediate"],"tags":["tag1","tag2"]},...]}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
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
      const topics = await generateTopicsForDomain(anthropic, domain)
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
  const secret = process.env.ADMIN_SECRET ?? process.env.ELEVENLABS_CUSTOM_LLM_SECRET
  const provided = request.headers.get('x-admin-secret')
  if (secret && provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({})) as { replace?: boolean }

  const supabase = createSupabaseAdminClient()
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  if (body.replace) {
    await supabase.from('topic_catalog').delete().eq('is_custom', false)
    console.log('[seed-topics] Cleared existing non-custom topics')
  }

  const BATCH_SIZE = 5
  const results: Array<{ domainId: string; inserted: number; error?: string }> = []

  for (let i = 0; i < ALL_DOMAINS.length; i += BATCH_SIZE) {
    const batch = ALL_DOMAINS.slice(i, i + BATCH_SIZE)
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
