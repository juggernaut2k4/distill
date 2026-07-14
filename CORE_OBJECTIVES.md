# Clio — Core Business Objectives

Version: 2.0 | Owner: Arun | Date: 2026-07-13
Status: APPROVED — referenced at every Feature Brief, every sprint review, every build validation
Supersedes: v1.0 (approved 2026-06-07, deleted 2026-07-13 — described a Clio-owned, single-tenant,
direct-to-executive B2C product that no longer exists)

> These are non-negotiable product principles under the B2B/B2B2C pivot. Every Feature Brief, every
> build, every sprint must be validated against these. A build that breaks any of these is not
> shippable.

---

## Hard Premise: B2C Is Killed

Clio's original B2C product — self-serve individual sign-up, a consumer landing page and pricing
page, gamified engagement (AI Readiness Score, streak counter), scheduled daily SMS/email delivery
via Twilio/Resend cron jobs, and Clerk-per-executive authentication as the primary product entry
point — is **retired, not paused, and not a parallel channel.**

This is a hard premise, not a hedge:

- No agent may resurrect any B2C surface, copy, flow, or schema (landing page, pricing page,
  onboarding-as-signup, gamification, SMS/Twilio, cron-scheduled daily delivery, individual Clerk
  accounts as end-user identity) by inferring intent from git history, `archive/b2c-legacy`, or
  prior sessions.
- Resurrecting any B2C surface requires a new, explicit instruction from Arun — not inference, not
  "it seemed useful," not silence read as permission.
- Infrastructure originally built for B2C that is reused under the new model (the Recall.ai/Attendee
  live meeting bot, Hume voice, the async content-generation pipeline, the template-review admin
  tool) is reused because it is genuinely infrastructure, not because B2C is coming back.

## What Clio Is Now

Clio is a B2B/B2B2C AI narration and integration layer for partner learning platforms. Clio does not
compete with platforms like Pluralsight, Domestika, or Coursera for individual executive users — it
plugs into them via API. Clio's AI joins a live meeting (via Recall.ai/Attendee), walks a user
through content, and narrates/explains it in that person's own terms — a capability those platforms
don't have natively.

Two partner archetypes are equally first-class instances of success. Neither is the default and
neither is a special case:

| Archetype | Example | Shape |
|---|---|---|
| **Platform Partner** | Pluralsight | Already has users, topics, and content. Wants Clio's AI to narrate its *existing* content live and answer questions. Billed by voice-minutes only. |
| **No-Platform Partner** | Capgemini | Has no existing learning platform. Uses Clio's Designer/Configurator to build one from scratch (questionnaire, topics, content, visualization, white-label domain). Billed by voice-minutes + LLM-generation-call count. |

Both partner types configure the same one flexible API via toggles — these are not two separate
products or capability tiers.

A partner (e.g. Capgemini) may extend its own credit allowance to its own downstream clients (e.g.
Hartford Insurance) as a sub-tenant. Those sub-tenants experience the product as the partner's own —
no Clio branding, no Designer access. Clio sees only a single rollup usage line per top-level
partner account; sub-tenant identity is opaque to Clio and entirely the partner's own concern.

## The Non-Negotiable Data Boundary

**Clio computes signal. Clio never becomes the system of record for partner or end-user data.**

The sole exception: Clio retains de-identified interaction transcripts, for its own
quality-improvement and prompt-tuning purposes only. These transcripts carry no user-identifying
information.

Everything else — end-user identity, learning profile, generated content, session history — is
either:

- Never stored by Clio at all (the default), or
- Computed by Clio and pushed to the partner's own database via the partner's API, opt-in per
  partner via a configuration toggle. If a partner enables the toggle, Clio pulls the data back via
  the partner's API at the start of each relevant session. If disabled, everything is purely
  session-scoped with no cross-session continuity.

This statement holds regardless of how the still-open question of whether Clio additionally keeps
an opaque-reference usage ledger for its own billing/dashboard purposes, or computes those numbers
live via round-trips to partner APIs, is eventually resolved — neither resolution stores partner or
end-user *identity, content, or profile* as Clio's system of record. That resolution is a
billing/dashboard implementation detail for later Feature Briefs, not a data-boundary exception.

---

## The Six Objectives

### Objective 1 — The User Learning Profile Is the Intelligence Layer
**Status: MODIFIED, survives.**

