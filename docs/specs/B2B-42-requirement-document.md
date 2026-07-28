# Unify Demo Passcode Gates (Meeting Save + Dispatch) — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-27

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

The CEO brief asked the BA to independently re-run the `verifyDemoPasscode` grep before finalizing
the deletion decision, and to check for any other reference to `DEMO_MEETING_PASSCODE` that would
need updating. Both re-verified directly against live code/repo state, not assumed:

**`verifyDemoPasscode` call sites** — `grep -rn "verifyDemoPasscode" .` (excluding `node_modules`)
returns exactly 5 hits, of which exactly **1** is a functional call:

| File | Line | What it is |
|---|---|---|
| `app/api/demo/[slug]/meeting/route.ts` | 5 | `import { verifyDemoPasscode } from '@/lib/demo/passcode'` — the import this brief removes |
| `app/api/demo/[slug]/meeting/route.ts` | 71 | `if (!verifyDemoPasscode(parsed.data.passcode))` — **the one functional call site**, being fixed here |
| `lib/demo/passcode.ts` | 22 | The function's own definition |
| `app/api/demo/[slug]/dispatch/route.ts` | 69 | A doc-comment referencing the function name historically ("replaces the single `verifyDemoPasscode()` call") — not a call |
| `lib/demo/passcode-accounts.ts` | 7 | A doc-comment referencing the function name in its file-header rationale — not a call |

This matches the CEO brief's finding exactly. Confirmed: after this brief's diff (§6.1) lands,
`verifyDemoPasscode()` has **zero** functional callers anywhere in the codebase.

**`DEMO_MEETING_PASSCODE` references** — `grep -rln "DEMO_MEETING_PASSCODE" .` (excluding
`node_modules`) returns:

