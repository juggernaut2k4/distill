# B2B-34 — Reseller Architecture, Demo Performance, Minutes Reporting, Adaptive Cutoff, Terminology Cleanup
Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-23
Source brief: `.claude/agents/clio/feature-briefs/B2B-34-reseller-architecture-performance-billing-cutoff-terminology.md`

> Scope in one line: five CEO-approved pieces, specified as five self-contained Requirement Documents
> (Parts A–E below) sharing one migration sequence and one cross-cutting decisions table, because Piece 2
> is a hard prerequisite for Piece 3 and all five were discussed as one coherent session. **Section 11 is
> empty in every Part.** One item required a documented reconciliation with a prior CEO-approved decision
> (B2B-28) rather than a fresh escalation — see §0.4. No item required escalation back to the CEO.

---

## 0. Cross-Cutting (read first — governs every Part below)

### 0.1 Build & sequencing order (confirmed, matches CEO's stated preference)

```
1. Part A — Piece 5 (terminology cleanup)         — self-contained, unblocks nothing else structurally,
                                                      but reduces the surface Part E's new code touches
2. Part B — Piece 2 (client_id + reseller/client)  — hard prerequisite for Part E
3. Part C — Piece 1 (Performance tab)  ┐ fully independent of B/E, can run in parallel with Part D
4. Part D — Piece 4 (Hume-verified cutoff) ┘
5. Part E — Piece 3 (minutes usage)                — depends on Part B's `end_client_id` column existing
                                                      and populated
```

### 0.2 Cross-cutting decisions table

| # | Question (from CEO brief) | Resolution | Reasoning |
|---|---|---|---|
| 1 | Migration numbering | Latest applied migration is **`093_b2b33_demo_meeting_dispatch.sql`** (confirmed via `ls supabase/migrations/`, 2026-07-23). This brief uses **`094`** (Part A), **`095`** (Part B), **`096`** (Part C). Part D and Part E are migration-free (see their own §12). | Directory listing re-verified at spec-writing time per the CEO brief's own instruction. |
| 2 | `client_id` naming collision (Part B, Piece 2) | **Wire/API field name stays `client_id`** (matches Arun's own language, matches the product's established vocabulary, and never appears in the same request/response body as the unrelated `partner_oauth_clients.client_id` — that identifier only ever appears in the `Authorization` header exchange, never in this endpoint's JSON). **Internal DB column and TypeScript identifier is `end_client_id` / `endClientId`** — disambiguates at the code level (where a grep/IDE-autocomplete collision with `PartnerApiKeyContext.clientId` and `partner_oauth_clients.client_id` was the CEO's actual concern) without changing the contract external integrators build against. | Full reasoning in Part B §6.1. |
| 3 | `internal_staff` vs `staff` token (Part A, Piece 5) | **`internal_staff`** — already resolved by the CEO in the brief itself; BA confirms no reason to deviate. | Brief §"CEO Resolution: the new token". |
| 4 | Reconciliation with B2B-28's AT-29/AT-30 test | See §0.4 below. | — |
| 5 | Does the B2B-33 demo dispatch account need a self-client (Part B, Piece 2 Q5)? | **No. Confirmed live in the database.** `partner_accounts` row `30d40f51-5d6e-49e9-bdda-519b7d70e13a` ("Clio Internal — Public Demo") has `account_kind = 'partner'`, not `channel_partner`. Part B's `client_id` requirement is scoped to `channel_partner`-authenticated callers only (see Part B §0 "Success Looks Like" point 2, which says "every **reseller**"). A plain `account_kind='partner'` caller — which the demo account is — is unaffected by this brief; `client_id` stays optional/unused for it, exactly as today. **No code change to the demo dispatch flow, no self-client provisioning for it, is required by this brief.** | Verified via direct SQL query against project `nqxlpcshouboplhnuvrh`, 2026-07-23 (see Part B §6.1 for the full query and all 12 live `partner_accounts` rows). |
| 6 | Zero live rows with `role='sales_partner'` (Part A, Piece 5 Q1) | **Confirmed: 0 rows.** `SELECT count(*) FROM internal_admin_users WHERE role='sales_partner'` → `0` (1 total row, the seeded super-admin). Constraint rename is migration-only, no `UPDATE` needed. | Verified via direct SQL query, 2026-07-23. |
| 7 | Time window for minutes usage (Part E, Piece 3 Q1) | **Trailing 30 days** as the headline figure (list page column + detail page top-line), **all-time cumulative** available alongside it on the detail page only. Not a selector — no evidence of demand for arbitrary date-range slicing yet, and a selector adds real UI/query complexity for a P1 reporting feature with exactly one stated consumer (Arun, account-management conversations). | BA default per CEO's own stated instinct; this is a metric-presentation detail, not a decision that changes what query runs (both windows are computed, just one is de-emphasized), so it stays within BA autonomy per the CEO brief's own carve-out. |
| 8 | Indexing for per-client breakdown (Part E, Piece 3 Q2) | **No new index needed.** The existing `idx_usage_events_account_type_time` (`partner_account_id, event_type, occurred_at DESC WHERE test_mode=false`, migration 072) already covers this query's `WHERE partner_account_id = $1 AND event_type = 'voice_minute' AND test_mode = false AND occurred_at >= $2` clause completely — `GROUP BY end_client_id` runs in-memory over the already-narrow, already-indexed row set, not against the whole table. Confirmed by reading the query plan this index produces for the exact predicate shape Part E issues (single-partner, single-event-type, bounded time window — the row count per reseller is expected to be small at current and near-future scale). | Documented finding, not a guess — see Part E §6.1. |
| 9 | Piece 5 exhaustive `sales_partner` grep sweep | **Run.** Full results in Part A §6.2 — found 5 call sites beyond the CEO brief's own list (four `admin.role === 'sales_partner'` checks in the glitches API surface, plus `sendSalesPartnerInviteEmail`'s subject/body copy and function name), all now included in Part A's fix list. | `grep -rn "sales_partner" --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.md" .`, filtered to exclude `channel_partner` and `node_modules`/`.next`, 2026-07-23. |

### 0.3 Migration plan (exact order, exact numbering)

| File | Piece | Contents |
|---|---|---|
| `supabase/migrations/094_b2b34_internal_staff_rename.sql` | Part A (5) | Rename `internal_admin_users.role` CHECK value, rename `sales_partner_assignments` table + its 2 indexes + its RLS policy. No data migration (0 live rows). |
| `supabase/migrations/095_b2b34_client_id_architecture.sql` | Part B (2) | `partner_accounts.is_self_client`, `partner_sessions.end_client_id`, `usage_events.end_client_id`, `partner_session_insights.end_client_id`, backfill self-clients for the 6 existing live `channel_partner` rows. |
| `supabase/migrations/096_b2b34_learner_insight_schema.sql` | Part C (1) | `partner_session_insights`: drop `psychology_keywords`, add `learner_insight JSONB`. Update `purge_partner_session_insights_full_detail()` RPC body. |

Part D (4) and Part E (3) are migration-free, confirmed in §0.2 rows 8 and the brief's own "Cross-cutting notes."

### 0.4 The one reconciliation (not an escalation)

`tests/unit/b2b28-security-orthogonality-and-naming.test.ts` (AT-29/AT-30) currently asserts that a prior
brief's fix to this exact naming problem was **copy-only**: it explicitly asserts the route paths
(`/api/admin/team/sales-partners*`), the state-variable identifiers (`salesPartners`, etc.), and the DB
value (`role='sales_partner'`) all stay **byte-identical**, with only `TeamClient.tsx`'s rendered text
changing. `docs/specs/B2B-28-requirement-document.md` (lines 24, 95, 1406) documents this explicitly as a
**deliberate, scoped-down fix**, and separately, explicitly, logs the full identifier/schema/route rename
this very brief (B2B-34 Piece 5) now does as **"a backlog item"** for later.

This is not a conflict requiring escalation — B2B-28 already named this exact follow-up work and deferred
it by design; B2B-34 Piece 5 is that deferred work now being executed, with the CEO's own resolved token
choice (`internal_staff`) folded in. Per the CEO brief's own instruction ("if it conflicts, escalate to me
rather than silently picking one"), the test was read in full before writing this document, as instructed.

**What this means for the build:** `tests/unit/b2b28-security-orthogonality-and-naming.test.ts`'s AT-29/
AT-30 `it()` blocks for "keeps every fetched route path byte-identical" and "keeps every state variable/
handler identifier byte-identical" will **fail** the moment Part A ships, by design — they are asserting
the pre-Part-A state. Part A's own Section 7 (Acceptance Tests) includes the exact replacement assertions;
updating this test file is an explicit, required line item in Part A's build, not an incidental side
effect to discover later. The one assertion checking migration 084's own file content
(`expect(migration084).toMatch(...)`) stays **unchanged and still passes** — migration 084's file is
never edited in place; Part A's rename happens via the new migration 094, exactly matching this
codebase's own established append-only migration convention.

---
---

# PART A — Piece 5: Terminology Cleanup (`sales_partner` → `internal_staff`)
Version: 1.0 | Status: CEO REVIEW | Author: Business Analyst Agent | Date: 2026-07-23

## 1. Purpose

Two completely different concepts in this codebase currently share the literal string `sales_partner`:
(A) Clio's own internal team member with scoped dashboard access
(`internal_admin_users.role='sales_partner'`, B2B-21), and (B) the external reseller entity
(`partner_accounts.account_kind='channel_partner'`, B2B-26, whose user-facing copy is "sales-partner").
This collision already produces user-facing confusion today: a brand-new Clio internal-staff member
accepting their own invite is told they're being invited "as a sales partner" — the product's own
established term for an entirely different kind of account they are not. Every day this ships unfixed,
more code (Part E of this very brief included) gets written against the ambiguous token, compounding the
eventual fix. Without this fix: a developer grepping `sales_partner` gets both concepts back with no way
to tell them apart by name alone, and the invite-acceptance copy keeps actively misleading new internal
hires about what role they've been given.

## 2. User Story

As a **Clio super-admin** inviting a new internal team member,
I want the invite and the admin UI to call that role "internal staff," not "sales partner,"
So that the term "sales partner" means one thing everywhere in the product: the external reseller entity.

As a **newly-invited Clio internal-staff member**,
I want my invite-acceptance page to correctly describe the role I'm accepting,
So that I am not told I am becoming "a sales partner" when I am not.

## 3. Trigger / Entry Point

Not a new user-facing flow — a rename across an existing one. Entry points unchanged from today:
`/dashboard/admin/team` (super-admin only, gated by `requireSuperAdmin()`), `/invite/accept?token=...`
(public, token-gated), and the underlying `internal_admin_users`/`internal_staff_assignments` tables
reached exclusively via `lib/internal-admin/auth.ts` and the routes listed in §6.

## 4. Screen / Flow Description

No screen's layout, fields, or interaction sequence changes. Every screen affected is described exactly
as it exists today except for the specific renamed strings below — this section lists every state whose
**rendered copy** changes; every other pixel is unchanged.

**`/dashboard/admin/team` (`TeamClient.tsx`) — "Internal sales staff" panel:** No copy change at all.
The panel heading, the invite-form heading, and every loading/error/empty string already say "Internal
sales staff" / "internal sales staff" (shipped under B2B-28) — this brief only renames the underlying
identifiers, routes, and DB value backing this panel, described in §6, not the text a super-admin reads.

**`/invite/accept?token=...` (`InviteAcceptClient.tsx`) — State A1 (before sign-in):** Heading changes
from:
> You've been invited to Clio as a sales partner.

to:

> You've been invited to Clio as a Clio staff member.

(when `role === 'internal_staff'`; the `super_admin` branch — "as a super-admin" — is unchanged). Every
other element of State A1 (the "Invited: {email}" line, the "Sign in to accept" button, states A2–A4) is
byte-identical to today.

## 5. Visual Examples

**State A1 — invite lookup succeeded, not yet signed in (internal-staff branch, the only copy change):**
```
┌─────────────────────────────────────────┐
│              CLIO                        │
│                                           │
│  You've been invited to Clio as a Clio   │
│  staff member.                           │
│                                           │
│  Invited: rahul@salesco.example.com      │
│                                           │
│  [PRIMARY BUTTON: "Sign in to accept"]   │
└─────────────────────────────────────────┘
```

**`/dashboard/admin/team` — "Internal sales staff" panel (unchanged from today, shown for reference —
no changes made here in this Part):**
```
┌─────────────────────────────────────────────────────┐
│  Internal sales staff                    [+ Invite]  │
│                                                        │
│  rahul@salesco.example.com          [PENDING]         │
│  [HelloWorld] [Pluralsight]                            │
│  [Edit tags] [Resend invite] [Deactivate]              │
│                                                        │
│  No internal sales staff yet.  (empty state, unchanged)│
└─────────────────────────────────────────────────────┘
```

## 6. Data Requirements

### 6.1 Migration `094_b2b34_internal_staff_rename.sql`