Clio still computes a structured, multi-dimensional learning profile per user (knowledge,
intellectual, psychological/motivation, and business-focus-lens dimensions — the same conceptual
structure as before) from de-identified session transcripts. What changes: Clio never owns storage
of that profile. Storage is delegated to the partner, opt-in per partner via a configuration toggle,
and fetched back via the partner's API at the start of every session where the toggle is enabled.

If a partner never enables the toggle, there is no cross-session profile continuity for their users
at all — every session is purely session-scoped, computed and used once, then discarded by Clio.
This is a fully legitimate, supported configuration, not a degraded one.

**Falsifiable test case:** A partner with the profile-storage toggle OFF gets a session where Clio
behaves as if it remembered the user from a prior session (e.g. skips a concept it "shouldn't know"
was already covered, or references a prior session by name). This is a violation — with the toggle
off, Clio must have no memory of the user across sessions.

### Objective 2 — Speak the User's Language
**Status: MODIFIED, survives, mechanism shifts.**

Personalization no longer happens by generating a different script text per user ahead of time. It
happens live, at explanation time: Hume's system prompt is instructed to check for a fetched user
profile (per Objective 1) and, if present, explain the same underlying (fixed, reused) content using
that person's vocabulary, reasoning style, and business-focus lens. If no profile is available —
either because the partner's toggle is off, or because this is the user's first session with no
signal yet — Hume explains generically from the content alone and still answers questions live.

**The reference test — same concept, two profile states, two different explanations.** Take any
concept in a piece of partner content (e.g. "hallucination risk" in an AI-literacy topic) and verify
Clio's live narration is genuinely different for:

- **A user with a fetched profile indicating a risk/compliance business lens and technical
  vocabulary:** narration should frame the concept in terms of governance, audit trail, and "under
  what conditions does this fail" — using the user's own domain terms if present in the profile.
- **A user with no profile available (toggle off, or first session):** narration should explain the
  same concept generically and correctly, without inventing a persona or lens the profile didn't
  actually establish.

Same underlying content object in both cases. If the narration sounds identical regardless of
profile presence, or if Clio fabricates personalization it has no signal for, Objective 2 is
failing.

**Falsifiable test case:** Two sessions on the same partner+topic content, one with a fetched
profile and one without, produce narration that is either (a) identical regardless of profile
presence, or (b) personalized in the no-profile case using signal Clio could not actually have had.
Either is a violation.

### Objective 3 — Content Static, Script + Visualization Adaptive
**Status: MODIFIED, survives, converges with the (paused) Template Designer thread.**

"Static" content generation becomes stronger than originally conceived: content is generated once
per partner+topic (via the Designer, for No-Platform partners; or supplied directly by the partner,
for Platform partners), approved by the partner, pushed to the partner's own database, and reused
across every session on that topic for that partner's users — never regenerated per individual end
user. "Adaptive" moves entirely into Objective 2's live-narration mechanism rather than being baked
into pre-generated script text per user.

Partner customization of how content renders happens via a 3-level configuration model:

- **Application/product level** — global theme, layout choices.
- **Template level** — properties common to every instance of a given content template.
- **Component/container level** — per-element styling and behavior.

This objective describes *what* that customization model must achieve (partner-configurable
rendering of reused, once-generated content) — it does not commit to which specific effort formally
owns building the mechanism. Whether that is the paused AI Template Designer brainstorm resumed
as-is, folded into a later Feature Brief as new scope, or some other implementation is a scoping
decision for that later brief, made separately from this objective.

**Falsifiable test case:** The same generated content item, rendered for two different partners with
different visualization configurations, is identical in ways their configured properties should
have differentiated (e.g. both partners configured different container-level styling but the
rendered output ignores it). Also a violation: content is regenerated per individual end user rather
than reused across all sessions on that partner+topic.

### Objective 4 — Smart Topic Delta
**Status: LARGELY UNCHANGED.**

The bridging/delta logic (pre-selecting existing topic interests, scoped deletion of removed-topic
sessions, queue-promotion to fill freed slots, bridging sessions generated when a topic is added) is
unaffected by the pivot. What changes is exposure: this is now an optional, toggle-gated capability
a partner can invoke via API (e.g. a Platform Partner sending an updated topic list) rather than the
only path an end user experiences directly inside a Clio-owned UI.

