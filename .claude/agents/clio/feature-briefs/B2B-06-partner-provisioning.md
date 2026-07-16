> **RECONSTRUCTED 2026-07-15** — original lost to a concurrent-agent `git stash` collision during the
> parallel B2B-06/07/08/09 build spree (2026-07-15). Rebuilt from `architecture.md` §18 (all
> subsections, §18.1–§18.12), `docs/b2b-pivot-status.md`'s Live Status row for B2B-06 and its Changelog
> entries dated 2026-07-13 (overnight) and 2026-07-15 (two same-day revisions), and
> `docs/specs/B2B-06-requirement-document.md` v1.1 (the BA's surviving output, written *from* this brief
> and back-derived against here for scope fidelity). Content matches the historical record to the best
> available evidence.
>
> **One source could not be independently re-read**: `docs/brainstorm-partner-signup-integration.md`
> does not exist on disk in the current worktree, and no commit in `git log --all` ever added it —
> it appears to be a second casualty of the same loss (or was never committed in the first place). It is
> not reconstructed here as its own file. Every direct quote attributed to it below is instead sourced
> from verbatim citations of it preserved inline in `docs/b2b-pivot-status.md`'s Changelog (which quotes
> Arun's exact words from that conversation twice, with clear attribution) — those quotes are
> high-confidence, not guessed, but the surrounding conversational context (anything not directly quoted
> in the tracker) is genuinely unrecoverable and is not invented here.

# Feature Brief: B2B-06 — Partner Provisioning
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-13 (v1, overnight) — revised 2026-07-15 (v2), revised again same day 2026-07-15 (v3)
Status: v3, approved for BA dispatch — zero open questions

## Changelog (revised in place — this brief was never forked; each revision replaced the prior text)

