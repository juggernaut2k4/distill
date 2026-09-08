# Feature Brief: B2B-30 — Sales-Partner Agreement: Document Generation, E-Signature, Storage/Audit Trail

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — gates real sales-partner onboarding; a sales-partner should not be able to fully
activate (add clients, draw on a shared wallet) without a signed agreement on file, though the exact
activation-gating behavior is a BA/product-shape decision, not mandated here (see Questions for BA).
Date: 2026-07-19

---

## What Arun Said

Verbatim, given directly (2026-07-19), covering the legal-agreement requirement for every
sales-partner:

> A legal agreement to be generated and e-signed by every sales-partner, covering: what the
> sales-partner can do, billing/payment terms, what terminates the contract, what stops bot/API
> access, what threshold triggers a notification/reminder, and what communication methods are used —
> "brainstorm thoroughly... so in future we are getting sued or misunderstood."
>
> "we need a way to save this documents so that we can refer anytime in future for our reference or
> download it for audit purposes."

`docusign-esign` (official DocuSign Node.js SDK) was approved into `CLAUDE.md`'s vendor list today
specifically for this brief (see `CLAUDE.md` line 185) — confirmed present before writing this brief.

---

## The Problem Being Solved

B2B-26 (shipped, `be6d811`) gave Clio a real sales-partner entity (`partner_accounts.account_kind =
'channel_partner'`) that can sign up, add clients, and invite a team — but nothing legally binds that
relationship. Today a sales-partner can start operating (adding clients, and once B2B-28 lands,
drawing on a shared wallet) with zero contractual agreement on file describing what they're allowed to
do, how they're billed, what suspends their access, or how the relationship ends. This is a real
exposure: Clio is extending API/bot access and a commercial relationship to an external company with
nothing signed. Arun's own framing is explicit — this exists to prevent Clio "getting sued or
misunderstood," i.e. this is a risk-reduction feature, not a UX nicety.

---

## What Success Looks Like

- Every sales-partner has exactly one agreement document, generated from their own account data
  (company name, revenue-share % at time of signature, signup date) and Clio's structural terms.
- The sales-partner e-signs it via DocuSign — embedded or emailed signing, BA to decide which fits
  this product's UX better (see Questions for BA).
- Once signed, Clio has a durable, retrievable, downloadable copy — a super-admin can look up any
  sales-partner and find/download their exact signed agreement, with who signed and when.
- The actual legal *language* in that document has been reviewed and finalized by Arun's own attorney
  before any real sales-partner ever sees it — see the caveat immediately below. Nothing in this
  brief's output should reach a real, paying sales-partner until that review has happened.

---

## CRITICAL — Legal-content caveat (read before anything else in this document)

**Every section below labeled "Contract structural outline" is a structural draft only. It is not
final, binding legal language. It has not been reviewed by an attorney. It must not be presented to
any real sales-partner for signature until Arun's own attorney has reviewed and finalized the actual
paragraph-level text.** I am not a lawyer and this brief does not attempt to produce legally
sound contract language — it produces a structural, comprehensive *outline* of what such a document
should cover, grounded in what Clio has actually built, so the attorney has a complete and accurate
starting point rather than a blank page. The engineering/mechanism side of this brief (templating,
e-signature, storage, audit trail) is normal engineering scope and can be built now. **The BA and any
developer working from this brief must carry this same caveat forward verbatim into the Requirement
Document and into any placeholder/mock content used during development — including a visible
`[DRAFT — NOT ATTORNEY-REVIEWED]` watermark or banner on every generated document until Arun confirms
the real, attorney-approved text is in place.** This is a hard requirement from the Orchestrator, not
optional brief-writing style, and it does not get softened, shortened, or dropped from the
Requirement Document.

---

## Contract structural outline (draft-for-attorney-review — see caveat above)

