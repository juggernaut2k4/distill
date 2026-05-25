/**
 * One-off script: re-seeds the 5 domains that failed due to max_tokens truncation.
 * Run with: npx tsx scripts/reseed-failed-domains.ts
 * Reads credentials from .env.production.pulled
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// Credentials passed via environment variables (set by the calling shell)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required env vars')
  console.error('ANTHROPIC_API_KEY:', !!ANTHROPIC_API_KEY, '| SUPABASE_URL:', !!SUPABASE_URL, '| SERVICE_KEY:', !!SUPABASE_SERVICE_KEY)
  process.exit(1)
}

// ─── The 5 failed domains (from taxonomy) ─────────────────────────────────────

const DOMAINS_TO_SEED = [
  { id: 'python',           label: 'Python for Data & Engineering',      description: 'Pandas, NumPy, async Python, packaging, performance',       tags: ['python', 'pandas', 'numpy', 'scipy', 'jupyter', 'async'] },
  { id: 'product-strategy', label: 'Product Strategy & Roadmapping',     description: 'Vision, OKRs, prioritisation frameworks, opportunity sizing', tags: ['product strategy', 'roadmap', 'okr', 'prioritisation', 'vision'] },
  { id: 'agile',            label: 'Agile & Scrum',                      description: 'Sprint planning, retrospectives, Kanban, scaled agile',     tags: ['agile', 'scrum', 'kanban', 'sprint', 'retrospective', 'safe'] },
  { id: 'user-research',    label: 'User Research & UX',                 description: 'Interviews, usability testing, personas, jobs-to-be-done',  tags: ['ux', 'user research', 'usability', 'personas', 'jtbd', 'design thinking'] },
  { id: 'growth',           label: 'Growth & Monetisation',              description: 'PLG, activation, retention, monetisation loops, pricing',   tags: ['growth', 'plg', 'product-led growth', 'retention', 'monetisation', 'pricing'] },
]

// Pre-computed relevant roles per domain (from taxonomy)
const DOMAIN_ROLES: Record<string, string[]> = {
  'python':           ['cto', 'developer', 'data-scientist', 'data-analyst'],
  'product-strategy': ['ceo', 'coo', 'product-manager', 'director', 'cto', 'marketing'],
  'agile':            ['coo', 'product-manager', 'developer', 'director', 'data-analyst'],
  'user-research':    ['product-manager', 'designer', 'marketing', 'developer', 'coo'],
  'growth':           ['ceo', 'coo', 'product-manager', 'marketing', 'director'],
}

// ─── Claude generation ────────────────────────────────────────────────────────

interface GeneratedTopic {
  title: string
  description: string
  maturity: string[]
  tags: string[]
}

async function generateTopics(
  anthropic: Anthropic,
  domain: typeof DOMAINS_TO_SEED[0]
): Promise<GeneratedTopic[]> {
  const prompt = `Domain: ${domain.label}
Domain description: ${domain.description}
Related keywords: ${domain.tags.join(', ')}

Generate exactly 7 practical learning topics for professionals in this domain.

Requirements:
- Each topic title: 4–8 words, specific and outcome-focused
- Each description: one sentence, 12–18 words, states the concrete skill gained
- Maturity: which proficiency levels apply? Choose from: beginner, intermediate, advanced, expert
- Cover a range: include 1–2 beginner topics, 2–3 intermediate, 1–2 advanced/expert
- Tags: 3–5 lowercase searchable keywords specific to this topic
- Topics must be practical and job-applicable, not academic theory

IMPORTANT: One of the 7 topics must be a "Tools & Platforms" comparison topic that:
- Compares 3–4 leading real tools or platforms in this domain
- Uses "vs" in the title (e.g. "Tool A vs Tool B vs Tool C — When to Use Each")
- Covers key differentiators, pricing model, and best-fit scenarios
- Is appropriate for a business professional evaluating or buying tools, not a developer installing them

Return ONLY valid JSON with no extra text:
{"topics":[{"title":"...","description":"...","maturity":["beginner","intermediate"],"tags":["tag1","tag2"]},...]}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const data = JSON.parse(clean) as { topics?: GeneratedTopic[] }

  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    throw new Error(`Empty topics for ${domain.id}`)
  }
  return data.topics.filter((t) => typeof t.title === 'string' && t.title.trim())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Clear existing topics for these 5 domains first
  const { error: deleteError } = await supabase
    .from('topic_catalog')
    .delete()
    .in('domain_id', DOMAINS_TO_SEED.map((d) => d.id))
    .eq('is_custom', false)

  if (deleteError) {
    console.error('Failed to clear existing topics:', deleteError)
    process.exit(1)
  }
  console.log('Cleared existing topics for 5 domains')

  let totalInserted = 0

  for (const domain of DOMAINS_TO_SEED) {
    process.stdout.write(`Generating topics for ${domain.id}... `)
    try {
      const topics = await generateTopics(anthropic, domain)
      const rows = topics.map((t) => ({
        title: t.title,
        description: t.description,
        domain_id: domain.id,
        relevant_roles: DOMAIN_ROLES[domain.id] ?? [],
        relevant_maturity: Array.isArray(t.maturity) ? t.maturity : ['intermediate'],
        tags: Array.isArray(t.tags) ? t.tags : [],
        is_custom: false,
      }))

      const { error } = await supabase.from('topic_catalog').insert(rows)
      if (error) {
        console.log(`FAILED: ${error.message}`)
      } else {
        console.log(`OK (${rows.length} topics)`)
        totalInserted += rows.length
      }
    } catch (err) {
      console.log(`FAILED: ${String(err)}`)
    }
  }

  console.log(`\nDone. Inserted ${totalInserted} topics across ${DOMAINS_TO_SEED.length} domains.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
