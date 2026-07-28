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
  // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.2) — end_user_name is now required on
  // CreateSessionSchema. This route dispatches for real (app/api/test-harness/dispatch/[topicId]/
  // route.ts proxies straight through to the live POST /api/partner/v1/sessions), so a placeholder
  // like PLACEHOLDER_MEETING_URL would break the call — a fixed, real value is used instead. See
  // TEST_HARNESS_END_USER_NAME in ./payload.ts.
  end_user_name: string
  // B2B-38 (docs/specs/B2B-38-requirement-document.md §6.2) — reseller_id is now mandatory on
  // CreateSessionSchema, validated to exactly equal the account TEST_HARNESS_PARTNER_API_KEY
  // authenticates as. Same "dispatches for real, cannot use a placeholder" reasoning as
  // end_user_name immediately above — see TEST_HARNESS_PARTNER_ACCOUNT_ID in ./payload.ts.
  reseller_id: string
}