```sql
-- B2B-34 Piece 5 — reserve `sales_partner` for the reseller entity only (B2B-26/28's `channel_partner`
-- concept). Renames the OTHER (B2B-21, internal-Clio-staff) concept's token to `internal_staff`.
-- Zero live rows with role='sales_partner' confirmed 2026-07-23 (query below, run against project
-- nqxlpcshouboplhnuvrh) — clean constraint swap, no UPDATE needed.
--   SELECT count(*) FROM internal_admin_users WHERE role='sales_partner';  -- => 0

ALTER TABLE internal_admin_users DROP CONSTRAINT IF EXISTS internal_admin_users_role_check;
ALTER TABLE internal_admin_users ADD CONSTRAINT internal_admin_users_role_check
  CHECK (role IN ('super_admin', 'internal_staff'));

ALTER TABLE sales_partner_assignments RENAME TO internal_staff_assignments;
ALTER INDEX idx_sales_partner_assignments_admin_user RENAME TO idx_internal_staff_assignments_admin_user;
ALTER INDEX idx_sales_partner_assignments_partner_account RENAME TO idx_internal_staff_assignments_partner_account;
ALTER POLICY "Service role full access on sales_partner_assignments"
  ON internal_staff_assignments RENAME TO "Service role full access on internal_staff_assignments";

COMMENT ON COLUMN internal_admin_users.role IS
  'B2B-34 Piece 5 (renamed from sales_partner, 2026-07-23): internal_staff = a Clio-internal team member with scoped dashboard access (formerly named sales_partner — collided with the unrelated reseller/channel_partner concept introduced by B2B-26/28). super_admin = full cross-partner reach. See docs/specs/B2B-34-requirement-document.md Part A.';
COMMENT ON TABLE internal_staff_assignments IS
  'B2B-34 Piece 5 (renamed from sales_partner_assignments, 2026-07-23): many-to-many join, Clio-internal staff <-> the partner_accounts (reseller or direct-partner) rows they are scoped to manage. See docs/specs/B2B-34-requirement-document.md Part A.';
```

Postgres auto-generates unnamed inline `CHECK` constraints as `{table}_{column}_check` — confirmed this
is exactly `internal_admin_users_role_check` by inspecting how migration 079 re-added
`partner_sessions_end_reason_check` using the identical DROP/ADD pattern against a constraint that was
also originally inline/unnamed in 077.

### 6.2 Exhaustive grep sweep — full results (per CEO brief's explicit ask, Q2)

`grep -rn "sales_partner" --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.md" .`
(excluding `node_modules`, `.next`, and every hit that is actually `channel_partner`), run 2026-07-23.
Every code hit is listed below with its disposition. Historical `docs/specs/*.md` and
`.claude/agents/clio/feature-briefs/*.md` files are **left untouched** (§10) — they are immutable records
of decisions made at the time they were written, not live code.

| File | What's there today | Disposition |
|---|---|---|
| `supabase/migrations/084_b2b21_internal_admin_identity.sql` | Original `CHECK`/table definition | **Untouched** (§0.4 — history stays; migration 094 supersedes at the DB level) |
| `supabase/migrations/086_b2b26_sales_partner_entity.sql` | Comment only, explaining the *other* concept's naming discipline | **Untouched** — it's Concept B's own migration, correctly describing why it avoided this token |
| `lib/internal-admin/auth.ts` | `InternalAdminResult` role union (×2), `InternalAdminUserRow.role`, `.from('sales_partner_assignments')`, 4× `role: 'sales_partner'`/`'sales_partner'` comparisons | **Fixed** — full diff below |
| `app/api/admin/team/sales-partners/route.ts` | File itself, `.eq('role','sales_partner')` ×2, `.from('sales_partner_assignments')` ×2, `role: 'sales_partner'` insert, response keys `sales_partners`/`sales_partner` | **Moved + fixed** — becomes `app/api/admin/team/internal-staff/route.ts` |
| `app/api/admin/team/sales-partners/[id]/route.ts` | Same shape | **Moved + fixed** — becomes `app/api/admin/team/internal-staff/[id]/route.ts` |
| `app/api/admin/team/sales-partners/[id]/resend-invite/route.ts` | Same shape | **Moved + fixed** — becomes `app/api/admin/team/internal-staff/[id]/resend-invite/route.ts` |
| `app/dashboard/admin/team/TeamClient.tsx` | `SalesPartnerRow` interface, `salesPartners`/`salesPartnersLoading`/`salesPartnersError` state, `loadSalesPartners`, `handleToggleSalesPartnerStatus`, 4× fetch URLs, `data.sales_partners` read | **Fixed** — full diff below. **Rendered copy unchanged** (§4). |
| `app/invite/accept/InviteAcceptClient.tsx` | 2× type union, 1× rendered ternary (line 142) | **Fixed** — full diff below |
| `app/api/admin/team/invites/accept/route.ts` | Doc-comment only (line 30, "as a sales partner") — the code itself passes `row.role` through with no hardcoded union, so it needs **zero functional change** | **Comment updated only** (cosmetic, included for consistency) |
| `lib/delivery/email.ts` | `sendSalesPartnerInviteEmail` (function name, log tags), email subject "as a sales partner", email body copy "as a sales partner" (html + text), mock message id, a doc-comment cross-reference from the sibling (genuinely Concept-B) email function | **Fixed — NOT in the CEO brief's own list, found by this sweep.** Full diff below. |
| `app/api/admin/glitches/route.ts` | 2× `admin.role === 'sales_partner'` | **Fixed — NOT in the CEO brief's own list, found by this sweep.** |
| `app/api/admin/glitches/issues/[id]/partner-visibility/route.ts` | 1× `admin.role === 'sales_partner'` | **Fixed — NOT in the CEO brief's own list, found by this sweep.** |
| `app/api/admin/glitches/summary/route.ts` | 1× `admin.role === 'sales_partner'` | **Fixed — NOT in the CEO brief's own list, found by this sweep.** |
| `app/api/admin/billing/test-block/route.ts` | Comment only ("hard-rejects a scoped `sales_partner`") | **Comment updated only** (cosmetic) |
| `tests/unit/b2b28-security-orthogonality-and-naming.test.ts` | AT-29/AT-30 assertions | **Updated** — see §0.4 and §7 |
| `app/dashboard/admin/sales-partners/*`, `app/api/admin/sales-partners/*` | Concept B's own `sales_partner`/`sales_partners` singular/plural response keys and JSX text — a genuinely different, correct usage | **Untouched** — this is the reseller-entity surface (Part E extends it in Part E, unrelated to this rename) |

**Response-key collision found by this sweep, resolved as a byproduct:** `GET /api/admin/sales-partners`
(Concept B, unchanged) and the pre-rename `GET /api/admin/team/sales-partners` (Concept A) both returned
a field literally named `sales_partners` — a second, JSON-contract-level instance of the same collision
this Part fixes at the code-identifier level. Renaming Concept A's response key to `internal_staff`
(§6.3) removes this collision as a natural side effect; it did not need a separate decision.

### 6.3 Exact code diffs

**`lib/internal-admin/auth.ts`:**
- `InternalAdminResult` union: `{ role: 'sales_partner'; ... }` → `{ role: 'internal_staff'; ... }`
- `InternalAdminUserRow.role: 'super_admin' | 'sales_partner'` → `'super_admin' | 'internal_staff'`
- `scopedPartnerAccountIdsFor()`: `.from('sales_partner_assignments')` → `.from('internal_staff_assignments')`
- Every `role: 'sales_partner'` return-object literal (2 occurrences, in `resolveInternalAdmin()`'s
  bound-row and lazy-bind branches) → `role: 'internal_staff'`
- `requireSuperAdmin()`: `if (result.role === 'sales_partner')` → `if (result.role === 'internal_staff')`
- `requireInternalAdmin()`: `result.role === 'sales_partner'` → `result.role === 'internal_staff'`
- Module doc comment's parenthetical (`internal_admin_users` / `sales_partner_assignments`) → updated to
  the renamed table name.

**Route move (3 files, `git mv` + edit, not copy):**
`app/api/admin/team/sales-partners/route.ts` → `app/api/admin/team/internal-staff/route.ts`
`app/api/admin/team/sales-partners/[id]/route.ts` → `app/api/admin/team/internal-staff/[id]/route.ts`
`app/api/admin/team/sales-partners/[id]/resend-invite/route.ts` → `app/api/admin/team/internal-staff/[id]/resend-invite/route.ts`

