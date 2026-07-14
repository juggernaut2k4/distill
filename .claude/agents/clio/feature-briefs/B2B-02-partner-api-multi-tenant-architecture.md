# Feature Brief: B2B-02 — Partner API & Multi-Tenant Architecture
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-13

## Series context
Second of five sequenced Feature Briefs for the B2C → B2B/B2B2C pivot (see
`docs/b2b-pivot-status.md` for the full dependency graph). This is the
**foundational** brief — B2B-03 (Designer/Configurator), B2B-04
(Billing/metering), and B2B-05 (Domain/white-label infra) all depend on this
one landing first and cannot start until this brief's BA spec is approved.
Scope precisely: do **not** pull the following into this spec, even though
they touch the same surface area —
- Designer/Configurator UI or the 3-level (app/template/component)
  visualization property system — that is B2B-03.
- Specific burn rates, credit-pool math, enterprise tier pricing, or the
  admin-dashboard UI at `/dashboard/admin/clients` — that is B2B-04. This
  brief defines the *mechanism* (usage ledger + signed webhooks) that B2B-04
  will price and render; it does not set numbers or build screens.
- Subdomain/custom-domain provisioning, Vercel Domains API integration, or
  Host-header tenant-resolution middleware — that is B2B-05. This brief
  defines the *auth/tenant* model B2B-05's routing will key off; it does not
  build the routing itself.

Authoritative sources, read in full before starting:
- `CORE_OBJECTIVES.md` v2.0 (repo root) — the current canonical statement of
  principles. Where it and the brainstorm doc phrase something slightly
  differently, `CORE_OBJECTIVES.md` wins. Objective 6 ("API Is the Integration
  Layer, UI Is a Display Layer") and "The Non-Negotiable Data Boundary" section
  are this brief's charter.
- `docs/brainstorm-b2b-platform-pivot.md` — full requirement detail and
  decision trail. Load-bearing sections for this brief specifically: §1.2 (two
  partner archetypes and their flows), §1.3 (sub-tenant/credit delegation),
  §2 Q2–Q4 (data retention, push-pull mechanics, one-API-many-toggles), §7.1
  (Clerk scope), §7.3 (usage ledger, signed webhooks, the open F-01 question),
  §7.5 (domain architecture — point 4 specifically answers how the *outbound*
  Clio→partner auth works).
- `docs/b2b-pivot-status.md` — current status, F-01/F-02 foundation items,
  vendor-decision state (Recall.ai→Attendee migration, still not fully
  cut over — relevant because this brief's API contract must not leak
  meeting-bot-vendor detail).

## What Arun Said
From `CORE_OBJECTIVES.md` Objective 6, now the explicit center of the business
model: *"No feature is complete until it is fully accessible through the API.
UI renders what the API returns. Nothing else."* Under the pivot this needs
dimensions it didn't need before: partner-level API keys (trust boundaries
per-partner-account, not per-individual-user-JWT), usage-metering hooks that
are API-observable for both Clio's own dashboard and the partner's, white-label
rendering with zero Clio branding, and a two-tier account hierarchy for
sub-tenant delegation where Clio sees only a rollup line per top-level partner.

From the brainstorm doc (§1.2, §2, §7), in Arun's words and confirmed
decisions:
- Two partner archetypes, **one flexible API**, not two tiers — Platform
  Partners (e.g. Pluralsight: has its own users/topics/content, wants Clio to
  narrate it live) and No-Platform Partners (e.g. Capgemini: builds a
  white-label portal via Clio's Designer) configure the same API differently
  via toggles.
- Content and profile flow through partner-owned storage, never Clio's:
  content generated once per partner+topic, partner-approved, **pushed to the
  partner's own DB via their API**, and **pulled back by Clio at render
  time** — Clio does not persist it. Profile follows the identical
  push/pull shape, gated by a **per-partner opt-in toggle**; if off, every
  session is purely session-scoped with no cross-session continuity (Q2, Q3).
- Every billable event (voice-minutes, LLM-generation calls) must be
  API-observable, feeding both Clio's own admin dashboard and the partner's
  own dashboard, via a **signed webhook POST** — "same signature-verification
  standard as the existing Stripe/Twilio handlers" (§7.3; note Twilio itself
  is retired, the standard referenced is the verification *pattern*, not the
  vendor).
