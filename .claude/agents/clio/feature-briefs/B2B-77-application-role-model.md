# Feature Brief: B2B-77 — Application-Wide Role Model (end_user / client / sales-partner / internal_staff / admin)

From: CEO Agent (on behalf of Arun)
To: Business Analyst Agent
Priority: P0 — foundational; B2B-78 and B2B-79 both assume this model exists
Date: 2026-08-11 (updated same day after Arun's naming decision, see Section 0)
Status: **SPEC-WRITING ONLY. Arun has explicitly said "don't build it."** No code, no schema, no
UI is authorized from this brief. The BA's deliverable is a complete Requirement Document. Nothing
proceeds to a developer agent until Arun has approved that document through the normal CEO review
gate.

**Numbering note:** highest ID in `docs/b2b-pivot-status.md` and
`.claude/agents/clio/feature-briefs/` is B2B-76 (2026-08-08). This is B2B-77.

**Source of truth for this brief:** `docs/2026-08-10-voice-language-brainstorm.md`, decisions D10
through D13 (section "Application-wide role model," dated 2026-08-11 in that log). Read that
section in full before writing the spec — this brief summarizes and organizes it, it does not
replace it.

---

## 0. Naming Decision — RESOLVED by Arun (2026-08-11, after CEO escalation)

The original version of this brief escalated a naming/collision question to Arun: does this
brainstorm's `reseller` concept duplicate the already-shipped "sales-partner" entity from B2B-26/28
(`partner_accounts.account_kind = 'channel_partner'`)? Arun's verbatim answer:

> "No, I like the name sales-partner better than reseller. Let's continue with the name
> sales-partner. But all we mentioned about reseller needs to be covered. Even in future if I refer
> reseller accidentally then just remember I am meaning sales-partner."

**Resolved:**
- **This is confirmed harmonization, not a new parallel entity.** Everything D10–D13 attached to
  "reseller" (the minute-purchasing, client-managing, white-label account) is the already-shipped
  B2B-26/28 "sales-partner" entity — extend/build on `partner_accounts.account_kind =
  'channel_partner'`, do **not** create a second account type.
- **Terminology going forward: "sales-partner," not "reseller."** Every substantive decision below
  (D10–D13) still fully applies — only the name was wrong, not the behavior.
- **This brief also folds in B2B-26's own already-flagged, not-yet-built follow-on**: B2B-21's
  internal `internal_admin_users.role = 'sales_partner'` DB value (a completely different concept —
  Clio's own account-manager staff) needs to be renamed. That rename target is exactly this
  brainstorm's `internal_staff` role — so this brief now specifies that rename directly instead of
  leaving it as a dangling TODO in B2B-26.

**Read this note before reading anything below it in this brief.** The material under Section 1 is
preserved close to how it was originally captured, including quoted uses of the word "reseller" —
per Arun's own instruction above, **read every occurrence of "reseller" anywhere in this brief,
including inside quotes, as meaning "sales-partner."** Quotes are preserved verbatim for the
historical record, not because the word choice is still open.

**Terminology resolution table** (this is the concrete artifact the BA should build against):

| Brainstorm-session term | Resolved human-facing term | Resolved schema/code identifier |
|---|---|---|
| `reseller` | **sales-partner** | Extend existing `partner_accounts.account_kind = 'channel_partner'` (B2B-26/28, unchanged, not a new table) |
| `client` | client (unchanged) | Existing `partner_accounts.account_kind = 'partner'`, owned by a sales-partner (B2B-26, unchanged) |
| `internal_staff` | internal_staff (unchanged) | **Rename** `internal_admin_users.role` value from `'sales_partner'` (B2B-21's old, differently-scoped meaning) → `'internal_staff'`, generalized to polymorphic `parent_type`/`parent_id` (reseller→sales-partner / client / admin) per D10 |
| `admin` | admin (unchanged) | Open — see Section 7, Q1: confirm whether this is a rename of existing `internal_admin_users.role = 'super_admin'` or a coexisting label |
| `end_user` | end_user (unchanged) | New — no existing schema concept today; genuinely new per D13 |

The BA must confirm every mapping in that table against the live schema before writing migrations —
it is my best-evidence reading, not a substitute for the BA's own verification (same standard this
brief already held itself to before the escalation).

---

## 1. What Arun Said

This was a direct, extended brainstorm between Arun and the Orchestrator — not a short instruction.
The material facts, close to verbatim from the log. **Per Section 0, read "reseller" below as
"sales-partner."**

- "the rebuild isn't scoped to the pipeline alone — the application changes significantly to align
  with this." Explicitly forward-design mode, not anchored to current code/production behavior
  unless something is a hard constraint.
- Five roles, defined by Arun (D10):
  - **`end_user`** — the people who belong to a client (e.g. employees of Capgemini, subscribers of
    Pluralsight) and actually take Clio sessions.
  - **`client`** — the organization that owns the content (e.g. Capgemini, Pluralsight).
  - **`sales-partner`** (originally spoken as "reseller" — see Section 0) — a team/org using
    hello-clio as a white-label product; converts a client's existing training material into
    something Clio can teach from. Sales-partners pay Clio (purchase usage minutes) and
    sub-allocate/sub-charge those minutes to their own clients at rates the sales-partner sets
    themselves.
  - **`internal_staff`** — lowest access; supports clients/sales-partners/admin. Tagged with
    `parent_type` + `parent_id` (polymorphic — sales-partner, client, or admin are all valid), can
    support **only** whoever they're allocated to.
  - **`admin`** — full access; invites sales-partners; monitors all activity/logs; ensures
    sales-partners have enough minutes; proactively (automated) notifies sales-partners to recharge/
    top up; fixes glitches; gives sales-partners usage/business insights. Admins can invite/create
    more admins with equal capabilities (flat, no admin tiers).
- **Clients never log in (D11).** "If a client ever needs to log in, they get invited as a
  **sales-partner** instead — there's no separate client-facing account type."
- **Role identity is admin-only-visible (D11).** "At no point should any user (sales-partner or
  otherwise) see that their own role is 'sales-partner' anywhere in their own UI — role labeling is
  visible **only to admin**. Everyone else just sees their own product experience, unlabeled by
  role." (This is, notably, already the exact precedent B2B-28 shipped for revenue-share visibility
  — see Section 6.)
