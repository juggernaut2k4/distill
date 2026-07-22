/**
 * B2B-32 — pure types + constants shared between the server-only payload-assembly module
 * (`lib/test-harness/payload.ts`, which transitively imports `lib/supabase.ts` and therefore
 * `next/headers`) and client components (Screen C, `lib/test-harness/postman.ts`). Kept in its own
 * file with zero server-only imports so a 'use client' page can safely import
 * `PLACEHOLDER_MEETING_URL` and the `TestHarnessPayload` type without pulling
 * `next/headers`/Supabase into the client bundle (Next.js RSC boundary — a client component may
 * only import `type` declarations from a server-only module, never a runtime value).
 */

export const PLACEHOLDER_MEETING_URL = 'REPLACE_WITH_MEETING_URL'

export interface TestHarnessContentPage {
  url: string
  media_type: 'html' | 'image'
  title?: string
  transition_trigger: string
}

export interface TestHarnessPayload {
  meeting_url: string
  title?: string
  subtitle?: string
  content_to_explain?: string
  content_source_id: string
  content_pages: TestHarnessContentPage[]
}
