# Feature Brief: B2B-29 — Post-Signup Onboarding (No Pre-Signup Company Capture) & Per-Client "Configure" Screen

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 — this closes a gap from an earlier instruction that was approved but never actually
built; the live flow today still contradicts what Arun asked for, and self-serve sales-partners
currently have no way to reach API/Docs/Payment for themselves or their clients at all.
Date: 2026-07-19

---

## What Arun Said

Verbatim, from today's conversation (2026-07-19), referencing an earlier instruction that was never
actually built — which is why this brief exists:

1. "All pushed and ready for me to test? Also I think when get started, we don't need to start with
   getting the organization instead can we signup with clerk or regular email and from the dashboard
   or left pane collect any info so we can easily tag to the id. I think even the payment we can get
   after signup. Until payment, user cannot use the bot or send api"

2. When shown today's actual flow (which still asks for "Company name" before Clerk signup,
   contradicting the above) and a proposed redesign, Arun said: "yes you need to remove there also.
   this flow is good." — approving removal of the pre-signup company-name capture from BOTH
   `/partner-signup` (self-serve) AND `/partner-invite/accept` (invite-based direct-partner signup),
   in favor of collecting it post-signup from the dashboard.

3. When asked how partners would see API/Docs/Integration details today, and told that this is
   entirely unreachable for self-serve sales-partners (blocked by `requirePartnerAdmin()`'s
   `channel_partner` 403, and no detail screen exists behind the Clients list), Arun approved a
   proposed per-client "Configurator" surface with one correction: "yes rename to \"configure\" and
   modify this screen to align with our ask and enable it for display. you know the drill" — i.e.
   rename the label from "Configurator" to "Configure", build it, and ship it end-to-end (CEO→BA→Dev,
   verify with tsc + real `npm run build` + tests, push to production without further check-ins —
   this matches Arun's standing instruction earlier this session: "ok dont wait. when everything is
   ready push it to production").

---

## The Problem Being Solved

Two related gaps, both created by the same root cause — an earlier Arun instruction (item 1 above)
that was approved in conversation but never actually implemented:

**Gap 1 — signup still front-loads a company-name form Arun explicitly asked to remove.**
`/partner-signup` and `/partner-invite/accept` both still show a required "Company name" text field
*before* the user ever reaches Clerk signup/Clerk `<SignUp>`. This directly contradicts Arun's
instruction: get the person into the product (via Clerk or regular email) first, collect any
identifying/company info afterward from the dashboard, and gate actual bot/API usage — not
navigation — on payment. The current flow adds friction before signup and duplicates data collection
the dashboard should own.

**Gap 2 — self-serve sales-partners have no way to see their own or their clients' API/Docs/Payment
details.** The full Configurator surface (Configurator/API/Docs/Known Bugs nav, Playground,
Integration, Payment) already exists and works, but it is gated by `requirePartnerAdmin()`, which
explicitly 403s any `account_kind='channel_partner'` account. A sales-partner's clients
(`partner_accounts` rows with `owning_channel_partner_id` set, zero `partner_admin_users` — the
client never logs in, by design) have no detail page at all today; clicking a client in the Clients
list goes nowhere. There is currently no way for a sales-partner to configure API credentials,
outbound routing, or payment for a client they manage, and no way for a sales-partner to add a card
for their own account either, since `requirePartnerAdmin` blocks `channel_partner` accounts from the
only screen that offers card verification today.

**Failure without this:** the signup flow keeps contradicting an instruction Arun already gave and
approved; sales-partners remain unable to configure or bill their own clients, which blocks the core
value proposition of the sales-partner model B2B-26 shipped.

---

## What Success Looks Like

- `/partner-signup`: "Get Started" goes straight into Clerk `<SignUp>` — no pre-signup form of any
  kind. Company name/info is never asked before the user has an identity.
- `/partner-invite/accept`: same change — its own pre-acceptance "Company name" field is removed.
- After signup, the user lands directly on their dashboard (`/dashboard/channel-partner` for
  self-serve sales-partners, `/dashboard/configurator` for invite-accepted direct partners) — no
  blocking modal, no forced wizard.
- The dashboard offers a non-blocking way to finish setting up company info and payment. Browsing,
  settings, inviting team, and adding clients all work with zero company info and zero card on file.
  Only bot dispatch / API usage is gated on payment — exactly as Arun stated ("Until payment, user
  cannot use the bot or send api"), and this must not regress or duplicate B2B-27's existing
  server-side usage gate.
- A sales-partner can add a card for their own account from their own dashboard — something that is
  impossible today.
- Clicking a client in the sales-partner's Clients list opens a real client detail page (doesn't
  exist today), showing basic client info and a "Configure" entry point.
- "Configure" (renamed from "Configurator" per Arun's correction) reuses the existing Configurator
  surface verbatim, scoped to that specific client's own `partner_account_id` — so everything a
  sales-partner sets up for a client (API credentials, outbound config, card on file) is billed and
  tracked against the client's own account, never against the sales-partner's.

---

## Known Constraints (from Arun, non-negotiable)

- No company/org info is collected before Clerk signup, on either signup surface. This was already
  approved once and must not be re-litigated or re-added in a different form.
- Payment gates usage (bot dispatch / API calls) only — never navigation. This mirrors B2B-27's
  already-shipped enforcement model and must not conflict with or duplicate it.
- The renamed label is "Configure", not "Configurator" — this is a direct, specific correction from
  Arun and applies to the surface's display label at minimum (BA to decide if the route slug also
  changes — see Section C below).
- Ship end-to-end without further check-ins once BA spec is approved: verify with `tsc` + real
  `npm run build` + tests, then push to production — per Arun's standing instruction earlier this
  session ("ok dont wait. when everything is ready push it to production").

---

## Ground Truth — Current Live Behavior (verified by the Orchestrator reading the actual code, treat as fact not speculation)

- `/partner-signup` (`app/partner-signup/[[...partner-signup]]/page.tsx`): State 1 ('capture') shows
  a "Company name" text field BEFORE Clerk's `<SignUp>` mounts. This is B2B-25-era behavior that
  survived unchanged through B2B-26/27/28 and directly contradicts instruction #1 above.
- `/partner-invite/accept` (`app/partner-invite/accept/PartnerInviteAcceptClient.tsx`, line ~197):
  has its own required "Company name" field, same pattern, same problem.
- `/dashboard/channel-partner` (self-serve sales-partner's own dashboard,
  `app/dashboard/channel-partner/page.tsx` + `_shared.tsx`'s `ChannelPartnerShell`): currently a
  3-tab nav (Dashboard / Clients / Team). No "Company info" or "Payment" panel exists here at all.
- Card-on-file verification (B2B-27, Stripe `setup`-mode) currently only lives under the
  DIRECT-partner Configurator's Payment tab (`app/dashboard/configurator/PaymentConfigClient.tsx`),
  gated by `requirePartnerAdmin()` — which explicitly 403s any `account_kind='channel_partner'`
  account (`lib/partner/auth.ts` line ~255). Self-serve sales-partners currently have NO way to add a
  card at all, anywhere.
- `lib/partner/clients.ts`: `listClientsForChannelPartner()` / `createClientForChannelPartner()`
  already exist — a "client" is a `partner_accounts` row (`account_kind='partner'`,
  `owning_channel_partner_id` set to the sales-partner's account id), with ZERO
  `partner_admin_users` rows (a client never logs in itself — the owning sales-partner manages it on
  the client's behalf).
- `app/dashboard/channel-partner/clients/` currently only has a list view (`ClientsClient.tsx`) —
  clicking a client goes nowhere; there is no per-client detail page at all.
- The full Configurator surface already exists and is reusable: `ConfiguratorSurface.tsx` /
  `ConfiguratorNavShell` (in `app/dashboard/configurator/_shared.tsx`) render a 4-destination nav
  (Configurator/API/Docs/Known Bugs) plus a Playground, all currently gated by
  `requirePartnerAdmin(partnerAccountId)` (Clerk-authenticated direct-partner-admin membership
  check).
- `lib/partner/auth.ts` already has `requireChannelPartnerAdmin()` — resolves "the caller's own
  channel-partner account" from the Clerk session, no client-supplied id, used by all
  `/api/channel-partner/*` routes today.

---

## Scope for This Brief

Three pieces, one cohesive arc — all approved by Arun above, all to ship together.

### A. Remove pre-signup company-name capture; collect it post-signup instead

- `/partner-signup`: Get Started → straight into Clerk `<SignUp>` (no pre-form).
  `unsafeMetadata: { signup_intent: 'partner' }` only.
- Webhook (`user.created` branch) creates the `partner_accounts` row with a placeholder `name` (e.g.
  derived from email, or a literal "Unnamed partner" — **BA to decide exact placeholder string**)
  since no company name is known yet. `account_kind='channel_partner'` still the self-serve default
  (B2B-28 behavior unchanged).
- `/partner-invite/accept`: remove its own pre-acceptance "Company name" field the same way — **BA to
  work out where the direct partner's company name gets collected instead** (likely the same
  post-signup dashboard mechanism, scoped to the direct-partner's own Configurator/settings rather
  than channel-partner's, since an invite-accepted partner is `account_kind='partner'`).
- Land immediately on the relevant dashboard (`/dashboard/channel-partner` for self-serve,
  `/dashboard/configurator` for invite-accepted direct partners) — no blocking modal, no forced
  wizard.

### B. Post-signup "Company info" + "Payment" on the channel-partner dashboard

- Add a non-blocking "Finish setting up your account" banner/checklist on
  `/dashboard/channel-partner` pointing at two incomplete items: Company info, Payment.
- Add a "Company info" panel/tab (new nav item, e.g. "Settings" — **BA to decide exact placement**
  within `ChannelPartnerShell`'s nav) with a form: company name (+ existing `company_url` column).
  Saves via a new small API route.
- Add a "Payment" panel/tab to the channel-partner dashboard reusing B2B-27's card-verification
  mechanism (Stripe `setup`-mode, no charge) — currently only exists under the direct-partner
  Configurator; this is new plumbing needed for channel-partner accounts specifically, since
  `checkCardOnFile()`/`createCardVerificationCheckoutSession()` already exist in
  `lib/partner/configurator-status.ts` / `lib/stripe.ts` and should be reusable, but the gating
  (`requirePartnerAdmin` 403s `channel_partner`) needs a parallel path for channel-partner accounts.
- Gate is on USAGE (bot dispatch / API calls), never on navigation — browsing, settings, inviting
  team, adding clients all work with zero card on file. This matches B2B-27's existing server-side
  enforcement in `/api/partner/v1/sessions/route.ts`, which should NOT need to change — only the UI
  path to set the card up needs to exist for channel-partner accounts.

### C. Per-client "Configure" screen

- New route, e.g. `/dashboard/channel-partner/clients/[id]/configure` (**BA to confirm exact
  path/naming** — Arun's instruction was specifically to rename the surface's LABEL from
  "Configurator" to "Configure", not necessarily the route slug; BA should decide whether the route
  itself also uses "configure" for consistency).
- New client detail page (doesn't exist today) at `/dashboard/channel-partner/clients/[id]` reached
  by clicking a client in the existing Clients list. Shows basic client info (name, company_url,
  status) plus a "Configure" button/tab.
- "Configure" reuses the EXISTING `ConfiguratorSurface`/`ConfiguratorNavShell` and its full tab set
  (Configurator[rename to "Configure"]/API/Docs/Known Bugs + Playground + Integration + Payment)
  verbatim — scoped to the CLIENT's `partner_account_id`, not the sales-partner's own.
- New authorization path required: NOT `requirePartnerAdmin(partnerAccountId)` (that requires a
  `partner_admin_users` row for the target account, but a client has zero such rows by design).
  Instead: `requireChannelPartnerAdmin()` to resolve the caller's own channel-partner account, THEN
  verify the target client's `owning_channel_partner_id` equals that account's id (ownership check,
  not membership check). BA must enumerate every route this surface calls (API credentials
  generation, outbound-config, payment/card verification, content/domain/etc. — whichever tabs stay
  visible per B2B-23's `VISIBLE_SECTIONS` reduction) and specify this same ownership-check pattern
  for each, OR propose a single chokepoint fix if there's a shared entry point (mirroring the B2B-26
  `requirePartnerAdmin` chokepoint precedent — reuse that established pattern if applicable).
- Everything entered here (API credentials, outbound base URL, card on file) belongs to the CLIENT's
  own `partner_accounts`/`partner_wallets` rows — so that client's own bot/API usage is billed and
  tracked against the client, never against the sales-partner.

---

## UX Requirement (per standing responsive policy)

`/partner-signup`, `/partner-invite/accept`, `ChannelPartnerShell`'s nav, and the new client detail /
Configure screens are all being touched or newly created under this brief, which triggers the
standing "any screen touched for any reason must be brought to a genuinely responsive bar as part of
the same change" rule (`CLAUDE.md`). No hardcoded pixel-width caps on layout containers — use the
established fluid/tiered Tailwind + `clamp()` pattern, matching what B2B-23 already established
across the Configurator surface. BA to confirm the new "Company info"/"Payment" panels and the new
client detail page follow this pattern from the start rather than needing a follow-up pass.

---

## Governance Note

Per this project's CEO→BA→Dev gate, produce the Feature Brief now. Flag any of the "BA to decide"
points above clearly so the BA resolves them in Section 11 rather than guessing silently. Standard
escalation applies: if anything here is genuinely ambiguous at the product-shape level (not a
technical implementation detail), name it as an open question for Arun rather than assuming an
answer — but everything explicitly covered by Arun's quoted words above (A's removal of pre-signup
company capture and post-signup collection instead, B's non-blocking gate behavior, C's rename +
existence of the per-client Configure surface) is settled and should NOT be re-opened as a question.

## Questions for BA

None of the product-shape decisions are open — items 1-3 in "What Arun Said" settle scope, the
non-blocking usage-only payment gate, and the Configure rename/existence. The following are
implementation-detail decisions explicitly left to BA discretion, to be resolved in Section 11 of the
Requirement Document (not escalated to Arun):

1. Exact placeholder string for a `partner_accounts.name` created before company info is known
   (Scope A).
2. Where a direct partner's (invite-accepted) company name gets collected post-signup, and under
   which existing or new nav item (Scope A).
3. Exact placement/label of the new "Company info" nav item within `ChannelPartnerShell` (Scope B).
4. Exact route naming for the per-client Configure screen — whether the URL slug itself says
   "configure" or keeps "configurator" internally while only the display label changes (Scope C).
5. Full enumeration of every route the reused Configurator surface calls, and the specific
   ownership-check pattern (or single chokepoint) applied to each for client-scoped access (Scope C).

Do not write code. Output only the Feature Brief markdown file.