| File | Nature | Action needed |
|---|---|---|
| `lib/demo/passcode.ts` | Reads the env var (`process.env.DEMO_MEETING_PASSCODE`) | Deleted whole file, §6.1 |
| `app/api/demo/[slug]/meeting/route.ts` | Indirect, via `verifyDemoPasscode()` | Fixed, §6.1 |
| `app/api/demo/[slug]/dispatch/route.ts` | Doc-comment only (file-header history note: "this also requires the same `DEMO_MEETING_PASSCODE` the Save action uses") | **Stale after this brief ships, but out of scope** — the CEO brief's own Known Constraints and "What NOT to Do" explicitly forbid touching `dispatch/route.ts` at all. Flagged below (§10) as a one-line future cleanup, not fixed here. |
| `tests/unit/demo-dispatch-route.test.ts` | Doc-comment only (describes the B2B-39 rewrite's own history) | No action — not a functional reference, and this brief doesn't touch this test file |
| `tests/unit/demo-meeting-route.test.ts` | Functional — sets `process.env.DEMO_MEETING_PASSCODE` to drive the old mechanism in tests | Rewritten, §13 |
| `.claude/agents/clio/feature-briefs/B2B-42-*.md`, `B2B-33-*.md`, `B2B-39-*.md`, `docs/b2b-pivot-status.md`, `docs/specs/B2B-39-*.md`, `docs/specs/B2B-33-*.md` | Historical narrative in briefs/specs/status tracker | No action — these are point-in-time historical records, not live references; never edited retroactively in this project's convention (confirmed by how B2B-39's own status-tracker entry still describes the pre-B2B-39 mechanism in past tense) |
| `lib/demo/passcode-accounts.ts` | Doc-comment (file-header rationale, explaining why the two mechanisms were originally kept separate) | This comment becomes historically inaccurate the moment this brief ships (the two mechanisms *are* now effectively unified from the Save action's perspective, even though the underlying files remain separate). Addressed in §6.1 — the comment is updated as part of this brief's own diff, since it lives in a file whose accuracy this brief directly affects. |
| `supabase/migrations/100_b2b39_demo_passcodes_and_billing.sql` | Grep hit on migration comment text | No action — migrations are immutable historical record, never edited after being applied |

**`.env.local.example` / deployment scripts / README** — checked `vercel.json`,
`setup-claude-skills.sh`, `scripts/qa-flow.sh`, `README.md`, and `docs/*.md`: **zero** matches for
`DEMO_MEETING_PASSCODE` in any of them.

**`.env.local.example` could not be directly read or grepped by the BA agent** — the sandbox's file
permission settings deny read/grep access to `.env*` paths for this agent. This is a genuine gap,
not a "confirmed clean" result — flagged explicitly as a manual step in §10/§12 for the Orchestrator
(who may have different file permissions, or can run the check via a non-agent shell) to verify
directly before or during deployment: grep `.env.local.example` for `DEMO_MEETING_PASSCODE` and
remove the line if present.

**Conclusion:** `lib/demo/passcode.ts` (both `verifyDemoPasscode()` and its internal
`timingSafeEqualStrings()` helper) is deleted outright as part of this brief, per the CEO brief's own
"either is acceptable" framing and this project's established pattern of fully removing dead
mechanisms rather than leaving deprecated code in place (see: `twilio`, `newsapi`, `@11labs/client`
full removals under the pivot, per `CLAUDE.md`'s "Removed from the approved list" section).

---

## 1. Purpose

`/demo/[slug]` has two passcode-gated actions on the same page — "Save" (persists the meeting URL +
participant name) and "Learn with AI" (dispatches Clio's real meeting bot). Since tonight's B2B-39
build, they run on two different, incompatible passcode mechanisms: dispatch resolves any
reseller's or the admin's own regenerated passcode via `resolveDemoPasscodeToAccount()`; Save still
checks against the single legacy shared secret `DEMO_MEETING_PASSCODE`, which B2B-39 did not touch by
design.

Without this fix, an operator (reseller or admin) who generates or regenerates their own passcode
from their dashboard reasonably expects that one passcode to work for the whole demo page. Instead,
their new passcode unlocks "Learn with AI" but is silently rejected (`401 incorrect_passcode`) by
"Save" — which still only accepts a shared secret most operators no longer know, since B2B-39
replaced it as their day-to-day credential. This is a real, reported UX gap ("the passcode that saves
name and meeting url is still old one and not using the new regenerated code"), not a hypothetical
one.

This feature makes the Save action resolve the entered passcode through the exact same
`resolveDemoPasscodeToAccount()` mechanism the dispatch action already uses, so one passcode
consistently gates both actions on the page.

## 2. User Story

As a **reseller (sales-partner, `account_kind='channel_partner'`) or the admin**, operating the
`/demo/[slug]` demo tool,
I want the one passcode I generated/regenerated from my own dashboard to work for both saving the
meeting URL/name and dispatching the "Learn with AI" bot,
so that I don't get confusingly rejected on one of the two actions with a passcode I know is correct.

## 3. Trigger / Entry Point

- **Route:** `POST /api/demo/[slug]/meeting` (unchanged route, unchanged HTTP method).
- **Trigger:** the operator fills in the meeting URL, participant name, and passcode fields on the
  Meeting tab of `/demo/[slug]` (`app/demo/[slug]/DemoTopicClient.tsx`) and clicks "Save" (the
  client-side call site and its `canSave` gating logic are unchanged by this brief — same fields,
  same button, same enablement rule).
- **State required:** none — `/demo/*` remains fully public/unauthenticated at the page level; the
  passcode field is the only credential, exactly as today. No Clerk session, no partner-admin login.
- **No client-side change** is required to trigger this differently — the request shape
  (`{ meeting_url, end_user_name, passcode }`) sent from `DemoTopicClient.tsx` is byte-identical to
  today's; only the server's handling of the `passcode` field changes.

## 4. Screen / Flow Description

No screen or flow changes. This is a server-side mechanism swap with an identical request/response
contract. For completeness, the existing (unchanged) flow on `/demo/[slug]`'s Meeting tab:

1. Operator lands on `/demo/[slug]`, sees the Meeting tab with three fields: a meeting URL text
   input (placeholder implied by existing markup, unchanged), a participant name text input, and a
   passcode text input labelled "Passcode" (`app/demo/[slug]/DemoTopicClient.tsx` line 603-612,
   `htmlFor="meeting-passcode-input"`).
2. The "Save" button is enabled once `urlInput`, `nameInput`, and `passcodeInput` are all non-empty
   (`canSave`, line 298) and not currently saving.
3. On click, the client POSTs `{ meeting_url, end_user_name, passcode }` to
   `/api/demo/[slug]/meeting`.
4. **On success (200):** the saved row is returned and reflected in the UI (unchanged behavior).
5. **On `401 incorrect_passcode`:** the client sets `savePasscodeError` to `'Incorrect passcode.'`,
   displayed directly under the passcode field (line 615-617). **This client-side error-handling
   code path is unchanged by this brief** — the response shape it depends on
   (`{ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }`, 401) is preserved
   exactly by the new mechanism (§6.1).
6. **On `422 validation_failed`:** unchanged, not touched by this brief (URL/name validation runs
   before the passcode check either way, §6.1).

**Confirmed (CEO brief Question 5, re-verified directly against `DemoTopicClient.tsx`):** no
client-side copy anywhere on the demo page references "the passcode" in a way that assumes two
different passcodes exist for the two actions. Both the Save field (line 604: label text
`"Passcode"`) and the Dispatch field (line 356: placeholder `"Passcode"`) use identical, generic
copy — neither says "meeting passcode," "dispatch passcode," or anything distinguishing. No copy
change is needed or made by this brief.

## 5. Visual Examples

No visual change. The Meeting tab's passcode field renders identically before and after this brief
— same label, same input, same error-message placement and copy. No wireframe is needed since no
pixel, layout, or copy changes.

## 6. Data Requirements

- **Read:** `demo_passcodes` table (`partner_account_id`, `id`, `passcode_hash`, `revoked_at`) via
  `resolveDemoPasscodeToAccount()` — same read the dispatch route already performs, no new query
  shape. **Not new** — the table and the read pattern were built in B2B-39 (migration
  `100_b2b39_demo_passcodes_and_billing.sql`); this brief only adds a second call site.
- **Write:** unchanged — `demo_meeting_urls` upsert (`slug`, `meeting_url`, `end_user_name`) on
  successful save, exactly as today. **No new column, no new table.** Per the CEO brief's Design
  Question 2 (confirmed correct, not re-litigated here): the resolved passcode's
  `partnerAccountId`/`passcodeId` are **not** read into any variable beyond the null-check itself,
  and are never written anywhere by the Save action — gate-only consumption, matching
  `demo_meeting_urls`' own table-comment ("Not a partner-facing table") and the fact that billing
  attribution belongs solely to `demo_dispatches` at dispatch time (B2B-39 §6.9 point 4).
- **APIs called:** none new. No outbound HTTP call is added or changed — `resolveDemoPasscodeToAccount()`
  is a local Supabase-admin-client lookup, not a network call to another service.
- **No localStorage/sessionStorage** involvement, unchanged.

### 6.1 Exact diff — `app/api/demo/[slug]/meeting/route.ts`

Mirrors `app/api/demo/[slug]/dispatch/route.ts`'s own integration pattern (lines 5, 69-75) exactly —
same import source, same null-check shape, same error response.

```diff
--- a/app/api/demo/[slug]/meeting/route.ts
+++ b/app/api/demo/[slug]/meeting/route.ts
@@ -1,7 +1,7 @@
 import { NextRequest, NextResponse } from 'next/server'
 import { z } from 'zod'
 import { createSupabaseAdminClient } from '@/lib/supabase'
 import { getDemoTopicBySlug } from '@/app/demo/_content'
-import { verifyDemoPasscode } from '@/lib/demo/passcode'
+import { resolveDemoPasscodeToAccount } from '@/lib/demo/passcode-accounts'

 /**
  * GET/POST /api/demo/[slug]/meeting
  *
  * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.1/§6.2). Reads/writes the Google Meet URL
  * Arun wants Clio's real bot to join for a given public demo topic. GET is unauthenticated
  * (page-viewing-equivalent — the "Currently saved" summary line and the Learn with AI button's
- * enabled/disabled state both depend on it). POST is passcode-gated (write-only gate, §0 Known
- * Constraints) — a shared secret check, not a login/session, since /demo/* stays fully public.
+ * enabled/disabled state both depend on it). POST is passcode-gated (write-only gate, §0 Known
+ * Constraints) — since /demo/* stays fully public.
+ *
+ * B2B-42 (docs/specs/B2B-42-requirement-document.md §6.1) — the passcode check now resolves,
+ * per-account, via `resolveDemoPasscodeToAccount()` (lib/demo/passcode-accounts.ts), the same
+ * mechanism and the exact same call pattern `app/api/demo/[slug]/dispatch/route.ts` already uses —
+ * no longer the single shared `DEMO_MEETING_PASSCODE` env var (lib/demo/passcode.ts, deleted as part
+ * of this brief once this was its only functional caller). Save is a gate-only consumer: unlike
+ * dispatch, it never reads `resolved.partnerAccountId` or `resolved.passcodeId` — saving a meeting
+ * URL/name has no billing or attribution consequence (that lives solely in `demo_dispatches`,
+ * written by the dispatch route at dispatch time). A passcode issued/regenerated for any
+ * `channel_partner` account or the admin sentinel account now unlocks both Save and dispatch
+ * uniformly.
  */
```

```diff
@@ -68,8 +74,11 @@ export async function POST(request: NextRequest, { params }: { params: { slug
     )
   }

-  if (!verifyDemoPasscode(parsed.data.passcode)) {
+  // B2B-42 (docs/specs/B2B-42-requirement-document.md §6.1) — replaces the single
+  // verifyDemoPasscode() call. Same error shape/code as before — visitor-facing behavior is
+  // unchanged; only the server-side resolution mechanism changed (one shared secret -> a
+  // per-account hashed-passcode lookup), mirroring dispatch/route.ts's own B2B-39 integration.
+  const resolved = await resolveDemoPasscodeToAccount(parsed.data.passcode)
+  if (!resolved) {
     return NextResponse.json({ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }, { status: 401 })
   }

   const supabase = createSupabaseAdminClient()
```

Note: `resolved` is intentionally never referenced again after the null-check — no
`resolved.partnerAccountId` / `resolved.passcodeId` read, matching §6's "gate-only" data requirement
above. A linter/type-checker will not flag this as unused since `resolved` is used in the `if (!resolved)`
condition itself.

### 6.2 Exact diff — `lib/demo/passcode.ts` (deleted outright)

Per §0's re-confirmed grep: zero functional callers remain once §6.1 lands. Delete the file in full
(both `verifyDemoPasscode()` and its internal `timingSafeEqualStrings()` helper — the helper has no
other caller; it exists solely to serve `verifyDemoPasscode()`).

```diff
--- a/lib/demo/passcode.ts
+++ /dev/null
@@ -1,25 +0,0 @@
-/**
- * B2B-33 (docs/specs/B2B-33-requirement-document.md §0a). Shared constant-time passcode check for
- * the /demo/[slug] Meeting tab's Save action and, per the 2026-07-23 CEO amendment, the Learn with AI
- * dispatch action too — same shared secret (`DEMO_MEETING_PASSCODE`), same fail-closed posture.
- * Edge-runtime-safe (no Node `crypto.timingSafeEqual`), mirroring lib/test-harness/basic-auth.ts.
- */
-
-function timingSafeEqualStrings(a: string, b: string): boolean {
-  const aBuf = new TextEncoder().encode(a)
-  const bBuf = new TextEncoder().encode(b)
-  const maxLen = Math.max(aBuf.length, bBuf.length, 1)
-  let diff = aBuf.length === bBuf.length ? 0 : 1
-  for (let i = 0; i < maxLen; i++) {
-    const x = i < aBuf.length ? aBuf[i] : 0
-    const y = i < bBuf.length ? bBuf[i] : 0
-    diff |= x ^ y
-  }
-  return diff === 0
-}
-
-/** Fails closed: an unconfigured DEMO_MEETING_PASSCODE never treats any input as correct. */
-export function verifyDemoPasscode(candidate: string): boolean {
-  const expected = process.env.DEMO_MEETING_PASSCODE ?? ''
-  return expected.length > 0 && timingSafeEqualStrings(candidate, expected)
-}
```

### 6.3 Exact diff — `lib/demo/passcode-accounts.ts` (comment-only update)

The file's own header (lines 7-10) and `resolveDemoPasscodeToAccount()`'s doc-comment (lines 84-85)
currently state this function is "used ONLY by the dispatch route — never by the Meeting tab's Save
action." That statement becomes false the moment §6.1 ships. Updated for accuracy, since this brief
directly changes the fact the comment asserts — no behavior change, comment-only:

```diff
--- a/lib/demo/passcode-accounts.ts
+++ b/lib/demo/passcode-accounts.ts
@@ -4,9 +4,9 @@ import { createSupabaseAdminClient } from '@/lib/supabase'
 /**
  * B2B-39 (docs/specs/B2B-39-requirement-document.md §6.4). Per-account demo passcode generation,
  * hashing, and dispatch-time resolution. Kept in a wholly separate file from `lib/demo/passcode.ts`
- * — that file's `verifyDemoPasscode()` (the single shared `DEMO_MEETING_PASSCODE` env var, gating the
- * Meeting tab's "Save meeting URL" action) is completely untouched by this feature and must never be
- * merged with this mechanism (§10 Out of Scope — conflating the two would let a reseller's own
- * demo-billing passcode also unlock editing the meeting URL for every demo topic).
+ * — that file was deleted as of B2B-42 (docs/specs/B2B-42-requirement-document.md §6.2), once its
+ * `verifyDemoPasscode()` (the single shared `DEMO_MEETING_PASSCODE` env var) lost its one remaining
+ * caller (the Meeting tab's Save action, which B2B-42 moved onto this file's
+ * `resolveDemoPasscodeToAccount()` instead). The Save action's use is gate-only — it never reads
+ * `resolved.partnerAccountId` or `resolved.passcodeId` — so this remains a read-only resolution
+ * helper with no billing side effect of its own; billing attribution is still written solely by the
+ * dispatch route via `demo_dispatches` at dispatch time (§6.9 below, unchanged by B2B-42).
  *
  * Only the SHA-256 hash (of the hyphen-stripped, uppercased candidate) is ever persisted, mirroring
  * `lib/partner/api-keys.ts`'s `hashApiKey()` discipline — the plaintext is returned to the caller
@@ -81,8 +81,9 @@ export interface ResolvedDemoPasscode {
 /**
  * Single indexed lookup: `demo_passcodes WHERE passcode_hash = hashDemoPasscode(candidate) AND
  * revoked_at IS NULL`. Returns the billing account id AND the passcode row id (needed by the
  * dispatch route to populate `demo_dispatches.demo_passcode_id` — §6.9 point 4) or `null` if no
- * active passcode matches. Used ONLY by the dispatch route — never by the Meeting tab's Save action,
- * which keeps using `lib/demo/passcode.ts`'s mechanism unchanged.
+ * active passcode matches. Used by both the dispatch route (which additionally reads
+ * `partnerAccountId`/`passcodeId` for billing attribution) and, as of B2B-42, the Meeting tab's Save
+ * action (gate-only — the resolved account/passcode identity is never read or stored there).
  */
 export async function resolveDemoPasscodeToAccount(candidate: string): Promise<ResolvedDemoPasscode | null> {
```

## 7. Success Criteria (Acceptance Tests)

✓ AT-1: Given a `demo_passcodes` row for a `channel_partner` (reseller) account with no
`revoked_at`, when its plaintext passcode is POSTed to `/api/demo/[slug]/meeting` with a valid
`https://` `meeting_url` and non-empty `end_user_name`, then the response is `200` and
`demo_meeting_urls` is upserted for that slug — a reseller's own regenerated passcode now works for
Save.

✓ AT-2: Given a `demo_passcodes` row for the admin sentinel account
(`DEMO_ADMIN_PARTNER_ACCOUNT_ID`, per `lib/demo/passcode-accounts.ts` line 39) with no `revoked_at`,
when its plaintext passcode is POSTed to `/api/demo/[slug]/meeting` with a valid `meeting_url` and
`end_user_name`, then the response is `200` and the row is saved — the admin's own passcode also
works for Save, not just resellers'.

✓ AT-3: Given a passcode string that resolves to no row in `demo_passcodes` (never issued, or
issued for a different value), when POSTed to `/api/demo/[slug]/meeting`, then the response is `401`
with `{ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }` and no row is
written to `demo_meeting_urls`.

✓ AT-4: Given a passcode that matches a `demo_passcodes` row where `revoked_at` is **not** null
(revoked), when POSTed to `/api/demo/[slug]/meeting`, then the response is `401 incorrect_passcode`
and no row is written — a revoked passcode does not work, exactly matching dispatch's own existing
revocation behavior (`resolveDemoPasscodeToAccount()`'s `.is('revoked_at', null)` filter, unchanged).

✓ AT-5: Given the **old** `DEMO_MEETING_PASSCODE` value set as an environment variable (proving the
mechanism swap actually took effect, not just that the code compiles), when that value is POSTed as
the `passcode` field to `/api/demo/[slug]/meeting` and it does **not** correspond to any row in
`demo_passcodes`, then the response is `401 incorrect_passcode` — the old shared secret no longer
grants access.

✓ AT-6 (regression): `GET /api/demo/[slug]/meeting` remains fully unauthenticated — given any
request with no passcode field at all, when GET is called for a known slug, then it returns `200`
with the saved (or null) `meeting_url`/`end_user_name`/`updated_at` exactly as before, confirming the
GET handler was not touched by this brief.

✓ AT-7 (regression): Given a request with a **valid** passcode but an invalid (non-`https://`)
`meeting_url` or a missing/empty `end_user_name`, when POSTed to `/api/demo/[slug]/meeting`, then the
response is still `422 validation_failed` with the existing message ("Enter a name and a valid
https:// meeting URL.") — Zod validation continues to run and reject before the passcode check is
even reached, exactly as today's code order (`SaveMeetingUrlSchema.safeParse` before the passcode
check) already establishes and this brief does not reorder.

✓ AT-8 (regression): Given an unknown `slug`, when POSTed to `/api/demo/[slug]/meeting` with any
passcode value, then the response is `404 not_found` before any passcode resolution is attempted —
unchanged from today (the `getDemoTopicBySlug()` check runs first).

✓ AT-9 (regression, dispatch route unaffected): Given the existing
`tests/unit/demo-dispatch-route.test.ts` suite, when run after this brief's changes, then every test
still passes unmodified — `app/api/demo/[slug]/dispatch/route.ts` itself is not touched by this
brief, and this test file is not modified by this brief.

✓ AT-10: Given `lib/demo/passcode.ts` has been deleted, when the full test suite runs (`npm test` /
`vitest run`), then there is no import-resolution failure anywhere in the codebase and no orphaned
test references the deleted file or `verifyDemoPasscode` — confirmed by `tests/unit/demo-meeting-route.test.ts`'s
rewrite (§13) removing every `process.env.DEMO_MEETING_PASSCODE`-based assertion.

## 8. Error States

- **Passcode does not resolve to any account** (never issued, mistyped, or revoked):
  `401 { error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }`. Identical shape/
  code to today — the client's existing `savePasscodeError` handling requires no change (§4).
- **`resolveDemoPasscodeToAccount()`'s underlying Supabase query itself errors** (e.g. transient DB
  connectivity issue): the function's existing implementation (`lib/demo/passcode-accounts.ts` lines
  87-98) does not distinguish a query error from "no match" — both resolve to `data` being falsy and
  the function returning `null`. This brief inherits that behavior unchanged (same as the dispatch
  route already does) — a transient DB error surfaces to the visitor as `401 incorrect_passcode`
  rather than a `500`. **Not a new error mode introduced by this brief** — pre-existing behavior of
  the function being reused, out of scope to change here.
- **`meeting_url`/`end_user_name` validation fails**: unchanged, `422 validation_failed`, runs before
  the passcode check (§7 AT-7).
- **Unknown slug**: unchanged, `404 not_found`, runs before the passcode check (§7 AT-8).
- **`demo_meeting_urls` upsert fails after a valid passcode**: unchanged —
  `500 { error: { code: 'internal_error', message: "Couldn't save — try again." } }`, exact existing
  code path, not touched by this brief.
- **No loading-state design needed**: the Save action already has its own `saving` state in
  `DemoTopicClient.tsx`, unchanged by this brief — the passcode-resolution lookup is a single indexed
  Supabase query (same cost profile as the dispatch route's own identical lookup), not a new
  slow-path.

## 9. Edge Cases

- **An operator who still has the old `DEMO_MEETING_PASSCODE` value memorized/bookmarked**: after
  this ships, that value stops working for Save (§7 AT-5) — expected and intended, this is the whole
  point of the fix. No migration/grace-period mechanism is needed or in scope; B2B-39 already made
  this the case for dispatch two features ago with no reported issue.
  the passcode field with a mix of the two mechanisms mid-transition: not applicable — this is a
  single atomic deploy of one route's handler; there is no partial-rollout state where one passcode
  mechanism is live for Save and the old one is simultaneously still live, since both routes are part
  of the same deployed application build.
- **A reseller's passcode is revoked mid-session** (e.g. between page load and clicking Save): the
  next Save attempt resolves to `null` and 401s (§7 AT-4) — same behavior dispatch already has for
  this exact scenario, no new handling needed.
- **Admin uses their sentinel-account passcode for Save on a slug they don't "own"** (there is no
  per-slug ownership concept in `demo_meeting_urls`, confirmed in §6 — it's a page-level, not
  per-account, resource): works identically to how it already works for dispatch — any valid,
  unrevoked passcode (reseller or admin) can Save or dispatch on any slug. Not a new edge case
  introduced by this brief — this was already true of the pre-existing dispatch mechanism and is
  unchanged in scope/shape here.
- **Mobile vs desktop**: no layout change on this page from this brief (server-only change), so no
  new responsive consideration applies. (Per `CLAUDE.md`'s standing responsive-by-default rule: this
  brief does not touch `DemoTopicClient.tsx`'s markup/layout in any way — server-route-only change —
  so it does not trigger that rule's "any future work that touches a screen" obligation.)
- **Slow network / API timeout on the Save POST**: unchanged existing client-side handling in
  `DemoTopicClient.tsx` (not touched by this brief).

## 10. Out of Scope

- Any change to `app/api/demo/[slug]/dispatch/route.ts`'s own passcode handling — confirmed already
  correct, untouched by this brief, per the CEO brief's explicit "What NOT to Do."
- Any change to the GET handler in `app/api/demo/[slug]/meeting/route.ts` — confirmed
  unauthenticated-by-design already, out of scope per CEO brief Design Question 1.
- Any new schema/column on `demo_meeting_urls` for account-identity tracking — confirmed not needed
  per CEO brief Design Question 2 and this doc's §6.
- Any visible UI/UX change to the demo page — same fields, same buttons, same layout, same copy (§5).
- **Minor stale-comment cleanup in `app/api/demo/[slug]/dispatch/route.ts`'s file header** (line
  17-20's mention of "the same `DEMO_MEETING_PASSCODE` the Save action uses," which becomes
  historically imprecise once this brief ships since Save no longer uses that env var) — **flagged,
  not fixed here**, because the CEO brief's Known Constraints explicitly forbid touching
  `dispatch/route.ts` in this change. A one-line comment correction there is a trivial, separately-
  scoped follow-up if Arun wants it; not required for this brief's own correctness since it's prose
  describing history, not logic.
- Manual verification of `.env.local.example` for a `DEMO_MEETING_PASSCODE` line — the BA agent could
  not read/grep this file due to sandbox permissions (§0). **Logged as a required manual step for the
  Orchestrator, not resolved here.**
- Removal of the `DEMO_MEETING_PASSCODE` Vercel environment variable itself — per the CEO brief, this
  is explicitly a manual post-deploy cleanup step, not something code can do. **Logged for the
  Orchestrator in §12, not resolved here.**

## 11. Open Questions

None. Every design question, both CEO-flagged decisions, and all 5 "Questions for BA" items from the
CEO brief are resolved above with concrete decisions, an exact diff, and explicit test coverage. The
one item the BA could not fully resolve (`.env.local.example` verification, due to a sandbox
permission limitation rather than a genuine ambiguity) is not a design or requirements question — it
is logged as a manual operational step in §10/§12, the same way the CEO brief itself already logged
the Vercel-env-var removal as a manual step rather than an open question.

## 12. Dependencies

- **B2B-39 (`resolveDemoPasscodeToAccount()`, `lib/demo/passcode-accounts.ts`, `demo_passcodes`
  table)** — already built and deployed. This brief adds a second call site to an existing,
  unmodified function; no changes to B2B-39's own code.
- **No database migration** — no new table, column, or RPC. Reuses `demo_passcodes` exactly as-is.
- **No new environment variables.**
- **`DEMO_MEETING_PASSCODE` env var (Vercel) — manual post-deploy cleanup, not part of this code
  change.** Once this brief ships and `lib/demo/passcode.ts` is deleted, nothing in application code
  reads this variable anywhere. Orchestrator should remove it from the Vercel project's environment
  variables as a manual step after deploy (per the CEO brief's own framing — this is ops housekeeping,
  not something a route handler can do).
- **`.env.local.example` — manual verification required.** The BA could not confirm directly (§0,
  sandbox permission denial on `.env*` paths). Orchestrator should grep this file for
  `DEMO_MEETING_PASSCODE` and remove the line if present, before considering this brief's cleanup
  fully closed out.
- No dependency on B2B-41 (participant-initiated call-end handling) — confirmed unrelated, sibling
  in-flight work this same session, touching a completely different file
  (`lib/voice/hume-native/prompt-template.ts`).

## 13. Test Plan

Two existing test files are affected; both follow this project's established Vitest mocking
convention (`vi.mock('@/lib/demo/passcode-accounts', ...)`), taken directly from
`tests/unit/demo-dispatch-route.test.ts`'s own B2B-39 rewrite (`state.resolvedPasscode`, mocked to
resolve or return `null`).

### 13.1 `tests/unit/demo-meeting-route.test.ts` — rewritten (not deleted)

This file is **not** a dedicated test file for `lib/demo/passcode.ts`/`verifyDemoPasscode()` alone —
it covers the entire `meeting/route.ts` module, including `GET` (unaffected by this brief) and POST's
Zod validation (unaffected — end_user_name/URL checks, B2B-36 F4 coverage). Deleting the whole file
would lose that still-valid coverage. Instead, **only the POST-passcode-specific tests are rewritten**
to mock `resolveDemoPasscodeToAccount()` instead of setting `process.env.DEMO_MEETING_PASSCODE`; the
GET suite and the non-passcode POST validation tests (URL format, `end_user_name` required, unknown
slug) are left exactly as they are today, since they remain valid and this brief doesn't touch that
logic.

**Diff to the file's mock block (top of file):**

```diff
--- a/tests/unit/demo-meeting-route.test.ts
+++ b/tests/unit/demo-meeting-route.test.ts
@@ -1,15 +1,22 @@
 import { describe, it, expect, vi, beforeEach } from 'vitest'
 import { NextRequest } from 'next/server'

 /**
  * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.1/§6.2, AT-2/AT-3/AT-4). Covers
  * GET/POST /api/demo/[slug]/meeting — reading/saving the Google Meet URL for a public demo topic.
  * GET is unauthenticated; POST is passcode-gated (write-only) and must never write a row on an
  * incorrect passcode or invalid URL.
  *
  * B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.7) — end_user_name is now required
  * alongside meeting_url. Pre-existing tests below are updated to include it so they keep
  * validating their original scenario rather than failing on an unrelated missing field.
+ *
+ * B2B-42 (docs/specs/B2B-42-requirement-document.md §13.1) — the passcode check no longer compares
+ * against the single shared DEMO_MEETING_PASSCODE env var (lib/demo/passcode.ts, deleted). It now
+ * resolves, per-account, via resolveDemoPasscodeToAccount() (lib/demo/passcode-accounts.ts), mocked
+ * here exactly as tests/unit/demo-dispatch-route.test.ts's own B2B-39 rewrite already does for the
+ * sibling dispatch route.
  */

 const state = {
   upserted: [] as unknown[],
   row: null as { meeting_url: string; end_user_name: string | null; updated_at: string } | null,
+  resolvedPasscode: null as { partnerAccountId: string; passcodeId: string } | null,
 }

+vi.mock('@/lib/demo/passcode-accounts', () => ({
+  resolveDemoPasscodeToAccount: vi.fn(() => Promise.resolve(state.resolvedPasscode)),
+}))
+
 vi.mock('@/lib/supabase', () => ({
   createSupabaseAdminClient: vi.fn(() => ({
     from: vi.fn(() => ({
```

**Diff to the POST describe block** (replaces the `DEMO_MEETING_PASSCODE`-based tests with
`state.resolvedPasscode`-based equivalents; GET describe block and the B2B-36 F4 nested describe are
untouched):

```diff
 describe('POST /api/demo/[slug]/meeting', () => {
   beforeEach(() => {
     vi.clearAllMocks()
     state.upserted = []
     state.row = null
-    process.env.DEMO_MEETING_PASSCODE = 'correct-passcode'
+    state.resolvedPasscode = null
   })

-  it('AT-4: 401s on an incorrect passcode and never writes a row', async () => {
+  it('AT-3: 401s on an incorrect/unrecognized passcode and never writes a row', async () => {
+    state.resolvedPasscode = null
     const res = await POST(postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'wrong' }), {
       params: { slug: 'claude-ai' },
     })
     const body = await res.json()
     expect(res.status).toBe(401)
     expect(body.error.code).toBe('incorrect_passcode')
     expect(state.upserted).toHaveLength(0)
   })

-  it('fails closed (401) when DEMO_MEETING_PASSCODE is unconfigured, even with a matching empty guess', async () => {
-    delete process.env.DEMO_MEETING_PASSCODE
+  it('AT-4: 401s when the passcode matches a revoked demo_passcodes row (resolves to null)', async () => {
+    state.resolvedPasscode = null // resolveDemoPasscodeToAccount already filters revoked_at IS NULL
     const res = await POST(postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'anything' }), {
       params: { slug: 'claude-ai' },
     })
     expect(res.status).toBe(401)
     expect(state.upserted).toHaveLength(0)
   })

+  it('AT-5: 401s when the OLD DEMO_MEETING_PASSCODE-style value is sent but does not resolve to any demo_passcodes row', async () => {
+    // Proves the mechanism swap took effect, not just that the code compiles — the pre-B2B-42
+    // shared secret carries no special meaning to resolveDemoPasscodeToAccount() and is treated
+    // like any other unrecognized string.
+    state.resolvedPasscode = null
+    const res = await POST(
+      postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'old-demo-meeting-passcode-value' }),
+      { params: { slug: 'claude-ai' } }
+    )
+    expect(res.status).toBe(401)
+    expect(state.upserted).toHaveLength(0)
+  })
+
   it('422s a non-https URL and never writes a row', async () => {
     const res = await POST(
       postRequest({ meeting_url: 'http://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'correct-passcode' }),
       { params: { slug: 'claude-ai' } }
     )
     expect(res.status).toBe(422)
     expect(state.upserted).toHaveLength(0)
   })

-  it('AT-3: saves on a correct passcode + valid https URL + name, returning the saved row', async () => {
+  it('AT-1: saves on a valid reseller passcode + valid https URL + name, returning the saved row', async () => {
+    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
     const res = await POST(
       postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'correct-passcode' }),
       { params: { slug: 'claude-ai' } }
     )
     const body = await res.json()
     expect(res.status).toBe(200)
     expect(body).toEqual({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', updated_at: '2026-07-23T00:00:00.000Z' })
     expect(state.upserted).toHaveLength(1)
     expect(state.upserted[0]).toMatchObject({ end_user_name: 'Arun' })
   })

+  it('AT-2: saves on a valid admin-sentinel-account passcode + valid https URL + name', async () => {
+    state.resolvedPasscode = { partnerAccountId: '30d40f51-5d6e-49e9-bdda-519b7d70e13a', passcodeId: 'passcode-admin-1' }
+    const res = await POST(
+      postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'admin-correct-passcode' }),
+      { params: { slug: 'claude-ai' } }
+    )
+    expect(res.status).toBe(200)
+    expect(state.upserted).toHaveLength(1)
+  })
+
   it('404s an unknown slug before any passcode check', async () => {
     const res = await POST(
       postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'correct-passcode' }),
       { params: { slug: 'not-a-real-topic' } }
     )
     expect(res.status).toBe(404)
     expect(state.upserted).toHaveLength(0)
   })
```

The `describe('B2B-36 F4 — end_user_name required', ...)` nested block (lines 152-173 of the current
file) is **unchanged** — it exercises validation that runs before the passcode check either way, and
already uses a `passcode: 'correct-passcode'` value that will simply resolve via the mock; since those
tests never reach the passcode branch (Zod fails first), they need no `state.resolvedPasscode` setup
to keep passing, matching AT-7's regression coverage.

### 13.2 `tests/unit/demo-dispatch-route.test.ts` — unchanged

Per §7 AT-9: this brief does not modify `app/api/demo/[slug]/dispatch/route.ts`, so this test file is
**not modified**. Included here only to confirm it's accounted for, not orphaned or forgotten — the
full existing suite (mocking `resolveDemoPasscodeToAccount` exactly as it already does) continues to
run and pass as-is.

### 13.3 No dedicated `lib/demo/passcode.test.ts` exists to delete or repurpose

Confirmed via `find tests -iname "*demo*"` (§0's file listing) — there is no test file dedicated
solely to `lib/demo/passcode.ts`. Its only test coverage lived inside
`tests/unit/demo-meeting-route.test.ts`'s POST suite (the passcode-specific assertions rewritten in
§13.1 above). No orphaned test file is left behind by deleting `lib/demo/passcode.ts`.
