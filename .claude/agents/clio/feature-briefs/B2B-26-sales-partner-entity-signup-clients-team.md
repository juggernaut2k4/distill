# Feature Brief: B2B-26 — Sales-Partner Entity: Signup Branch, Client Roster, Own Team

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — foundation for the sales-partner/channel model; unblocks the billing and Known-Bugs
follow-on briefs described below, which cannot be spec'd meaningfully until this entity exists.
Date: 2026-07-19

---

## What Arun Said

Verbatim, given directly in conversation today (2026-07-19), simplifying the open design question
left in `docs/brainstorm-sales-partner-subdomain-routing.md` §7/"Next step":

> "basically the only difference between the partner and sales-partner is sales-partner can have
> multiple clients. so for today lets proceed with partner-signup. but lets add a selection, ask the
> question if you manage multiple clients yes or no. if they say yes then they become a sales-partner.
> if no then they become a partner"

This is the final answer to the brainstorm doc's proposed split between "(A) separate URL vs. one
signup with a branch" — Arun chose: **one signup flow, one new branching question, no separate URL.**
It also gives the clearest possible steer on data modeling: a sales-partner is not a structurally
different thing from a partner, it is the same thing plus a clients relationship. I have taken that
literally in the technical recommendation below rather than inventing a parallel entity.

---

## The Problem Being Solved

Today `/partner-signup` (B2B-25, shipped `854f05a`) produces exactly one outcome: a `partner_accounts`
row + a `partner_admin_users` row (`role='owner'`) for the signing-up company itself. There is no way
for a reseller/channel company — the brainstorm doc's worked example is "ai-learn.com" reselling Clio
to "Pluralsight" — to sign up once and manage several downstream client accounts under one login, one
shared bill, and one team. Today that company would have to create N separate direct-partner accounts
with N separate logins, which does not match how a reseller actually operates and gives Clio no way to
model the sales-partner ↔ client relationship at all.

The brainstorm doc (a full architecture discussion already converged with Arun on 2026-07-18) defines
the target shape in detail — terminology, the two scenarios, endpoint design, billing model, and the
list of new work this requires (§1–§6). This brief formalizes the self-serve entry point and the
minimum viable entity so a sales-partner can exist, sign up, add clients, and staff their own team.
It does not yet build billing mechanics or the subdomain routing layer — see Scope Split below.

---

## What Success Looks Like

- A visitor at `/partner-signup` answers one new question — "Do you manage multiple clients?" — in
  addition to the existing company-name capture. **No** answers "No" → the existing B2B-25 flow runs
  completely unchanged (a `partner_accounts` row, `partner_admin_users` role `owner`). **Yes** →
  the visitor becomes a sales-partner: a comparable account, but one that can hold client records.
- A sales-partner logs into their own dashboard (not the Configurator — see Scope below) and sees:
  a Clients list, an "Add client" action capturing name + company URL (the brainstorm doc's own
  minimum, §2 Scenario B), and a Team panel to invite their own staff.
- A sales-partner can invite people onto their own team. Every invitee gets full access to everything
  on the sales-partner's dashboard **except billing/payments** — the same "full access except
  billing" rule Arun has now confirmed applies at every tenant level (Clio's own super-admin/internal
  layer, a sales-partner's own team, and — already latent but never built — a direct partner's own
  team).
- Nothing about the existing direct-partner flow, `partner_admin_users`, `requirePartnerAdmin`, or the
  Configurator changes for a partner who answers "No." This is additive.

---

## Naming collision — read this before scoping anything (technical finding, resolved here, not escalated)

**The string `sales_partner` already exists extensively in shipped code — for a completely different
concept than what Arun means today.** B2B-21 (shipped) built Clio's own internal-operator layer and
named its scoped-invitee role literally `'sales_partner'`: `internal_admin_users.role` is a hard
TypeScript union `'super_admin' | 'sales_partner'` and a DB `CHECK` constraint of the same values; the
join table is `sales_partner_assignments`; the API is `/api/admin/team/sales-partners`; the UI copy on
`TeamClient.tsx` says "Invite sales-partner" / "Manage Clio super-admins and invite sales-partners
scoped to specific partner accounts." **That B2B-21 "sales-partner" is Clio's own employee, tagged to
help manage specific existing partner accounts — an account manager, not a reseller.**

