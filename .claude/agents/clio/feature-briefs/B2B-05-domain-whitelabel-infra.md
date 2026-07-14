# Feature Brief: B2B-05 — Domain / White-label Infrastructure
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-13

## Series context

Fifth and final Feature Brief in the B2B pivot sequence. B2B-01 (Core Objectives), B2B-02 (Partner
API & multi-tenant architecture), B2B-03 (Designer/Configurator), and B2B-04 (Billing/Metering) are
all done — built and committed to `main` (`7291b7d`, `6d3aa80`, `a49e151`, `a49f1dc`/`34f7e92`).
B2B-05 is the last piece: it does not add a new product capability so much as it closes a dependency
every prior brief named and explicitly deferred to it.

**Correction to `docs/b2b-pivot-status.md`'s current B2B-03 row, made while researching this brief**:
the tracker still shows B2B-03 as "CEO Feature Brief written, pending BA dispatch." That is stale —
B2B-03 has a full requirement document (`docs/specs/B2B-03-requirement-document.md`), was built, and
is committed (`a49e151`). Flagging this now rather than letting it sit; the Live Status table update
below corrects it.

## What Arun Said

Two things, both from `docs/brainstorm-b2b-platform-pivot.md`:

1. **§1.2, Type 2 partner requirement (his own words, not a suggestion):** "White-label hosting:
   rendered under the partner's own domain (e.g. `capgemini.learning.com`) — the partner just
   supplies the URL, and Clio's rendering is directed there." And separately, on SSO: "The partner's
   own UI calls Clio's API directly," with end users having "no awareness that Clio exists."
2. **§7.5, restated from Arun's own requirement line:** "If a partner registers a domain or subdomain
   and configures it, the API send/receive should work without further development effort per new
   partner." This is Arun's stated requirement — the specific mechanism (subdomain-first,
   Vercel Domains API for custom-domain upgrade, Host-header middleware) is the Orchestrator's
   proposed implementation of it, not something Arun dictated verbatim.

Separately, §7.6 (the "onboarding wizard": Questionnaire → Topics → Content → Visualization → Domain
→ Payment → Go-live, with save-and-resume) is **not** something Arun asked for anywhere in his stated
requirements (Section 1). It first appears in the brainstorm doc labeled explicitly as "Orchestrator's
recommendation," and `docs/brainstorm-b2b-platform-pivot.md` §8 item 4 still marks it, alongside §7.5,
as "recommended by Orchestrator, not yet explicitly confirmed by Arun" — unlike §7.4 (the wallet
billing model), which went through the same Q&A pattern and *did* get an explicit "Arun confirmed
Option B" resolution recorded. §7.6 never got that resolution. I'm treating that absence as meaningful
rather than papering over it — see "Known Constraints" and the note to Arun at the end of this brief.

## The Problem Being Solved

Two real, evidenced gaps — not hypothetical ones. I verified both against the live codebase before
writing this brief, not just the brainstorm doc:

1. **No host-based tenant resolution exists anywhere in the codebase today.** `middleware.ts` has zero
   `Host`-header logic. Both end-user-facing partner surfaces built in B2B-03 —
   `/partner-render/[clio_session_ref]` (loaded headlessly by the meeting bot, screen-shared into the
   live session) and `/partner-questionnaire/[partner_account_id]` (loaded directly in an end user's
   own browser before a session starts) — are Clio-domain paths today, not partner-branded ones. An
   employee at Hartford Insurance (Capgemini's sub-tenant, per the brainstorm's §1.3 delegation model)
   filling out the pre-session questionnaire today would see Clio's own Vercel/production domain and a
   raw UUID in their address bar. That directly contradicts the stated requirement that "Hartford's
   employees... have no awareness that Clio exists."
