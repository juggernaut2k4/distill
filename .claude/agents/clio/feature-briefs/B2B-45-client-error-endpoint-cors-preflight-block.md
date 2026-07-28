# Feature Brief: B2B-45 — client-error diagnostic endpoint blocked by missing CORS headers

From: CEO (Arun)
To: Orchestrator (pure technical fix — missing CORS header on an already-unauthenticated diagnostic
endpoint; no BA gate required, same scoping precedent as B2B-43/B2B-44)
Priority: P0
Date: 2026-07-28

## What Arun Said

Minutes after B2B-44 (transcript fix, crash-capture schema fix, glitch persistence, duplicate-dispatch
guard) shipped and was live-tested: "I am still getting the application error in the screen sharing.
check now."

## What Arun's own standing instruction requires

"ask for evidence of confirmation if its working" — carried over from this morning's B2B-44 brief.
This fix specifically needs a deliberately-reproduced crash to actually land a row in
`glitch_instances`, not just a clean build.

## Independent verification performed (not taken on the Orchestrator's word)

I re-verified every claim myself against live code and live production data before writing this brief.

**1. Route has no CORS handling — confirmed by direct read.**
`app/api/partner/render/client-error/route.ts` exports only `POST`. No `OPTIONS` export, no
`Access-Control-Allow-Origin` header anywhere in the file, on either the success path or the
early-return-on-invalid-body path (`{ok:false}` at status 200). Next.js App Router auto-generates a
bare `OPTIONS` 204 for routes with no explicit `OPTIONS` export, but that default carries no CORS
headers.

**2. Iframe origin is genuinely opaque — confirmed by direct read.**
`app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` line 424: `sandbox="allow-scripts"`,
without `allow-same-origin`, confirmed deliberate (per AT-SSRF-3, cited in `lib/partner/live-render.ts`
line 34: "a real reseller's page must never read Clio's session data"). An opaque-origin `fetch()`
sends `Origin: null`.

**3. This is not a new bug — it's already documented in the code, from a prior investigation.**
`lib/partner/live-render.ts` lines 28–66 (predating this brief) already record two prior live
occurrences (2026-07-27) where the diagnostic shim's `window.onerror`/`unhandledrejection` handlers
produced zero reports, and B2B-43 Fix 4b's MutationObserver/error-boundary detection was added on top.
Neither prior mitigation considered that the shim's `fetch()` call itself — POSTing
`application/json`, a non-"simple" content-type — triggers a CORS preflight from an opaque origin, and
that the target route never answers that preflight with permissive headers. This is the layer
underneath both prior fixes, not a regression they introduced.

**4. Mechanism reasoned through independently, not accepted on faith.**
A `POST` with `Content-Type: application/json` is not a CORS-simple request (simple content-types are
limited to `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`), so the browser
preflights with `OPTIONS`, `Origin: null`, `Access-Control-Request-Method: POST`. Next's default
`OPTIONS` response returns 204 with an `Allow` header but no `Access-Control-Allow-Origin`. Per the
Fetch spec, the browser's CORS check on the preflight response then fails, and the actual `POST` is
never sent — it's blocked client-side, before any network log on the server could ever show it. A
204 on the preflight is consistent with "the browser got a response" and inconsistent with "the browser
was satisfied by it" — those are different things, and only the second matters for CORS.

**5. Live data, this specific session — confirmed.**
`partner_sessions.id = 82fd9ca4-eae9-4c4d-888d-e4b6842f0378` — confirmed live in Supabase
(`nqxlpcshouboplhnuvrh`): `status = 'bot_active'`, `created_at = 2026-07-28 21:59:56 UTC`,
`partner_reference = 'claude-ai'`. `glitch_instances` for this `partner_session_id`: queried directly,
**zero rows.** B2B-44 Fix 3 should have written a `technical_error` row if the report had ever reached
the server.