The brainstorm doc already caught this collision and locked the correct fix (§1, terminology table):
*B2B-21's "sales-partner" is renamed to "internal-staff"* — but that rename is its own separate,
not-yet-written brief (item **(A)** in the brainstorm doc's proposed split). It has not shipped. Until
it does, the literal string `sales_partner` in the codebase means the *old* B2B-21 concept, while
every human-facing word "sales-partner" from this point forward (this brief, Arun's own words today)
means the *new* reseller entity.

**Resolution (technical decision, within my authority, not a product call):** this brief's new schema,
API routes, and TypeScript types must **not** reuse the bare token `sales_partner` / `sales-partner`
anywhere a human or a future grep could confuse it with B2B-21's role. I am directing the BA to pick
collision-free identifiers for every new symbol this brief introduces — for example (not mandating
exact names, the BA owns final naming): a schema discriminator like
`partner_accounts.account_kind IN ('partner', 'channel_partner')`, a new join concept named around
"channel" or "reseller" internally in code even though the **UI-facing label stays "sales-partner"**
per Arun's own chosen term (§1: "not called 'reseller' — sounds more industrialistic"). The point is
symbol-level: user-visible copy says "sales-partner," code/schema identifiers avoid the bare
`sales_partner` token that B2B-21 already owns. The BA must state its chosen naming convention
explicitly in the Requirement Document so Dev doesn't collide with `internal_admin_users`,
`sales_partner_assignments`, `/api/admin/team/sales-partners`, or the `InternalAdminResult` role union
in `lib/internal-admin/auth.ts` — all of which are B2B-21's, untouched, out of scope here.

I raise this as a **known constraint**, not an escalation — Arun's own words already settle what the
new entity is and is called to a human; the only open question was a code-naming collision, which is
a technical call.

---

## A second wording clarification (also resolved here, not escalated)

The scope handed to me describes a sales-partner inviting "their own internal-staff." Read literally,
this would create a *third* meaning for the term "internal-staff" (already claimed by the brainstorm
doc's terminology lock as Clio's own employees, item (A) above). I am confident this is describing the
generic pattern — every tenant level gets to invite its own team, full access except billing — not
literally reusing the reserved term. **I am directing the BA to call this "the sales-partner's own team
members" or equivalent in the spec, and explicitly not "internal-staff."** This keeps the brainstorm
doc's terminology lock intact and avoids a three-way naming collision on top of the one above.

---

## Recommended data-model approach (a recommendation for the BA to evaluate, not a mandate)

Arun's own framing — "the only difference between the partner and sales-partner is sales-partner can
have multiple clients" — argues strongly against inventing a parallel entity table. My recommendation,
grounded in the actual shipped schema (`supabase/migrations/071_b2b02_partner_accounts_and_api_keys.sql`,
read directly for this brief) and B2B-25's just-shipped `createOrClaimPartnerAccount()` pattern
(`lib/partner/signup.ts`):

- **Reuse `partner_accounts` + `partner_admin_users` for the sales-partner's own account, unchanged
  in shape.** A sales-partner is a `partner_accounts` row like any other; whoever signs up gets a
  `partner_admin_users` row (`role='owner'`) against it exactly like today. This is the same
  `createOrClaimPartnerAccount()` helper B2B-25 already built — call it with one new discriminator
  value.
- **Add one discriminator column**, e.g. `partner_accounts.account_kind TEXT NOT NULL DEFAULT
  'partner' CHECK (account_kind IN ('partner', 'channel_partner'))` (naming per the collision
  resolution above — BA to finalize the literal value).
- **Add one ownership column for client rows**, e.g. `partner_accounts.owning_channel_partner_id UUID
  REFERENCES partner_accounts(id) ON DELETE SET NULL`, nullable, set only on a client record created
  by a sales-partner. A client is *itself* a normal `partner_accounts` row (`account_kind='partner'`)
  — this is exactly what the brainstorm doc says (§2 Scenario B: "each client = a `partner_accounts`
  row, same shape as a direct partner"), and it means the entire existing Configurator, Integration
  step, `outbound_base_url`/`outbound_auth_token_ciphertext`/`outbound_signing_secret` columns
  (already on `partner_accounts`, migration 071 — this **is** the "webhook_url" the brainstorm doc
  refers to informally in §3/item 6, no new column needed), billing wallet shape, etc. all work for a
  client row with **zero new code** to represent the client's own configuration.
- **A client row gets zero `partner_admin_users` rows** — confirmed by the brainstorm doc, "the
  partner never logs into Clio themselves, ever." The sales-partner's own admin(s) act on the client's
  behalf. This needs one new authorization path: a caller who is a `partner_admin_users` member of the
  *owning* sales-partner account may also read/write the client's `partner_accounts` row (and its
  Integration fields, wallet, etc. once those screens exist in the follow-on brief). Recommend a new
  helper parallel to `requirePartnerAdmin` (`lib/partner/auth.ts`) — e.g.
  `requirePartnerAdminOrOwningChannelPartner(partnerAccountId)` — that passes if the caller
  administers the account directly **or** administers the account named in its
  `owning_channel_partner_id`. This is additive; `requirePartnerAdmin` itself is untouched.
- **The sales-partner's own team (this brief's Team panel)** — reuse `partner_admin_users`'s existing
  three-role shape (`owner`/`admin`/`member`) for members of the sales-partner's *own* account row,
  same as any partner's own team would. No new role table needed for this. The "full access except
  billing" rule is a **new authorization rule** this brief must add somewhere (BA to decide: a
  `role`-based check, or a small new capability flag) — note that this same rule needs to eventually
  apply to a *direct* partner's own team too (B2B-25's finding: no partner-facing invite-teammate UI
  exists at all today), but building that for direct partners is **out of scope here** — only the
  sales-partner's own team invite is in scope for this brief. Flag the shared-rule reuse opportunity
  for whichever brief eventually builds direct-partner team invites.

