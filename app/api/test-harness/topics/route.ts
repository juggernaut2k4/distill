import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET/POST /api/test-harness/topics
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen A, §6.4). Gated by Basic Auth at the
 * middleware layer (`middleware.ts`'s `test.hello-clio.com` host branch) — no per-route auth check
 * needed here. GET lists every topic with a computed screen count; POST creates an empty topic row
 * (the title/subtitle/body form lives on Screen B itself, not a separate creation modal).
 */

export async function GET() {
  const supabase = createSupabaseAdminClient()

  const { data: topics, error } = await supabase
    .from('test_harness_topics')
    .select('id, title, updated_at')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[test-harness/topics] list failed:', error.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to load topics.' } }, { status: 500 })
  }

  const topicIds = (topics ?? []).map((t) => t.id as string)
  const countByTopicId = new Map<string, number>()

  if (topicIds.length > 0) {
    const { data: screenRows } = await supabase.from('test_harness_screens').select('topic_id').in('topic_id', topicIds)
    for (const row of screenRows ?? []) {
      const id = row.topic_id as string
      countByTopicId.set(id, (countByTopicId.get(id) ?? 0) + 1)
    }
  }

  return NextResponse.json({
    topics: (topics ?? []).map((t) => ({
      id: t.id as string,
      title: t.title as string | null,
      screenCount: countByTopicId.get(t.id as string) ?? 0,
      updatedAt: t.updated_at as string,
    })),
  })
}

export async function POST() {
  const supabase = createSupabaseAdminClient()

  const { data: inserted, error } = await supabase.from('test_harness_topics').insert({}).select('id').single()

  if (error || !inserted) {
    console.error('[test-harness/topics] create failed:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create topic.' } }, { status: 500 })
  }

  return NextResponse.json({ id: inserted.id as string }, { status: 201 })
}