**6. Live data, Vercel runtime logs — confirmed, and more conclusive than the Orchestrator's original
read.**
Queried `prj_05lfiXOO7aVzoMwf5xPyuYvXv3OO` myself:
- `client-error`, last 15 min: **15 `OPTIONS /api/partner/render/client-error` requests, all 204**,
  clustered at 22:00:45–22:00:46 UTC (consistent with the bot joining at 22:00:40 plus a few seconds
  for the iframe's page(s) to hydrate and the shim to arm) — split across `edge-middleware` and
  `serverless` source types, matching the Orchestrator's count.
- `POST /api/partner/render/client-error`, **last 2 hours** (I widened the window beyond the
  Orchestrator's original check): **zero results.** Not one successful POST to this route in the last
  two hours, i.e. since before B2B-44 shipped. This confirms the write-up's strongest claim: neither
  the original `window.onerror` shim (2026-07-27) nor B2B-43 Fix 4b's error-boundary detector
  (2026-07-27) nor B2B-44 Fix 2/3's schema widening + glitch persistence (2026-07-28) has ever
  successfully delivered a single report, because none of them could have — the request never left the
  browser.

**Conclusion: root cause confirmed independently.** The screen-share crash itself may or may not be
fixed by any of the last two days' work — we still don't know, because we have never once seen a real
diagnostic report. This brief fixes the reporting pipe, not the crash. Whether the crash is otherwise
already resolved is a separate open question that this fix will finally let us answer with real data
next time it happens.

## Scope confirmation

This is a missing-CORS-header bug on an endpoint whose own doc comment already states it is
intentionally unauthenticated ("no Clerk session, no partner API key, validated only by the opaque
`clio_session_ref`") and returns no sensitive data (`{ok: true/false}` only, fire-and-forget). No
screen, no copy, no product behavior changes. I agree with the Orchestrator: this does not need a BA
spec, same carve-out precedent as B2B-43/B2B-44.

## Proposed Fix

`app/api/partner/render/client-error/route.ts`:

1. Add an explicit `OPTIONS` handler:
   ```ts
   export async function OPTIONS() {
     return new NextResponse(null, {
       status: 204,
       headers: {
         'Access-Control-Allow-Origin': '*',
         'Access-Control-Allow-Methods': 'POST, OPTIONS',
         'Access-Control-Allow-Headers': 'Content-Type',
       },
     })
   }
   ```
2. Add `'Access-Control-Allow-Origin': '*'` to **both** response paths in the existing `POST` handler
   — the early `{ok: false}` return on failed Zod parse, and the final `{ok: true}` success return.

**`Access-Control-Allow-Origin` value — my call: literal `'*'`, not a reflected `"null"`.**
Both are functionally equivalent here (the request carries no credentials — the shim's `fetch()` call
has no `credentials: 'include'` — so `*` is permitted by spec even against an opaque/`null` origin).
I'm choosing `'*'` over reflecting the literal string `"null"` for one reason: `Access-Control-Allow-
Origin: null` is a well-known CORS anti-pattern flagged by security scanners and linters, because a
`null` origin can also be produced by other untrusted contexts (e.g. `data:` URIs, other sandboxed
iframes anywhere), so reflecting it gives no real origin restriction while looking like it does —
inviting a future "why does this look insecure" flag on code that is not, in fact, any less secure than
`*`. Since this endpoint has no trust boundary to protect in the first place (per its own doc comment),
`*` is the clearer, equally-safe, more conventional choice, and avoids that false-flag risk entirely.

## Files Changed

- `app/api/partner/render/client-error/route.ts` — add `OPTIONS` handler; add
  `Access-Control-Allow-Origin: '*'` to both `POST` response paths.

## Known Constraints

- Do not touch `ClientErrorSchema`, the `glitch_instances` insert logic, or the ordinal scheme —
  B2B-44 Fix 2/3 already correctly built those; this brief only unblocks the request from ever arriving.
- Do not add `Access-Control-Allow-Credentials` — the shim's `fetch()` sends no credentials, and adding
  it would be incompatible with `Access-Control-Allow-Origin: '*'` per spec.
- Do not widen CORS on any other partner-render route as part of this fix — scope is this one
  diagnostic sink only.

## Required live verification before any PASS (per Arun's "ask for evidence of confirmation")

Per `CLAUDE.md`'s QA Gate 3 — a code-review-only PASS or "it compiles" is invalid for this fix
specifically. Required:

1. Deploy the fix, then deliberately reproduce a screen-share crash (or trigger the error-boundary
   fallback text on a test render page) inside a live `partner-render` iframe.
2. Confirm in the browser's network panel (or via a fresh Vercel runtime-log query) that the `OPTIONS`
   preflight is now followed by an actual `POST /api/partner/render/client-error` — not just another
   204 preflight.
3. Confirm a new row lands in `glitch_instances` for that session with `glitch_type = 'technical_error'`
   — query Supabase directly, don't infer from logs alone.
4. Confirm the row is visible via `/api/admin/glitches` (or the admin UI it backs), matching B2B-44
   Fix 3's original intent.
5. Do not close this brief on "the OPTIONS handler was added" alone — the evidence bar is a real report
   completing the full round trip into the dashboarded table.

## Questions for BA

None. Pure technical/correctness fix — a missing CORS header on an endpoint that was always intended
to be reachable from an opaque-origin iframe. No product-shape or UX-copy decision. Section 11: empty.

## Confidence flag

High confidence in the root cause — independently re-derived the CORS mechanism rather than accepting
the Orchestrator's explanation, and the live Vercel log data (zero POSTs in 2 hours despite three
separate shipped mitigations trying to send them) is about as conclusive as evidence gets for "the
request never leaves the browser." The one thing this fix does NOT tell us: whether the underlying
screen-share crash itself is already resolved by B2B-43/B2B-44's other changes. That remains unknown
until a real report comes through post-fix — flagging so it isn't mistaken for a re-occurrence of the
same bug if Arun sees "Application error" again after this ships.
