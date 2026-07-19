# Feature Brief: B2B-25 — Remove Clerk Organizations from Partner Signup

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 — blocking prerequisite for the sales-partner/subdomain-routing work in `docs/brainstorm-sales-partner-subdomain-routing.md`
Date: 2026-07-19

---

## What Arun Said

Verbatim, from the live architecture discussion recorded in `docs/brainstorm-sales-partner-subdomain-routing.md`:

> "i am not very much happy with the organization that clerk provides. too complicated."

And, confirming the scope and sequencing of this specific brief:

> "yes i m ok to drop organization. also remove all user and organization entries lets start with a clean slate. fix this org removal first and then proceed with all the remaining fixes."

This is a decision Arun already made directly — this brief documents it faithfully, it does not re-litigate it. The data-wipe half of that instruction (7 test `partner_accounts` + their `partner_admin_users` rows, all confirmed today's live-testing artifacts) is **already done** by the Orchestrator and is explicitly **not** part of this brief. This brief is the code/architecture change only.

Conclusion from the same discussion: Clerk Organizations should not be used anywhere in this product — not for internal staff (B2B-21 already proved the flat-table alternative works, shipped and live) and not for a partner's own team either. Every tenant type ends up on the same flat membership pattern.

---

## The Problem Being Solved

Two distinct problems, one fix:

**1. Product/architecture problem.** Clerk Organizations is a second, structurally different identity model living alongside the flat-table model B2B-21 already built and shipped for internal-admin (`internal_admin_users` + invite tokens, no Clerk Organizations involved). Arun does not want two membership patterns in the product — one dependency to reason about, one auth surface to secure, one pattern for every future tenant type (partner, and the sales-partner entity from the brainstorm doc that comes after this brief).

**2. Concrete bug class.** Both real, reproduced-live bugs fixed earlier this week — the `/partner-signup/organization` catch-all-routing failure (Clerk's `<CreateOrganization>` re-rendering the create form instead of completing after a successful create, because the fixed non-catch-all route gave its internal navigation nowhere valid to land) and the blank-page-for-signed-out-visitor bug — both lived **inside Clerk's own `<CreateOrganization>` component's internal navigation**, not in code Clio controls. Removing this step removes that entire bug surface permanently, not just today's two instances of it. Worth stating in the spec's rationale, not just as a footnote.

---

## What Success Looks Like

- A partner signs up via `/partner-signup` and lands with a working `partner_accounts` row and a `partner_admin_users` row (role `owner`) — with **no** intermediate "create your organization" screen, and with **zero** dependency on Clerk's Organizations product anywhere in the flow.
- `app/api/webhooks/clerk-organization/route.ts`'s two event handlers (`organization.created`, `organizationMembership.created`) are retired — no live code path still writes through them.
- `partner_admin_users` continues to be the single source of truth for "which Clerk-authenticated human administers which partner account" — this table's *shape* and its consumers (`requirePartnerAdmin` in `lib/partner/auth.ts`, `getPartnerAccountsForClerkUser` in `lib/partner/admin-accounts.ts`, both already keyed purely off `clerk_user_id` + `partner_account_id`) are **unchanged**. Only how rows get *written into* it changes.
- The two bugs named above become structurally impossible to recur, because the component that caused them no longer ships.

---

## Known Constraints (explicit, from Arun's instruction and this project's governance)

- No resurrecting anything from B2C git history.
- Test data cleanup is done; do not redo it or treat it as in scope here.
- Standing responsive-UI rule applies to any new/changed screen (Tailwind + `clamp()`, no hardcoded pixel-width caps).
- This is a **destructive-adjacent change to a live auth mechanism** — see explicit staging guidance below. Not a default big-bang assumption.
- Follow B2B-21's already-shipped pattern (`lib/internal-admin/auth.ts`, `lib/internal-admin/invite-tokens.ts`) rather than inventing a new one, per Arun's own instruction in this dispatch.

---

## Technical Findings (from reading the live code directly — for the BA to build on, not re-derive)

**Current flow, file by file:**
- `app/partner-signup/[[...partner-signup]]/page.tsx` — Clerk `<SignUp>`, `forceRedirectUrl="/partner-signup/organization"`. No `unsafeMetadata` is attached today (unlike the B2C onboarding flow, which already does this — see below).
- `app/partner-signup/organization/[[...organization]]/page.tsx` — the `<CreateOrganization>` step. **This entire file should be deleted**, not stubbed.
- `app/api/webhooks/clerk-organization/route.ts` — svix-verified handler for `organization.created` (upserts `partner_accounts` keyed on `clerk_org_id`) and `organizationMembership.created` (upserts `partner_admin_users`, first member gets `role='owner'`, rest get `'admin'`, sends `sendPartnerSignupWelcomeEmail`). **This route should be retired** (removed, or left as a 410/no-op — BA to decide which is cleaner, see Section below).
- `app/api/webhooks/clerk/route.ts` (`user.created`) — **already exists and already does the equivalent job for the consumer/onboarding path**: on `user.created`, if `unsafe_metadata` was attached to the `<SignUp>` call, it validates and saves the full onboarding profile atomically with account creation. This is the established, working precedent (labelled `ONBOARD-DATA-01` in the code) for "attach intent/data to signup via `unsafeMetadata`, act on it in the `user.created` webhook."
- `lib/partner/auth.ts` (`requirePartnerAdmin`) and `lib/partner/admin-accounts.ts` (`getPartnerAccountsForClerkUser`) — **both already read `partner_admin_users` purely by `clerk_user_id` + `partner_account_id`.** Neither has any Clerk-Organizations awareness at all. This means the entire *read* side of partner-admin auth requires zero changes — this is a write-path-only fix.
- `partner_accounts.clerk_org_id` (migration `071_b2b02_partner_accounts_and_api_keys.sql`) — the only column anywhere tied to Clerk Organizations. **Recommend: leave the column in place, nullable, stop writing to it.** Per this project's "hide, don't delete without approval" governance default, and because there's no forcing reason to drop it — a follow-up migration to drop it later is cheap and low-risk once the team is confident nothing reads it.
- `middleware.ts` — only reference is a comment on the `/partner-signup(.*)` public route noting it covers both `<SignUp>` and `<CreateOrganization>`; update the comment, no route-matching logic changes needed.
- `inngest/partner-signup-reminder.ts` — references `organization.created` / the clerk-organization webhook in its own doc comments as the thing that marks a signup "complete." **This needs to be repointed** to whatever new signal marks partner-account creation complete under the new flow (the BA spec must define this explicitly — likely the same `user.created` → `partner_accounts` row-exists check, or a dedicated Inngest event emitted from the new webhook path).
- `lib/delivery/email.ts` (`sendPartnerSignupWelcomeEmail`) — currently takes an `orgName` param sourced from the Clerk Organization's name. Needs to keep working with a `partner_accounts.name` sourced a different way (see open point below on where the company name comes from now).

**No partner-facing "invite a teammate" UI exists anywhere in Clio's own dashboard today.** I grepped the Configurator surface and found nothing — the only way a partner could ever add a second team member was through Clerk's own hosted `<CreateOrganization>`/Organization-management UI's built-in invite feature, which itself was never embedded or linked anywhere in this app beyond the initial `<CreateOrganization>` step. Practically, this means: **removing Clerk Organizations does not remove any teammate-invite functionality Clio ever actually shipped or exposed** — it only formalizes that partner accounts are effectively single-owner today. This is a real, useful fact for scoping, not a gap this brief needs to close.

**Judgment call — reuse `partner_admin_users` as-is, do not build the eventual generic `tenant_staff_users` table now.** The brainstorm doc's fuller design merges sales-partner's-own-staff and partner's-own-staff into one generic table later. I considered building that table now to avoid touching `partner_admin_users` twice. I recommend against it: `partner_admin_users`' *shape* (`clerk_user_id`, `partner_account_id`, `role`) needs zero schema changes for this brief — only its population mechanism changes. Building the generic table now would mean speculatively designing for the sales-partner entity (not yet spec'd, out of scope here) and migrating existing rows for no immediate benefit. Minimal, reversible change now; the generic-table migration is cleanly deferrable to the sales-partner brief where it's actually needed.

---

## Questions for BA (resolved here so Section 11 stays empty — reasoned from code + the brainstorm doc, not guessed)

**Q1 — What triggers `partner_accounts` row creation with no organization-creation step to hang it off of?**
Answer: extend `app/api/webhooks/clerk/route.ts`'s `user.created` handler, using the exact same `unsafeMetadata` mechanism already proven by `ONBOARD-DATA-01`. Attach `{ signup_intent: 'partner', ... }` (plus whatever fields below) to the `<SignUp unsafeMetadata={...}>` call in `app/partner-signup/[[...partner-signup]]/page.tsx`. Branch in the webhook: if `signup_intent === 'partner'`, create `partner_accounts` + `partner_admin_users` (role `owner`) instead of running the consumer onboarding-save path. This is a real code-level decision the BA should document precisely (exact metadata shape, exact branch condition) — I'm giving the mechanism, not the field-by-field spec.

**Q2 — Where does the partner's company name come from, with no `<CreateOrganization>` form to collect it?**
There is no existing "rename my partner account" UI anywhere in the admin API today (checked directly), so whatever name is captured at signup is effectively permanent until someone builds a rename feature — that argues for capturing it explicitly rather than defaulting to something derived (e.g. email domain) and hoping nobody minds. Recommendation: add one plain-HTML text field ("Company name") on a lightweight step immediately before Clerk's `<SignUp>` renders on `/partner-signup` (not a Clerk component — just a small form Clio owns), stash the value into the same `unsafeMetadata` payload from Q1, and let the `user.created` webhook use it as `partner_accounts.name` directly. This is a product-shape/screen decision — the BA must write the full 3+ line spec for this exact screen (copy, validation, empty-state handling) per this project's "ambiguous UX = STOP" rule; I'm supplying the mechanism and the recommendation, not the finished screen.

**Q3 — Retire the webhook route outright, or leave a stub?**
Recommend: delete `app/api/webhooks/clerk-organization/route.ts` outright and remove the corresponding webhook endpoint from the Clerk dashboard configuration (manual step, document it in the spec's rollout notes) — rather than leaving a stub that silently 200s. A stub that accepts but ignores events is more surprising later (looks alive, does nothing) than a route that's simply gone and would 404 if Clerk ever redelivered against it, which is diagnosable. `CLERK_ORGANIZATION_WEBHOOK_SECRET` should be removed from env docs once no code reads it.

**Q4 — Staging vs. big-bang.** Per the explicit instruction to be precise about this rather than default to big-bang: this is safe to cut over in one deploy, not feature-flagged, for three reasons — (a) test data is already wiped, so there are zero live partner accounts whose auth would break; (b) the read path (`requirePartnerAdmin`, `getPartnerAccountsForClerkUser`) is completely unchanged, so nothing downstream of signup is at risk; (c) the blast radius of the write-path change is fully contained to the signup moment itself. The one thing that must happen in the same deploy, not after it: the Clerk-dashboard-side webhook endpoint removal (Q3) and the `/partner-signup/organization` route deletion, so there's no window where a partner can reach a half-migrated flow. BA should still confirm this reasoning in the spec rather than take it as given.

---

## Out of Scope for This Brief

- The sales-partner entity itself (self-serve signup, client CRUD, dashboard) — separate, larger brief per the brainstorm doc's proposed split (B).
- Renaming B2B-21's "sales-partner" role to "internal-staff" — separate brief (A).
- Any partner-facing "invite a teammate" feature — does not exist today (see finding above); log as a follow-on backlog item if Arun wants it, not built here.
- Subdomain routing, billing model changes — briefs (C), (D) in the brainstorm doc.

---

## Escalations

None. Every point I could not answer confidently from code + the brainstorm doc's already-recorded discussion is answered above with reasoning, not guessed — per this project's "reason it through or escalate, never guess" rule. If the BA's deeper investigation surfaces something that genuinely changes the product shape (e.g. a hidden dependency on `clerk_org_id` I didn't find), that comes back to me, not decided solo.