- **No sales-partner-to-client billing tracked by Clio (D12).** "That's entirely the sales-partner's
  own external business. We only ever see sales-partner-level minutes/usage on our side."
- **`end_user` is stateless; hard PII rule (D13).** Session-time inputs (name, domain, industry,
  language) are used live to personalize the session and produce the after-session insight sent
  back to the sales-partner, but **none of it may be saved anywhere persistent** — no database
  column, no transcript store, no log line. Arun's explicit instruction: "proactively flag it, in
  the moment, any time code does or would violate this — don't wait to be asked." **Explicit,
  resolved exception:** `end_user_name` is allowed to be persisted — confirmed by Arun directly,
  not a violation.
- This rule is **already saved to core memory** as a standing engineering rule
  (`feedback_no_end_user_pii_persistence.md`, updated with the `end_user_name` exception) — it
  governs all future code, not just this brief.

---

## 2. The Problem Being Solved

Clio's current access model was built incrementally, feature-by-feature, without one authoritative
statement of who the actors in the system are and what each is allowed to see. B2B-26/28 already
shipped a real sales-partner/client model; this brainstorm re-derived much of the same shape
independently and added two genuinely new pieces on top: a formal `end_user` concept (with a hard
statelessness/PII rule) and a generalized, polymorphically-scoped `internal_staff` role. Arun wants
one canonical role model — building on what's shipped, not replacing it wholesale — that every
future screen, API, and access check is built against.

---

## 3. What Success Looks Like

- A single canonical definition of `end_user`, `client`, `sales-partner`, `internal_staff`, and
  `admin` exists in the spec, expressed as a concrete extension of the already-shipped
  `partner_accounts`/`internal_admin_users` schema — not a from-scratch parallel model.
- Every existing and future admin-adjacent screen can be checked against one rule: does this leak a
  user's own role back to them? (It must not, except to `admin`.)
- A client-owning-content org can be represented in the data model and operated on by a
  sales-partner's own admins, without the client ever holding a login of its own.