**v2 (2026-07-15):** Arun directly overrode v1's own flagged Q1 (see "What Arun Said" below) — signup
is self-serve, not internal-operator-mediated. This forced four changes, each re-verified against live
code rather than carried over from v1's assumptions: Q1 flips to self-serve via Clerk Organizations; Q4
flips from "API-only, no UI" to three real UI surfaces (signup wrapper, self-serve credential
generation, self-serve outbound-config); one new schema column (`partner_accounts.clerk_org_id`,
v1 had claimed no migration was needed — true only for v1's narrower scope); and one new finding
surfaced while re-verifying for the revision, not previously flagged — `POST /api/partner/v1/sessions`
has no funding/payment-method check anywhere in its dispatch path, which was an acceptable gap only
because every account used to be internal-operator-vetted before it could exist. Self-serve removes
that vetting step, so v2 adds a small, explicitly-scoped cost-exposure guardrail. Q2 reframed, Q3
carried forward unchanged. OAuth2 Client Credentials named explicitly as a fast-follow, not v2 scope.

**v3 (2026-07-15, same day):** The sibling CEO Agent working B2B-07 caught a document error in v2 while
grounding that brief: v2's own text said OAuth2 was a fast-follow with the static key as the in-scope
v1 mechanism, but Arun's direct correction on this exact point (see "What Arun Said" below) had already
happened in the same conversation that produced v2 — v2's text was simply never updated to reflect it.
v3 corrects this, narrowly, in the auth-mechanism section only. Self-serve signup, the outbound-config
UI, the payment-guardrail scoping, and the internal-operator recovery routes are unchanged from v2,
re-confirmed here, not re-derived. New Q5 resolves the OAuth2/static-key scoping explicitly. Q1–Q4
unchanged and not reopened.

---

## Series context

This is not one of the original five sequenced B2B pivot briefs (B2B-01 through B2B-05 — all done,
built, and committed). It surfaced from the overnight completeness audit Arun asked for before going to
sleep ("check that the user will be able to navigate to all the screens... and perform all the expected
actions," explicitly authorized to proceed without waiting for approval). One of that audit's five
parallel read-only sweeps found, with full certainty — `grep`-confirmed across every `.insert()` call in
`app/`, `lib/`, `inngest/`, every migration, every seed script — that **no code path anywhere creates a
new `partner_accounts` or `partner_admin_users` row.** Every partner-lifecycle feature built across
B2B-02 through B2B-05 assumes the account already exists. There is no way for a real partner to reach
Clio at all without a Clio engineer manually inserting rows. This brief is that gap, driven as its own
Feature Brief rather than folded into the overnight audit's smaller fixes, because closing it is a
product-shape decision (who provisions an account), not a bug fix.

## What Arun Said

**Trigger (overnight, pre-B2B-06):** the completeness-audit instruction above, which is what surfaced
the gap in the first place — not a statement about provisioning itself.

**v1's own flagged question, and Arun's direct override (2026-07-15):** v1 scoped provisioning as
internal-operator-only and flagged that choice prominently as "the one call in this brief closest to a
genuine product-shape decision... flagging it prominently for Arun to confirm or override," with its own
supporting reasoning being that "Pluralsight and Capgemini are realistically negotiated deals, not
self-serve." Arun responded directly, in his own words:

> "someone from customer side will signup (capgemini or pluralsight)... our role will be to help them if
> they face any issues in signup or integration... those are sensitive and we should not see it hence it
> has to be self serve."

This is a direct override, not a refinement — Arun names those exact two companies as the self-serve
example, meaning v1's central piece of supporting reasoning was read backwards, not merely
under-confirmed.

**On the credential mechanism, first pass (v2):** in the same conversation, discussing OAuth2 as a
possible addition, Arun said "if they want to use JWT" — read at the time as naming a real, worth-building
mechanism that did not need to gate v2's completeness, so v2 scoped it as a fast-follow, not v1 scope.

**On the credential mechanism, corrected (v3):** the same conversation, read back more carefully by the
sibling B2B-07 CEO Agent, contained a further, more explicit instruction that v2's own document text
never incorporated:

> "We need this advanced login now itself. Let's not start with static API."

This is Arun's direct correction that OAuth2 Client Credentials is the v1/day-one default authentication
mechanism for real partners, not a fast-follow. v3 exists to fix v2's document text, which was simply
never updated to reflect that this instruction had already been given.

## The Problem Being Solved

Three real, evidenced gaps, not hypothetical ones — each verified against live code, not assumed from
the brainstorm doc alone:

1. **No prospective partner can become a Clio partner without a Clio engineer manually inserting rows.**
   `partner_wallets` and `partner_onboarding_progress` already self-provision the moment an account
   exists (confirmed in code), and `POST /api/admin/partner-keys` already works once a
   `partner_admin_users` row exists — but nothing anywhere creates that first row. This directly
   contradicts Arun's stated intent that Clio's role is to "help them if they face any issues... not
   perform the signup itself."
2. **The only credential mechanism that exists — a static, unexpiring API key (`partner_api_keys`) — is
   exactly the shape of credential Arun explicitly rejected as the v1/day-one default** once he clarified
   his intent ("We need this advanced login now itself. Let's not start with static API"): a long-lived
   secret is a standing risk if leaked and works forever until someone manually revokes it — not
   acceptable as the first thing a real partner's engineering team is handed.
3. **`POST /api/partner/v1/sessions` has zero funding check before dispatching a real, billable meeting
   bot.** This was a reasonable gap when every account was internal-operator-vetted before it could
   exist — vetting was the funding check, functionally. The moment signup becomes self-serve, that
   implicit protection disappears: an unvetted, unfunded account could dispatch unlimited real, billable
   sessions at Clio's own cost with no way to ever collect payment.

**What failure looks like without this brief:** no partner ever reaches Clio without a manual,
Clio-staff-mediated process Arun has explicitly said should not exist; any partner who did get an
account would be issued the exact credential shape Arun rejected; and the moment self-serve signup ships
without a funding guardrail, an unvetted account can run up real, uncollectable vendor cost.

## What Success Looks Like

1. A prospective partner's own employee (e.g. someone at Capgemini or Pluralsight) signs up themselves —
   own company email, own organization name — with zero Clio staff involvement.
2. The moment their organization is created, they can immediately access the Configurator to begin
   integration — no separate "wait for Clio to provision you" step, and no new redirect logic needs to
   be built for this: it falls out of the existing B2B-05 wizard entry-point redirect once this brief's
   provisioning mechanism has created the underlying rows.
3. That same partner-admin generates their own `client_id`/`client_secret` pair in-app, immediately —
   their own engineering team never has to ask Clio for a credential — and separately enters their own
   outbound webhook base URL and generates their own signing secret without that secret ever passing
   through a Clio employee's hands.
4. Nothing about `test`-mode access — credential generation, token exchange, exploring the Configurator,
   calling `test`-mode API endpoints — is ever gated on funding. Only a `live`-mode session dispatch is
   gated, and only at the moment of dispatch, never at signup.
5. Clio's own backend refuses to dispatch a real, billable meeting bot for an unfunded `live`-mode
   account, protecting Clio from unrecoverable vendor cost, without ever touching or slowing down the
   `test`-mode path that already works today (B2B-08, unmodified).
6. A Clio SPOC (Arun, or future ops staff) can still manually finish a stalled signup for a partner who
   gets stuck, using the same internal-operator routes that exist today — nothing about this brief
   removes that capability.

## Known Constraints

1. **Self-serve is required, not optional** — this is Arun's direct override of v1, not a nice-to-have.
   Do not build or leave in place any UI or process step that requires a Clio employee to touch a
   real signup.
2. **Use Clerk Organizations**, not a bespoke identity model — this is a genuinely new integration
   surface (no existing usage of the Organizations API anywhere in `lib/`/`app/` today), but it is the
   correct one: Clerk already handles the org-creation and membership-invite UX Arun described, and
   inventing a parallel mechanism would duplicate work Clerk's own SDK already does.
3. **No fully designed public marketing/signup page.** The pivot's design system remains undefined
   (`CLAUDE.md` says so explicitly). Use Clerk's own hosted `<SignUp/>`/`<CreateOrganization/>` components
   behind a minimal branded wrapper instead of inventing a visual direction — this is a "flag as blocker,
   don't invent" situation resolved by using what already exists (the identical pattern already applied
   to the existing B2C `<SignUp/>` page's styling).
4. **`client_id` is a standalone identifier, not a secret.** It is safe to display indefinitely in the
   UI, unlike `client_secret`, which is shown exactly once. Do not treat the two the same way in the UI
   or in logging.
5. **The static API key is preserved, not deleted**, per the standing "no delete without approval" rule.
   It is demoted to a secondary, internal-operator-only recovery mechanism (`POST /api/admin/
   partner-keys`, unchanged) for SPOC support — it is no longer the self-serve partner's default or
   first-generated credential. v2's originally planned self-serve static-key-generation Configurator call
   site is replaced by the OAuth2 client-generation flow instead; it is not built in v3.
6. **`app/api/webhooks/clerk/route.ts` is not touched or merged into.** It is pure B2C-era `user.created`
   handling (the retired `users` table, B2C welcome email, abandoned-onboarding timer) that still fires
   on every Clerk sign-up today. The new organization-provisioning webhook handler is a fully separate
   route. Reusing the existing one would conflate two different identity models. (Flagged separately, not
   part of this brief: that file is itself a cleanup candidate — it is B2C-legacy code still executing in
   production.)
7. **The funding guardrail gates a `live`-mode session dispatch only** — never signup, never `test`-mode
   access of any kind. It must reuse the existing `partner_wallets.stripe_default_payment_method_id`
   field (already computed today for the admin billing page's "payment method on file" column) and the
   existing `account_suspended` error-envelope pattern already in `requirePartnerApiKey()`. No new schema
   for this specifically — implementation lands in the B2B-02/04-owned files
   (`lib/partner/auth.ts`, the sessions route) as a small, named addition, not a rewrite.
8. **`partner_wallets` and `partner_onboarding_progress` are not touched.** Both already self-provision
   the moment an account exists (confirmed in code) — this brief only reads
   `partner_wallets.stripe_default_payment_method_id`, never writes to either table.
9. **OAuth2 Client Credentials is the v1/day-one default auth mechanism (v3), not a fast-follow** — per
   Arun's direct correction. A new table, not an extension of `partner_api_keys`: `client_id` is a
   standalone identifier, not a truncated prefix of a secret the way `key_prefix` is, and overloading one
   table with both credential shapes would produce a confusing state matrix for no real reuse benefit.

## Questions for BA

All resolved before dispatch — none of these are open questions for the BA to answer; they are handed
over pre-resolved with the reasoning shown, per governance, so the BA can verify the logic rather than
re-derive it.

**Q1 — Who provisions a new partner account: self-serve or internal-operator-mediated?**
RESOLVED (v2, direct override): self-serve, via Clerk Organizations. See "What Arun Said." v1's
internal-operator-only routes are preserved as a secondary SPOC recovery path, not the primary
mechanism.

**Q2 — What does the identity/account-creation model look like at signup — is `archetype` required?**
RESOLVED (v2, reframed from v1): Clerk identity creation is synchronous with account creation (unlike
v1's internal-operator flow, where an admin was linked to an account that already existed). `archetype`
is not required at signup — it defaults to `'unspecified'` and is settable later from the internal admin
table. Do not block signup on a question Arun never asked to be part of it.

**Q3 — Does wallet or onboarding-progress provisioning need any new work?**
RESOLVED (v1, carried forward unchanged through v2 and v3): No. Both `partner_wallets` and
`partner_onboarding_progress` already self-provision the moment a `partner_accounts` row exists —
confirmed in code, not assumed. Nothing new needed here; do not build a redundant provisioning step.

**Q4 — What UI surfaces are actually needed for account creation and credential/outbound setup?**
RESOLVED (v2, flipped from v1's "API-only, no UI" position): three real UI surfaces are needed —
(a) a minimal branded wrapper around Clerk's own hosted `<SignUp/>`/`<CreateOrganization/>` components,
(b) a Configurator call site where a partner-admin self-generates their own first credential, and
(c) a self-serve outbound-config screen (reveal-once signing secret, following Stripe's own
webhook-secret UX pattern, plus a "Test connection" affordance) — this last one folded into this brief
directly rather than scoped as a fast-follow, because it is the direct, load-bearing answer to Arun's own
stated reason self-serve is required at all: "those are sensitive and we should not see it."

**Q5 — Should OAuth2 Client Credentials or the existing static API key be the v1/day-one default partner
credential? (added in v3)**
RESOLVED (v3, correcting v2's stale document text): OAuth2 Client Credentials is the v1/day-one default,
per Arun's direct correction ("We need this advanced login now itself. Let's not start with static
API"). The static key is preserved but demoted to an internal-operator-only recovery mechanism. Build:
self-serve `client_id`/`client_secret` generation (reveal-once, same UX pattern as the outbound signing
secret) as a partner's first credential; a new token endpoint,
`POST /api/partner/v1/oauth/token`, matching the existing `/api/partner/v1/*` flat-route convention and
mirroring the shape Clio's own upstream voice vendor already uses for this exact grant type (Hume's live
`oauth2-cc/token` endpoint); the existing partner-auth check extended to accept a short-lived OAuth2
token alongside the static key, with zero changes needed at the `sessions`/`usage`/`wallet` route call
sites themselves.

## What is explicitly NOT in this brief's scope, and why

- **A fully designed public marketing/signup page.** Covered under Known Constraints — the pivot design
  system is undefined; use Clerk's hosted components behind a minimal wrapper instead of inventing a
  visual direction.
- **OAuth2 refresh tokens or persistent token sessions.** Client Credentials tokens are short-lived and
  re-obtained by re-authenticating each time — no refresh-token flow, no persistent server-side token
  state.
- **OAuth2 scopes or fine-grained per-credential permissions.** A `client_id`/`client_secret` pair has the
  same access as today's single-tier API key, gated only by `mode` (`test`/`live`) — not a permissions
  system.
- **Self-serve UI for generating a static API key.** The static key is preserved for internal-operator
  recovery use only; no self-serve UI is built for it in this brief.
- **Revocation UI for OAuth2 credentials.** This brief builds self-serve generation and listing only,
  matching the existing precedent that static API keys also have no self-serve revocation UI today.
  Revoking a compromised credential remains a manual, internal-operator action until a future brief scopes
  a self-serve revoke control.
- **Any change to `app/api/webhooks/clerk/route.ts`.** Unchanged — the new organization-provisioning
  handler is a fully separate route. See Known Constraints.
- **Any change to `partner_wallets` or `partner_onboarding_progress`.** Both already self-provision; this
  brief only reads the wallet's payment-method field.
- **What happens to an already-dispatched `live` session if the payment method is later removed
  mid-session.** The funding guardrail only gates whether a session can *start* — that is a distinct,
  already-covered concern for B2B-04, not reopened here.
- **Deleting or restricting the internal-operator create/link routes.** Preserved as the manual
  support/recovery path, per the standing "no delete without approval" rule.
- **A Configurator-side balance/funding-status banner.** Not something Arun asked for; the funding
  guardrail's user-facing surface is the API's own error response. A proactive balance banner is a
  reasonable future enhancement, not built here.
- **Retroactively linking a Clerk Organization to a pre-existing, manually-provisioned partner account.**
  No backfill mechanism — out of scope.
- **Developer documentation or an API playground for any of this.** That is B2B-07's scope, a separate
  Feature Brief this one unblocks but does not build.

## Approval note

I'm approving this brief for BA dispatch as scoped above, as one single document — self-serve signup via
Clerk Organizations, OAuth2 Client Credentials as the v1/day-one credential mechanism (client
generation, listing, and the token endpoint), the self-serve outbound-config UI, and the funding
guardrail on `live`-mode session dispatch. These four pieces are not separable: the OAuth2 credential a
partner generates is how they'd call the funding-guarded sessions endpoint, and the outbound-config
screen is reached through the same signup flow — treat this as one coherent mechanism that makes the
rest of this brief's self-serve design safe to ship at all, not four independent features. The BA may
split this into two documents if the scope genuinely warrants it once the spec is under way, but that
decision must be documented clearly if made — otherwise keep it as one document matching this brief's
own single-brief framing.

Wireframe the funding guardrail's user-facing state explicitly, even though it is not a Clio-rendered
screen — a partner's own developer only ever sees the API's own error response, and that response shape
needs to be documented with the same rigor as a screen would be.

Zero open questions remain. Ready for the BA to write the full Requirement Document.
