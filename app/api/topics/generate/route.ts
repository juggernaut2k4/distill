import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
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

  // Inject context-aware extras based on keywords
  if (lower.includes('customer') || lower.includes('cx')) {
    base.push('AI for Customer Experience & Personalisation')
  }
  if (lower.includes('finance') || lower.includes('forecast') || lower.includes('roi')) {
    base.push('AI in Finance & Forecasting')
  }
  if (lower.includes('team') || lower.includes('people') || lower.includes('hr')) {
    base.push('Upskilling Teams for the AI Era')
  }
  if (lower.includes('product') || lower.includes('develop')) {
    base.push('AI in Product Development')
  }
  if (lower.includes('security') || lower.includes('privacy') || lower.includes('compliance')) {
    base.push('AI Security, Privacy & Compliance')
  }
  if (lower.includes('sales') || lower.includes('marketing') || lower.includes('revenue')) {
    base.push('AI for Sales & Revenue Growth')
  }

  return base.slice(0, 14)
}

/**
 * POST /api/topics/generate
 * Uses Claude to generate a personalised topic list from user objectives.
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

  if (isPlaceholder) {
    console.log('[MOCK] generate topics for user', userId, '| objectives:', objectives.slice(0, 80))
    await new Promise((r) => setTimeout(r, 1200)) // simulate latency
    return NextResponse.json({ topics: mockTopics(objectives) })
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `My learning objectives: ${objectives}` }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''

    // Strip markdown code fences if present
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const data = JSON.parse(clean) as { topics?: unknown }

    if (Array.isArray(data.topics) && data.topics.length > 0) {
      const topics = (data.topics as unknown[])
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .slice(0, 14)
      return NextResponse.json({ topics })
    }
  } catch (err) {
    console.error('[topics/generate] Claude error:', err)
  }

  return NextResponse.json(
    { error: 'Could not generate topics. Please try again or enter topics manually.' },
    { status: 500 }
  )
}