- No code path anywhere writes `end_user`-scoped PII to persistent storage, except the one
  explicitly approved field (`end_user_name`).
- `internal_staff` can be scoped to support exactly one parent (a specific sales-partner, a specific
  client, or admin-at-large) and is blocked from acting on anything outside that scope.
- B2B-21's old, differently-scoped `internal_admin_users.role = 'sales_partner'` value is renamed to
  `'internal_staff'`, closing the gap B2B-26 flagged and never built.

---

## 4. Known Constraints (binding — do not relax)

- **C1 — No client login, ever.** A client's people never get an account under the `client` role.
  If a client's org needs someone with dashboard access, that person is invited as a
  `sales-partner`.
- **C2 — Role labels are admin-only-visible.** No UI, copy, or API response visible to a
  non-admin user may ever state or imply that user's own role.
- **C3 — No sales-partner→client billing inside Clio.** Do not design any wallet, invoice, or
  ledger concept for a sales-partner's sub-customers. Clio's billing surface stops at the
  sales-partner. (This matches B2B-26's own already-shipped "Sales-partner billing" scope boundary
  — confirm consistency, don't re-derive from zero.)
- **C4 — end_user PII: nothing persists except `end_user_name`.** This is a hard rule already in
  core memory, not a design choice open for this spec to revisit. Every new table, column, log
  line, or transcript-store touching `end_user` data must be checked against it explicitly in the
  spec, field by field.
- **C5 — Admins are flat, no tiers.** Do not design a hierarchy among admins.
- **C6 — Build on the shipped B2B-26/28 entity, don't fork it.** Per Section 0's resolution, the
  sales-partner/client model already exists in `partner_accounts.account_kind`. This brief extends
  it (new decisions: minute purchasing/sub-allocation as first-class concepts if not already
  present, `end_user` formalization, `internal_staff` rename/generalization) — it does not replace
  the underlying entity.
- **C7 — Do not reuse the bare token `sales_partner` for the new account-level concept.** Per B2B-26
  and B2B-28's own already-established convention, code/schema identifiers avoid the bare
  `sales_partner` string where it could collide with the (now being renamed) `internal_admin_users`
  role value — until this brief's rename lands, treat the token as still reserved.

---

## 5. What Was Section 5 (Terminology Collision) — Now Resolved, See Section 0

The original version of this brief contained a full analysis flagging a likely naming collision
between this brainstorm's "reseller" and the already-shipped "sales-partner" entity from B2B-21/26/
28, and escalated it to Arun rather than guessing. That escalation is resolved — see Section 0 for
Arun's verbatim answer and the resulting terminology table. This section is kept only as a pointer
so a future reader understands why Section 0 exists and isn't surprised to see it ahead of "What
Arun Said."

---

## 6. Prior Art the BA Must Read Before Designing

- `docs/2026-08-10-voice-language-brainstorm.md` — D10 through D13, full context above them.
- `.claude/agents/clio/feature-briefs/B2B-21-internal-admin-identity-super-admin-and-sales-partner.md`
  — the existing `internal_admin_users` role model. Its `role: 'super_admin' | 'sales_partner'`
  value is the one being renamed per Section 0's table.
- `.claude/agents/clio/feature-briefs/B2B-26-sales-partner-entity-signup-clients-team.md` — the
  existing `channel_partner` account-kind, client-ownership model, and the "client never logs in"
  precedent this brief's `client`/`sales-partner` extends. **Read its own naming-collision section**
  (its "the string sales_partner already exists..." discussion) — it is the direct precedent for
  Section 0's resolution and for C7 above; it already worked through exactly this kind of
  code-identifier-vs-UI-copy split for a different word pair, and its convention should be reused,
  not reinvented.
- `.claude/agents/clio/feature-briefs/B2B-28-direct-partner-invite-only-and-sales-partner-revenue-visibility.md`
  — the admin-only visibility precedent (super-admin sees sales-partner revenue share; the
  sales-partner itself never does) directly analogous to D11's role-visibility rule, and already
  shipped — confirm this brief's D11 requirement is fully satisfied by what's already live, or
  identify the gap precisely.
- The standing memory rule `feedback_no_end_user_pii_persistence.md` (core memory) — must be read
  verbatim, not paraphrased from this brief, before writing the PII section of the spec.

---

## 7. Questions for the BA to Resolve (Section 11 must be empty on delivery)

1. **Is `admin` a rename of `internal_admin_users.role = 'super_admin'`, or a coexisting label?**
   Not addressed by Arun's naming decision — genuinely still open. Confirm against current admin
   UI/API usage and recommend, don't assume either reading.
2. **Exact migration for the `internal_staff` rename.** Specify the migration renaming
   `internal_admin_users.role`'s `'sales_partner'` value to `'internal_staff'`, plus the schema
   change generalizing scoping from B2B-21's current (specific-partner-account-only) shape to the
   polymorphic `parent_type` (`sales_partner` | `client` | `admin`) / `parent_id` shape D10
   describes. Identify every existing call site referencing the old value/shape
   (`sales_partner_assignments`, `/api/admin/team/sales-partners`, `resolveInternalAdmin`, per
   B2B-26's own citation list) and specify the update for each — this is a real, live rename
   touching shipped code, not a greenfield addition.
3. **`internal_staff` scoped to a `client` parent — how does this actually work given clients never
   log in (D11)?** If `internal_staff.parent_type = 'client'` is valid per D10, but a `client` has
   no account/login (D11/C1), what does "supporting a client" mean concretely for that
   internal_staff member — do they operate through the owning sales-partner's account, or is there
   some other mechanism? Do not assume; escalate to Arun or reason it through explicitly with
   stated tradeoffs.
4. **Admin's "proactively notifies sales-partners to recharge/top up" (D10) — new work or already
   built?** Check B2B-04 (billing/metering) and B2B-13 (recurring plan tiers/topups) for any
   existing low-balance notification mechanism before specifying this as new scope.
5. **Full inventory of role-label leaks (C2).** A systematic audit of every current screen/API
   response that could reveal a user's own role, account kind, or internal categorization to
   themselves — not just a statement of the rule, but a checklist the dev team can act on. Note:
   B2B-28 already shipped part of this pattern (revenue-share hidden from the sales-partner) —
   confirm what's already compliant vs. what still needs auditing.
6. **The end_user PII exception boundary (C4).** Beyond `end_user_name`, specify precisely: what
   happens to `end_user_industry`/`end_user_role`/`language` etc. after a session ends — confirm
   they are truly never written anywhere (not even transiently logged), and specify the mechanism
   that guarantees this (e.g., explicit typing/lint rule, code review checklist, or structural
   isolation) rather than just restating the rule as prose.
7. **The open PII case Arun has explicitly not resolved:** an end_user could volunteer identifying
   information out loud mid-conversation (email, employer name, etc.), and session transcripts are
   stored today. This is the hardest unresolved case in D13. **Do not invent an answer.** Carry
   this forward verbatim as an open question for Arun — options to lay out for him (not to choose
   among) include: no transcript storage at all for end_user-facing sessions, automated PII
   scrubbing post-call (with its own accuracy risk), or an accepted-risk policy with a retention/
   access-control mitigation. State the tradeoffs; do not pick one.
8. **Admin invite flow for sales-partners/admins.** Concrete flow: does an admin inviting a
   sales-partner reuse B2B-06's existing self-serve or B2B-28's invite-only signup branch, and does
   inviting another admin follow the same or a different path?

---

## 8. Explicitly Out of Scope

- Any sales-partner-to-client billing mechanism (C3).
- Any admin tiering (C5).
- Building or renaming any actual database column, enum, or table — this brief produces a spec
  only; migrations are a developer-agent deliverable once the spec is approved.
- Introducing a second, parallel sales-partner-like entity — Section 0 forecloses this.

---

## 9. Sequencing Note for the Orchestrator

This brief is foundational to B2B-78 (production session API: `bot-dispatch`/`bot-sessions`) and
B2B-79 (inline delivery + sales-partner custom domains) — both of those briefs have been updated to
use "sales-partner" consistently per Section 0. Neither is blocked any further on this brief's
naming question — that part is resolved — but both still depend on the BA's concrete schema/
migration answers to Section 7 above (particularly Q2, the `internal_staff` rename) before
finalizing their own schema decisions.