2. **This is not a case of B2B-03 having quietly solved it.** I read `docs/specs/B2B-03-requirement-
   document.md`'s own Out-of-Scope section (lines ~1003–1016). It explicitly names both "Subdomain/
   custom-domain routing for `/partner-questionnaire/[partner_account_id]` or
   `/partner-render/[clio_session_ref]` under the partner's own domain" and "a dedicated 'your
   portal's domain' settings field UI" as deferred, and explicitly hands them to B2B-05 by name. It
   also distinguishes the wizard (partner-admin's own first-time account-setup flow) from the
   end-user-facing rendered questionnaire, and names the wizard as unowned pending B2B-05's own
   scoping — which this brief is now doing. This is a genuine, real, unbuilt dependency, not
   ambiguity I'm inventing.

`partner_accounts` (migration `071`) has no `subdomain_slug` or `custom_domain` column today — I
checked the live schema, not just the architecture doc. This is net-new schema work, not a rename or
a toggle.

## What Success Looks Like

A Type 2 (no-platform) partner, from their own Configurator:
1. Picks a subdomain slug (e.g. `capgemini`) and is live instantly at `capgemini.<clio-root-domain>`
   — no DNS work on their side, no waiting.
2. Optionally enters their own domain (e.g. `learning.capgemini.com`). Clio calls the Vercel Domains
   API to register it against the project, shows the partner the exact CNAME/TXT record to add, and
   the domain goes live with auto-issued SSL the moment Vercel verifies it — no code deploy, no
   engineering involvement, per new partner.
3. The partner's own end users navigate the questionnaire under that domain and never see a Clio URL,
   a raw UUID, or Clio branding anywhere in the address bar.
4. One partner's domain/subdomain configuration can never resolve to, leak into, or affect another
   partner's content or config — this is the same hard multi-tenant isolation requirement Arun set for
   B2B-03 ("each partner should be isolated and modular... from their configuration screen"), and it
   applies identically here.
5. The existing Clerk-gated Configurator itself stays on Clio's own domain always — partner admins log
   in there, not on their own branded domain. Only the two public, unauthenticated end-user-facing
   surfaces (questionnaire render, session render) get domain resolution. This is not a re-architecture
   of auth; `middleware.ts`'s existing Clerk-gate logic is extended, not touched or weakened.
6. The meeting-bot's headless load of `/partner-render/[clio_session_ref]` keeps working exactly as it
   does today (it already resolves the correct partner via `partner_sessions.partnerAccountId`, not via
   domain) — domain resolution is additive polish for that specific route, not a functional dependency
   for it. It is a functional dependency for the questionnaire route, which has no other tenant signal
   as clean as a resolved domain would provide for a truly branded, uuid-free URL.

## Known Constraints

- **Approved-library update needed as part of this brief.** The Vercel Domains API is not yet on
  `CLAUDE.md`'s approved list. Per `CLAUDE.md`'s own note ("New vendor approvals... will be added here
  as the relevant Feature Briefs land"), I'm approving it now as part of this brief — same pattern used
  for `hume`, `googleapis`, `@dagrejs/dagre`. BA/dev should call it via Vercel's own SDK/REST client
  pattern already used elsewhere in this codebase, never a raw unauthenticated fetch.
- **Zero Clio-side persistence of end-user or partner identity still applies.** `subdomain_slug` and
  `custom_domain` are partner-**account**-level configuration, not end-user data — same category as
  the already-live `outbound_base_url`/`outbound_auth_token_ciphertext` columns on `partner_accounts`.
  This does not touch the Objective 1/6 data-boundary discipline.
- **Middleware change is additive only.** `middleware.ts`'s existing Clerk gate, `isPublicRoute` list,
  and `x-pathname` header-injection pattern must be extended, not replaced. Host-header tenant
  resolution applies only to the already-public `/partner-render/(.*)` and `/partner-questionnaire/(.*)`
  routes (and their new vanity-URL equivalents, see Questions for BA) — never to `/dashboard/*` or any
  Clerk-protected route.
- **No billing dependency.** `docs/specs/B2B-04-requirement-document.md` already explicitly states
  domain/custom-domain provisioning is "unrelated to billing." Keep it that way — no new `usage_events`
  event type for this brief.
- **Real sequencing dependency, not a blocker, worth naming plainly:** subdomain-first requires an
  actual wildcard-cert-capable root domain to mint slugs under. `docs/b2b-pivot-status.md`'s `INFRA-07`
  row shows the final brand/domain decision is still "in progress" (leaning `hello-clio`, not locked;
  trademark check recommended in parallel). This brief should not hardcode a root domain — the BA spec
  and build must make it a single config value (env var), so the mechanism is correct today and doesn't
  need rework once `INFRA-07` closes. `hello-clio.com` is already aliased to the production deployment
  per current infra, which is a reasonable starting root domain for `*.hello-clio.com` subdomains, but
  I'm not treating `INFRA-07`'s "in progress" status as fully resolved just because of that alias.
- **Multi-tenant isolation is a hard requirement, not a nice-to-have**, carried forward verbatim from
  Arun's B2B-03 instruction. Any bug where partner A's domain could resolve to partner B's content is
  not a minor defect — treat it at the same severity B2B-03 treated cross-partner config leakage.

## Questions for BA

Standard BA-gate questions — these need full documentation (wireframes, exact copy, states) before any
code is written, per the "Ambiguous UX = STOP" rule. I'm not answering these myself:

1. **Domain settings screen** (new Configurator screen, likely a 7th alongside the existing
   Questionnaire/Topics/Content/Visualization screens) — exact wireframe for: subdomain slug picker
   (validation rules — character set, length, reserved-word list, live-availability check), custom
   domain entry field, the CNAME/TXT verification-record display, and the four states a custom domain
   can be in (`none` / `pending_verification` / `verified` / `failed`) with exact copy for each.
2. **Vanity URL routing shape** — my recommendation, for the BA to confirm or revise: the existing
   UUID-bearing paths (`/partner-render/[clio_session_ref]`, `/partner-questionnaire/
   [partner_account_id]`) stay as the reliable Clio-domain fallback (the meeting bot always uses this
   form regardless of domain config), while Host-header-resolved requests on a partner's own
   subdomain/custom domain get a clean, uuid-free path (e.g. `capgemini.hello-clio.com/questionnaire`)
   that the middleware internally maps to the same handler with `partner_account_id` injected as a
   request header, following the existing `x-pathname` injection pattern. BA to spec the exact new
   route(s) and header contract.
3. **Custom domain removal/replacement flow** — what happens to the Vercel-side domain registration and
   any in-flight verification if a partner changes their mind or types the wrong domain. Needs explicit
   states, not left implicit.
4. **Wildcard domain provisioning** — is this a one-time, Orchestrator-run setup step against Clio's own
   Vercel project (add `*.{root-domain}` once), or does BA need to spec code that provisions it
   programmatically? My recommendation: one-time manual/Orchestrator setup, not per-partner code — flag
   for BA to confirm this doesn't need to be in the build's runtime path.

## What is explicitly NOT in this brief's scope, and why

**The onboarding wizard (brainstorm §7.6) is not included as an approved, in-scope deliverable of this
brief.** I considered including it — B2B-03's own spec left its ownership assignment for B2B-05 to make,
and I could resolve *what shape* it would take (a guided flow that sequences the existing, already-built
Configurator screens: Questionnaire → Topics → Content → Visualization → Domain → Payment → Go-live,
not a separate rebuild of them) — but I'm not confident I should decide **whether to build it at all**.

Here's why: unlike §7.4 (the wallet billing model), which Arun explicitly confirmed after the same
"Orchestrator recommends, awaiting confirmation" pattern, §7.6 has sat unconfirmed since 2026-07-12 with
no direct answer from Arun in either direction. It is also not something Arun asked for in his original
requirements at all — it's a pure Orchestrator invention aimed at easing first-time partner setup. Per
Product Principle #2 ("Ambiguous UX = STOP... must go back to BA for full documentation before any code
is written") and the CEO's own standing instruction not to make product-shape calls I'm not confident
about, I'm treating "should this exist" as Arun's call, not mine or the BA's.

**Practically, this doesn't block the rest of the brief.** The brainstorm's own §7.6 text says: "After
initial setup, drop the wizard framing — configuration becomes directly editable via the Configurator" —
which is already exactly how B2B-03 shipped. So the fallback if Arun says no isn't a stub or a placeholder
— it's the real, already-live experience. This brief's domain/subdomain/custom-domain mechanism (the
part with real, evidenced, unblocked demand) can proceed to BA now on its own; the wizard can be
answered separately and folded in as a fast-follow, or dropped, without touching anything built here.

## Approval note

I'm approving this brief for BA dispatch as scoped above — subdomain-first hosting, custom-domain
upgrade via the Vercel Domains API, Host-header tenant resolution middleware, and the Configurator
domain settings screen. The onboarding wizard is carved out per the section above and needs Arun's
direct yes/no before any BA work is dispatched for it specifically.
