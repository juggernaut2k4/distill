import { NextRequest, NextResponse } from 'next/server'
import { assembleTestHarnessPayload, PLACEHOLDER_MEETING_URL, TestHarnessTopicNotFoundError } from '@/lib/test-harness/payload'
import { getScreensForTopic } from '@/lib/test-harness/data'

/**
 * GET /api/test-harness/payload/[topicId]
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen C, §6.4, AT-9). Blocks on zero
 * screens (AT-9 — never attempts content-source registration for an incomplete payload). Assembles
 * the preview payload with the `REPLACE_WITH_MEETING_URL` placeholder — Screen C substitutes the
 * live "Meeting URL" input value client-side from this same in-memory payload state (no re-fetch
 * per keystroke).
 */
export async function GET(request: NextRequest, { params }: { params: { topicId: string } }) {
  const screens = await getScreensForTopic(params.topicId)
  if (screens.length === 0) {
    return NextResponse.json({ error: { code: 'no_screens', message: 'Add at least one screen before reviewing a payload.' } }, { status: 422 })
  }

  try {
    const payload = await assembleTestHarnessPayload(params.topicId, PLACEHOLDER_MEETING_URL)
    return NextResponse.json({ payload })
  } catch (err) {
    if (err instanceof TestHarnessTopicNotFoundError) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Topic not found.' } }, { status: 404 })
    }
    console.error('[test-harness/payload/:id] assembly failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'internal_error', message: "Couldn't prepare the payload. Try again." } }, { status: 500 })
  }
}
