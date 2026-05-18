import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const GenerateSchema = z.object({
  objectives: z.string().min(5).max(2000),
})

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_')

const SYSTEM_PROMPT = `You are a curriculum designer for AI education targeted at senior business executives (CEOs, VPs, Directors, Heads of function).

Given the user's learning objectives or interests, generate a focused list of 10–14 AI topics they should cover.

Rules:
- Every topic must be directly relevant to what they described
- Topics should be practical and business-focused, not academic
- Each topic title must be concise: 4–8 words
- Mix strategic, operational, and awareness topics
- Avoid generic filler topics that don't address what they asked

Return ONLY valid JSON in this exact format with no extra text:
{"topics": ["Topic title 1", "Topic title 2", ...]}`

function mockTopics(objectives: string): string[] {
  const lower = objectives.toLowerCase()
  const base = [
    'AI Strategy for Senior Leaders',
    'Understanding Large Language Models',
    'AI ROI Measurement & Business Cases',
    'Evaluating AI Vendors & Solutions',
    'AI Governance & Risk Frameworks',
    'Building an AI-Ready Organisation',
    'Process Automation with AI',
    'AI Ethics & Responsible Deployment',
    'Competitive Intelligence with AI',
    'Data Strategy for AI Initiatives',
  ]

  if (lower.includes('customer') || lower.includes('cx')) base.push('AI for Customer Experience & Personalisation')
  if (lower.includes('finance') || lower.includes('forecast') || lower.includes('roi')) base.push('AI in Finance & Forecasting')
  if (lower.includes('team') || lower.includes('people') || lower.includes('hr')) base.push('Upskilling Teams for the AI Era')
  if (lower.includes('product') || lower.includes('develop')) base.push('AI in Product Development')
  if (lower.includes('security') || lower.includes('privacy') || lower.includes('compliance')) base.push('AI Security, Privacy & Compliance')
  if (lower.includes('sales') || lower.includes('marketing') || lower.includes('revenue')) base.push('AI for Sales & Revenue Growth')

  return base.slice(0, 14)
}

function buildObjectivesFromProfile(profile: {
  role?: string | null
  industry?: string | null
  ai_maturity?: string | null
  worry?: string | null
}): string {
  const parts: string[] = []
  if (profile.role) parts.push(`I am a ${profile.role}`)
  if (profile.industry) parts.push(`working in the ${profile.industry} industry`)
  if (profile.ai_maturity) parts.push(`with ${profile.ai_maturity} experience with AI`)
  if (profile.worry) parts.push(`and my biggest AI concern is: ${profile.worry}`)
  parts.push('I want practical AI knowledge relevant to my executive role.')
  return parts.join(', ')
}

async function generateFromObjectives(objectives: string): Promise<string[]> {
  if (isPlaceholder) {
    await new Promise((r) => setTimeout(r, 800))
    return mockTopics(objectives)
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `My learning objectives: ${objectives}` }],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const data = JSON.parse(clean) as { topics?: unknown }

  if (Array.isArray(data.topics) && data.topics.length > 0) {
    return (data.topics as unknown[])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .slice(0, 14)
  }

  throw new Error('Empty topics response from Claude')
}

/**
 * GET /api/topics/generate
 * Auto-generates topics from the user's onboarding profile.
 * If the user already has saved topics, returns those first.
 */
export async function GET() {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('role, industry, ai_maturity, worry, topic_interests')
    .eq('id', userId!)
    .single()

  // Return existing saved topics if user already went through this
  if (
    user?.topic_interests &&
    Array.isArray(user.topic_interests) &&
    user.topic_interests.length > 0
  ) {
    return NextResponse.json({ topics: user.topic_interests, source: 'saved' })
  }

  const objectives = buildObjectivesFromProfile(user ?? {})

  try {
    const topics = await generateFromObjectives(objectives)
    return NextResponse.json({ topics, source: 'profile' })
  } catch (err) {
    console.error('[topics/generate GET] Failed:', err)
    return NextResponse.json(
      { error: 'Could not generate topics from your profile.' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/topics/generate
 * Generates a personalised topic list from user-provided objectives text.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const body = await request.json() as unknown
  const parsed = GenerateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please describe what you want to learn (at least 5 characters).' },
      { status: 400 }
    )
  }

  const { objectives } = parsed.data
  console.log('[topics/generate POST] user', userId, '| objectives:', objectives.slice(0, 80))

  try {
    const topics = await generateFromObjectives(objectives)
    return NextResponse.json({ topics })
  } catch (err) {
    console.error('[topics/generate POST] Claude error:', err)
    return NextResponse.json(
      { error: 'Could not generate topics. Please try again or enter topics manually.' },
      { status: 500 }
    )
  }
}