Within all three: `.eq('role', 'sales_partner')` → `.eq('role', 'internal_staff')`;
`.from('sales_partner_assignments')` → `.from('internal_staff_assignments')`; the POST route's
`role: 'sales_partner'` insert literal → `role: 'internal_staff'`; the GET route's response
`{ sales_partners: salesPartners }` → `{ internal_staff: internalStaff }` (rename the local variable
too, for readability); the POST route's response `{ sales_partner: created, ... }` →
`{ internal_staff_member: created, ... }`; import `sendSalesPartnerInviteEmail` →
`sendInternalStaffInviteEmail` (both the list route and resend-invite route); all doc comments'
`/api/admin/team/sales-partners` references → `/api/admin/team/internal-staff`; error-message strings
("Couldn't load sales-partners.", "Sales-partner not found.", "Could not update sales-partner.", "Could
not update sales-partner status.") → the equivalent "internal-staff" phrasing (e.g. "Couldn't load
internal staff.", "Internal-staff member not found.").

**`app/dashboard/admin/team/TeamClient.tsx`:**
- `interface SalesPartnerRow` → `interface InternalStaffRow` (every usage site follows: `SalesPartnerRow[]`
  → `InternalStaffRow[]`, function params typed `row: SalesPartnerRow` → `row: InternalStaffRow`)
- State: `salesPartners`→`internalStaff`, `salesPartnersLoading`→`internalStaffLoading`,
  `salesPartnersError`→`internalStaffError`
- `loadSalesPartners()` → `loadInternalStaff()`; inside it, fetch URL
  `'/api/admin/team/sales-partners'` → `'/api/admin/team/internal-staff'`; `data.sales_partners` →
  `data.internal_staff`
- `handleSendInvite()`: fetch URL → `/api/admin/team/internal-staff`; on success, calls
  `await loadInternalStaff()` (was `loadSalesPartners()`)
- `handleSaveTags()`: fetch URL → `` `/api/admin/team/internal-staff/${id}` ``; calls
  `await loadInternalStaff()`
- `handleResendInvite()`: fetch URL → `` `/api/admin/team/internal-staff/${id}/resend-invite` ``; calls
  `await loadInternalStaff()`
- `handleToggleSalesPartnerStatus()` → `handleToggleInternalStaffStatus()`; fetch URL →
  `` `/api/admin/team/internal-staff/${row.id}` ``; calls `await loadInternalStaff()`; every call site of
  the old function name in JSX updated to the new name
- Initial `useEffect`: `loadSalesPartners()` → `loadInternalStaff()`
- Every `salesPartners.map(...)`, `salesPartners.length === 0`, `salesPartnersLoading`,
  `salesPartnersError` reference in the JSX rebound to the renamed state vars
- **Rendered strings ("Internal sales staff", "Loading internal sales staff…", "No internal sales staff
  yet.", "Couldn't load internal sales staff. Try refreshing.", "Invite internal sales staff") are
  copy-identical to today — zero text changes, per §4.**

**`app/invite/accept/InviteAcceptClient.tsx`:**
- `LookupState`'s `'valid'` variant: `role: 'super_admin' | 'sales_partner'` → `'super_admin' | 'internal_staff'`
- `View`'s `'A1'` variant: same union change
- Line 142: `{view.role === 'super_admin' ? 'a super-admin' : 'a sales partner'}` →
  `{view.role === 'super_admin' ? 'a super-admin' : 'a Clio staff member'}`

**`app/api/admin/team/invites/accept/route.ts`:** doc-comment on line 30 —
`"as a sales partner" / "as a super-admin"` → `"as a Clio staff member" / "as a super-admin"`. No code
change (the route passes `row.role` through untyped).

**`lib/delivery/email.ts`:**
- `export async function sendSalesPartnerInviteEmail(...)` → `export async function sendInternalStaffInviteEmail(...)`
- `console.log('[MOCK] sendSalesPartnerInviteEmail', ...)` → `console.log('[MOCK] sendInternalStaffInviteEmail', ...)`
- Mock `messageId: 'mock-sales-partner-invite-id'` → `'mock-internal-staff-invite-id'`
- `subject: "You've been invited to Clio as a sales partner"` → `"You've been invited to Clio as internal staff"`
- HTML body: `"...has invited you as a sales partner, scoped to:"` → `"...has invited you as internal staff, scoped to:"`
- Plain-text body: same substitution
- `logEmailResult('sendSalesPartnerInviteEmail', ...)` → `logEmailResult('sendInternalStaffInviteEmail', ...)`
- `console.error(`[email:sendSalesPartnerInviteEmail] ...`)` → `` `[email:sendInternalStaffInviteEmail] ...` ``
- The sibling B2B-26 function's doc comment ("Same ... skeleton as `sendSalesPartnerInviteEmail`") →
  updated to reference `sendInternalStaffInviteEmail`. The sibling function itself (a genuine
  reseller-team invite, Concept B) is **not renamed**.

**Glitches API (3 files, each 1–2 line changes only, no structural change):**
`app/api/admin/glitches/route.ts` — 2× `admin.role === 'sales_partner'` → `'internal_staff'`
`app/api/admin/glitches/issues/[id]/partner-visibility/route.ts` — 1× same substitution
`app/api/admin/glitches/summary/route.ts` — 1× same substitution

**`app/api/admin/billing/test-block/route.ts`:** comment-only — `"hard-rejects a scoped sales_partner"`
→ `"hard-rejects a scoped internal_staff"`.

## 7. Success Criteria (Acceptance Tests)

✓ Given a Clerk session bound to an `internal_admin_users` row with `role='internal_staff'` and
`status='active'`, when `resolveInternalAdmin()` runs, then it returns `{ role: 'internal_staff', ... }`
(not `'sales_partner'`, which the CHECK constraint no longer accepts).

✓ Given that same session, when it calls `GET /api/admin/team/internal-staff`, then it 200s (unchanged
`requireSuperAdmin()`-only gate applies — this is a super-admin-only route regardless of the caller's own
role, so this test uses a super-admin session, not the internal-staff session above, to hit 200; an
internal-staff-role session hitting this route still 403s, unchanged from today).

✓ Given `POST /api/admin/team/internal-staff` with a valid `{ email, partner_account_ids }` body, when it
succeeds, then a new `internal_admin_users` row is inserted with `role='internal_staff'` and matching
`internal_staff_assignments` rows are created, and the response is
`{ internal_staff_member: {...}, email_sent: boolean }`.

✓ Given `GET /api/admin/team/sales-partners` (the old, pre-rename path), when called, then it 404s (route
no longer exists at that path) — confirms the move, not a copy.

✓ Given a fresh internal-staff invite email is sent, when its subject/body is inspected, then it reads
"...as internal staff...", never "...as a sales partner...".

✓ Given `/invite/accept?token=...` for a `role='internal_staff'` invite, when State A1 renders, then the
heading reads "You've been invited to Clio as a Clio staff member." — never "...as a sales partner.".

✓ Given `/dashboard/admin/team`'s "Internal sales staff" panel, when it loads, then every rendered string
is byte-identical to what ships today (no visible regression from this Part).

✓ Given `npm run build` + `npx tsc --noEmit`, when run after this Part, then both are clean — confirms no
stray reference to the old `SalesPartnerRow`/`salesPartners`/`sales_partner_assignments`/old route paths
survives anywhere in the touched files.

✓ Given `tests/unit/b2b28-security-orthogonality-and-naming.test.ts`, when run after this Part, then the
route-path and identifier assertions (previously asserting byte-identical `/api/admin/team/sales-partners*`
paths and `salesPartners`-family identifiers) are updated to assert the **new** paths/identifiers
(`/api/admin/team/internal-staff*`, `internalStaff`-family) and pass; the migration-084-content assertion
is untouched and still passes (§0.4).

✓ Given the `app/api/admin/glitches*` scoping tests (already covered generally by existing suites), when
a caller with `role='internal_staff'` and a non-empty `scopedPartnerAccountIds` hits
`GET /api/admin/glitches`, then results are filtered to their scope exactly as they were pre-rename for
`role='sales_partner'` — confirms the 4 glitches-route call sites found by the exhaustive sweep were
fixed, not missed.

## 8. Error States

No new error states — this Part renames identifiers/routes/copy on existing, already-specified error
paths (B2B-21 §8). The one behavior change: `GET/POST/PATCH` against the **old** `/api/admin/team/
sales-partners*` paths now 404 (route deleted, not aliased) rather than succeeding — deliberate, not a
gap: no external caller should ever have depended on this internal-admin-only, super-admin-gated path,
and no redirect/alias is warranted for an internal-tool route rename.

## 9. Edge Cases

- **A pending invite created before this migration ships, still unaccepted after it ships.** Its
  `internal_admin_users.role` value was written as `'sales_partner'` before migration 094 ran — but
  since 0 live rows exist today (confirmed §0.2 row 6) and this migration is a schema-only change (no
  `UPDATE`), any row created *before* 094 runs with the old value would violate the new CHECK constraint
  the instant anything tries to re-save it. This is provably unreachable: 0 rows exist to begin with, and
  the deploy is a single atomic migration + code push, leaving no window for a new `'sales_partner'` row
  to be inserted between the old code and the new constraint.
- **A super-admin has the old `/dashboard/admin/team` page bookmarked/cached client-side (stale JS).**
  The page itself doesn't move (`/dashboard/admin/team` is unchanged); only the API routes it calls move.
  A stale browser tab with old JS still calling the old API path gets a 404 on the next fetch and
  surfaces the panel's existing generic error state ("Couldn't load internal sales staff. Try
  refreshing.") — no crash, just prompts a refresh, which resolves it.
- **Concept B's `/dashboard/admin/sales-partners` and `/api/admin/sales-partners*` are never touched by
  this Part** — confirmed no file-path overlap with the renamed Concept-A routes (different parent path:
  `app/api/admin/team/*` vs `app/api/admin/sales-partners/*`).

## 10. Out of Scope

- Historical `docs/specs/*.md` and `.claude/agents/clio/feature-briefs/*.md` files — never edited; they
  are point-in-time records, not live code.
- Renaming anything under `channel_partner` — that token is Concept B's correct, permanent name (§6.2,
  confirmed out of scope by the CEO brief).
- Any change to `partner_admin_users`, the Clerk-Organizations webhook path, or any partner-facing (as
  opposed to Clio-internal-admin-facing) surface.

## 11. Open Questions

None.

## 12. Dependencies

- Must ship before (or in the same PR as) any new Part-E code that would otherwise touch
  `role === 'sales_partner'` comparisons — sequencing recommendation from the CEO brief, confirmed sound
  since Part E's own new code (Part E §6) reads `requireSuperAdmin()`/`internal_admin_users` only
  incidentally (auth gate, not new role-branching logic), so no hard blocking dependency exists, but
  shipping Part A first still avoids writing any new code against the soon-to-be-dead token.
- No dependency on Part B, C, or D.

---
---

# PART B — Piece 2: Reseller/Client Architecture
Version: 1.0 | Status: CEO REVIEW | Author: Business Analyst Agent | Date: 2026-07-23

## 1. Purpose

Today, `POST /api/partner/v1/sessions` has no structural way to know which of a reseller's end-customers a
session is for — the closest field, `partner_end_user_ref`, is an optional, unvalidated free-text string,
not a real foreign key. This means Clio cannot enforce that a reseller only launches sessions for clients
they've actually registered, cannot reliably attribute usage to a specific client for reporting (blocking
Part E), and ships a real, already-live bug where the `session.insights_ready` webhook always reports
`partner_reference: null` regardless of what the partner set at session-creation time. Without this Part:
Part E cannot be built correctly, the webhook bug persists indefinitely, and the reseller/client
production flow Arun describes (register clients manually, thread `client_id` through every session, keep
billing reseller-level only) has no schema to run on at all.

## 2. User Story

As a **sales-partner (reseller) integrator**,
I want to pass a `client_id` identifying which of my registered clients a session is for,
So that Clio attributes the session correctly and I can report per-client usage back to my own business.

As a **sales-partner (reseller) admin, brand-new with no clients registered yet**,
I want to be able to test my own integration immediately after signing up,
So that I don't need a real end-customer before I can verify anything works.

As a **Clio super-admin**,
I want the `session.insights_ready` webhook to always carry the real `partner_reference` a partner set,
So that a partner's own webhook consumer can correlate the event correctly (closing the existing bug).

## 3. Trigger / Entry Point

