/**
 * B2B-49 — shared client-side error reporting sink.
 *
 * Extracted from `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`
 * (originally added 2026-07-27, local to that file) so `lib/voice/hume-adapter.ts` can also
 * report its own previously-silent failure paths (`ws.onerror` / `ws.onclose`) to the same
 * Vercel-log-visible sink (`/api/partner/render/client-error`), without `HumeAdapter` importing
 * from a page-level client component. Logic is unchanged from the original — this is a pure
 * relocation plus an export, not a rewrite.
 *
 * Fire-and-forget: never throws, never awaited by callers, must never affect the caller's own
 * control flow or timing.
 *
 * `source` must match `ClientErrorSchema`'s `source` enum in
 * `app/api/partner/render/client-error/route.ts` exactly — the two must be widened together.
 * This codebase has hit "forgot to widen the enum" as a real bug before (B2B-44 Fix 2): a source
 * value shipped here without also being added to that Zod schema sits silently rejected
 * (`.safeParse()` fails, route returns `{ ok: false }` before `console.error` is ever reached).
 */
export type ClientErrorSource =
  | 'error'
  | 'unhandledrejection'
  | 'error-boundary'
  | 'react-error-boundary'
  // B2B-49 — HumeAdapter's own ws.onerror / ws.onclose failure paths (real WS close code/reason).
  | 'hume-adapter-error'
  // B2B-49 — PartnerRenderClient's connect() outer catch (getUserMedia / token fetch /
  // HumeAdapter.create() setup failures that aren't already-classified WS errors above).
  | 'hume-connect-error'
  // B2B-61 Part A — OpenAIRealtimeAdapter's own ws.onerror / ws.onclose failure paths, mirroring
  // 'hume-adapter-error' exactly for the alternate voice provider.
  | 'openai-realtime-adapter-error'

export function reportClientError(clioSessionRef: string, source: ClientErrorSource, message: string, stack?: string) {
  try {
    fetch('/api/partner/render/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clio_session_ref: clioSessionRef, source, message, stack }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* best-effort only */
  }
}
