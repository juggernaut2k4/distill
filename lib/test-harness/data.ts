import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-32 — thin read helpers over `test_harness_topics`/`test_harness_screens`, factored out so
 * `lib/test-harness/payload.ts` (used by both the `GET payload` route and the `POST dispatch`
 * route, §6.5) and the topic/screen API routes never drift on row shape.
 */

export interface TestHarnessTopicRow {
  id: string
  title: string | null
  subtitle: string | null
  content_to_explain: string | null
  content_source_id: string | null
  created_at: string
  updated_at: string
}

export type TestHarnessScreenType = 'html' | 'image'

export interface TestHarnessScreenRow {
  id: string
  topic_id: string
  screen_type: TestHarnessScreenType
  position: number
  title: string | null
  transition_trigger: string
  html_content: string | null
  storage_path: string | null
  image_mime_type: string | null
  created_at: string
  updated_at: string
}

export async function getTopic(topicId: string): Promise<TestHarnessTopicRow | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase.from('test_harness_topics').select('*').eq('id', topicId).maybeSingle()
  return (data as TestHarnessTopicRow | null) ?? null
}

export async function getScreensForTopic(topicId: string): Promise<TestHarnessScreenRow[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('test_harness_screens')
    .select('*')
    .eq('topic_id', topicId)
    .order('position', { ascending: true })
  return (data as TestHarnessScreenRow[] | null) ?? []
}

export async function getScreen(screenId: string): Promise<TestHarnessScreenRow | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase.from('test_harness_screens').select('*').eq('id', screenId).maybeSingle()
  return (data as TestHarnessScreenRow | null) ?? null
}

/** Next `position` for a new screen on a topic — 1 if the topic has no screens yet. */
export async function nextScreenPosition(topicId: string): Promise<number> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('test_harness_screens')
    .select('position')
    .eq('topic_id', topicId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const currentMax = (data?.position as number | undefined) ?? 0
  return currentMax + 1
}
