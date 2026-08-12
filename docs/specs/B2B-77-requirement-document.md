# B2B-77 — Application-Wide Role Model (end_user / client / sales-partner / internal_staff / admin)
# Requirement Document
Version: 1.2
Status: APPROVED (CEO, 2026-08-11) — cleared for Dev, per the CEO→BA→Dev gate; Section 11 is empty.
All three items Arun answered directly are folded in below with full reasoning and, per his explicit
instruction on Q2, a complete paper trail rather than a silent restoration.
Author: Business Analyst Agent
Date: 2026-08-11

Changelog: v1.2 — folds in Arun's direct answers to v1.1's three §11 open questions, closing Section 11.
**Q1 (transcript PII):** Arun confirmed option (c), accepted-risk with a retention/access-control
mitigation. This document now proposes a concrete 30-day retention window rather than leaving "short" as
an undefined placeholder — see §6.4 point 4. **Q2 (meeting-bot content purge):** Arun confirmed extending
it — a deliberate, dated reversal of his own earlier instruction, not a re-derivation of v1.0's original
(wrong) reasoning. §6.4 point 3 below states the full sequence explicitly (original instruction → v1.0's
mistaken reversal → v1.1's correct withdrawal pending his call → his own 2026-08-11 reversal), per his own
instruction that this paper trail matters. **Q3 (self-serve → invite-only):** Arun confirmed yes, plus
real new scope (a contact-us lead-capture flow) that doesn't belong inside this document — spun out into
its own Feature Brief and Requirement Document, `docs/specs/B2B-80-requirement-document.md`. §6.5's Q8
resolution below is updated to state the policy decision in one paragraph and point there, not respecify
the mechanism.

Changelog: v1.1 — three corrections from CEO review of v1.0. (1) Added §6.5, resolving Brief §7 Q4
(admin's automated low-balance notification — confirmed already fully built by B2B-04's
`checkLowBalanceAndAlert()`, no new work) and Q8 (admin invite flow — the super-admin-inviting-admin half
is already built by B2B-21; the admin-inviting-a-sales-partner half is genuinely unresolved against
B2B-28's shipped self-serve signup and is carried to §11 Q3, not silently answered). Both questions were
present in the source Feature Brief but had been dropped from v1.0 without being resolved or carried to
Section 11 — a real omission, not a judgment call. (2) §6.4 point 2's original recommendation to widen the
meeting-bot content purge (`content_pages`/etc.) was withdrawn — it would have reversed a recorded product
decision (`inngest/partner-session-insights-extractor.ts`'s own comment: the widget-only scoping is "per
Arun's own explicit instruction not to change anything about the existing inline-content flow," not an
unexplained gap), and is now carried to §11 Q2 as Arun's call, with the tension stated plainly. The
independently-justified part of that same recommendation — extending the PII-column purge
(`end_user_role`/`end_user_industry`/`conversation_language`) to meeting-bot sessions under the separate,
unrelated C4 rule — stands unchanged. (3) Removed a dangling `§7.1` cross-reference in §6.1's table that
pointed at a subsection which was never written.

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-77-application-role-model.md`
Source brainstorm: `docs/2026-08-10-voice-language-brainstorm.md`, D10–D13.
Prior art read in full: B2B-21 (`.claude/agents/clio/feature-briefs/B2B-21-internal-admin-identity-super-admin-and-sales-partner.md`,
`supabase/migrations/084_b2b21_internal_admin_identity.sql`, `lib/internal-admin/auth.ts`), B2B-26
(`.claude/agents/clio/feature-briefs/B2B-26-sales-partner-entity-signup-clients-team.md`,
`supabase/migrations/086_b2b26_sales_partner_entity.sql`), B2B-28
(`.claude/agents/clio/feature-briefs/B2B-28-direct-partner-invite-only-and-sales-partner-revenue-visibility.md`,
`supabase/migrations/088_b2b28_direct_partner_invites_and_revenue_share.sql`,
`091_remove_revenue_share.sql`), **B2B-34**
(`.claude/agents/clio/feature-briefs/B2B-34-reseller-architecture-performance-billing-cutoff-terminology.md`,
`docs/specs/B2B-34-requirement-document.md`, migrations `094`/`095`/`096`), `lib/partner/auth.ts`,
`lib/partner/api-keys.ts`, `lib/partner/session-schema.ts`, `lib/partner/widget-session-schema.ts`,
`app/api/partner/v1/widget-sessions/route.ts`, `inngest/partner-session-insights-extractor.ts`, and the
core-memory standing rule `feedback_no_end_user_pii_persistence.md`.

---

## 0. Headline finding — most of this brief's "open work" is already shipped

Before anything else: the Feature Brief's Section 7 was written against the 2026-08-10/11 brainstorm
log alone, without checking whether B2B-34 (dispatched and *already merged*, 2026-07-23) had
independently converged on and shipped most of the same ground. It had. Concretely, as of this
document:

- **The `internal_staff` rename (Brief Section 7 Q2) is done.** `supabase/migrations/094_b2b34_internal_staff_rename.sql`
  already renamed `internal_admin_users.role`'s `'sales_partner'` value to `'internal_staff'` and
  `sales_partner_assignments` → `internal_staff_assignments` (confirmed zero live rows at rename time,
  clean constraint swap, no backfill). Live code (`lib/internal-admin/auth.ts`) already reflects this:
  `InternalAdminResult` is typed `'super_admin' | 'internal_staff'`, and
  `scopedPartnerAccountIdsFor()` reads from `internal_staff_assignments`. **No new migration for this
  brief.**
- **B2B-34 also independently confirmed the taxonomy** this brief calls D10's "five roles" against, using
  the same words: "3 account types — `superadmin` (Clio itself), `sales-partner` (the reseller, currently
  `channel_partner` in DB), `partner` (regular customer). `internal-staff` is not a 4th peer type — it's
  a role that attaches to any of the three." This is fully consistent with D10–D13 and requires no
  reconciliation — B2B-34 got there first, D10–D13 re-derived the same shape independently. `end_user` is
  the one genuinely new concept neither brief had built before this one.
- **B2B-34 Piece 2 already built real `client_id` attribution** on the production session-creation
  contract (`POST /api/partner/v1/sessions`, migration `095_b2b34_client_id_architecture.sql`): every
  session now carries `end_client_id` (DB column; wire field stays `client_id` — see the naming note
  under §6.1), and a channel-partner-authenticated caller is *required* to supply a `client_id` that
  resolves to a `partner_accounts` row it owns (`owning_channel_partner_id = auth.partnerAccountId`).
  `app/api/partner/v1/widget-sessions/route.ts` (lines 70–98) already implements the identical check.
- **B2B-28's `revenue_share_percent` column, built to track sales-partner revenue attribution, was
  fully removed** (`091_remove_revenue_share.sql`, "we are not going to do any revenue sharings... remove
  all requirements and development on revenue sharings," 2026-07-21). This confirms C3 (no
  sales-partner-to-client billing tracked by Clio) is not just a rule for this brief to state — it is
  already the live, enforced shape of the schema. There is no revenue-share concept anywhere in
  `partner_accounts` today.

This document treats B2B-34's shipped work as the baseline and specifies only what is genuinely new:
the formal `end_user` concept, the C4 PII-purge gap this investigation found (§6.4), the admin-visibility
audit (§6.2), and the `internal_staff`-scoped-to-`client` mechanics (§6.3). Section 11's open-question
count is small precisely because most of the brief's Section 7 questions turn out to already have a
shipped, evidenced answer.

---

## 1. Purpose

Clio's access model has been built by five separate briefs (B2B-21, B2B-26, B2B-28, B2B-34, and this one)
across four months, each adding one more piece without a single canonical statement tying them together.
The result — confirmed correct, not confirmed *coherent* — is that "who is allowed to see what" lives as
tribal knowledge scattered across those five specs. This document is that canonical statement: one place
that defines all five roles (`end_user`, `client`, `sales-partner`, `internal_staff`, `admin`), states
exactly how each maps onto the live schema, and gives every future screen/API/access-check one rule to
build against.

**What failure looks like without this document:** a future engineer adds a screen that shows a
sales-partner their own `account_kind`, not realizing D11 forbids it, because there is no single
document that says so plainly and lists every existing surface already checked. Or worse: a future
change persists an `end_user`'s stated industry/role past the end of their session, because the existing
PII rule lives only in a memory file most code review never consults — which, per §6.4 below, has
*already happened* and is confirmed live in production today.

## 2. User Story

**Story 1 — Future engineer building any new screen or API route**
As a developer extending Clio,
I want one document that tells me exactly which of the five roles exists, how each maps to a real table/
column, and which UI/API surfaces must never reveal a user's own role,
So that I don't have to re-derive access rules from five different specs or guess.

**Story 2 — Admin (Arun / a future super-admin)**
As the person who needs full visibility into the business,
I want to see every sales-partner's real category, revenue relationship, and internal-staff assignments,
So that I can run the business — a visibility right no other role shares.

**Story 3 — Sales-partner (e.g. ai-learn.com)**
As a company reselling Clio under my own brand,
I want my own product experience with zero mention of "sales-partner," "reseller," or "channel_partner"
anywhere in my own UI or API responses,
So that nothing in my own dashboard undermines the white-label relationship I have with my own clients.

**Story 4 — end_user (e.g. an employee of a sales-partner's client, taking a live session)**
As someone joining a live Clio session,
I want my name, role, and industry used to personalize *this* session and nothing else,
So that none of what I say about myself outlives the 20 minutes I spend in the call.

## 3. Trigger / Entry Point

This is not a single screen or flow — it is a cross-cutting model that every existing and future
entry point must be checked against. The concrete, checkable triggers this document specifies:

- **Every `/api/admin/*` and `/dashboard/admin/*` request** — must resolve through
  `resolveInternalAdmin()`/`requireSuperAdmin()`/`requireInternalAdmin()` (`lib/internal-admin/auth.ts`,
  unchanged by this brief) before returning role-sensitive data.
- **Every `/dashboard/channel-partner/*` and `/api/channel-partner/*` request** — must resolve through
  `requireChannelPartnerAdmin()`/`requireChannelPartnerClientAccess()` (`lib/partner/auth.ts`, unchanged)
  and must never emit `account_kind`, `owning_channel_partner_id`, or a role label about the
  *authenticated caller's own account* in its response body (§6.2).
- **Every `POST /api/partner/v1/*` session-creation call** (today: `sessions`, `widget-sessions`; per
  B2B-78, tomorrow: `bot-dispatch`, `bot-sessions`) — every `end_user_*` field it accepts is
  session-time-use-only per C4; this brief's §6.4 is the binding purge specification those routes and
  their downstream Inngest jobs must implement.
- **Every internal-staff invite/assignment write** (`app/dashboard/admin/team/TeamClient.tsx`,
  `app/api/admin/team/*`) — must produce a row shaped per §6.3.

## 4. Screen / Flow Description

This brief changes **no existing screen's layout** and adds **no new screen**. Every screen already
named in B2B-21/26/28/34 (`/dashboard/admin/team`, `/dashboard/admin/sales-partners[/[id]]`,
`/dashboard/channel-partner/*`, `/invite/accept`, `/team-invite/accept`, `/partner-invite/accept`)
is unchanged in this document. What changes is **copy and query shape on two already-shipped screens**,
specified exactly below, plus a **data-handling change with no visible screen at all** (§6.4's purge).

### 4.A `app/invite/accept/InviteAcceptClient.tsx` — one-line copy correction (verify, not build)

**Current state, confirmed live at line 142:**
```
You've been invited to Clio as {view.role === 'super_admin' ? 'a super-admin' : 'a sales partner'}.
```
B2B-34 Piece 5 already specified fixing this ternary's `internal_staff` branch to stop saying "a sales
partner" (since that phrase is now reserved for the external reseller entity). This document's own §6.2
audit re-confirms the requirement and gives the exact final copy, closing the loop B2B-34 opened:

```
You've been invited to Clio as {view.role === 'super_admin' ? 'a super-admin' : 'a Clio staff member'}.
```

Wireframe (unchanged layout, copy only):
```
┌─────────────────────────────────────────────────┐
│  Clio                                            │
│                                                   │
│  You've been invited to Clio as a Clio staff     │
│  member.                                         │
│                                                   │
│  [ Continue with email ]                         │
└─────────────────────────────────────────────────┘
```
This is the one and only place in the current, live codebase where D11's role-visibility rule (§6.2) was
found to still be violated for the `internal_staff`/`super_admin` pair. It does not violate the rule for
`internal_staff` itself under this document's own reading of D11 (see §6.2's reasoning on why
`internal_staff`/`admin` seeing their own label is not the leak D11 is protecting against) — it is fixed
anyway, per B2B-34's own prior direction, because "a sales partner" is now factually wrong, not because
seeing *some* role label here is itself forbidden.

### 4.B `/dashboard/admin/sales-partners` and `/[id]` — no screen change, one query-shape confirmation

No new field is added. This document confirms (§6.2) that neither page's existing query includes
`revenue_share_percent` (removed, §0) or any `end_user`-scoped data, so no redaction work is needed here.

## 5. Visual Examples

Only one visual changes (the invite-accept copy above). No new wireframe is required beyond §4.A.

## 6. Data Requirements

### 6.1 Canonical role → schema mapping (the terminology table this brief exists to produce)

| Human-facing role (D10) | Schema representation | Live since | Notes |
|---|---|---|---|
| `admin` | `internal_admin_users.role = 'super_admin'` | B2B-21 (084) | **Not a rename.** "Admin" (brainstorm) and "super-admin" (schema/B2B-34's own taxonomy) name the identical concept; this document adopts "admin" for narrative prose and keeps `super_admin` as the DB/code token, exactly mirroring how "sales-partner" (narrative) maps to `channel_partner` (DB token) elsewhere in this same model. |
| `internal_staff` | `internal_admin_users.role = 'internal_staff'`, scoped via `internal_staff_assignments.partner_account_id` | B2B-34 (094) | Renamed from `'sales_partner'`, already shipped. See §6.3 for the `client`-parent mechanics. |
| `sales-partner` | `partner_accounts` row, `account_kind = 'channel_partner'` | B2B-26 (086) | Code token deliberately avoids the bare `sales_partner` string (B2B-26 §0's own collision-avoidance convention) — UI copy says "sales-partner," code says `channel_partner`. Unchanged by this brief. |
| `client` | `partner_accounts` row, `account_kind = 'partner'`, `owning_channel_partner_id` set to a sales-partner's id | B2B-26 (086) | A client is a normal `partner_accounts` row with **zero** `partner_admin_users` rows (B2B-26 §confirmed) — this *is* D11's "clients never log in," already fully implemented, not something this brief adds. |
| `end_user` | **No table.** A per-session identifier only — `partner_sessions.end_user_name` (persisted, approved exception) plus the session-time-only `end_user_role`/`end_user_industry`/`conversation_language` fields (must not persist past the session, §6.4) | New, this brief | Genuinely new concept. See §6.4 for the hard PII boundary. |

**Wire-field naming note carried over from B2B-34 (not reopened here):** the wire field the sales-partner
sends is `client_id`; the DB column is `end_client_id` (deliberately distinct from the unrelated
`partner_oauth_clients.client_id`, B2B-34 Piece 2's own resolved naming-collision call). This document
does not change either name — B2B-78 inherits it as-is.

### 6.2 D11/C2 role-visibility audit (Brief §7 Q5) — checklist, not a restatement of the rule

D11's rule, read precisely: *no user, other than admin, may see a statement of their own role/category
in their own UI or API responses.* This document's reading (stated explicitly, since the brief's own D11
text says "any user... or otherwise," which could be read to include `internal_staff`/`admin` themselves):
**the rule protects the sales-partner↔client business relationship from being exposed to the party it
concerns** — a sales-partner must never be told "you are merely a reseller, not our direct customer";
a client, by construction, never even has a login to be told anything. It does **not** need to extend to
`internal_staff`/`admin` seeing their own label, because those two roles are Clio's own operators — there
is no business relationship being concealed from them by telling them they work for Clio. This reading is
a judgment call, stated for the CEO's review, not silently assumed (see §11 for the one place this
reading could be wrong).

Audit, surface by surface:

| Surface | Checked | Finding |
|---|---|---|
| `GET /api/channel-partner/account` (backs `SettingsClient.tsx`) | Yes, read directly | Returns `{name, company_url}` only. **Compliant** — no `account_kind`/role field. |
| `/dashboard/channel-partner/*` pages generally (`ClientsClient.tsx`, `TeamClient.tsx`, `page.tsx`) | Yes | None render `account_kind`, `channel_partner`, or "sales-partner"/"reseller" about the logged-in account itself anywhere in visible copy. **Compliant.** |
| `app/invite/accept/InviteAcceptClient.tsx` line 142 | Yes | **Non-compliant as of today** (says "a sales partner" for an `internal_staff` invitee) — fixed by §4.A above. |
| `app/team-invite/accept/TeamInviteAcceptClient.tsx` (B2B-26 sales-partner team invite) | Yes, by grep | Invites a person onto a sales-partner's own team (`partner_admin_users` row) — never states "you are a sales-partner," only that they're joining a named company's Clio account. **Compliant.** |
| `app/partner-invite/accept` (B2B-28 direct-partner invite) | Yes, by grep | Never mentions "channel_partner"/"sales-partner" — the invitee becomes a direct partner unconditionally, with no branch shown. **Compliant.** |
| `/dashboard/admin/sales-partners[/[id]]` | Yes | `admin`-only surface (gated `requireSuperAdmin`) — by design, this is the one place role/category *is* visible, correctly restricted to admin per D11. **Compliant by design.** |
| `POST /api/partner/v1/{sessions,widget-sessions}` error responses | Yes, read directly | Error codes/messages (`invalid_reseller_id`, `client_id_required`, etc.) reference `reseller_id`/`client_id` as field names, never the words "sales-partner"/"channel_partner"/"reseller" in message text. **Compliant** — and this is the bar B2B-78's new `bot-dispatch`/`bot-sessions` error copy must also clear. |
| `/dashboard/configurator/*` (direct partner) | Yes | Never states "you are a direct partner" or exposes `account_kind='partner'` — this was never a sensitive fact to begin with, and the UI has always just said "Configurator." **Compliant, low-risk either way.** |

**Conclusion:** one confirmed violation, already fixed in §4.A above. No other surface change required.
This table is the checklist the brief's §7 Q5 asked for — future screens should be checked against it
and the reasoning above, not re-litigated from scratch.

### 6.3 `internal_staff` scoped to a `client` parent (Brief §7 Q3) — resolved, no new mechanism needed

The brief frames this as a puzzle: if `internal_staff.parent_type = 'client'` is valid, but a client has
no login, what does "supporting a client" mean? **Resolved by reading the existing schema precisely:**
`internal_staff_assignments.partner_account_id` is a foreign key to `partner_accounts.id` with **no
`CHECK` restricting which `account_kind` it may point at**. A client *is* a `partner_accounts` row
(`account_kind = 'partner'`, `owning_channel_partner_id` set) — exactly the same table, exactly the same
row shape, as a sales-partner or a direct partner. There is nothing polymorphic to build: an
`internal_staff` member "scoped to a client" is simply an `internal_staff_assignments` row whose
`partner_account_id` happens to reference a client row instead of a sales-partner or direct-partner row.
"Supporting a client" concretely means: that internal_staff member can act on the client's own
`partner_accounts` row and its associated data (content sources, sessions, billing status if any) through
whichever admin-facing surface displays it — most concretely, a future "client detail" admin view
reachable the same way `/dashboard/admin/sales-partners/[id]`'s client-roster rows are reachable today —
scoped by `requireInternalAdmin(clientPartnerAccountId)` exactly as it already scopes any other account.
**No schema change, no new `parent_type`/`parent_id` column.** The brainstorm's "polymorphic parent_type"
language is already fully satisfied by the existing single FK, because `partner_accounts` itself is
already the polymorphic table (direct partner / sales-partner / client, discriminated by
`account_kind`/`owning_channel_partner_id`).

**One related, smaller point resolved the same way, not separately escalated:** D10 also lists "admin" as
a valid `parent_type`. Read literally as a fourth kind of assignment row, this has no schema referent —
there is no "admin account" row to point a FK at. This document resolves it as: an `internal_staff` member
scoped to "admin" is not a distinct case requiring new schema — it would only be needed to express
"this internal_staff member may access general admin surfaces not tied to one partner account," and no
such surface exists today for `internal_staff` to be scoped into (every current `internal_staff`-visible
surface — glitches, clients billing, templates — is scoped per B2B-21's original design to specific
partner accounts via `requireInternalAdmin(partnerAccountId)`). If a future admin-level, cross-partner,
`internal_staff`-visible surface is ever built, that surface's own spec should decide at that time whether
it needs a nullable `partner_account_id` assignment row (meaning "unscoped/admin-wide") — deferring this
is a technical call within BA/Dev discretion, not a product gap this brief needs to close now.

### 6.4 The `end_user` PII boundary (C4) — confirmed live violation found, remediation specified

This is the most consequential finding in this document. Per the standing rule
(`feedback_no_end_user_pii_persistence.md`): *no PII that could identify a specific end_user may ever be
saved — not in a database column, not in a transcript store, not in a log line* — with a single
confirmed, approved exception for `end_user_name`. Everything else (`end_user_role`, `end_user_industry`,
and by extension `conversation_language`/`partner_end_user_ref`) is session-time-use-only.

**Confirmed by direct code read: this rule is currently violated in production, for both delivery
channels.** `partner_sessions.end_user_role` and `partner_sessions.end_user_industry` (migrations 097,
098) are written at session creation and **never nulled by any purge job**. The only existing "no
leftovers" purge (`inngest/partner-session-insights-extractor.ts`, both the success path around line 402
and the permanent-failure path around line 534) nulls exactly five columns —
`content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/`assembled_prompt_snapshot` — and
is explicitly scoped to `delivery_channel === 'widget'` only. `end_user_role`, `end_user_industry`, and
`conversation_language` are not in that column list on either code path, and **meeting-bot sessions
(`delivery_channel` unset/`'meeting'`) have no purge step of any kind today** — not even the content
purge widget sessions get. Per Arun's own standing instruction ("please highlight whenever we have coded
or have to code like that... proactively, don't wait to be asked"), this is flagged here as required,
not optional, remediation — not a hypothetical risk.

**Required remediation, specified for the Dev agent to implement (not a new open question — the fix
shape is clear from the existing pattern):**

1. Extend the existing widget-channel "no leftovers" purge (both call sites in
   `partner-session-insights-extractor.ts`) to also null `end_user_role`, `end_user_industry`, and
   `conversation_language` in the same `UPDATE`. `end_user_name`, `partner_end_user_ref`, and
   `partner_reference` are left untouched — the first is the approved exception, the second two are the
   *sales-partner's own* correlation tags (D8/D9), not `end_user`-identifying data Clio itself collected.
2. **Add a new, separate purge step nulling `end_user_role`/`end_user_industry`/`conversation_language`
   for meeting-bot (`delivery_channel` = `'meeting'`/unset) sessions too.** This stands on its own
   justification under the standing PII rule (C4) — these three columns are `end_user`-identifying
   personalization inputs, not "the existing inline-content flow" Arun's instruction below protects, so
   nothing about that instruction bears on whether *these specific columns* should be purged. Today
   meeting-bot sessions get no purge of any kind, for any column — this closes that gap for the PII
   columns specifically, independent of what happens to content.
3. **Extend the same purge to null `content_pages`/`content_to_explain`/`content_title`/
   `content_subtitle`/`assembled_prompt_snapshot` for meeting-bot sessions too — committed, per Arun's
   own explicit decision on 2026-08-11.** The full sequence, recorded here deliberately, per Arun's own
   instruction, so a future reader sees *who* changed this and *why*, not just that it changed:
   - **Original state:** `inngest/partner-session-insights-extractor.ts`'s content purge was built
     widget-channel-only, with its own comment recording why: "per Arun's own explicit instruction not to
     change anything about the existing inline-content flow."
   - **v1.0 of this document (2026-08-11, earlier the same day) mistakenly recommended widening the purge
     to meeting-bot sessions**, reasoning that "there is no stated reason in that spec for the channel
     restriction beyond 'that was this feature's own scope at the time.'" That reasoning was wrong — a
     reason *was* stated, in the comment quoted above, and this document had not read it carefully enough.
   - **v1.1 caught this in CEO review, correctly withdrew the recommendation**, and carried the question to
     §11 Q2 rather than either quietly keeping the mistaken recommendation or quietly reverting it back to
     "leave meeting-bot alone" on the BA's own authority — either silent move would have hidden that a real
     tension existed.
   - **Arun himself, on 2026-08-11, reconsidered his own original instruction and reversed it**: extend the
     purge to meeting-bot sessions, matching widget sessions. This is now committed, required remediation —
     not because v1.0's original reasoning turned out to be right (it wasn't, at the time it was written),
     but because Arun has independently made this exact call himself, fully aware of what he was reopening.
   Implementation: identical mechanism to point 1/2 above — extend both call sites in
   `partner-session-insights-extractor.ts` to run this `UPDATE` unconditionally (drop the
   `if (session.delivery_channel === 'widget')` guard around the content-column nulling), and update that
   guard's own comment to record this sequence (or at minimum cite this document) rather than leaving the
   old, now-superseded "per Arun's own explicit instruction not to change anything" comment standing
   unexplained next to code that now does change it.
4. **The mid-session-volunteered-PII case (per D13 and the brief's own §7 Q7) — resolved:** Arun confirmed
   option (c) from this document's v1.1 (accepted-risk with a retention/access-control mitigation), without
   specifying a duration. This document proposes **30 days**, mirroring the existing convention already
   established elsewhere in this exact pipeline: `partner_session_insights.full_detail_purged_at` (migration
   078) already purges *extracted* insight detail on a 30-day clock, and this proposal simply applies the
   same clock to the *raw* material those insights are extracted from — a natural pairing, since it makes
   little sense for the raw source to meaningfully outlive the summary derived from it. Scope, stated
   precisely rather than left implicit: this 30-day window and admin-only access restriction is directly
   enforceable on what Clio itself stores — concretely, the OpenAI Realtime transcript capture in Upstash
   Redis (B2B-63) — where it should be implemented as a native Redis key TTL (`EX 2592000` seconds), the
   simplest possible fit for exactly this requirement, plus confirming (if not already true) that read
   access to that data goes through a `requireSuperAdmin()`-gated surface only. **What this document cannot
   unilaterally guarantee:** Hume's and ElevenLabs' own vendor-side conversation/chat records are stored on
   *their* infrastructure, governed by *their* retention settings, not a table or key Clio's own migrations
   can add a TTL to. This document recommends, as a follow-up action item (not a Dev-phase build task —
   there is no code to write for this part): Clio's own team check each vendor's dashboard/account
   settings for a configurable data-retention policy and align it to the same 30-day window where the
   vendor allows it. This is stated honestly as a partial guarantee, not oversold as a complete technical
   fix — exactly the caution v1.1 flagged accepted-risk framing requires.

### 6.5 Brief §7 Q4 and Q8 — resolved, addressed in response to CEO review (were dropped from v1.0)

**Q4 — Admin's "proactively notifies sales-partners to recharge/top up" (D10) — already built, not new
work.** Confirmed by direct code read: `checkLowBalanceAndAlert()` (`lib/partner/webhooks.ts`, ~lines
451–491) is B2B-04's own shipped mechanism (Requirement Doc §5.B.5) — called from the wallet-decrement
path, fires exactly once per depletion cycle via a race-safe compare-and-set on
`low_balance_alert_fired_at`, at 80% of the account's `reference_topup_amount_usd` consumed, sending
`sendLowBalanceAlertEmail()` (Resend) to every email `getPartnerAdminEmails(partnerAccountId)` resolves
for that account, plus a `wallet.low_balance` webhook dispatch through the existing signed-webhook
mechanism. The function takes a bare `partnerAccountId` with **no `account_kind` branch anywhere in
it** — it already fires identically for a `channel_partner`-kind (sales-partner) account as for a direct
partner, with zero special-casing required. This is an exact, already-live match for D10's requirement
("automated... notifies resellers to recharge/top up"). B2B-13 (recurring plan tiers/configurable
topups, `docs/specs/B2B-13-requirement-document.md`) was checked and adds no separate low-balance
mechanism of its own — B2B-04's is the only and complete one. **No new work for this brief.**

**Q8 — Admin invite flow for sales-partners/admins — fully resolved** (the sales-partner half was
genuinely open in v1.1, pending Arun's own decision; it has since been answered directly, see below).
- **Inviting another admin (super-admin):** already fully built by B2B-21 — `internal_admin_users`'s own
  `invite_token_hash`/`invite_token_expires_at` mechanism, unchanged by this brief. No new work.
- **"Inviting" a sales-partner — resolved by Arun directly, 2026-08-11.** His verbatim answer: "Yes change
  to invite only. if someone likes to enquire or join, let them submit a contact us form and we will reach
  them through email or phone or whatsapp." **Policy decision:** self-serve sales-partner signup
  (`/partner-signup`, unconditional since B2B-28) is retired; every new sales-partner account going forward
  traces back to a deliberate admin-issued invite, the same posture B2B-28 already gave direct partners.
  Arun's answer also contains real, new product scope beyond that yes/no — a public contact-us lead-capture
  flow, decoupled from account creation — which is not respecified here. **See
  `docs/specs/B2B-80-requirement-document.md` for the full mechanism**: the new public inquiry form, the
  admin-facing leads list, and the generalization of B2B-28's existing `direct_partner_invites` table/flow
  to also produce sales-partner accounts (one additive column, one hardcoded value in the accept webhook
  changed — B2B-80 §0 has the exact diff). This document's own role-model resolutions (§6.1's terminology
  table, §6.4's PII remediation) are unaffected by this policy change and require no update.

## 7. Success Criteria (Acceptance Tests)

✓ Given a fresh grep of the codebase for the bare token `sales_partner` (excluding `channel_partner` and
the already-renamed `internal_staff_assignments`), when run after this brief closes, then the only hits
are: the historical/comment references inside migration files documenting the rename itself, and the
UI-copy strings in `app/(with-clerk)/dashboard/channel-partner/clients/[id]/SalesPartnerDetailClient.tsx`
and `app/api/admin/sales-partners/[id]/route.ts` (both of which correctly refer to the *external reseller*
entity, not `internal_admin_users`).

✓ Given a Clerk-authenticated sales-partner viewing their own `/dashboard/channel-partner/*` pages, when
any API response under `/api/channel-partner/*` is inspected, then no response body contains the string
`channel_partner`, `account_kind`, or the word "reseller"/"sales-partner" describing the caller's own
account.

✓ Given an `internal_staff` invitee who has just accepted their invite, when they land on the acceptance
confirmation screen, then the copy reads "a Clio staff member," never "a sales partner."

✓ Given a completed widget-channel session, when the insights-extraction Inngest job finishes (success or
permanent failure), then `partner_sessions.end_user_role`, `end_user_industry`, and
`conversation_language` are `NULL` for that row, in addition to the five columns already nulled today.

✓ Given a completed meeting-bot-channel session, when the extended purge (§6.4 points 2–3) runs, then
`end_user_role`, `end_user_industry`, `conversation_language`, `content_pages`, `content_to_explain`,
`content_title`, `content_subtitle`, and `assembled_prompt_snapshot` are all `NULL` for that row — this is
new behavior on both counts (today meeting-bot sessions get no purge of any kind), and the content-column
half of this test is only assertable because Arun explicitly reversed his own prior instruction on
2026-08-11 (§6.4 point 3's paper trail) — a future reader should not assume this was always the intended
behavior.

✓ Given the OpenAI Realtime transcript capture in Upstash Redis (B2B-63), when a key reaches 30 days old,
then it has expired via its own TTL and is no longer retrievable — and any surface that reads this data
requires `requireSuperAdmin()`, per §6.4 point 4's resolution of the accepted-risk retention policy.

✓ Given an `internal_staff` member with an `internal_staff_assignments` row pointing at a client's
`partner_accounts.id`, when they call `requireInternalAdmin(thatClientId)`, then the check passes
(same code path as any other scoped account), and when they call it against an unrelated account, it
403s — no new code path, same existing function.

✓ Given a query of `partner_accounts` for any column named `revenue_share_percent` or similar, when run
against the current schema, then the column does not exist (confirms §0's finding stays true going
forward — no future brief should reintroduce sales-partner-to-client billing per C3).

## 8. Error States

Not applicable in the traditional sense — this document specifies no new user-facing form or API call of
its own. The one behavioral change with a failure mode is §6.4's purge extension: if the widened `UPDATE`
fails, it must fail exactly as the existing purge already does — logged, non-fatal, never blocking or
reverting the insights-write that precedes it (existing pattern, unchanged).

## 9. Edge Cases

- **A sales-partner account that later also becomes a direct partner is not possible** — confirmed by
  `check_account_kind_invariants()` (migration 086, extended by 088/089/091): a `channel_partner`-kind row
  can never itself carry an `owning_channel_partner_id`, and B2B-26 §Q6 already confirmed a sales-partner
  account is a management shell with no Configurator access of its own. No new edge case here; restated
  for completeness since B2B-78/79 both depend on this staying true.
- **An `internal_staff` member assigned to a client whose owning sales-partner is later suspended** — the
  client row's own `status` is independent of the sales-partner's; `requireInternalAdmin` checks the
  assignment against the client's own id, not transitively against the sales-partner's status. No new
  work needed; this falls out of the existing per-row scoping.
- **A session created before this brief's purge extension ships** — its `end_user_role`/`end_user_industry`
  values (and, for meeting-bot sessions per §6.4 point 3, `content_pages`/`content_to_explain`/
  `content_title`/`content_subtitle`/`assembled_prompt_snapshot`) from before the fix remain un-purged
  (this brief's remediation is forward-only — a purge that only fires on the insights-extraction job's own
  completion path does not retroactively catch a session whose extraction already ran under the old,
  narrower column list). Recommend the Dev agent run a one-time backfill covering both column sets —
  `UPDATE partner_sessions SET end_user_role = NULL, end_user_industry = NULL, conversation_language = NULL
  WHERE <insights already extracted>`, and, separately, the same backfill widened to the five content
  columns for meeting-bot rows specifically — as part of the same migration, so the fix is retroactive, not
  just forward-looking, given the standing PII rule (and, for content, Arun's own 2026-08-11 decision) is
  about *not retaining* this data, not merely about ceasing to retain it from today forward.
- **`end_user_name` on `demo_meeting_urls`** (migration 098 also added it there) is out of this brief's
  scope — that table backs the internal demo/showcase flow, not real sales-partner traffic, and carries no
  purge obligation under C4 since no real end_user's data flows through it.

## 10. Out of Scope

- Any sales-partner-to-client billing mechanism (C3) — confirmed already fully removed from the schema
  (§0), not being reconsidered here.
- Any admin tiering (C5) — B2B-21's flat, equal-peers super-admin model is unchanged.
- Building or renaming any database column/enum/table beyond the one migration this document specifies
  (§6.4's purge-column extension and its one-time backfill) — everything else in the terminology table
  (§6.1) already exists and is left untouched.
- A second, parallel sales-partner-like entity — foreclosed by Section 0's resolution, restated here.
- Building any new admin-level, cross-partner, `internal_staff`-scoped-to-"admin" surface (§6.3) — no such
  surface exists to need this today.
- Configuring vendor-side (Hume/ElevenLabs) transcript retention settings (§6.4 point 4) — flagged as a
  follow-up action item for Clio's own team to check against each vendor's account settings, not a
  Dev-phase build task this document specifies code for.
- The full contact-us lead-capture mechanism and the generalized invite flow (§6.5's Q8 resolution) —
  entirely owned by `docs/specs/B2B-80-requirement-document.md`; not respecified here.

## 11. Open Questions

None. All three items open in v1.1 have been answered directly by Arun (2026-08-11) and are folded in
above, not merely closed here:

**Q1 (transcript PII) — RESOLVED.** Arun confirmed option (c) from v1.1's three-way tradeoff:
accepted-risk policy, transcripts continue to be stored, with a retention window and admin-only access as
the mitigation rather than eliminating the risk technically. §6.4 point 4 turns this into a concrete
30-day retention window (mirroring `partner_session_insights`'s own existing 30-day full-detail purge
clock) plus a `requireSuperAdmin()`-gated access requirement, scoped honestly to what Clio itself stores
(the OpenAI Realtime Redis transcript capture) — with the vendor-side (Hume/ElevenLabs) retention boundary
stated explicitly as a follow-up action item, not silently assumed solved.

**Q2 (meeting-bot content purge) — RESOLVED, by Arun's own deliberate reversal of his prior
instruction.** Confirmed: extend the purge to meeting-bot sessions the same way widget sessions already
get it. §6.4 point 3 carries the complete sequence — the original instruction, v1.0's mistaken reversal of
it, v1.1's correct withdrawal pending Arun's own call, and Arun's own 2026-08-11 decision to reopen and
reverse it himself — so a future reader sees who changed this and why, not just that it changed.

**Q3 (self-serve → invite-only) — RESOLVED, with new scope spun out to its own brief.** Arun confirmed:
yes, retire self-serve sales-partner signup. His answer also specified a new contact-us lead-capture
mechanism, which is real product scope beyond this document's own role-model concerns — see §6.5's updated
Q8 resolution, which states the policy decision and points to
`docs/specs/B2B-80-requirement-document.md` for the full mechanism rather than respecifying it here.

**One reasoning call flagged for CEO confirmation in v1.1, not phrased as a blocking open question
(§6.2), unchanged in v1.2:**
this document's reading of D11 — that `internal_staff`/`admin` may see their own role label, only
`sales-partner`/`client`-adjacent roles may never see theirs — is a judgment call, not dictated verbatim
by the brainstorm log. If the CEO's review disagrees and D11 should be read as an absolute ban with no
carve-out, the only concrete consequence is that §4.A's fixed copy ("a Clio staff member") would need to
become fully role-neutral ("You've been invited to Clio" with no role mention at all) — a small,
easily-reversed change, flagged here so it isn't silently locked in if the reading is wrong.

## 12. Dependencies

- B2B-21, B2B-26, B2B-28, B2B-34 (all shipped) — this document extends, not replaces, their schema.
- The standing memory rule `feedback_no_end_user_pii_persistence.md` — this document's §6.4 is a direct
  enforcement action under that rule, and the rule itself is unchanged by this brief.
- B2B-78 and B2B-79 both consume this document's terminology table (§6.1) directly — both are written
  concurrently with this document and cross-reference it by section number where relevant.
- B2B-80 — this document's §6.5 Q8 resolution points to it for the full sales-partner-acquisition
  mechanism (contact-us form, admin leads list, generalized invite flow); B2B-80 in turn points back here
  for the policy decision it implements. Neither document respecifies the other's content.
- B2B-63 (OpenAI Realtime transcript capture, Upstash Redis) — §6.4 point 4's 30-day retention proposal
  is a change to that feature's own storage TTL, not a new table or mechanism.
