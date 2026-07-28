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

// B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.2) — end_user_name is now required on
// every CreateSessionSchema request. The test harness has no real end-user identity to supply, so
// a fixed, descriptive value is used — this call dispatches for real (see payload-types.ts), so a
// PLACEHOLDER_-style value cannot be used here the way it can for meeting_url.
export const TEST_HARNESS_END_USER_NAME = 'Content QA'

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

  // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.2) — reseller_id is now mandatory on every
  // CreateSessionSchema request, validated server-side to exactly equal the account resolved from
  // the caller's API key. This route dispatches for real using TEST_HARNESS_PARTNER_API_KEY
  // (app/api/test-harness/dispatch/[topicId]/route.ts) — so reseller_id must be that same key's own
  // account id, sourced from a dedicated env var (mirrors DEMO_PARTNER_ACCOUNT_ID's role for the
  // demo dispatch flow, app/api/demo/[slug]/dispatch/route.ts) rather than a hardcoded literal.
  // Read at call time (same as appUrl immediately above), not module load time, so it reflects the
  // env at request time. If unset, the field is empty and CreateSessionSchema's own required-field/
  // uuid validation fails closed — matching this codebase's existing "no infra value → fail closed,
  // never guess" convention (see performance/route.ts's DEMO_PARTNER_ACCOUNT_ID handling).
  const resellerId = process.env.TEST_HARNESS_PARTNER_ACCOUNT_ID ?? ''

  return {
    meeting_url: meetingUrl,
    title: topic.title ?? undefined,
    subtitle: topic.subtitle ?? undefined,
    content_to_explain: topic.content_to_explain ?? undefined,
    content_source_id: contentSourceId,
    end_user_name: TEST_HARNESS_END_USER_NAME,
    reseller_id: resellerId,
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
