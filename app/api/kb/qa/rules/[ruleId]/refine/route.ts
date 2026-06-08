import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import { refineRuleWithSuggestion } from '@/lib/kb-qa-agent'

interface Params { params: { ruleId: string } }

const Body = z.object({ suggestion: z.string().min(1).max(1000) })

/**
 * POST /api/kb/qa/rules/[ruleId]/refine
 * Sends the original rule + user suggestion to Claude and returns a refined version.
 * The refined text is saved to refined_rule_text but the rule stays "pending"
 * until the user explicitly approves it.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = Body.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: 'suggestion required' }, { status: 400 })
  }

  const { data: rule } = await supabase
    .from('kb_qa_rules')
    .select('rule_text, justification')
    .eq('id', params.ruleId)
    .single()

  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  const refinedText = await refineRuleWithSuggestion(
    rule.rule_text,
    rule.justification,
    body.data.suggestion
  )

  await supabase
    .from('kb_qa_rules')
    .update({
      user_suggestion: body.data.suggestion,
      refined_rule_text: refinedText,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.ruleId)

  return NextResponse.json({ refined_rule_text: refinedText })
}
