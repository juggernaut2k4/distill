import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { ALL_DOMAINS } from '@/lib/learning/taxonomy'
import Anthropic from '@anthropic-ai/sdk'

const Body = z.object({
  title: z.string().min(3).max(200),
  role: z.string().optional(),
  domains: z.array(z.string()).optional(),
})

const DOMAIN_IDS = ALL_DOMAINS.map((d) => d.id).join(', ')
const ROLE_IDS = 'ceo, cto, coo, cfo, product-manager, developer, data-scientist, data-analyst, designer, marketing, hr, director'

/**
 * POST /api/topics/catalog/add
 * Saves a user-typed topic to the shared topic_catalog so future users benefit.
 * Claude infers domain, description, maturity, tags, and relevant roles.
 * Silently skips if the title already exists.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const body = Body.safeParse(await request.json().catch(() => ({})))
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { title, role, domains } = body.data
  const supabase = createSupabaseAdminClient()

  // Skip if this title already exists (case-insensitive)
  const { data: existing } = await supabase
    .from('topic_catalog')
    .select('id')
    .ilike('title', title.trim())
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ skipped: true, reason: 'already_exists' })
  }

  // Ask Claude to classify and describe the topic
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `Classify this learning topic for a professional curriculum catalog.

Title: "${title}"
${role ? `User's role: ${role}` : ''}
${domains?.length ? `User's areas of interest: ${domains.join(', ')}` : ''}

Valid domain IDs (pick the single best match): ${DOMAIN_IDS}
Valid role IDs (pick all that apply): ${ROLE_IDS}

Return ONLY valid JSON with no extra text:
{
  "domain_id": "best_matching_domain_id",
  "description": "one sentence 12-18 words stating the concrete skill gained",
  "maturity": ["beginner"|"intermediate"|"advanced"|"expert"],
  "tags": ["tag1", "tag2", "tag3"],
  "relevant_roles": ["role_id1", "role_id2"]
}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const data = JSON.parse(clean) as {
      domain_id?: string
      description?: string
      maturity?: string[]
      tags?: string[]
      relevant_roles?: string[]
    }

    const domainId = ALL_DOMAINS.find((d) => d.id === data.domain_id)
      ? data.domain_id!
      : (domains?.[0] ?? 'ai-ml')

    await supabase.from('topic_catalog').insert({
      title: title.trim(),
      description: data.description ?? '',
      domain_id: domainId,
      relevant_roles: Array.isArray(data.relevant_roles) ? data.relevant_roles : (role ? [role] : []),
      relevant_maturity: Array.isArray(data.maturity) ? data.maturity : ['intermediate'],
      tags: Array.isArray(data.tags) ? data.tags : [],
      is_custom: true,
    })

    console.log(`[topics/catalog/add] Saved custom topic: "${title}" → domain: ${domainId} by user ${userId}`)
    return NextResponse.json({ saved: true, domain_id: domainId })
  } catch (err) {
    // Non-fatal — the topic still works in the session, just isn't persisted to catalog
    console.error('[topics/catalog/add] Failed:', err)
    return NextResponse.json({ saved: false }, { status: 500 })
  }
}