This reuses `createOrClaimPartnerAccount`, `partner_admin_users`, the entire Configurator, and the
existing Integration/billing columns almost without modification — exactly matching Arun's own framing
that these are barely different entities. The BA owns the final schema; this is my starting
recommendation, not a mandate.

---

## Scope for THIS brief (B2B-26)

1. **Extend `/partner-signup`'s State 1 screen** (`app/partner-signup/[[...partner-signup]]/page.tsx`,
   read directly for this brief) with a new question: "Do you manage multiple clients?" Yes/No. This
   is a genuine screen change (new field + branching logic) — the BA must write the full 3+ line
   screen spec (copy, layout, validation, how the answer travels through State 2's `unsafeMetadata`
   and State 2b's claim-route body alongside `company_name`) per this project's "ambiguous UX = STOP"
   rule, matching the existing dark-void card styling already established by B2B-25's shipped screen —
   do not invent new visual language.
2. **No → Partner.** Existing flow, completely unchanged. Reuses `createOrClaimPartnerAccount()`
   exactly as B2B-25 built it (implicitly `account_kind='partner'`).
3. **Yes → Sales-partner account creation.** New branch through the same webhook
   (`app/api/webhooks/clerk/route.ts`) and claim route (`app/api/partner-signup/claim/route.ts`) write
   paths B2B-25 already built — extend `createOrClaimPartnerAccount()` to accept the discriminator
   rather than forking a second function, per the recommendation above.
4. **Clients list + add-client (minimal).** A sales-partner's own dashboard area listing their client
   `partner_accounts` rows (`owning_channel_partner_id = <their account id>`). "Add client" captures
   **name + company URL only** — the brainstorm doc's own explicit minimum (§2 Scenario B: "ai-learn
   creates a client record for Pluralsight (name + company URL) inside their dashboard"). No
   Integration/Behavior/usage-cap/routing-address fields on this screen — those are the follow-on
   brief's job (see Scope Split below). Creating a client here produces a real `partner_accounts` row
   with `account_kind='partner'`, `owning_channel_partner_id` set, and zero `partner_admin_users` rows
   — a real, functioning entity, just with its detailed configuration screens deferred.
5. **Team panel.** The sales-partner invites their own team members. Reuse the B2B-21 invite-token
   mechanism verbatim as the technical pattern — `lib/internal-admin/invite-tokens.ts`
   (`generateInviteToken`/`hashInviteToken`, SHA-256, 7-day expiry, plaintext shown once) is the exact
   right shape to copy for this new invite flow; do not reinvent token generation. The accept-flow
   precedent is `app/invite/accept/InviteAcceptClient.tsx` — reuse the pattern, not the B2B-21 table
   (a new, small `partner_admin_users`-scoped invite mechanism, since this brief's invitees end up as
   `partner_admin_users` rows on the sales-partner's own `partner_accounts` row, not
   `internal_admin_users` rows). "Full access except billing" is enforced here — BA to specify exactly
   which billing/payment routes and UI a non-owner sales-partner team member is blocked from.
6. **A minimal aggregate Dashboard**, reusing B2B-24's four-content-area *pattern* (not its code) at a
   scope appropriate to what exists in this brief: client count / roster glimpse, team count, and a
   "Billing — coming soon" placeholder card (real wallet numbers land in the Billing follow-on brief,
   see below — do not build throwaway wallet UI here). No Known-Bugs data on this dashboard, matching
   B2B-24's own explicit exclusion of glitch/bug data from its dashboard.

---

## What's explicitly OUT of scope for this brief (do not build; each is a named follow-on)

- **Per-client detail screen** — Integration fields (reusing the existing `outbound_base_url` /
  `outbound_auth_token_ciphertext` / `outbound_signing_secret` columns and the existing
  `IntegrationClient` Configurator step, `app/dashboard/configurator/integration/IntegrationClient.tsx`),
  usage cap, and the routing-address field. **Reasoning for deferring, not just punting:** these
  require the `requirePartnerAdminOrOwningChannelPartner`-style auth path this brief only introduces
  the data model for, and the routing-address field specifically depends on a real product decision
  about how to represent a not-yet-functional address (see note below) — cleaner as its own reviewed
  brief than bolted onto signup/entity/team.
- **The `*.hello-clio.com` subdomain routing layer** (brainstorm doc item C) — separate brief,
  unchanged. For *this* brief's minimal Clients list, no routing-address field is shown at all (not
  even a placeholder) — Clients list only shows name + company URL + status, per the literal minimum
  in scope item 4. A non-functional-looking domain string would risk a real partner mistaking it for
  live infrastructure, which cuts against the "no AI-slop / no misleading UI" standard; better to add
  it deliberately, correctly labeled, once the per-client detail brief is written and needs it.