**Falsifiable test case:** A partner sends an updated topic list via API (add C, keep A, remove B)
and the resulting session set does not reflect scoped deletion of B's sessions, promotion of A's
queued sessions, and bridging-session generation for C — the same behavior the original delta logic
guaranteed, just triggered by a partner API call instead of a direct user action.

### Objective 5 — Just-in-Time Personalization via Profile, Not Just-in-Time Generation
**Status: LARGELY UNCHANGED, recontextualized.**

The async background-generation pipeline (SubtopicOutline → Visualization + Script generated in
parallel, ready before use rather than generated live during a session) holds as-is. What changes:
the trigger moves from a personal daily cron to a partner-initiated session/API call, and the
destination moves from "ready in Clio's own dashboard before the user clicks Start" to "pushed to
the partner's database, pulled back by Clio at render time." Nothing is generated live during a
meeting, in either the old or new model.

**Falsifiable test case:** A user's session start is observably blocked on live content generation
(visualization or script generated synchronously during the call rather than pre-generated and
pulled from the partner's database ahead of time). This is a violation regardless of which trigger
initiated the pipeline.

### Objective 6 — API Is the Integration Layer, UI Is a Display Layer
**Status: BECOMES THE CORE OF THE BUSINESS MODEL.**

> "No feature is complete until it is fully accessible through the API. UI renders what the API
> returns. Nothing else."

This was an internal architecture principle under the B2C product. Under the pivot, it is no longer
background architecture — it is the product itself. Every data flow (content push/pull, profile
push/pull, usage/webhook events) is API-mediated, with zero Clio-side persistence of partner or
end-user data except de-identified transcripts (see "The Non-Negotiable Data Boundary" above).

This objective now requires dimensions it did not need under the B2C model:

- **Partner-level API keys** — trust boundaries are per-partner-account, not per-individual-user-JWT.
- **Usage-metering hooks** — every billable event (voice-minutes, LLM-generation calls) is
  API-observable, feeding both billing and the partner's own dashboard.
- **White-label rendering** under a partner's own domain, with no Clio branding visible to end users
  of a No-Platform partner's portal.
- **Two-tier account hierarchy** for sub-tenant delegation (e.g. Capgemini → Hartford), where Clio
  sees only a rollup line per top-level partner.

**Falsifiable test case:** Any feature or data flow that can only be exercised through Clio's own
UI, with no equivalent partner-facing API path producing the same result, violates this objective —
the UI (Designer/Configurator, admin dashboard) must be a client of the API, never a required path.

---

## How the Objectives Apply to Each Partner Archetype

Neither archetype is the default case the objectives were written for — both must hold, with the
same objective realized through a different mechanism:

| Objective | Platform Partner (e.g. Pluralsight) | No-Platform Partner (e.g. Capgemini) |
|---|---|---|
| 1 — Profile | Optional signal the partner already has (wishlist, completed courses) can seed the profile if the partner opts in; otherwise purely session-scoped, same as any partner with the toggle off | Profile computed by Clio from its own sessions |
| 2 — Language | Narration adapts live to a fetched profile if available; otherwise generic — identical mechanism | Same mechanism |
| 3 — Content | Content authored once by the partner, not regenerated by Clio, reused across sessions — satisfies "generated once, reused" via partner authorship instead of Clio generation | Content generated once via the Designer, partner-approved, reused |
| 4 — Topic delta | Optional, invoked if the partner sends updated topic lists via API | Optional, invoked via the same API or the Designer's topic toggle |
| 5 — Background prep | The partner's existing content is converted into Clio's walkthrough-ready paginated format ahead of session time, not live during the call | Visualization/script generated ahead of session time via the async pipeline |
| 6 — API-first | The entire integration is a single API call triggered by a button in the partner's own UI | The entire Designer/Configurator and end-user flow is API-mediated end to end |

---

## Out of Scope for This Document

This document states objectives only. It does not specify:

- The partner API request/response contract
- Designer/Configurator UI requirements
- Billing rate tables, credit-wallet mechanics, or tier pricing
- Domain/white-label infrastructure
- Resolution of the open ledger-storage question or COGS-derived burn rates
- Which specific effort formally owns building Objective 3's 3-level configuration mechanism

Each of the above is scoped to a separately sequenced Feature Brief.