- Sub-tenant delegation (§1.3): a partner (Capgemini) can extend credit to its
  own downstream clients (Hartford). Hartford's employees experience it as
  Capgemini's own product — no Designer access, no Clio branding, no
  awareness Clio exists. Capgemini controls entitlements; **Clio sees only one
  rollup usage line per top-level partner, sub-tenant identity is opaque to
  Clio.**
- Clerk scope confirmed (§7.1): manages partner-admin human accounts only
  (people at Capgemini/Pluralsight logging into Clio's own Designer/
  Configurator/billing UI) — never end-user identity, in any form.
- Outbound auth pattern already decided at a high level (§7.5 point 4): the
  Clio→partner direction (content/profile pull, usage webhooks) is "just a
  settings field (base URL + auth token)" configured per partner — no DNS/
  cert work, since it's the partner's own infrastructure receiving the call.

## The Problem Being Solved
Today, Clio's only auth model is Clerk-issued per-individual-user JWTs, and
there is no concept of a "partner" as a trust boundary, no mechanism for Clio
to push content/profile data out to an external system it doesn't control, no
mechanism for an external system to pull a session-trigger into Clio, and no
usage-metering/webhook infrastructure at all. Every downstream capability in
the pivot — the Designer (B2B-03), metered billing (B2B-04), white-label
domains (B2B-05) — needs a partner identity to attach to, an API surface to
call, and a usage event stream to meter against. None of that exists yet.
`architecture.md` does not exist for the pivoted system (per `CLAUDE.md`: "no
`architecture.md` exists yet — one will be produced as part of the B2B-02
Feature Brief"), so this brief is also where that schema/API-map artifact
gets created for the first time under the new model.

## What Success Looks Like
A BA spec exists that, once built, means:

1. **Partner-level API keys / auth exist as a first trust boundary, distinct
   from Clerk.** A partner account can be issued one or more API keys scoped
   to that account; every inbound API call (session trigger, content
   submission, topic list submission, etc.) authenticates against a partner
   account, not an individual end-user identity. This is explicitly a
   *second*, new auth system alongside Clerk (which stays scoped to
   partner-admin humans logging into Clio's own UI per §7.1) — the spec must
   not conflate the two or describe Clerk as covering this.
2. **A session-initiation contract exists** — the entry point everything else
   hangs off. A partner's own UI (Pluralsight's button, or a No-Platform
   partner's Designer-built portal) calls one authenticated Clio endpoint to
   trigger a live session: topic/content reference in, a joinable
   meeting-bot session out. This endpoint must not hardcode which meeting-bot
   vendor is behind it (Recall.ai/Attendee migration is still in progress per
   `docs/b2b-pivot-status.md` V-02 — the existing `MeetingBotProvider`
   abstraction must be respected, not bypassed).
3. **The content push-pull contract is fully specified** (exact JSON/HTML
   payload shape, endpoints, and auth on both legs): Clio pushes
   partner-approved, once-generated content to a partner-configured endpoint;
   Clio pulls it back at render time from that same partner's endpoint. Zero
   Clio-side persistence of the content itself.
4. **The profile push-pull contract is fully specified**, identical shape to
   content, gated by a per-partner configuration toggle. Toggle off means
   Clio has provably no mechanism to recall anything about a user across
   sessions — this must be verifiable, not just documented (see Objective 1's
   falsifiable test case in `CORE_OBJECTIVES.md`).
5. **A usage-metering and signed-webhook mechanism exists** such that every
   billable event (a voice-minute of session time, an LLM-generation call —
   topic/content/prerequisite) is recorded as it happens, immediately
   observable via Clio's own API (feeding both the future internal admin page
   and the future partner dashboard — B2B-04 builds those screens, this brief
   builds the event stream and storage contract they'll read from), and
   triggers a signed webhook POST to the partner's configured endpoint using
   the same signature-verification discipline as the existing Stripe webhook
   handler (`stripe.webhooks.constructEvent` equivalent — HMAC-signed,
   verified before processing, timestamp-checked against replay).
6. **Sub-tenant delegation requires no new identity concept in Clio's own
   schema.** Because Clio only ever sees a single rollup line per top-level
   partner account (§1.3), the spec should confirm (and the acceptance
   criteria should test) that a sub-tenant's usage arrives at Clio
   indistinguishable from the top-level partner's own usage — same API key,
   same account, no sub-tenant field Clio needs to store or expose. If the BA
   finds a reason this doesn't hold cleanly (e.g. a webhook needs a
   partner-supplied opaque sub-tenant tag passed through un-interpreted), that
   should be spec'd explicitly rather than silently assumed away.
7. **`architecture.md` and a `schema.sql`-equivalent migration exist**,
   scoped to what this brief covers (partner accounts, API keys, session
   records keyed to opaque references, the webhook-dispatch log, and whatever
   minimal usage-event storage the F-01 resolution below requires) — not a
   speculative full schema for B2B-03/04/05's not-yet-spec'd needs.

## Known Constraints
- **Data boundary is non-negotiable and applies to this brief specifically:**
  per `CORE_OBJECTIVES.md`, Clio never becomes the system of record for
  partner or end-user identity, content, or profile. The only persisted
  exception is de-identified transcripts (out of this brief's scope — that's
  the existing quality-eval pipeline) and whatever minimal usage-event
  storage is needed for the ledger/webhook mechanism (see F-01 handling
  below) — and even that must never carry end-user identity, only opaque
  session/account references.
- **Two auth systems, not one.** Clerk = partner-admin humans in Clio's own
  UI (existing, scoped by B2B-01/CLAUDE.md, not this brief's concern to
  redesign). Partner API keys = machine-to-machine, partner-account-scoped,
  new in this brief. Do not let the spec merge these.
- **Bidirectional API, both directions need their own auth model.** Partner →
  Clio (session trigger, content/topic submission) is authenticated by the
  API key Clio issues to the partner. Clio → Partner (content pull, profile
  pull, usage webhooks) is authenticated by credentials the *partner*
  supplies to Clio — per §7.5 point 4, a settings field (base URL + auth
  token) configured per partner, not a Clio-issued key. Get this direction
  right; conflating them was flagged by the Orchestrator's research as a
  likely failure mode.
- **One flexible API, toggle-configured — not two product tiers.** The same
  endpoints must serve both Platform Partners (thin narration, no Designer)
  and No-Platform Partners (full Designer-configured build) via
  partner-level configuration, not divergent API surfaces.
- **Meeting-bot vendor must stay abstracted.** Recall.ai→Attendee migration
  (V-02 in `docs/b2b-pivot-status.md`) is mid-flight; Phase 2 (deleting
  Recall code) isn't authorized yet. The session-initiation contract in this
  brief must go through the existing `MeetingBotProvider` abstraction, not
  around it.
- **Sub-tenant identity is opaque to Clio by design** (§1.3) — do not design
  a sub-tenant table, sub-tenant-scoped API keys, or any Clio-side visibility
  into Hartford-style downstream clients. That is entirely the top-level
  partner's own concern.
- **Signed-webhook standard mirrors the existing Stripe pattern** — HMAC
  signature verification before processing, consistent with
  `stripe.webhooks.constructEvent` and the project's stated rule that "all
  webhook handlers must verify signatures before processing." Twilio's
  specific verification helper is retired along with the package; use it only
  as a precedent for the *pattern* (signed, verified, timestamp-checked), not
  as a dependency.
- **Scope boundary, repeated for emphasis:** no Designer UI, no billing
  numbers/tiers, no domain/DNS infra in this spec. If a screen or a rate
  table would need to exist for this brief's acceptance criteria to be
  testable, describe the API contract that screen/rate table will eventually
  consume — do not design the screen or set the rate here.

### F-01 (ledger storage model) — how to handle it, do not silently guess
`docs/b2b-pivot-status.md` flags F-01 as open: does Clio keep an
opaque-reference usage ledger of its own for billing/dashboard purposes, or
compute those numbers live via round-trips to partner APIs? I considered
escalating this to Arun as a blocking question before this brief could be
scoped, and decided against it — **my judgment is this brief can and should
be scoped to hold under either resolution**, the same way `CORE_OBJECTIVES.md`
itself was deliberately written to hold under either resolution (see its
"Non-Negotiable Data Boundary" section, last paragraph). Concretely, instruct
the BA to:

1. Design a **webhook-dispatch log** (event type, partner account, opaque
   session/usage reference, payload hash, delivery status, timestamp, retry
   count) as a required, F-01-independent piece — this is needed regardless
   of F-01's outcome, purely for webhook reliability/idempotency/audit, and
   is not itself "the ledger" in the billing sense.
2. Explicitly document, as two labeled branches in the spec (not a forced
   single answer), what additional schema/API surface each F-01 resolution
   would require on top of #1:
   - **Resolution A (opaque-reference ledger):** an aggregating
     `usage_events` table Clio queries for its own admin dashboard and
     partner dashboard numbers.
   - **Resolution B (zero-storage, live round-trip):** no aggregating table;
     Clio's dashboards call back into the partner's own API (or recompute
     from the webhook-dispatch log's raw events) at read time.
   Both branches should be spec'd concretely enough that B2B-04 can pick up
   whichever one F-01 resolves to without re-opening this brief.
3. If, in doing this, the BA concludes the API *architecture itself* (not
   just the storage/query layer) genuinely forks between the two resolutions
   — i.e. this isn't just a schema-and-query-pattern difference but changes
   what the partner-facing contract looks like — stop and escalate that
   specific finding back to me rather than picking one. I don't currently
   believe that's the case (the partner-facing webhook contract is identical
   either way; only Clio's *internal* read path differs), but I'm not
   certain, and the BA will have gone deeper into the schema than I have.

## Questions for BA
These are scoping questions where I want your judgment; only come back to me
if you get genuinely stuck (per the standing gate, your Requirement
Document's Section 11 must still land empty).

1. **API versioning and environment separation** (test/sandbox vs. live
   keys) — not addressed anywhere in Arun's source material. Stripe-style
   test/live key pairs would let a partner integrate before their first real
   billable event. Use your judgment on whether to include this in scope now
   or explicitly defer it as a documented gap; either is fine, just don't
   silently omit it without a note.
2. **Rate limiting per partner API key** — not addressed in source material.
   Recommend a sensible default (e.g. per-partner, per-endpoint) and document
   it; this is a technical decision within your authority.
3. **Key rotation/revocation UX** — same as above, technical judgment call,
   just make sure it's spec'd (a partner losing the ability to rotate a
   compromised key without downtime would be a real operational gap).
4. **Exact shape of the "opaque session/end-user reference"** used throughout
   the content/profile/usage contracts — a random UUID Clio mints per
   session? A hash of something? This needs to be concrete enough for the
   webhook payload schema (item 3 under "What Success Looks Like") to be
   fully specified, not left as "an opaque reference" in prose.
5. **F-01 handling** — see the dedicated section above. Follow that
   instruction; do not resolve F-01 yourself and do not leave it as a Section
   11 open question that blocks the whole spec. If you disagree with my
   framing that this is scopable without Arun's input, tell me why in your
   spec rather than proceeding on a framing you don't actually believe.

## Approval note
I've read `CORE_OBJECTIVES.md` v2.0 in full (it supersedes the brainstorm
doc's phrasing per Arun's instruction), the complete
`docs/brainstorm-b2b-platform-pivot.md` (both rounds, all sections), and
`docs/b2b-pivot-status.md`'s current status before writing this brief. I'm
confident enough in Arun's already-stated decisions (one flexible API, B2C
killed, the data boundary, Clerk scoped to partner-admins only, the outbound
settings-field auth pattern from §7.5) to authorize BA work starting now. The
one genuinely unresolved item — F-01 — I've made a scoping call on rather than
silently guessing either resolution or blocking on it; that reasoning is
explicit above so it can be checked. I will review the completed Requirement
Document against this brief, against `CORE_OBJECTIVES.md` Objective 6, and
against the F-01 handling instruction specifically before approving it for
build.