- **Per-client behavior/voice/language configuration UI** (brainstorm doc item E) — separate brief.
  Not referenced anywhere in this brief's screens.
- **Sales-partner billing** — shared wallet funding, per-client usage tracking, optional per-client
  caps, consolidated invoice/total. Brainstorm doc item D, separate brief. This brief's Dashboard shows
  only a "Billing — coming soon" placeholder (scope item 6). No Stripe changes in this brief.
- **Known Bugs aggregation for sales-partners** (extending B2B-22's hybrid-scope pattern from
  internal-staff to sales-partners) — separate, small follow-on brief. Cannot be meaningfully spec'd
  until this brief's client roster and ownership model exist for it to aggregate over.
- **Renaming B2B-21's `sales_partner` role to `internal-staff`** — brainstorm doc item (A), separate
  brief. Not touched here (see Naming collision section above).

---

## Scope-split recommendation (as instructed — judged, not defaulted)

This is a large brief. I considered building the full six-screen surface (signup, Clients, per-client
detail, Billing, Team, Known Bugs) in one brief, per the raw scope handed to me, and rejected it:
Billing touches Stripe/the wallet ledger and deserves its own focused BA spec and CEO review given
real money is involved (consistent with how B2B-04/B2B-13 were each their own briefs); the per-client
detail screen and Known Bugs aggregation both structurally *depend* on this brief's client-ownership
model existing first, so spec'ing them now would mean guessing at an interface this brief itself will
finalize. Splitting also keeps each brief small enough for a clean CEO review pass and a QA gate that
actually exercises a coherent, shippable slice.

**Recommended sequence:**
1. **B2B-26 (this brief)** — signup branch, sales-partner entity + client-ownership model, minimal
   Clients CRUD (name + URL only), Team invite, minimal Dashboard. Ships a real, usable (if minimal)
   sales-partner product.
2. **B2B-27 (follow-on)** — per-client detail screen: Integration fields, usage cap, routing-address
   field (once its UX is deliberately designed, not deferred-forever).
3. **B2B-28 (follow-on)** — sales-partner billing: shared wallet, per-client usage/caps, consolidated
   invoice, wiring the Dashboard's placeholder card to real numbers.
