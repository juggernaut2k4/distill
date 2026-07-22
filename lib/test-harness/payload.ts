import { getTopic, getScreensForTopic } from './data'
import { ensureTestHarnessContentSource } from './content-source'
import type { TestHarnessPayload } from './payload-types'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §6.5, AT-6, AT-13, AT-16).
 *
 * Shared payload-assembly helper — used by BOTH `GET /api/test-harness/payload/[topicId]` (preview)
 * and `POST /api/test-harness/dispatch/[topicId]` (real dispatch), so the two can never drift. This
 * shape is verified against the real `CreateSessionSchema`/`ContentPageSchema`
 * (`lib/partner/session-schema.ts`) field-for-field (AT-6).
 *
 * Server-only (transitively imports `lib/supabase.ts` → `next/headers`). The plain types/constants
 * this module works with live in `./payload-types` instead, which has zero server-only imports —
 * client components (Screen C) import from there, never from this file, to stay on the correct
 * side of the Next.js RSC boundary.
 */

export type { TestHarnessPayload, TestHarnessContentPage } from './payload-types'
export { PLACEHOLDER_MEETING_URL } from './payload-types'

export class TestHarnessTopicNotFoundError extends Error {
  constructor(topicId: string) {
    super(`Test harness topic not found: ${topicId}`)
    this.name = 'TestHarnessTopicNotFoundError'
  }
}

export async function assembleTestHarnessPayload(topicId: string, meetingUrl: string): Promise<TestHarnessPayload> {
  const topic = await getTopic(topicId)
  if (!topic) throw new TestHarnessTopicNotFoundError(topicId)

  const screens = await getScreensForTopic(topicId)
  const contentSourceId = await ensureTestHarnessContentSource(topicId)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  return {
    meeting_url: meetingUrl,
    title: topic.title ?? undefined,
    subtitle: topic.subtitle ?? undefined,
    content_to_explain: topic.content_to_explain ?? undefined,
    content_source_id: contentSourceId,
    content_pages: [...screens]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        url: `${appUrl}/test-harness-render/${s.id}`,
        media_type: s.screen_type,
        title: s.title ?? undefined,
        transition_trigger: s.transition_trigger,
      })),
  }
}