Brainstormed thoroughly per Arun's instruction, grounded wherever possible in mechanisms Clio has
actually built (cited below) rather than invented numbers. Sections marked **[NEEDS ARUN'S NUMBER]**
are business/legal parameters I am not confident enough to set myself — see Escalations.

1. **Parties and effective date.** The sales-partner (legal entity name, not just the display name
   captured at signup) and Clio, effective on signature date.

2. **Scope of the relationship — what a sales-partner is authorized to do.**
   - May: recruit and onboard their own clients into Clio's platform under their own account
     (`partner_accounts.account_kind = 'channel_partner'`, B2B-26); configure each client's
     integration, behavior, and (once B2B-27 lands) per-client settings on the client's behalf, since
     the client itself never logs into Clio (confirmed design, `docs/brainstorm-sales-partner-
     subdomain-routing.md` §1); invite their own team members with full access except billing
     (B2B-26 §6.6).
   - May not: represent themselves as Clio, or represent that Clio is a party to any agreement the
     sales-partner has with their own client — the client relationship is exclusively between the
     sales-partner and their client; Clio's relationship is exclusively with the sales-partner
     (`docs/brainstorm-sales-partner-subdomain-routing.md` §2, "Clio only ever directly interacts with
     the middle party").
   - May not: exceed the API/bot usage scope granted by their account tier or attempt to circumvent
     the subdomain-routing/authentication model once B2B-C (the `*.hello-clio.com` routing layer)
     ships — the caller's API key/OAuth2 token is what proves identity; the subdomain is addressing
     convenience only (`docs/brainstorm-sales-partner-subdomain-routing.md` §3, "confirmed security
     design").

3. **Billing/payment terms.** Grounded in the actual wallet model (`partner_wallets`, migration
   `075_b2b04_billing_metering.sql`, extended by `081_b2b13_plan_tiers_and_topups.sql`):
   - The sales-partner funds one shared wallet (`balance_usd`); their clients never pay Clio directly
     (`docs/brainstorm-sales-partner-subdomain-routing.md` §4, confirmed).
   - Funding mechanism follows whatever `funding_mechanism` the sales-partner's account is on
     (`checkout_topup` / `subscription_auto_recharge` / `invoicing` / `plan_subscription` — the same
     four mechanisms any partner account can use, migration 075/081).
   - Non-payment consequence: **[NEEDS ARUN'S NUMBER]** — see Escalations; today's codebase has a
     `partner_accounts.status` column (`'active' | 'suspended'`) but no route currently checks it to
     block session/API creation (verified directly: `grep -rln "'suspended'" app/api lib` returns only
     `lib/partner/domain-resolution.ts` and `lib/partner/clients.ts`, neither of which gates a live
     API call). This means the "what stops bot/API access" clause cannot honestly claim a mechanism
     that isn't wired up yet — flagged clearly below as a real, separate engineering gap, not
     something this brief silently papers over with contract language that overstates what the
     product does today.

4. **Revenue-share terms.** The percentage lives on the sales-partner's own account (owned by the
   sibling signup-flip/list-detail brief being written in parallel — this brief does not build that
   field, only reads it). **This document must record a frozen, point-in-time snapshot of the
   percentage at signature time, not a live reference to a mutable dashboard field** — a legal
   document has to reflect what was actually agreed, and the live field could change later for
   legitimate business reasons (renegotiation) without that constituting an amendment to what was
   signed. See Technical mechanism → Document generation, below, for how this is captured.

5. **Termination conditions.**
   - Either party may terminate for convenience with **[NEEDS ARUN'S NUMBER — notice period, e.g. 30
     days]** written notice.
   - Clio may terminate immediately for breach (see §6, suspension triggers) or for the sales-partner
     misrepresenting itself as Clio or exceeding its authorized scope (§2).
   - On termination: no migration path exists for a client to move from sales-partner-owned to direct
     — the client relationship simply ends and the client's `partner_accounts` row (with
     `owning_channel_partner_id` set) reflects that the owning sales-partner relationship has ended.
     This mirrors the confirmed "no reassignable foreign key" design decision
     (`docs/brainstorm-sales-partner-subdomain-routing.md` §5).
   - Wallet balance disposition on termination (refundable/non-refundable, pro-rated) —
     **[NEEDS ARUN'S NUMBER]**, see Escalations.

6. **Bot/API suspension triggers.** Non-payment, contract breach, or abuse should stop API/bot access.
   **Named as a real, separate engineering gap, not assumed solved by this brief:** the data model
   (`partner_accounts.status`) exists but is not enforced anywhere today. This brief's document
   generation work should not claim a suspension mechanism the product doesn't yet have. See
   Technical mechanism section below for whether closing that gap belongs in this brief or a sibling
   one.

7. **Notification/reminder thresholds.** Resolved, not escalated — Clio already has exactly this
   mechanism for wallet depletion: an **80%-consumed low-balance threshold**
   (`supabase/migrations/075_b2b04_billing_metering.sql` line 49 comment, "Denominator for the
   80%-consumed low-balance threshold"; `partner_wallets.low_balance_alert_fired_at`; fired once per
   depletion cycle via `lib/partner/webhooks.ts` and delivered by
   `lib/delivery/email.ts::sendLowBalanceAlertEmail` — "Requirement Doc Section 5.B.5"). The
   agreement's notification-threshold clause should reference this existing, already-shipped 80%
   threshold rather than invent a new number — it is the one Arun's own product already enforces for
   direct partners, and extending it to a sales-partner's shared wallet is the natural, consistent
   choice once B2B-28 (sales-partner billing) exists. I am confident closing this question this way
   rather than escalating it.

8. **Communication methods.** Grounded in what's actually built: transactional email via Resend
   (`lib/delivery/email.ts`, confirmed present, ~64KB of existing send functions with an established
   `isPlaceholder`/mock-guard pattern this brief's new email functions should follow exactly). No
   in-app notification *system* exists yet in this codebase beyond dashboard-rendered data (e.g. the
   Known Bugs panels) — the agreement should name email as the primary/binding channel and not
   overclaim an in-app notification capability that doesn't structurally exist yet.

9. **Confidentiality/data handling.** Must not contradict `CORE_OBJECTIVES.md`'s existing
   Non-Negotiable Data Boundary, quoted directly: *"Clio computes signal. Clio never becomes the
   system of record for partner or end-user data."* The sales-partner's own confidentiality
   obligations toward their clients' data should be stated as at least as protective as this
   commitment, and the agreement should not describe Clio as holding client data it structurally does
   not hold (per that same boundary, everything except de-identified interaction transcripts is either
   never stored by Clio or pushed to the partner's own database, opt-in per configuration toggle).

10. **Liability/indemnification.** **Named as a section that exists and requires full attorney
    drafting — I have not attempted to draft any liability-limitation or indemnification language
    myself.** This is a deliberate, explicit gap, not an oversight: liability/indemnification carries
    materially higher legal risk than the structural/operational sections above, and drafting it
    without counsel is a step further into real exposure than a reasonable "structural draft" should
    take. Flagged here as a named empty section for the attorney to fill entirely.

---

## Technical mechanism to spec (normal engineering scope)

### Document generation

**Recommendation: no new PDF-rendering library.** Investigated: no PDF library exists anywhere in this
codebase today (`grep` for `pdf|puppeteer|playwright|docx|react-pdf` in `package.json` returns nothing
runtime — `@playwright/test` is a devDependency for E2E only). `@react-email/components` is on the
approved list but not yet used anywhere (`grep -rln "@react-email/components" lib/` returns nothing) —
available if the BA wants a component-based HTML template, but not required.

The cleanest fit: **generate the agreement as a server-rendered HTML string** (simple template —
string interpolation or `@react-email/components` if the BA prefers component structure — of sales-
partner name, revenue-share % snapshot, signup date, and the attorney-finalized structural terms into
a fixed HTML template), then **hand that HTML directly to DocuSign as the envelope document**.
DocuSign's Envelope API accepts an HTML document definition and converts it to PDF as part of envelope
creation (`documents[].htmlDefinition` — BA/Dev to confirm exact field name against the current
`docusign-esign` SDK version at build time) — this means Clio never needs to render its own PDF at
generation time. After signing completes, DocuSign's Envelope Documents API returns the final
certified PDF (signed, with DocuSign's own audit certificate) — that returned PDF is what gets stored
(see Storage below), not anything Clio rendered itself. This keeps the whole pipeline on two already-
justified dependencies (Resend for notification emails, DocuSign for everything document/signature-
related) with zero new PDF-rendering surface area.

The revenue-share percentage must be read and copied into the generated document's data at generation
time (a snapshot value stored alongside the envelope record, not a live join) — see Contract outline
§4 above for why. Document generation should be gated on that field existing on the sales-partner's
account; if the sibling brief's field isn't yet live when this brief's Dev work starts, BA should
specify a clear placeholder/blocking behavior (Dev should not invent a percentage).

### E-signature (DocuSign)

- Investigate DocuSign's actual envelope-creation and signing-flow shape (embedded signing via a
  recipient view URL launched inside Clio's own dashboard vs. remote/emailed signing where DocuSign
  sends the email and the sales-partner signs on DocuSign's own site) — BA to pick the flow that fits
  this product's "sales-partner logs into their own dashboard" pattern (B2B-26) best. My starting lean
  is **embedded signing**, so the sales-partner never has to leave Clio's dashboard and the "signed" 
  state can be reflected immediately via DocuSign's Connect webhook rather than relying on the
  sales-partner returning to Clio on their own — but this is the BA's call to make and document with a
  real flow diagram, not mine to mandate.
- **Webhook for completion**: DocuSign Connect (their webhook mechanism) should notify Clio when
  signing completes. Per this project's standing rule (`CLAUDE.md`, "Webhook handlers must verify
  signatures before processing"), the BA/Dev must specify how DocuSign Connect's HMAC verification is
  implemented (DocuSign supports HMAC-SHA256 webhook payload signing) — same discipline as the existing
  Stripe/Clerk-via-svix webhook handlers already in this codebase.
- **Mock/stub path (mandatory per this project's standing rule)**: when `DOCUSIGN_*` env vars are
  placeholders, the integration must behave like every other mocked integration in this codebase
  (`lib/delivery/email.ts`'s `isPlaceholder` pattern is the exact model to copy) — log what envelope
  would have been created, return a realistic mock envelope ID/status, and let the rest of the flow
  (storage, audit trail, dashboard state) work end-to-end in development without live DocuSign
  credentials.

### Storage/audit trail

- **No file-upload or file-storage mechanism exists anywhere in this codebase today** (confirmed by
  direct grep this session, zero hits for Supabase Storage or any other upload path). A new storage
  mechanism is required.
- **Recommendation: Supabase Storage**, and I have specifically checked this is sound rather than
  assumed it: `@supabase/supabase-js` and `@supabase/ssr` are already approved, already-used
  dependencies; Supabase Storage requires no new SDK (it's part of the same `supabase-js` client
  already imported throughout `lib/`); it inherits the same project-level auth/service-role pattern
  every other Supabase table access in this codebase already uses; and it avoids introducing an
  entirely separate vendor (e.g. S3) for what is a low-volume, low-throughput use case (one PDF per
  sales-partner, not a media pipeline). This is the right fit, not just the path of least resistance.
- **Schema for tracking signed-document metadata** (BA to finalize exact table/column names following
  this brief's own naming-collision discipline, precedent set by B2B-26 §0): needs at minimum —
  sales-partner account reference, DocuSign envelope ID, signer identity (name/email) and signed-at
  timestamp, revenue-share percentage snapshot (§4 above), storage bucket/path for the final signed
  PDF, and a status field (`pending` / `signed` / `voided` — mirroring existing status-enum
  conventions elsewhere in this codebase, e.g. `partner_team_invites.status` from B2B-26). Downloadable
  by super-admin — BA to specify exactly where in the super-admin UI this is surfaced (the sibling
  signup-flip/list-detail brief's forthcoming sales-partner detail view is the natural home per the
  Orchestrator's note below; this brief should not build that view itself, only make the download
  possible via an API route the detail view can later call).

---

## Explicitly OUT of scope

- The signup-flow flip, invite links, and the revenue-share % field itself — a separate sibling brief,
  currently being written in parallel. This brief only *reads* that percentage once it exists.
- The super-admin sales-partner list/detail view — also the sibling brief's scope. This brief's
  document-generation/download feature will eventually be linked from that detail view, but this brief
  does not build the view.
- The card-required-for-trial payment work — a separate sibling brief.
- Actually enforcing `partner_accounts.status = 'suspended'` against live API/session calls (the real
  "what stops bot/API access" mechanism) — this is a genuine, separate engineering gap I found while
  grounding §6/§3 above, not something this brief was asked to close. I am not silently scoping it in.
  See Questions for BA #4 for whether it should be folded into this brief or named as its own
  follow-on.
- B2B-27/28/29 (per-client detail, sales-partner billing, Known Bugs aggregation) — B2B-26's own
  reserved follow-on sequence, unrelated to this brief; I deliberately chose B2B-30 to avoid squatting
  on those reserved numbers or colliding with whatever number the parallel signup-flip sibling brief
  claims.

---

## Scope-split recommendation (judged, not defaulted)

This is a large, genuinely novel-vendor brief (DocuSign is a brand-new external vendor for this
codebase, same risk class Stripe/Clerk were when first integrated). I recommend splitting it, following
the same reasoning B2B-26 used to defer its own billing scope:

1. **B2B-30 (this brief, recommended as the first slice)** — document generation (HTML template +
   revenue-share snapshot) and storage/audit trail (Supabase Storage + metadata schema), built and
   testable with a mocked/placeholder signature step (e.g. a manual "mark as signed" admin action) so
   the storage/audit/download pipeline can ship and be verified independent of a live DocuSign
   integration.
2. **B2B-31 (follow-on)** — the actual DocuSign e-signature integration (envelope creation, embedded
   or remote signing flow, Connect webhook + HMAC verification, mock/stub path) wired into the
   B2B-30 pipeline in place of the manual mark-as-signed step.

**Reasoning:** DocuSign is a new, unproven-in-this-codebase vendor with real signature-verification
and webhook-security surface area — exactly the kind of scope B2B-26 itself flagged as deserving
isolated review when it deferred billing (real money, its own vendor risk) rather than bundling it into
the entity brief. Splitting also means the storage/audit-trail half — which has zero legal or new-
vendor risk, just a new Supabase Storage bucket and a metadata table — isn't held hostage to DocuSign
integration questions being fully resolved first. If the BA judges the two halves are small enough
combined to review as one spec, that's a legitimate call to make explicitly in the Requirement
Document (matching this brief's own instruction to judge and state reasoning, not follow blindly) —
but my recommendation is the two-brief split above.

---

## Known Constraints

- No resurrecting anything from B2C git history.
- Standing responsive-UI rule applies to any new screen this brief touches (the super-admin download
  affordance, if this brief builds the API route the sibling detail view will call): Tailwind +
  `clamp()`, no hardcoded pixel-width caps.
- Never populate the generated agreement with speculative AI-generated legal content — the structural
  outline above is a fixed, human/attorney-authored template with data fields interpolated in
  (company name, %, dates), never an LLM call generating contract language at runtime. This is a hard
  line: legal documents are exactly the kind of undefined, high-stakes screen this project's "never use
  AI-generated content to fill undefined screens" rule was written for.
- No new npm dependencies beyond `docusign-esign` (already approved) without written justification.
- The `[DRAFT — NOT ATTORNEY-REVIEWED]` watermark/banner (see Legal-content caveat above) is a hard
  requirement on every generated document until Arun confirms otherwise — BA must specify exactly how
  and where it renders in both the HTML template and the signing UI.

---

## Questions for BA

1. Confirm/finalize the two-brief split above (B2B-30 storage+generation / B2B-31 DocuSign
   integration) or state reasoning for handling as one — either is acceptable, but state the reasoning
   explicitly per this project's standing instruction.
2. Design the exact DocuSign signing flow (embedded vs. remote/emailed) with a real flow diagram — my
   embedded-signing lean above is a starting recommendation, not a mandate.
3. Finalize the signed-document metadata schema and naming (collision-free per B2B-26's own precedent
   discipline) and specify exactly where/how a super-admin downloads a signed agreement — coordinate
   the interface shape with whatever the parallel signup-flip/list-detail sibling brief is building for
   its sales-partner detail view, without building that view yourself (Orchestrator will relay the
   exact interface once both briefs have landed with the BA).
4. Decide whether closing the `partner_accounts.status='suspended'` enforcement gap (found during this
   brief's own grounding work — the "what stops bot/API access" clause currently has no matching
   product mechanism) belongs inside this brief/B2B-31, or should be named as its own separate,
   focused engineering brief. I lean toward a separate brief (it's an enforcement/security change
   touching every partner API route, not just sales-partners, and deserves its own focused review) but
   defer to the BA's judgment on sequencing.
5. Specify exactly what gates a sales-partner's ability to operate (add clients, invite team) on having
   a signed agreement on file — full hard gate, soft warning, or no gate for this initial version? This
   is a genuine product-shape decision I have not made for the BA; my only steer is that Arun's own
   "so we don't get sued or misunderstood" framing suggests he wants this to matter, not be purely
   decorative, but the exact enforcement point (signup time? first-client-add time? none yet, review-
   only for now?) needs a real answer.

Section 11 must be empty before this reaches Dev, per standing governance. Items 4 and 5 above may
close either by the BA's own confident technical/UX judgment (matching this project's existing
BA-authority pattern for equivalent calls in B2B-26) or by coming back to me if they turn out to be
larger product-shape questions than they look.

---

## Escalations

**Two genuine escalations to Arun, both legal/business parameters I am not confident setting myself —
everything else above is resolved with reasoning, not guessed:**

🔴 CEO ESCALATION — NEEDS ARUN'S DECISION

Context: Building the sales-partner agreement's termination and non-payment sections (Contract
structural outline §3, §5 above). These are structural-draft placeholders only — final language still
requires attorney review regardless of Arun's answer here — but the engineering schema needs a
starting value to store as a configurable field (not hardcoded), and the draft needs a number to show
the attorney rather than a blank.

Blocker: Two specific numbers — (1) termination-for-convenience notice period (days), and (2) wallet
balance disposition on termination (forfeited / refunded / pro-rated).

Options considered: Common SaaS-reseller-agreement defaults would be 30 days' notice and "unused
balance forfeited on termination" (simplest to administer, no refund-processing mechanism needs to
exist) — but these are genuine business-risk calls, not technical defaults I should silently pick.

Recommendation: 30 days' notice, unused wallet balance forfeited on termination (matches the
simplicity of "no migration path" already confirmed for clients switching sides,
`docs/brainstorm-sales-partner-subdomain-routing.md` §5) — but this is a recommendation, not a
decision I'm making unilaterally given real money is involved.

Please reply with your decision (or confirm my recommendation) so the BA can finalize the schema's
default values and the attorney has real numbers to review rather than placeholders.