4. **B2B-29 (follow-on)** — Known Bugs aggregation for sales-partners, extending B2B-22's hybrid-scope
   pattern (`app/api/admin/glitches/route.ts`'s `sales_partner` scoping — note: that code path is
   B2B-21's *old* concept; B2B-29 will need to reconcile against whatever B2B-21's rename brief (A)
   has done by then, or against today's naming if (A) hasn't landed — flag this dependency ordering
   risk now for whoever picks up B2B-29).

I am not writing Feature Briefs for B2B-27–29 now — only naming and sequencing them, per the
instruction to judge and state the split, not build out every sibling brief in this dispatch.

---

## Known Constraints

- No resurrecting anything from B2C git history.
- Standing responsive-UI rule applies to every new screen: Tailwind + `clamp()`, no hardcoded
  pixel-width caps, matching B2B-25's own `max-w-sm` fluid-card precedent.
- Reuse aggressively and name each reuse explicitly in the Requirement Document: B2B-25's
  `createOrClaimPartnerAccount()` / `unsafeMetadata` mechanism (extend, don't fork), B2B-21's invite
  token generation (`lib/internal-admin/invite-tokens.ts`, copy the pattern not the table), B2B-24's
  Dashboard four-area *pattern* (not its literal code — nothing in that brief's scope exists yet for
  this entity to reuse directly), the existing `partner_accounts` Integration columns (no new columns
  needed for those, confirmed by direct migration read).
- Do not touch `requirePartnerAdmin`, `partner_admin_users`' existing shape, B2B-21's
  `internal_admin_users`/`sales_partner_assignments`/`resolveInternalAdmin`/`requireSuperAdmin`/
  `requireInternalAdmin`, or anything in `lib/internal-admin/*` — all untouched, orthogonal, out of
  scope.
- No new npm dependencies without written justification.
- Never populate any of this brief's screens with speculative AI-generated content — Clients list,
  Team panel, and Dashboard are all structured data reads, not generative surfaces.

---

## Questions for BA

1. Finalize the exact `account_kind` / ownership-column naming (collision-free per the Naming section
   above) and document it precisely — this is the one piece of this brief with real "get it wrong once
   and it's everywhere" risk.
2. Design the full State 1 screen addition (the Yes/No question) — copy, layout, and exactly how the
   answer flows through both B2B-25 write paths (`unsafeMetadata` and the claim-route body).
3. Specify `requirePartnerAdminOrOwningChannelPartner`-equivalent auth precisely: 401/403 shapes,
   parity with `requirePartnerAdmin`'s existing conventions.
4. Specify the sales-partner team invite flow end to end (token issuance, accept page, expiry,
   re-invite, revoke) and the exact "full access except billing" enforcement — which routes/UI
   surfaces are gated, and how a non-owner team member is blocked from billing specifically (there is
   no billing UI yet in this brief's scope — confirm this means "no billing surfaces exist for anyone
   yet" rather than something to actively gate today, and note it becomes a real gate once B2B-28
   ships).
5. Specify the Dashboard's four areas precisely (client roster glimpse, team count, "Billing — coming
   soon" card, quick-nav) with wireframes, per the "ambiguous UX = STOP" rule — reuse B2B-24's
   structural pattern, do not rubber-stamp it since the underlying data here is different.
6. Confirm and document: can a sales-partner's own account (the `account_kind='channel_partner'`-style
   row itself) ever also act as a *direct* partner with its own Configurator, or is a sales-partner
   account strictly a management shell with all real product usage happening on client rows? (My
   reading of the brainstorm doc is the latter — confirm and state explicitly, since it determines
   whether the sales-partner's own nav ever shows a Configurator link at all.)

Section 11 must be empty before this reaches Dev, per standing governance.

---

## Escalations

None. Every point I could not answer confidently from the brainstorm doc + Arun's direct words today
is resolved above with reasoning (the naming collision, the terminology clarification, the
data-model recommendation, the scope split) rather than guessed. If the BA's deeper investigation
surfaces a genuine product-shape ambiguity I haven't covered — most likely candidates: whether a
sales-partner's own account can ever be a direct partner too (Q6 above), or whether the "full access
except billing" rule needs a real capability-flag system versus a simple owner/non-owner check — that
comes back to me, not decided solo by the BA or Dev.