`POST /api/partner/v1/sessions` — server-to-server, authenticated via a partner API key or OAuth2 access
token (`lib/partner/auth.ts`'s `requirePartnerApiKey`). No new route is introduced; this Part changes the
request contract of an existing route and adds one new field to `ChannelPartnerClient`'s existing detail
page.

## 4. Screen / Flow Description

**New: `ClientDetailClient.tsx` gains a "Client ID" display.** This is a genuine functional gap this
Part must close, not called out explicitly in the CEO brief but required for the reseller/client
architecture to be usable at all: today, `/dashboard/channel-partner/clients/[id]` never shows the
client's own `partner_accounts.id` anywhere — but a reseller integrating against the new `client_id`
requirement has no other way to learn which UUID to pass for a given registered client. Added directly
below the existing "Configure" card, a new card:

- Heading: "Client ID"
- Body copy: "Pass this as `client_id` when creating a session for this client via the API."
- A monospace, selectable text block showing the raw UUID (e.g. `1b925846-6c84-4156-995c-6bcb707c3c38`),
  with a "Copy" button (icon button, `Copy` from `lucide-react`, matches the existing icon-button
  precedent elsewhere in this codebase) that copies the UUID to the clipboard and shows a 2-second "✓
  Copied" tooltip/label swap. Not a secret — no reveal-once/masking behavior; always visible.

**`/dashboard/channel-partner/clients` (list) — self-client visibility.** The auto-provisioned self-client
(§6.2) appears in this list like any other client row (so the reseller can find and copy its id, per
above), with one visual addition: a small muted "Self" label/badge immediately after its name (inline
`<span>`, `color: COLORS.textMuted`, `fontSize: 11`, e.g. `background:'#1A1A1A'`, `border:
'1px solid #333333'`, `borderRadius: 4`, `padding: '1px 6px'`, text "Self") — distinguishes it from a
real registered client at a glance. No other layout change to this list.

**`/dashboard/channel-partner` (dashboard) — Clients count.** The "Clients" metric card's count
(`clients.length` today) excludes the self-client: displayed count becomes
`clients.filter(c => !c.is_self_client).length`. Reasoning: a reseller's dashboard should report their
real customer count, not include Clio-internal plumbing they never created. The self-client is still
reachable from the full `/dashboard/channel-partner/clients` list (above), just not counted here.

**No other screen changes.** `POST /api/partner/v1/sessions` is a server-to-server API, not a UI flow —
its contract change is fully specified in §6.

## 5. Visual Examples

**Client detail page — new "Client ID" card:**
```
┌─────────────────────────────────────────┐
│  ← All clients                           │
│                                           │
│  Acme Corp                    [ACTIVE]   │
│  https://acme.example.com                │
│                                           │
│  ┌─────────────────────────────────┐    │
│  │ Configure                        │    │
│  │ Set up API credentials, ...      │    │
│  │ [Configure →]                    │    │
│  └─────────────────────────────────┘    │
│                                           │
│  ┌─────────────────────────────────┐    │
│  │ Client ID                        │    │
│  │ Pass this as client_id when      │    │
│  │ creating a session for this      │    │
│  │ client via the API.              │    │
│  │                                   │    │
│  │ 1b925846-6c84-4156-995c-6bcb...  │    │
│  │ [Copy]                           │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**Clients list — self-client row:**
```
┌─────────────────────────────────────────┐
│  Clients                                  │
│                                            │
│  Acme Corp                    [ACTIVE]    │
│  Self (direct sessions)  [Self]  [ACTIVE] │
└─────────────────────────────────────────┘
```

## 6. Data Requirements

### 6.1 The `client_id` naming resolution (full reasoning)

**Wire/API request field stays `client_id`.** **Internal DB column / TypeScript identifier is
`end_client_id`.** Verified live-database confirmation this doesn't collide in practice: querying
`partner_accounts` (2026-07-23, project `nqxlpcshouboplhnuvrh`) confirmed 12 live rows — 6
`account_kind='channel_partner'` (resellers), 4 `account_kind='partner'` rows already owned by one of
those 6 (existing registered clients), and 2 standalone `account_kind='partner'` rows with no owner
(`Clio Internal — Test Harness`, `Clio Internal — Public Demo`) — the latter directly resolving
cross-cutting decision #5 (no self-client needed for the demo account, since it is not a reseller). This
confirms the schema's existing `owning_channel_partner_id` relationship (migration 086) is exactly the
right FK target for the new `end_client_id` concept — no new relationship table needed.

**Which callers must supply `client_id`?** Only `account_kind='channel_partner'`-authenticated callers.
This is a resolution the BA had to make explicit — the CEO brief's own wording ("client_id is a required
field on `POST /api/partner/v1/sessions`") read literally would require every direct partner
(`account_kind='partner'`) to also supply a `client_id` pointing at a row they own — but the
`check_account_kind_invariants()` trigger (migration 086) only permits `owning_channel_partner_id` to
point at rows owned by a `channel_partner`-kind account, meaning **no valid `client_id` could ever exist
for a direct partner** under the current schema. Applied literally, this would make it structurally
impossible for any existing or future direct partner to ever create a session — a severe, unintended
breaking change the CEO brief's own "What Success Looks Like" point 2 ("Every **reseller**...") does not
actually ask for. **Resolution: `client_id` is required only when the authenticating account's
`account_kind = 'channel_partner'`. For `account_kind='partner'` callers, the field stays absent/unused,
exactly matching today's behavior.** This is exactly why cross-cutting decision #5 concludes the demo
account needs no changes.

### 6.2 Auto-provisioned "self" client — exact mechanism

New column: `partner_accounts.is_self_client BOOLEAN NOT NULL DEFAULT FALSE`.

**Trigger point: `createOrClaimPartnerAccount()` in `lib/partner/signup.ts`**, immediately after the
`partner_admin_users` insert succeeds, only when `resolvedAccountKind === 'channel_partner'` — this is
application code, per the BA's own confirmed instinct in the CEO brief (matches this codebase's existing
convention of putting business logic in `lib/partner/*`, not DB triggers; the one existing trigger,
`check_account_kind_invariants()`, is a pure data-integrity invariant, not business logic, a different
category). Chosen specifically because `createOrClaimPartnerAccount()` is the **sole** chokepoint for
provisioning a `channel_partner` account today — called from the `user.created` webhook branch and both
authenticated claim routes (`/api/partner-signup/claim`, `/api/partner-invite/accept`) — so this covers
every current and future provisioning path with one change, zero new call sites.

```ts
if (resolvedAccountKind === 'channel_partner') {
  const { error: selfClientError } = await supabase.from('partner_accounts').insert({
    name: 'Self (direct sessions)',
    archetype: 'unspecified',
    status: 'active',
    account_kind: 'partner',
    owning_channel_partner_id: account.id,
    is_self_client: true,
  })
  if (selfClientError) {
    // Best-effort, non-blocking — mirrors this file's own established convention (the admin-insert
    // failure branch above is similarly accepted/logged, not retried). A reseller whose self-client
    // failed to provision can always create an equivalent client manually via "Add a client" — this
    // never blocks the core account-creation flow, which must not fail for a peripheral convenience.
    console.error('[partner-signup] Failed to auto-provision self-client (non-blocking):', selfClientError.message)
  }
}
```
Placed after the existing `inngest.send('clio/partner-account.created', ...)` call's position is
irrelevant (independent of it) — placed directly after the `partner_admin_users` insert's success check,
before the welcome email send.

**Naming (fixed, not derived from the reseller's own company name):** `"Self (direct sessions)"` — a
fixed string, deliberately not mirroring the reseller's own (possibly still-placeholder,
`UNNAMED_PARTNER_PLACEHOLDER`) company name, which would go stale the moment the reseller edits their
real company name in Settings (B2B-29) without a corresponding update to this row. `is_self_client=true`
makes this row precisely identifiable regardless of its display name.

**Backfill (migration 095, §6.4):** the 6 existing live `channel_partner` rows (confirmed above) each get
a self-client row inserted as part of the migration itself — otherwise those 6 real resellers would be
immediately blocked from testing their own integration the moment this ships, with no code path to
self-heal (the auto-provision trigger only fires on *new* account creation).

### 6.3 The webhook fix — `recordInsightsReadyEvent()`, both call sites, both hardcoded-null locations

**Two separate things are wrong today, both traced to the same root cause — `extractInsightsForPartnerSession()`'s own `SELECT` never fetches `partner_sessions.partner_reference` at all:**

1. **Pre-existing bug, independent of this Part's new concept:** `partner_reference` (an existing
   column/field, an opaque partner-supplied correlation string set at session-creation time, e.g. B2B-33's
   demo dispatch sets it to the topic slug) is hardcoded to `null` in `recordInsightsReadyEvent()`'s
   `referencePayload` object AND in the `canonicalHashInput()` call used to compute that payload's
   idempotency hash. **Fix: extend the `SELECT` in both call sites to include `partner_reference`, and
   thread the real value through `recordInsightsReadyEvent()`'s existing `testMode`-style parameter
   pattern.**
2. **New, Part-B-introduced field:** `end_client_id` did not exist before this Part and therefore was
   never in this payload at all. **Fix: add it as a new, additive, non-hashed field** (matching how
   `extraction_status`/`action_items`/`glitches` are already additive-only, non-hashed fields on this
   same payload) — never conflated with the `partner_reference` fix above.

**Why not repurpose `partner_reference` to carry the new `client_id`/`end_client_id` value instead of
adding a separate field** (a literal reading the CEO brief's phrasing — "the real `client_id`... instead
of the hardcoded `null`" — could support): doing so would recreate, inside this very webhook payload, the
exact ambiguous-token problem Part A of this same brief is dedicated to eliminating elsewhere — a field
named `partner_reference` silently carrying a `client_id` value is exactly the kind of naming collision
that produces wrong integrations later. **Resolution: fix `partner_reference` to carry its own,
already-existing, correctly-named value (closing the pre-existing bug), and separately add `end_client_id`
as a new field** — this delivers strictly more information to a partner's webhook consumer than either
reading alone, at zero extra cost, with zero new ambiguity.

`recordInsightsReadyEvent()`'s new signature:
```ts
export async function recordInsightsReadyEvent(params: {
  partnerSessionId: string
  partnerAccountId: string
  extractionStatus: 'success' | 'success_empty' | 'failed'
  testMode: boolean
  partnerReference: string | null   // NEW — the real value, was hardcoded null
  endClientId: string | null        // NEW — Part B's own new concept, additive
}): Promise<void>
```
`referencePayload` gains `partner_reference: params.partnerReference` (was `null`) and
`end_client_id: params.endClientId` (new field). `canonicalHashInput()`'s call is updated to pass
`partner_reference: params.partnerReference` — **`end_client_id` is NOT added to the hash input**, exactly
matching how `extraction_status` etc. are already excluded from the idempotency hash (it stays a narrow
"core identity of the event" hash, not a full-payload hash).

**Both call sites updated**, per the CEO brief's own explicit instruction that both must be fixed
together:
- `extractInsightsForPartnerSession()`'s own `SELECT` on `partner_sessions` extends from
  `'id, partner_account_id, hume_chat_id, test_mode'` to
  `'id, partner_account_id, hume_chat_id, test_mode, partner_reference, end_client_id'`, and its
  `recordInsightsReadyEvent()` call passes both new params through from that same row.
- `markInsightsExtractionFailed()`'s `partner_sessions!inner(test_mode)` FK embed extends to
  `partner_sessions!inner(test_mode, partner_reference, end_client_id)`, and its own
  `recordInsightsReadyEvent()` call (inside the `nextAttemptCount >= 3` branch) passes both through the
  same way.

`WebhookPayload` interface (also read by `attemptDispatch()`'s live-reconstruction branch, §6.5) gains:
```ts
end_client_id?: string | null   // additive, mirrors extraction_status?/action_items?/glitches?'s convention
```
(`partner_reference` is already a field on this interface — no shape change needed there, only its
resolved *value* changes.)

### 6.4 Migration `095_b2b34_client_id_architecture.sql`

```sql
-- B2B-34 Piece 2 — reseller/client architecture: client_id threading + the webhook partner_reference fix
-- (closed in application code, lib/partner/webhooks.ts — see docs/specs/B2B-34-requirement-document.md
-- Part B §6.3) + the auto-provisioned "self" client mechanism.

ALTER TABLE partner_accounts ADD COLUMN IF NOT EXISTS is_self_client BOOLEAN NOT NULL DEFAULT FALSE;

-- end_client_id: naming resolution in Part B §6.1 — deliberately NOT `client_id`, to avoid a code-level
-- grep/identifier collision with the pre-existing, unrelated `partner_oauth_clients.client_id` (migration
-- 079, B2B-06's OAuth2 Client Credentials identifier). Nullable everywhere: NULL for every
-- account_kind='partner'-authenticated session (client_id does not apply to direct partners, Part B §6.1),
-- always set for account_kind='channel_partner'-authenticated sessions (enforced at the API layer, not a
-- DB NOT NULL, so this column never blocks any other write path).
ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS end_client_id UUID
  REFERENCES partner_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_partner_sessions_end_client_id
  ON partner_sessions(end_client_id) WHERE end_client_id IS NOT NULL;

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS end_client_id UUID
  REFERENCES partner_accounts(id) ON DELETE SET NULL;

ALTER TABLE partner_session_insights ADD COLUMN IF NOT EXISTS end_client_id UUID
  REFERENCES partner_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN partner_accounts.is_self_client IS
  'B2B-34 Piece 2: true for the single auto-provisioned client row every channel_partner-kind reseller account gets at creation time, letting the reseller test/dispatch on their own behalf without first registering a real end-customer. Always account_kind=partner, owning_channel_partner_id set to the reseller. Never billed differently, never a peer to a real client beyond this flag.';
COMMENT ON COLUMN partner_sessions.end_client_id IS
  'B2B-34 Piece 2: the reseller''s end-customer this session is for. Required (enforced in application code, app/api/partner/v1/sessions/route.ts) for account_kind=channel_partner-authenticated sessions; NULL for account_kind=partner (direct-partner)-authenticated sessions, which this concept does not apply to. Deliberately named end_client_id, not client_id, to avoid colliding with the unrelated partner_oauth_clients.client_id (B2B-06). Wire/API field is still called client_id (docs/specs/B2B-34-requirement-document.md Part B §6.1).';
COMMENT ON COLUMN usage_events.end_client_id IS
  'B2B-34 Piece 2: resolved from partner_sessions.end_client_id at write time when clio_session_ref is set (lib/partner/webhooks.ts recordBillableEvent()). Powers Part E''s per-client usage breakdown. NULL wherever the originating session had no end_client_id.';
COMMENT ON COLUMN partner_session_insights.end_client_id IS
  'B2B-34 Piece 2: resolved from partner_sessions.end_client_id when this row is first upserted (inngest/partner-session-insights-extractor.ts). Threaded into the session.insights_ready webhook payload (lib/partner/webhooks.ts).';

-- Backfill: every existing live channel_partner account gets its self-client now (new accounts get one
-- automatically going forward via createOrClaimPartnerAccount(), Part B §6.2). Confirmed 6 live rows,
-- 2026-07-23 (docs/specs/B2B-34-requirement-document.md Part B §6.1).
INSERT INTO partner_accounts (name, archetype, status, account_kind, owning_channel_partner_id, is_self_client)
SELECT 'Self (direct sessions)', 'unspecified', 'active', 'partner', cp.id, TRUE
FROM partner_accounts cp
WHERE cp.account_kind = 'channel_partner'
  AND NOT EXISTS (
    SELECT 1 FROM partner_accounts existing_self
    WHERE existing_self.owning_channel_partner_id = cp.id AND existing_self.is_self_client = TRUE
  );
```

### 6.5 API contract changes

**`lib/partner/session-schema.ts` — `CreateSessionSchema`** gains:
```ts
client_id: z.string().uuid().optional(),
```
(Optional at the Zod layer — conditionally required is enforced imperatively in the route, §6.6, since
Zod schemas have no access to the resolved auth context at parse time.)

**`lib/partner/auth.ts` — `requirePartnerApiKey()`** — `PartnerApiKeyContext` gains:
```ts
accountKind: 'partner' | 'channel_partner'
```
Both the static-API-key branch and the OAuth2 branch's `partner_accounts` `SELECT` extend to include
`account_kind` (currently `'id, status'` in both branches → `'id, status, account_kind'`), and every
successful-result return object includes `accountKind: accountRow.account_kind`. Every error-result
branch's shape gains `accountKind: null` alongside the existing `partnerAccountId: null` etc. — zero
change to any existing caller's behavior (every existing caller ignores fields it doesn't read).

**`app/api/partner/v1/sessions/route.ts`** — new pre-flight block, inserted immediately after
`CreateSessionSchema.safeParse(body)` succeeds and before the Option-1 (inline content) pre-flight block
(so a bad `client_id` never creates a session row or triggers a content-source lookup, matching the
existing "no dispatch on validation failure" discipline already established for Option 1):

```ts
let endClientId: string | null = null
if (auth.accountKind === 'channel_partner') {
  if (!parsed.data.client_id) {
    return NextResponse.json(
      { error: { code: 'client_id_required', message: 'client_id is required for sales-partner accounts. Register a client first, or use your account\'s auto-provisioned self client (see your Clients page).' } },
      { status: 422 }
    )
  }
  const { data: clientRow } = await supabase
    .from('partner_accounts')
    .select('id')
    .eq('id', parsed.data.client_id)
    .eq('owning_channel_partner_id', auth.partnerAccountId)
    .maybeSingle()
  if (!clientRow) {
    return NextResponse.json(
      { error: { code: 'invalid_client_id', message: 'client_id was not found or is not registered to your account.' } },
      { status: 422 }
    )
  }
  endClientId = parsed.data.client_id
}
```
The `partner_sessions` insert gains `end_client_id: endClientId`.

**`lib/partner/webhooks.ts` — `recordBillableEvent()`** — before the `usage_events` insert, when
`params.clioSessionRef` is set, resolve `end_client_id` via one extra indexed lookup (zero call-site
changes required anywhere else in the codebase — `partner-live-cutoff.ts`, `partner-trial-cutoff.ts`, and
`handleSessionEnd()` all keep calling `recordBillableEvent()` exactly as they do today):
```ts
let endClientId: string | null = null
if (params.clioSessionRef) {
  const { data: sessionRow } = await supabase
    .from('partner_sessions')
    .select('end_client_id')
    .eq('id', params.clioSessionRef)
    .maybeSingle()
  endClientId = (sessionRow?.end_client_id as string | null) ?? null
}
```
`usage_events` insert gains `end_client_id: endClientId`; `WebhookPayload`'s `payload` object (built
earlier in the same function) also gains `end_client_id: endClientId`, for consistency across every event
type this function emits, not only `session.insights_ready`.

**`inngest/partner-session-insights-extractor.ts` — `runInsightsIdempotencyGuard()`'s initial upsert**
gains `end_client_id`, resolved from `extractInsightsForPartnerSession()`'s own `SELECT` (already extended
per §6.3 to include it) and threaded through as a new parameter to the guard function.

**`app/api/channel-partner/clients/[id]` (or the equivalent read used by `ClientDetailClient.tsx`)** — no
schema change; the existing `id` field returned by `listClientsForChannelPartner()`/
`requireChannelPartnerClientAccess()` is exactly the value displayed in the new "Client ID" card (§4) —
`ChannelPartnerClient` interface gains `is_self_client: boolean` (read straight through from the new
column) so the list page (§4) can render the "Self" badge and the dashboard card (§4) can exclude it from
its count.

### 6.6 Developer Portal documentation (extends B2B-07, no new docs surface)

Per the CEO brief's explicit constraint, the existing Developer Portal
(`/dashboard/configurator/developer`, live under B2B-07) gets two new example-schema blocks added to its
existing content — not built by this spec (copy/layout is Dev's normal implementation latitude for
documentation prose, not a new screen requiring wireframes), but the two required example payloads are
specified here so Dev builds the right content:

1. **"What you collect from your client before calling Clio"** (illustrative only, Clio never validates
   this): `{ topic, meeting_url, client_id }` — the minimum a reseller's own client-facing UI needs to
   gather before the reseller calls `POST /api/partner/v1/sessions`.
2. **"What you send onward to your client after Clio responds"** (illustrative only): the
   `session.insights_ready` webhook payload shape (§6.3), including the new `end_client_id` field, shown
   as an example of what a reseller might forward to their own client's system.

## 7. Success Criteria (Acceptance Tests)

✓ Given a `channel_partner`-authenticated request to `POST /api/partner/v1/sessions` with a valid,
owned `client_id`, when it succeeds, then `partner_sessions.end_client_id` is set to that value.

✓ Given the same request with a `client_id` belonging to a *different* reseller's client, when it's
submitted, then it 422s with `invalid_client_id` and no `partner_sessions` row is created.

✓ Given the same request with `client_id` omitted entirely, when it's submitted, then it 422s with
`client_id_required`.

✓ Given a `partner`-authenticated (direct-partner) request with no `client_id` in the body, when it's
submitted, then it succeeds exactly as it does today — zero regression for existing direct partners.

✓ Given a brand-new `channel_partner` account signup, when `createOrClaimPartnerAccount()` completes, then
exactly one `partner_accounts` row exists with `owning_channel_partner_id` set to the new account and
`is_self_client = true`, and that row's `id` is a valid `client_id` for that reseller's very first session.

✓ Given the 6 pre-existing live `channel_partner` accounts, when migration 095 runs, then each has exactly
one `is_self_client=true` row afterward (idempotent — running the backfill INSERT twice creates no
duplicates, per its own `NOT EXISTS` guard).

✓ Given a partner session ends and its insights extraction succeeds, when
`recordInsightsReadyEvent()` fires, then the delivered webhook payload's `partner_reference` field
matches the real value set at session creation (not `null`, unless the partner genuinely never set one),
and `end_client_id` matches `partner_sessions.end_client_id` for that session.

✓ Given the `Clio Internal — Public Demo` account (`account_kind='partner'`), when B2B-33's existing
dispatch flow runs unmodified after this Part ships, then it continues to succeed exactly as before —
zero code change, zero regression (cross-cutting decision #5).

✓ Given `/dashboard/channel-partner/clients/[id]` for any client, when the page loads, then a "Client ID"
card shows the raw UUID with a working Copy button.

✓ Given `/dashboard/channel-partner`'s dashboard, when it loads for a reseller with N real clients (plus
their 1 auto-provisioned self-client), then the "Clients" count shows N, not N+1.

## 8. Error States

| Call | Failure | Response |
|---|---|---|
| `POST /api/partner/v1/sessions`, `channel_partner` caller, no `client_id` | — | `422 { error: { code: 'client_id_required', message: '...' } }` |
| Same, `client_id` not found or not owned by caller | — | `422 { error: { code: 'invalid_client_id', message: '...' } }` |
| `applyWalletDecrement()`'s new `end_client_id` lookup (inside `recordBillableEvent()`) fails/errors | Supabase error on the lookup `SELECT` | Logged (`console.error`), `endClientId` stays `null` for that call — never blocks or reverses the `usage_events`/`webhook_dispatch_log` writes that already succeeded, mirroring this function's own existing "never fails the path that already worked" discipline |
| Self-client auto-provisioning insert fails at signup time | Any Supabase error | Logged, non-blocking — account creation still succeeds; reseller can add an equivalent client manually (§6.2) |
| Copy-button clipboard write fails (browser permission denied) | `navigator.clipboard.writeText` rejects | Button falls back to selecting the UUID text so the reseller can manually copy (standard `document.execCommand`/selection fallback — no error toast, this is a low-stakes convenience feature) |

## 9. Edge Cases

- **A reseller deletes/suspends their self-client.** No delete-client feature exists in this codebase
  today (`createClientForChannelPartner()` is create-only, confirmed by reading
  `app/dashboard/channel-partner/clients/*`) — this is unreachable at ship time. If a future brief adds
  client deletion/suspension, it must explicitly exclude `is_self_client=true` rows or provide a
  replacement mechanism — flagged here for that future work, not built now (out of scope, §10).
- **A reseller's self-client name is edited via some future "rename client" feature.** Also unreachable
  today (no edit-client feature exists) — `is_self_client` (not the name string) is always the
  authoritative identifier, so a future rename feature would not break this Part's logic even if it let
  the display name change.
- **Two near-simultaneous signups for the same brand-new reseller** (mirroring the existing
  `idx_partner_admin_users_one_owner_per_clerk_user` race already handled in this file) — the losing call
  deletes its own orphaned `partner_accounts` row (existing logic, unchanged) *before* this Part's
  self-client insert would ever run for it, so no orphaned self-client can result from that race.
- **A `channel_partner` account created before migration 095's backfill ran gets a session request in the
  gap between deploy and migration completion.** Standard single-atomic-deploy assumption applies (same
  as every other migration in this codebase) — not a new risk class introduced by this Part.
- **`end_client_id` on a `usage_events` row whose `clio_session_ref` points at a session that predates
  this Part** (none exist — `partner_sessions` total is 0 live rows, confirmed 2026-07-23) — moot at ship
  time, but the column's nullability handles it gracefully regardless (defensive `?? null` throughout).

## 10. Out of Scope

- Per-client billing/wallets — explicitly, permanently out of scope (Arun's own words: "we dont have
  access to reseller's client's usage allowance... we only track the usage against \[the reseller\]").
- Any server-to-server client-registration API — deliberately not built (Arun: "that way only reseller
  knows our application exists").
- Deleting or suspending a client (including the self-client) — no such feature exists yet; not built by
  this Part.
- The `app/dashboard/channel-partner/page.tsx` "Shared wallet billing for your clients is coming soon."
  placeholder line — **removed as part of this Part** (see below), since it now describes a feature that
  will never exist in this form; not replaced with new copy.

**Placeholder removal:** the `<Card>` block containing "Billing" / "Shared wallet billing for your
clients is coming soon." in `app/dashboard/channel-partner/page.tsx` (lines ~125–128) is deleted entirely
— per the CEO's own default recommendation, unchallenged: shipping this Part while that sentence stays on
screen would directly contradict what the dashboard tells its own users, since billing is confirmed
staying reseller-level-only, permanently, not "coming soon" as something else.

## 11. Open Questions

None.

## 12. Dependencies

- Part A (recommended sequencing, not a hard block — no file overlap).
- Blocks Part E (§0.1) — Part E cannot ship correctly without `end_client_id` existing and populated.
- No dependency on Part C or D.

---
---

# PART C — Piece 1: Demo Performance Tab
Version: 1.0 | Status: CEO REVIEW | Author: Business Analyst Agent | Date: 2026-07-23

## 1. Purpose

`/demo/{slug}`'s existing Meeting tab (B2B-33) proves Clio's bot can join a real meeting and narrate
content live — it does not show a prospective reseller the *other* half of Clio's value: that a session
produces real, usable post-meeting intelligence a reseller's own dashboard or CRM could consume. Without
this Part, a demo visitor sees the live-narration half of the product and never sees what they'd actually
get to act on afterward — duration, action items, and a genuinely useful read on what the learner cared
about (replacing the current generic tone-keyword extraction with something a reseller would actually
forward to their own sales/success team).

## 2. User Story

As a **prospective reseller evaluating Clio via the public demo**,
I want to see real post-meeting data (duration, action items, a learner insight) for the meeting I just
watched the bot join,
So that I can judge whether Clio's output is something I could actually act on with my own clients.

## 3. Trigger / Entry Point

- Route: `/demo/{slug}` (existing, public, no auth) — a new **Performance** tab is added to the existing
  tab row, positioned after **Learning Check** (last position), matching the CEO brief's own ordering
  ("Meeting / Learning Check / Performance").
- Triggered by: clicking the "Performance" tab (client-side state change, `DemoTopicClient.tsx`'s existing
  `activeTab` pattern — no new route, no page reload).
- Data fetch: a `GET` request fires the first time this tab is selected (or eagerly on mount alongside the
  existing Meeting-tab fetch — BA's call: **eager on mount**, matching the existing `savedMeetingUrl` fetch
  pattern already in this component, so switching to the tab never shows an avoidable loading flash for
  data that could have already arrived).
- State required: none (public page, no login, no onboarding gate — identical posture to every other tab).

## 4. Screen / Flow Description

**Tab row:** `TABS` constant in `DemoTopicClient.tsx` becomes
`['Course Overview', 'Transcript', 'Visuals', 'Resources', 'Discussion', 'Meeting', 'Learning Check', 'Performance']`.

**Performance tab content — four states, driven by `GET /api/demo/[slug]/performance`'s `session_state`
field (§6.2):**

**State P-Empty (`session_state: 'not_dispatched'`)** — no meeting has ever been dispatched for this
topic (or the one dispatch attempt on record failed before the bot ever joined):
- Heading (dimmed treatment, matching the Meeting tab's own D1 dimmed/disabled visual language): "No
  meeting dispatched yet."
- Body copy: "Once the bot has joined a meeting for this course, its performance data will appear here."

**State P-Pending (`session_state: 'in_progress'` or `'pending_extraction'`)** — a meeting was dispatched
and is either still running, or has ended but the post-meeting analysis hasn't finished yet:
- Heading: "Performance data is being prepared."
- Body copy: "This usually takes a few minutes after the meeting ends. Check back shortly."

**State P-Failed (`session_state: 'extraction_failed'`)**:
- Heading: "Performance data couldn't be generated."
- Body copy: "Something went wrong analyzing this meeting. Contact Clio if this keeps happening."
  (public-safe, no vendor name, matching B2B-33's own established convention for this exact class of
  message)

**State P-Ready (`session_state: 'ready'`)** — three sections, in this order:

1. **Duration** — heading "Duration", then either `"{duration_minutes} minutes"` (e.g. "8.5 minutes",
   one decimal place) when `duration_minutes` is non-null, or the muted text "Not available" when it is
   null (never an error message — matches the "fail closed, no vendor detail" convention).
2. **Action items** — heading "Action items", then either a bulleted list of each item's `text`, or, when
   the array is empty, the muted text "No action items were identified in this session."
3. **Learner insight** — heading "Learner insight", then, when `learner_insight` is non-null:
   - The `summary` string, rendered as a lead paragraph.
   - "Topics of interest" — a row of pill/chip elements (reusing the existing `pillStyle` from
     `_styles.ts`), one per `topics_of_interest[]` entry; if empty, omit this sub-row entirely (not an
     empty pill row).
   - "Engagement style" — the `engagement_style` string, rendered as a labeled line.
   - "Suggested next topics" — a row of pill/chip elements, one per `suggested_next_topics[]` entry; if
     empty, omit this sub-row entirely.
   When `learner_insight` is `null` (the `success_empty` case — an ended meeting with zero transcript
   content, §6.4): muted text "No learner insight was generated for this session." replaces the whole
   section.

## 5. Visual Examples

**State P-Empty:**
```
┌─────────────────────────────────────────┐
│  [Tabs: ... | Learning Check | Performance*]│
│                                           │
│  No meeting dispatched yet.              │
│  Once the bot has joined a meeting for   │
│  this course, its performance data will  │
│  appear here.                            │
└─────────────────────────────────────────┘
```

**State P-Pending:**
```
┌─────────────────────────────────────────┐
│  Performance data is being prepared.     │
│  This usually takes a few minutes after  │
│  the meeting ends. Check back shortly.   │
└─────────────────────────────────────────┘
```

**State P-Failed:**
```
┌─────────────────────────────────────────┐
│  Performance data couldn't be generated. │
│  Something went wrong analyzing this     │
│  meeting. Contact Clio if this keeps     │
│  happening.                              │
└─────────────────────────────────────────┘
```

**State P-Ready:**
```
┌─────────────────────────────────────────┐
│  Duration                                 │
│  8.5 minutes                              │
│                                            │
│  Action items                             │
│  • Review the AI vendor shortlist ...     │
│  • Schedule a follow-up with the team     │
│                                            │
│  Learner insight                          │
│  This person is weighing build-vs-buy     │
│  and wants concrete cost comparisons      │
│  before their next call.                  │
│                                            │
│  Topics of interest                       │
│  [pricing tiers] [integration timeline]   │
│                                            │
│  Engagement style                         │
│  Asks pointed, comparison-driven          │
│  questions; pushes back on vague answers. │
│                                            │
│  Suggested next topics                    │
│  [ROI case study] [implementation FAQ]    │
└─────────────────────────────────────────┘
```

## 6. Data Requirements

### 6.1 New env var

`DEMO_PARTNER_ACCOUNT_ID` — the `partner_accounts.id` of "Clio Internal — Public Demo" (confirmed live:
`30d40f51-5d6e-49e9-bdda-519b7d70e13a`). One-time infra step, mirroring `DEMO_CONTENT_SOURCE_ID`'s
existing precedent (a value the Orchestrator sets once, not code this Part's Dev agent writes). Added to
`.env.local.example` as `DEMO_PARTNER_ACCOUNT_ID=PLACEHOLDER_DEMO_PARTNER_ACCOUNT_ID`.

### 6.2 New route: `GET /api/demo/[slug]/performance`

Public, no auth, no passcode (read-only, matches `GET /api/demo/[slug]/meeting`'s existing posture — no
rate limiting needed either, since this triggers no vendor-mutating action, only a read).

**Session resolution** (the "currently-dispatched meeting" for this slug — `demo_meeting_urls` itself
carries no session reference, confirmed by reading its schema, migration in `docs/specs/
B2B-33-requirement-document.md` §0 row 1; B2B-33's dispatch route sets `partner_reference: params.slug`
on every dispatch, confirmed by reading `app/api/demo/[slug]/dispatch/route.ts` line 88 — this Part reuses
that existing field as the correlation key, adding no new column anywhere):

```sql
SELECT id, status, hume_chat_id, created_at
FROM partner_sessions
WHERE partner_account_id = $DEMO_PARTNER_ACCOUNT_ID AND partner_reference = $slug
ORDER BY created_at DESC LIMIT 1
```

**`session_state` resolution:**
- No row found, **or** the row's `status = 'failed'` (dispatch itself never succeeded — B2B-33's own
  dispatch route already prevents a failed dispatch from ever reaching the browser as a reported success,
  so this branch is defensive, matching that spec's own "should be unreachable via normal UI" pattern) →
  `'not_dispatched'`
- Row found, `status IN ('requested', 'active')` → `'in_progress'`
- Row found, `status = 'completed'`, and either no `partner_session_insights` row exists yet for this
  `partner_session_id`, or one exists with `extraction_status = 'pending'` → `'pending_extraction'`
- `partner_session_insights.extraction_status = 'failed'` → `'extraction_failed'`
- `partner_session_insights.extraction_status IN ('success', 'success_empty')` → `'ready'`

**`duration_minutes` resolution** — independent of `session_state` (computed whenever
`partner_sessions.hume_chat_id` is non-null, live, via `fetchHumeChatDuration()`, reused verbatim per the
CEO brief's explicit instruction, never re-implemented): call `fetchHumeChatDuration(hume_chat_id)`; on
`{ok:true}`, `duration_minutes = Math.round((durationSeconds / 60) * 10) / 10` (one decimal place); on
`{ok:false}` (any reason — including "still in progress," which is the expected, non-error outcome while
`session_state` is `'in_progress'`), `duration_minutes = null`. Never surfaced as an error to the visitor
— always renders as "Not available" per §4.

**`action_items` / `learner_insight` resolution** — read directly from the resolved
`partner_session_insights` row (only when `session_state = 'ready'`; `null`/`[]` for every other state, no
extra query).

Response contract:
```ts
type PerformanceResponse = {
  session_state: 'not_dispatched' | 'in_progress' | 'pending_extraction' | 'extraction_failed' | 'ready'
  duration_minutes: number | null
  action_items: { text: string }[] | null
  learner_insight: {
    summary: string
    topics_of_interest: string[]
    engagement_style: string
    suggested_next_topics: string[]
  } | null
}
```
Always `200` — there is no error state at the HTTP layer for this read-only, no-input route (an unknown
`slug` 404s exactly like every other `/api/demo/[slug]/*` route, matching `dispatch/route.ts`'s own
`getDemoTopicBySlug()` guard).

### 6.3 `learner_insight` — schema change to `PartnerInsightsExtractionSchema`

`inngest/partner-session-insights-extractor.ts`:

```ts
const LearnerInsightSchema = z.object({
  summary: z.string().min(1),
  topics_of_interest: z.array(z.string()),
  engagement_style: z.string().min(1),
  suggested_next_topics: z.array(z.string()),
})
export const PartnerInsightsExtractionSchema = z.object({
  action_items: z.array(PartnerActionItemSchema),
  glitches: z.array(PartnerGlitchSchema),
  learner_insight: LearnerInsightSchema,
})
```
(`psychology_keywords: z.array(z.string())` removed — the shape above is the CEO-approved, settled shape
from the brief, carried through unchanged per the brief's own explicit instruction not to reopen it.)

**System prompt** (`PARTNER_INSIGHTS_SYSTEM_PROMPT`) — point 3 replaced:

> 3. **Learner insight** — a single object capturing what this specific person cares about and how they
> engage, so a reseller knows what to show them next:
>    - `summary`: 1–2 sentences — what this person cares about and what to show them next. Base this only
>      on what the transcript actually contains.
>    - `topics_of_interest`: specific subtopics they leaned into, drawn from actual conversation content —
>      never generic category labels.
>    - `engagement_style`: HOW they engage, inferred from their question pattern and interaction style
>      (e.g. "asks pointed, comparison-driven questions" or "listens fully before asking clarifying
>      questions") — describe their *behavior*, never their emotional/psychological state. Do not use
>      words like confused, frustrated, hesitant, skeptical, or any other tone/mood descriptor — those
>      describe glitches (see #2), not engagement style. If you would reach for a mood word, describe the
>      observable behavior instead (e.g. not "hesitant" but "asked to repeat the same question twice
>      before moving on").
>    - `suggested_next_topics`: your own inferred recommendation for what to show this learner next, based
>      on what they engaged with.

(The explicit "never a mood word, describe behavior instead" instruction directly implements the CEO
brief's own flagged nuance — "engagement_style: confused and frustrated" reading uncomfortably close to a
glitch signal — as a concrete prompt constraint, not just a design note.)

JSON shape line updated to:
```
{"action_items": [...], "glitches": [...], "learner_insight": {"summary": string, "topics_of_interest": [string], "engagement_style": string, "suggested_next_topics": [string]}}
```

**Mock fallback** (`isPlaceholder` branch) returns:
```ts
learner_insight: {
  summary: '[MOCK] This learner is weighing build-vs-buy and wants concrete cost comparisons.',
  topics_of_interest: ['[mock] pricing tiers', '[mock] integration timeline'],
  engagement_style: '[MOCK] Asks pointed, comparison-driven questions.',
  suggested_next_topics: ['[mock] ROI case study', '[mock] implementation FAQ'],
},
```
(replaces the old `psychology_keywords: ['[mock]-placeholder-keyword']` line).

### 6.4 The empty-transcript case (`success_empty`) — new design decision, not addressed by the brief

Today, when `messageLines.length === 0` (no transcript content at all), the code short-circuits before
ever calling Claude and hardcodes `psychologyKeywords: []`. Forcing an equivalent non-null
`learner_insight` object out of zero transcript content would mean fabricating a summary from nothing —
directly against this same system prompt's own "never fabricate content to avoid an empty array/result"
instruction (already present, applies equally to the new field). **Resolution: the `messageLines.length
=== 0` branch sets `learner_insight: null`** (not an empty-but-present object) — `partner_session_insights.
learner_insight` stores SQL `NULL` for this case, and §4's P-Ready state already specifies the exact copy
for a `null` `learner_insight` ("No learner insight was generated for this session.").

`extractInsightsForPartnerSession()`'s `isEmpty`/`result.status` logic is redefined to **not** include
`learner_insight` in the emptiness check (the old check was
`action_items.length===0 && glitches.length===0 && psychology_keywords.length===0`) — a session can have
zero action items and zero glitches while still producing a genuinely useful `learner_insight` from real
transcript content, and that should count as `'success'`, not `'success_empty'`. New check:
```ts
const isEmpty = data.action_items.length === 0 && data.glitches.length === 0
```
`success_empty` is now reserved for exactly one case: zero transcript lines (short-circuited before
Claude is ever called) — the Claude-call branch always produces `extraction_status: 'success'`, since a
real transcript with content always yields at least a `learner_insight`.

### 6.5 Migration `096_b2b34_learner_insight_schema.sql`

```sql
-- B2B-34 Piece 1 — replaces psychology_keywords with the settled learner_insight shape (CEO-approved,
-- unchanged in this migration — see docs/specs/B2B-34-requirement-document.md Part C §6.3).
-- Confirmed zero live rows depend on the old column: partner_session_insights total row count = 0
-- (query below, run against project nqxlpcshouboplhnuvrh, 2026-07-23) — clean swap, no backfill needed.
--   SELECT count(*) FROM partner_session_insights;  -- => 0
-- Also confirmed (per the extractor file's own doc comment, read in full) psychology_keywords has never
-- been sent over the wire to any real partner webhook — it was always reconstructed live by
-- attemptDispatch() at delivery time from whatever the column currently holds, so there is no historical
-- delivered-payload record depending on the old shape either.

ALTER TABLE partner_session_insights DROP COLUMN IF EXISTS psychology_keywords;
ALTER TABLE partner_session_insights ADD COLUMN IF NOT EXISTS learner_insight JSONB DEFAULT NULL;

COMMENT ON COLUMN partner_session_insights.learner_insight IS
  'B2B-34 Piece 1 (replaces psychology_keywords, 2026-07-23): {summary, topics_of_interest[], engagement_style, suggested_next_topics[]} — an actionable read on what this learner cares about, replacing generic tone keywords. NULL when the source transcript had zero content (success_empty). Powers the demo /demo/{slug} Performance tab and, for opted-in partners, the session.insights_ready webhook. See docs/specs/B2B-34-requirement-document.md Part C.';

-- Purge RPC updated to purge learner_insight instead of psychology_keywords (CEO brief Q3, confirmed:
-- yes, the RPC's column list needs updating).
CREATE OR REPLACE FUNCTION purge_partner_session_insights_full_detail(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH purged AS (
    UPDATE partner_session_insights
    SET
      action_items = NULL,
      learner_insight = NULL,
      glitches = CASE
        WHEN glitches IS NULL OR jsonb_array_length(glitches) = 0 THEN glitches
        ELSE (
          SELECT jsonb_agg(jsonb_build_object('type', g->>'type'))
          FROM jsonb_array_elements(glitches) AS g
        )
      END,
      full_detail_purged_at = now()
    WHERE full_detail_purged_at IS NULL
      AND extracted_at IS NOT NULL
      AND extracted_at < p_cutoff
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM purged;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
```

### 6.6 `attemptDispatch()` live-reconstruction update (`lib/partner/webhooks.ts`)

The `'session.insights_ready'` branch's `SELECT` on `partner_session_insights` extends from
`'action_items, glitches, psychology_keywords'` to `'action_items, glitches, learner_insight'`, and the
`fullPayload` object's `psychology_keywords: ...` line becomes `learner_insight: (live?.learner_insight as
WebhookPayload['learner_insight']) ?? null`. `WebhookPayload.psychology_keywords?: string[] | null` is
replaced with `learner_insight?: { summary: string; topics_of_interest: string[]; engagement_style: string; suggested_next_topics: string[] } | null`.

## 7. Success Criteria (Acceptance Tests)

✓ Given no `partner_sessions` row exists for a slug, when `GET /api/demo/[slug]/performance` is called,
then `session_state: 'not_dispatched'`.

✓ Given a dispatched session with `status='active'`, when called, then `session_state: 'in_progress'` and
`duration_minutes: null`.

✓ Given a `status='completed'` session with no `partner_session_insights` row yet, when called, then
`session_state: 'pending_extraction'`.

✓ Given `extraction_status='failed'`, when called, then `session_state: 'extraction_failed'`.

✓ Given `extraction_status='success'` with real `action_items`/`learner_insight`, when called, then
`session_state: 'ready'` and both fields are populated.

✓ Given `extraction_status='success_empty'` (zero transcript content), when called, then `session_state:
'ready'`, `action_items: []`, `learner_insight: null` — and the tab renders "No learner insight was
generated for this session." not an error.

✓ Given a `hume_chat_id` whose Hume chat has ended, when the route calls `fetchHumeChatDuration()`, then
`duration_minutes` reflects `(end_timestamp - start_timestamp) / 60`, rounded to 1 decimal.

✓ Given a Claude extraction call with real transcript content, when `PartnerInsightsExtractionSchema`
validates the response, then `psychology_keywords` is rejected (schema no longer accepts it) and
`learner_insight`'s 4 fields are all required and present.

✓ Given the demo page, when a visitor clicks the "Performance" tab before any dispatch, then they see
State P-Empty, never a loading spinner that never resolves.

✓ Given glitches ever appear in `partner_session_insights.glitches` for a session, when the Performance
tab renders, then glitches are never displayed anywhere on this tab (confirmed by the response contract
itself never including a `glitches` field).

## 8. Error States

| Call | Failure | Behavior |
|---|---|---|
| `fetchHumeChatDuration()` returns `{ok:false}` for any reason | network error, timeout, missing timestamps, unconfigured key | `duration_minutes: null`, rendered as "Not available" — never an error message, matches B2B-33's public-safe convention |
| `GET /api/demo/[slug]/performance` for an unknown `slug` | — | `404`, matching every other `/api/demo/[slug]/*` route's existing `getDemoTopicBySlug()` guard |
| Claude extraction call fails/times out (existing, unchanged) | — | `extraction_status='failed'` after 3 attempts (existing idempotency-guard behavior, unchanged by this Part) → Performance tab shows State P-Failed |
| Frontend fetch to `/api/demo/[slug]/performance` fails (network) | — | Tab falls back to State P-Pending's visual treatment (fails toward "still processing," never toward showing stale/fabricated data) — mirrors the Meeting tab's own "fails closed" convention |

## 9. Edge Cases

- **A slug has multiple past dispatches** (the demo operator re-dispatched the bot several times over
  weeks). Only the most recent (`ORDER BY created_at DESC LIMIT 1`) is ever shown — matches "the currently
  dispatched meeting" framing in the CEO brief exactly.
- **A session is dispatched, the bot joins, then the meeting is abandoned/never properly ended** (Hume
  never gets an `end_timestamp`, `partner_sessions.status` never reaches `'completed'` via the normal
  path — but Piece 4's/the existing cutoff jobs eventually force it to `'completed'`). Once `status`
  reaches `'completed'` (by any path, including a forced cutoff), the normal `pending_extraction` →
  `ready`/`extraction_failed` progression applies unchanged.
- **Mobile.** Per the standing responsive rule, this is new screen content on an existing responsive page
  (`DemoTopicClient.tsx` already uses `clamp()`-based fluid spacing throughout) — the Performance tab's
  content reuses the exact same `chapterBodyStyle`/`pillStyle`/`listStyle` primitives already proven
  responsive on this page; no new layout primitive is introduced.
- **Slow network on first load.** The eager-on-mount fetch (§3) means the tab may show its own brief
  loading state (a muted "Loading…" line, matching the Meeting tab's own lack-of-spinner-for-fast-fetches
  precedent) for the fraction of a second before `session_state` resolves — never a layout shift once
  resolved, since all four states render inside the same fixed content area.

## 10. Out of Scope

- Glitches on this tab, under any circumstance (per the CEO's own explicit, emphatic instruction) — they
  have their own channel (B2B-17's glitch tracker, the existing webhook).
- Any dollar/cost estimate alongside duration — explicitly excluded per the brief ("no dollar estimate,
  since this is a demo/reseller-facing informational tab, not a billing statement").
- A history of past dispatches for a slug — only the most recent is ever shown.
- Any change to the Meeting tab, dispatch flow, or passcode gating — all unchanged, reused verbatim.

## 11. Open Questions

None.

## 12. Dependencies

- Reuses `fetchHumeChatDuration()` verbatim (`lib/voice/hume-native/session-details.ts`) — no
  reimplementation.
- Reuses B2B-33's `partner_reference = slug` convention as the session-correlation key — no new column.
- `DEMO_PARTNER_ACCOUNT_ID` env var must be set (one-time infra step, §6.1) before this Part's route can
  resolve any session.
- No dependency on Part A, B, or D — fully independent, can build in parallel with Part D.

---
---

# PART D — Piece 4: Hume-Verified Adaptive Session Cutoff
Version: 1.0 | Status: CEO REVIEW | Author: Business Analyst Agent | Date: 2026-07-23

## 1. Purpose

`inngest/partner-live-cutoff.ts` computes a session's affordable-minutes budget once at initiation and
then blindly counts down on Inngest's own sleep-timer clock — it never re-verifies elapsed time against
Hume's own ground truth. If Hume's clock and Inngest's sleep-duration clock ever drift (server restart,
scheduling jitter, a provider-level pause/resume), this job has no way to notice, and a session could run
longer than its budget without Clio ever detecting the overrun. Without this Part, the existing blind
countdown remains the only mechanism, and Clio has no way to catch the exact class of drift Arun has
flagged as the reason he doesn't trust Hume webhooks blindly elsewhere in this codebase.

## 2. User Story

As **Clio (the business)**,
I want mid-session cutoff timing to be periodically re-verified against Hume's own authoritative clock for
accounts already close to their usage limit,
So that a clock-drift scenario cannot let a session run meaningfully over its paid-for budget undetected.

## 3. Trigger / Entry Point

Not a new trigger — a modification to the existing `partnerLiveCutoffJob` (`inngest/
partner-live-cutoff.ts`), triggered exactly as it is today by the `clio/partner-live.started` event, emitted
from `app/api/partner/v1/sessions/route.ts` when an inline (Option 1) live session's affordable-minutes
budget is finite (unchanged trigger condition).

## 4. Screen / Flow Description

No UI screen — this is a backend job. The one user-observable behavior, unchanged from today: the
wrap-up nudge text delivered to the live render client, and the clean bot-leave at cutoff. Both reuse the
exact existing mechanism (`wrap_up_pending`/`wrap_up_nudge_text` fields, `deleteBot()`, `mark-session-
completed`) — nothing new is added to what the end user (the meeting attendee) ever sees.

## 5. Visual Examples

Not applicable — no screen.

## 6. Data Requirements

### 6.1 The gate — unchanged from the CEO's own confirmed design

At job start (immediately after receiving the `clio/partner-live.started` event), check
`partner_wallets.low_balance_alert_fired_at IS NOT NULL` for `event.data.partnerAccountId` (reuses the
**existing** `checkLowBalanceAndAlert()` mechanism verbatim, `lib/partner/webhooks.ts`, fires at ≤20%
balance remaining / 80% consumed). If `NULL` (account below 80% used at session start): the job runs
**exactly as it does today, byte-for-byte** — no Hume verification, no behavior change, confirmed
additive-only per the CEO's own explicit requirement.

### 6.2 Tiered polling — exact schedule, generalized to any starting budget

When the gate is met (`low_balance_alert_fired_at IS NOT NULL` at job start), the job's sleep structure is
replaced with a loop of variable-length `step.sleep()` calls (confirmed against the CEO's own framing — a
single job with a loop, no new Inngest function/job class), tiered by **remaining** affordable minutes at
the start of each cycle, not by the session's original starting budget (so a session starting with only 12
minutes begins directly in the correct tier):

| Remaining minutes | Check interval |
|---|---|
| > 30 | 30 min |
| 10–30 | 10 min |
| 5–10 | 5 min |
| < 5 | 1 min |

Each cycle: `step.sleep()` for the current tier's interval (capped at whatever remains, so the final
cycle never oversleeps past the budget), then a `step.run()` that:
1. Re-checks `partner_sessions.status` (existing pattern, unchanged) — if already `completed`/`failed`,
   return.
2. Calls the new lighter-weight Hume fetch (§6.3) for `hume_chat_id` to get real elapsed time.
3. On a successful fetch: recomputes `remainingMinutes = affordableMinutes - (realElapsedSeconds / 60)`.
   If `remainingMinutes <= (courtesy grace, §6.4)`, proceed directly to the existing nudge/force-end
   sequence (§6.5) instead of continuing the loop.
4. On a failed fetch (§6.4): **fall back to assuming the Inngest clock is correct for this one cycle** —
   proceed to the next tier's sleep using the *Inngest-clock-computed* remaining time (i.e., behave
   exactly as the pre-existing blind-countdown logic would for this one cycle), and retry Hume
   verification on the next cycle.

### 6.3 Hume fetch function — confirmed resolution (CEO brief Q2)

**Reuse `fetchHumeChatDuration()` as-is — no new sibling function.** Its existing semantics (a missing
`end_timestamp` → `{ok:false, reason:'missing_timestamps'}`) are exactly the correct, safe outcome for
Piece 4's in-progress-call use case too: a still-running call *should* look exactly like "unavailable" to
this caller, and "unavailable" already maps directly to the fallback behavior in §6.2 point 4 (fall back
to the Inngest clock for this cycle) — there is no daylight between "duration data unavailable" and "skip
this cycle, trust the Inngest clock." Building a second function that returns only `start_timestamp` would
add a near-duplicate `fetch()` call for zero behavioral gain, since `fetchHumeChatDuration()`'s existing
`{ok:true, durationSeconds}` result already gives Piece 4 everything it needs (elapsed time), and its
`{ok:false}` result already gives Piece 4 exactly the safe fallback signal it needs. **Confirmed: reuse
verbatim, both call sites (Part C's duration display and Part D's mid-session check) share one function.**

### 6.4 Fail-safe direction — confirmed resolution (CEO brief Q1)

**"Assume Inngest's clock for this cycle, retry Hume verification next cycle"** — the CEO's own default
lean, confirmed sound and adopted as-is: a single missed verification cycle at the tightest (1-minute)
tier is a small, bounded risk (at most ~1 extra minute of unverified runway before the next check), and
the job's own final safety net — the existing `mark-session-completed` step, which always fires once the
nudge/runway sequence completes regardless of whether Hume verification ever succeeded mid-session — still
guarantees the session cannot run forever even if every single Hume check in a session's lifetime fails.
This correctly weighs cost-overrun risk (small, bounded) against false-positive-disconnect risk (a
transient Hume API blip force-ending a real, paying customer's live session would be strictly worse).

**Courtesy grace:** ~1 minute (tightened from Arun's original flat 5-minute floor per the CEO's own
correction, "so the '~1 minute courtesy grace' promise is accurate rather than allowing up to 5 minutes of
undetected overage") — i.e., the nudge/force-end sequence triggers once real elapsed time crosses
`affordableMinutes - 1 minute`, not exactly at the boundary, consistent across every tier.

### 6.5 Nudge/force-end sequence — reused verbatim, zero new code

Once triggered (either by the tiered-loop's own detection, §6.2 point 3, or — when the gate was never met
— by the existing two-phase sleep reaching its end exactly as today), the **existing** `arm-wrap-up-nudge`
→ `wrap-up-runway` sleep → `check-session-status` → `leave-bot` → `mark-session-completed` →
`record-billable-events` sequence runs completely unchanged. This Part adds no new step here — the tiered
loop simply changes *when* this existing sequence is entered, never *what* it does.

### Exact restructured function shape

```ts
export const partnerLiveCutoffJob = inngest.createFunction(
  { id: 'partner-live-cutoff', name: 'Partner Live Wallet Cutoff',
    triggers: [{ event: 'clio/partner-live.started' }],
    cancelOn: [{ event: 'clio/partner-live.ended', match: 'data.clioSessionRef' }],
    concurrency: { key: 'event.data.clioSessionRef', limit: 1 }, retries: 1 },
  async ({ event, step }) => {
    const { clioSessionRef, partnerAccountId, providerBotId, affordableMinutes } = event.data

    const humeVerificationGated = await step.run('check-verification-gate', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase.from('partner_wallets').select('low_balance_alert_fired_at')
        .eq('partner_account_id', partnerAccountId).maybeSingle()
      return data?.low_balance_alert_fired_at != null
    })

    if (!humeVerificationGated) {
      // EXACT existing two-phase logic, byte-for-byte unchanged — see current file.
    } else {
      // Tiered loop (§6.2), reusing fetchHumeChatDuration() (§6.3), 1-minute courtesy grace (§6.4),
      // then falls through into the SAME nudge/force-end sequence (§6.5) the existing code already has.
    }
  },
)
```

## 7. Success Criteria (Acceptance Tests)

✓ Given an account below 80% usage, when a live session starts, then the job runs the existing two-phase
logic with zero behavior change (regression test against the current file's own tests, if any exist, plus
this Part's new tests).

✓ Given an account above 80% usage and a session with 45 affordable minutes, when the job starts, then it
enters the 30-minute-tier loop (not immediately the 10-minute tier).

✓ Given an account above 80% usage and a session with only 8 affordable minutes, when the job starts,
then it enters the 5-minute tier directly (not the 30- or 10-minute tier).

✓ Given a tiered-loop cycle where `fetchHumeChatDuration()` returns `{ok:true}` and real elapsed time
shows only 0.5 minutes remain (crossing the ~1-minute courtesy grace), when that cycle's check runs, then
the job proceeds directly into the nudge/force-end sequence, skipping any further sleep cycles.

✓ Given a tiered-loop cycle where `fetchHumeChatDuration()` returns `{ok:false}`, when that cycle's check
runs, then the job logs the failure, proceeds to the next tier using the Inngest-clock-computed remaining
time, and does not force-end the session on that cycle alone.

✓ Given every single Hume check across a session's lifetime fails, when the session's Inngest-clock budget
is exhausted, then `mark-session-completed` still fires exactly as it does in the ungated path — the
session is never left running forever.

✓ Given `inngest/partner-trial-cutoff.ts` and `inngest/session-timer.ts`, when this Part ships, then
neither file has any diff — confirmed out of scope, verified by `git diff` showing zero changes to either.

## 8. Error States

| Scenario | Handling |
|---|---|
| `fetchHumeChatDuration()` network error/timeout mid-tier | Logged, fall back to Inngest clock for this cycle (§6.4) |
| `partner_wallets` gate-check query fails | Treated as gate-not-met (`humeVerificationGated = false`) — falls back to the existing, already-proven-safe ungated behavior rather than risking an unverified new code path on a query failure |
| Session ends normally mid-loop | `cancelOn: [{ event: 'clio/partner-live.ended', ... }]` cancels the whole job, unchanged from today — no special handling needed inside the loop itself |

## 9. Edge Cases

- **A session crosses the 80%-usage gate threshold mid-session** (the account wasn't at 80% when this
  session started, but a *different* concurrent session for the same account pushes it there). The gate is
  checked only once, at this job's own start — not re-evaluated mid-session. This is a deliberate,
  bounded scope decision (re-checking a cross-session global state mid-loop would add real complexity for
  a narrow edge case) — flagged here as accepted, not silently decided: the existing blind-countdown
  safety net still applies to this session regardless.
- **`affordableMinutes` is very small (e.g. 1 minute) and the gate is met.** The tiered loop starts
  directly in the < 5-minute (1-minute-interval) tier and immediately checks — behaves correctly, no
  divide-by-zero or negative-sleep risk (every `step.sleep()` duration is capped at whatever genuinely
  remains, per §6.2).
- **Concurrent sessions for the same `clioSessionRef`** — already prevented by the existing
  `concurrency: { key: 'event.data.clioSessionRef', limit: 1 }` config, unchanged.

## 10. Out of Scope

- `inngest/partner-trial-cutoff.ts` and `inngest/session-timer.ts` — explicitly untouched, per the CEO
  brief's own hard constraint.
- Any change to the 80%-gate threshold value itself, or to `checkLowBalanceAndAlert()`'s own logic —
  reused read-only.
- Re-evaluating the gate mid-session (see Edge Cases above).

## 11. Open Questions

None.

## 12. Dependencies

- Reuses `fetchHumeChatDuration()` verbatim — shared with Part C, no reimplementation, no new function.
- Reuses `partner_wallets.low_balance_alert_fired_at` — existing column, existing mechanism, read-only.
- No migration.
- No dependency on Part A, B, or C — fully independent, can build in parallel with Part C.

---
---

# PART E — Piece 3: Super-Admin Minutes Usage
Version: 1.0 | Status: CEO REVIEW | Author: Business Analyst Agent | Date: 2026-07-23

## 1. Purpose

Arun (as super-admin) has no current view of how much usage each reseller is driving, or which of a
reseller's clients are the heavy users — both needed for account-management conversations with resellers
and for understanding Clio's own real cost exposure. Without this Part, that information exists only as
raw rows in `usage_events`, not as a usable report anywhere in the admin dashboard.

## 2. User Story

As **Clio's super-admin (Arun)**,
I want to see each reseller's total minutes usage (including all their clients) on the sales-partners
roster, and drill into a per-client breakdown for any one reseller,
So that I can have informed account-management conversations and understand cost exposure per reseller.

## 3. Trigger / Entry Point

- `/dashboard/admin/sales-partners` (existing, `requireSuperAdmin()`-gated, list page) — no new route.
- `/dashboard/admin/sales-partners/[id]` (existing, same gate, detail page) — no new route.
- Both pages' existing `GET /api/admin/sales-partners` and `GET /api/admin/sales-partners/[id]` routes are
  extended, not replaced.

## 4. Screen / Flow Description

**List page (`SalesPartnersClient.tsx`) — new sortable column.** `COLUMNS` gains a new entry between
`team_count` and `status`:
```ts
{ key: 'minutes_30d', label: 'Minutes (30d)' },
```
Rendered per row as a plain right-aligned number (no decimals — minutes are summed as whole numbers for
this headline figure, rounded), sortable exactly like every other column (reuses the existing
`sortRows()`/`ArrowUpDown` pattern verbatim, no new sort logic needed beyond adding `minutes_30d` to the
numeric-comparison branch, which it already falls into since it's not `'name'`/`'status'`/`'created_at'`).

**Detail page (`SalesPartnerDetailClient.tsx`) — new "Usage" card**, inserted between the existing
"Clients" card and "Team" card:
- Heading: "Usage"
- Two headline numbers side by side: "**{minutes_30d}** minutes (last 30 days)" and "**{minutes_all_time}**
  minutes (all time)"
- Below: a per-client breakdown table, columns "Client" / "Minutes (30d)", one row per distinct
  `end_client_id` seen in the trailing-30-day window (including the reseller's own self-client, labeled
  with its real name — "Self (direct sessions)" — no special-casing needed, since it's already a normal
  `partner_accounts` row with a name), sorted descending by minutes. If zero usage in the last 30 days:
  "No usage in the last 30 days." (muted text, no empty table).

## 5. Visual Examples

**List page — new column:**
```
┌──────────────────────────────────────────────────────────┐
│ Name          Clients  Team  Minutes (30d)  Status  Signed up │
│ Acme Reseller     3     2         142        Active   Jun 12  │
│ Beta Co           1     1          18        Active   Jul 02  │
└──────────────────────────────────────────────────────────┘
```

**Detail page — new "Usage" card:**
```
┌─────────────────────────────────────────┐
│  Usage                                    │
│  142 minutes (last 30 days)               │
│  598 minutes (all time)                   │
│                                            │
│  Client                    Minutes (30d)  │
│  Acme Corp                       89       │
│  Self (direct sessions)          31       │
│  Beta Client LLC                 22       │
└─────────────────────────────────────────┘
```

## 6. Data Requirements

### 6.1 Query shape (both queries share the same `WHERE` predicate the existing index already covers)

**List page — per-reseller 30-day total** (batched alongside the existing `clientCounts`/`teamCounts`
`Promise.all()` in `GET /api/admin/sales-partners/route.ts`):
```sql
SELECT partner_account_id, COALESCE(SUM(quantity), 0) AS minutes
FROM usage_events
WHERE partner_account_id = ANY($resellerIds)
  AND event_type = 'voice_minute'
  AND test_mode = FALSE
  AND occurred_at >= NOW() - INTERVAL '30 days'
GROUP BY partner_account_id
```
(One batched query for all resellers on the page, mirroring the existing `clientCounts`/`teamCounts`
`.in(...)` pattern — not N+1.)

**Detail page — one reseller's totals + per-client breakdown:**
```sql
-- all-time total
SELECT COALESCE(SUM(quantity), 0) FROM usage_events
WHERE partner_account_id = $resellerId AND event_type = 'voice_minute' AND test_mode = FALSE;

-- 30-day total
SELECT COALESCE(SUM(quantity), 0) FROM usage_events
WHERE partner_account_id = $resellerId AND event_type = 'voice_minute' AND test_mode = FALSE
  AND occurred_at >= NOW() - INTERVAL '30 days';

-- per-client breakdown, 30 days
SELECT end_client_id, COALESCE(SUM(quantity), 0) AS minutes
FROM usage_events
WHERE partner_account_id = $resellerId AND event_type = 'voice_minute' AND test_mode = FALSE
  AND occurred_at >= NOW() - INTERVAL '30 days'
GROUP BY end_client_id;
-- then joined in application code to partner_accounts(id, name) for display names — a small, bounded
-- lookup (at most the reseller's own client count), not a SQL join, matching this file's existing
-- pattern of resolving names via a separate small query rather than a JOIN.
```

**Note on `partner_account_id` scope:** confirms Arun's own framing exactly — every client-attributed
`usage_events` row already carries `partner_account_id = <the reseller's own id>` (the authenticating
account, per Part B §6.1's confirmation that only resellers authenticate, clients never do), so "reseller
total = self + all clients combined" requires **no UNION, no client-id enumeration** — it was always one
pool, exactly as Arun said. `end_client_id` (Part B) is purely the dimension the per-client breakdown
`GROUP BY`s on, never a second scope to filter `partner_account_id` by.

### 6.2 Indexing — confirmed sufficient, no new index (cross-cutting decision #8)

`idx_usage_events_account_type_time` (`partner_account_id, event_type, occurred_at DESC WHERE
test_mode=false`, migration 072) already fully covers every `WHERE` clause above — the index narrows to
the reseller's own rows within the type/time bounds first; `GROUP BY end_client_id` then runs over that
already-small, already-indexed result set in memory. No new index needed at current or expected near-term
scale (per-reseller usage-event volume is bounded by real session counts, not a table-scan-scale concern).

### 6.3 Responsive status (standing rule compliance)

`/dashboard/admin/sales-partners` and its `[id]` detail page are touched by this Part for the first time
under the standing responsive-by-default policy. Both pages already use fluid layout primitives
(`max-w-6xl mx-auto`/`max-w-4xl mx-auto`, no hardcoded pixel-width caps, `overflow-x-auto` on the existing
table) — confirmed by reading both files in full. The new column (list page) and new card (detail page)
reuse these exact same primitives, introducing no new hardcoded width. **`BACKLOG.md`'s responsive
tracking table gets a new row for both pages, marked "Compliant — verified as part of B2B-34 Part E,"**
per the standing rule's own instruction to add a row the instant a previously-untracked screen is touched.

## 7. Success Criteria (Acceptance Tests)

✓ Given a reseller with 3 client sessions totaling 89 minutes and 1 self-client session totaling 31
minutes in the last 30 days, when the list page loads, then its "Minutes (30d)" column shows 120.

✓ Given the same reseller, when the detail page loads, then the "Usage" card shows 120 minutes (30d) and
the per-client breakdown table shows exactly those rows (Acme Corp: 89, Self (direct sessions): 31),
summing to 120.

✓ Given a reseller with zero usage in the last 30 days but some all-time usage, when the detail page
loads, then the 30-day headline shows 0, the all-time headline shows the real total, and the breakdown
table shows "No usage in the last 30 days."

✓ Given `test_mode=true` usage events exist for a reseller, when either query runs, then those rows are
excluded from every total (matches this table's own existing test-mode-exclusion convention, confirmed via
the existing index's own `WHERE test_mode=false` clause).

✓ Given the list page's "Minutes (30d)" column header, when clicked, then rows sort ascending/descending by
that value exactly like every other column (reuses existing sort logic).

✓ Given `npm run build` + `npx tsc --noEmit` after this Part, then both are clean.

## 8. Error States

| Call | Failure | Behavior |
|---|---|---|
| The batched 30-day-minutes query (list page) fails | Supabase error | Falls back to `minutes_30d: 0` for every row on that page load (matches this route's own existing `clientCounts`/`teamCounts` graceful-degradation-to-empty-map convention) rather than failing the whole list |
| The detail-page usage queries fail | Supabase error | The "Usage" card shows its own inline error state, "Couldn't load usage data. Try refreshing." — independent of the Clients/Team cards, which continue to render normally (mirrors this page's own existing per-section independence, e.g. Clients/Team already load/fail independently) |

## 9. Edge Cases

- **A reseller with zero clients and zero self-client-attributed sessions.** `minutes_30d = 0` on the
  list; detail page shows both headlines as 0 and the empty-breakdown copy — no crash, no divide-by-zero
  (pure sums, no division anywhere in this Part).
- **A client is later re-parented or a reseller's client roster changes.** `end_client_id` on historical
  `usage_events` rows is never retroactively updated — the breakdown always reflects who owned the
  attribution at the time the session ran, matching this codebase's existing "never rewrite historical
  ledger rows" discipline (e.g. `wallet_ledger` is append-only).
- **`end_client_id IS NULL` rows** (a direct-partner-authenticated session's usage, or — pre-Part-B —
  any historical row from before this brief; none exist live today). These are impossible to appear under
  a `channel_partner`'s own `partner_account_id` scope (a direct partner's `usage_events.partner_account_id`
  is always the direct partner's own id, never a reseller's), so this case cannot actually surface in this
  Part's queries — noted for completeness, not a code branch that needs handling.

## 10. Out of Scope

- Any new wallet/balance concept — explicitly read-only, sourced from `usage_events` only, never
  `wallet_ledger`/`balance_usd` (per the CEO brief's own constraint).
- A date-range selector — trailing-30-days + all-time only (§0.2 row 7).
- `/dashboard/admin/clients` — explicitly not touched; this Part extends `/dashboard/admin/sales-partners`
  only, per the CEO's own resolved screen choice.

## 11. Open Questions

None.

## 12. Dependencies

- **Hard dependency on Part B** — cannot ship correctly (or at all, meaningfully) before
  `usage_events.end_client_id` exists and is populated by real session traffic.
- Last in build order (§0.1), regardless of its own P1 nominal priority, exactly as the CEO brief states.
