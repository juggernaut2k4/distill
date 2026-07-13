# Brainstorm: B2C → B2B/B2B2C Platform Pivot

Status: REQUIREMENTS + ANALYSIS CAPTURED — decision made (B2C killed), awaiting Arun's go-ahead to
dispatch the CEO Agent. No CORE_OBJECTIVES.md rewrite, no code, no schema changes made yet.
Started: 2026-07-12
Participants: Arun (product owner), Orchestrator

This document exists to capture Arun's raw requirements before any CEO/BA/build work starts, per
his standing process: (1) document requirements, (2) orchestrator asks clarifying questions, (3)
document Arun's answers, (4) orchestrator restates understanding and gives recommendations, (5)
only then proceed to CEO → BA → build → review → test → deploy.

## 0. Relationship to other in-flight brainstorms

- **Supersedes the B2C framing** in `CORE_OBJECTIVES.md` (all 6 objectives, approved 2026-06-07).
  Those objectives were written for a Clio-owned, single-tenant, direct-to-executive product. This
  pivot changes who owns the user relationship, who owns storage, and how revenue is generated —
  see Section 3 for the objective-by-objective impact.
- **Converges with the paused AI Template Designer brainstorm**
  (`docs/brainstorm-ai-template-designer.md`, started earlier the same day). That thread's 26
  requirements — a visual designer with app/template/component-level CSS properties, AI-recommended
  skeletons, per-template configuration — turn out to be the exact mechanism Type 2 partners
  (Section 1.2) need to configure their white-label portal. Orchestrator's recommendation is to
  resume that thread as the design spec for this pivot rather than treat it as separate work
  (Arun has not yet explicitly confirmed this — see Section 5).

---

## 1. Arun's Requirements (as stated, restructured for clarity)

### 1.1 The pivot, in his words

- Original framing: Clio was a B2C product for CEOs, VPs, and directors who can't scale their AI
  skills fast enough. Individual sign-up/login, a questionnaire (domain, experience, area of
  expertise, role) drives AI-generated topics and curriculum.
- On reflection, a B2C play puts Clio in direct competition with Pluralsight, Domestika, Coursera —
  platforms with an existing customer base Clio cannot out-acquire.
- What those platforms lack: AI that can join a live meeting, screen-share, and walk a user through
  content interactively, clarifying questions in real time.
- **New objective: don't compete with them — plug into them via API.** B2B, not B2C. Collaborate
  with the incumbents instead of fighting them for the same users.

### 1.2 Two partner archetypes

**Type 1 — Platform Partner (e.g. Pluralsight): already has a platform**

- Has its own users, topics, and content already prepared.
- Wants AI to run their *existing* content live in a session and answer questions — not new
  visualization generation from Clio.
- Can optionally give Clio access to signal it already has (wishlist, completed courses) to build a
  profile — not required.
- Flow: end user clicks a button in Pluralsight's UI → topic + content sent to Clio via API → Clio's
  AI joins the meeting → presents their existing content, paginated via a "Next"-navigable format
  Clio can walk through screen by screen → narrates it and answers questions live.
- Onboarding: Pluralsight signs up on Clio's site, gets documentation and a partner dashboard.
- Billing: metered by **voice-minutes consumed only**. Prepaid balance; can load minutes; alert/
  reload prompt at 80% consumed so there's no interruption.
- Partner dashboard shows only: minutes used, minutes to purchase, load minutes. No per-end-user
  breakdown, no user data surfaced.
- No SMS/email to end users needed — only account-level emails to Pluralsight itself (billing/low-
  minutes alerts), via the existing Resend integration.
- Payment: existing Stripe integration, assumed sufficient (needs to move to metered/usage billing —
  see Section 3, Objective 6).

**Type 2 — No-Platform Partner (e.g. Capgemini): builds a white-label portal via Clio's Designer**

- Has no existing learning platform. Uses Clio's Designer to configure one from scratch.
- Configures across 3 domains:
  1. **Questionnaire** — builds their own onboarding questions/screens; Clio renders them
     automatically (single page or multi-page, partner's choice); submissions are sent back to the
     partner as an API request.
  2. **Topics** — toggle: Clio's LLM generates topics vs. Capgemini supplies its own topic list via
     API/JSON. A separate toggle controls prerequisite/topic-delta generation (LLM-generated vs.
     partner-supplied).
  3. **Visualization** — a 3-level property system:
     - **Application/product level** — global CSS/theme, layout choices (e.g. one question per page
       vs. all questions on one page).
     - **Template level** — properties common across every instance of a given template.
     - **Component/container level** — per-element styling (fill/outline/neon, motion, 3D lines,
       etc.), configurable per web element (button, link, textbox, container).
- **White-label hosting**: rendered under the partner's own domain (e.g. `capgemini.learning.com`) —
  the partner just supplies the URL, and Clio's rendering is directed there.
- **SSO**: entirely owned and managed by the partner. End users never touch Clio's login or see Clio
  branding. The partner's own UI calls Clio's API directly.
- **Content generation toggle**: Clio's LLM generates session content vs. Capgemini supplies
  predefined content.
- End-user flow: selects a topic → clicks "Let's go" → a Google Meet link is generated → the topic,
  session, and content are sent to Clio → Clio's AI joins the call and explains the topic to the
  user, per whichever toggles are configured.
- Billing: itemized — (a) count of AI/LLM generation calls (topics, prerequisites, content),
  (b) voice-minutes used. Same prepaid-balance/top-up model as Pluralsight. Billed only to
  Capgemini, never to individual end users.

### 1.3 Sub-tenant / credit delegation model

- A partner (e.g. Capgemini) can extend a learning-credit allowance (e.g. 500 hours) to its own
  clients (e.g. Hartford Insurance).
- Hartford's employees experience it as Capgemini's product — no Designer access, no Clio branding,
  no awareness that Clio exists.
- Capgemini sees all of its sub-clients' usage and fully controls entitlements — this is Capgemini's
  decision, not Clio's.
- Clio sees only **one rollup line per top-level partner** (e.g. "Capgemini — 1,200 minutes"). No
  visibility into sub-tenant identities, no per-user itemization, single billing line against the
  partner account.

### 1.4 Arun's explicit instruction

> "Analyze these requirements thoroughly and let me know your thoughts. Tell me what changes impact
> our core objectives. I think we need to start with those, but before making any changes to the
> code, let me hear your recommendations and thoughts on this."

---

## 2. Clarifying Q&A

**Q1 (Orchestrator):** Does the direct B2C product get killed outright, or kept as a parallel
channel?
**A (Arun):** **B2C is killed.** Not paused, not a parallel channel.

**Q2 (Orchestrator):** Does "we don't save any user information" extend to internal
quality-improvement signal, or is retention stricter than that?
**A (Arun):** Transcripts of user interaction are read for quality improvement and to fine-tune the
Hume AI prompt — retained, but **de-identified** ("we don't store any user information as such").
Separately: an **opt-in API** lets a partner fetch Clio's computed profile signal and store it in
their own DB. If a partner enables this toggle in their configuration, Clio fetches the profile back
from the partner's API at the start of every session with that user and uses it for personalization.
If the toggle is off, this is skipped entirely — purely session-scoped, no continuity.

**Q3 (Orchestrator):** What's the real-time constraint — must content be generated live during the
call, and does "reused" mean the generated content itself or just the structural template shapes?
**A (Arun):** Not literally real-time. Same async approach as the existing pipeline: generate
content in the background, fit it into the partner's configured template. Content generated through
the Designer, once the partner approves it, is converted to HTML/JSON and **pushed to the partner's
own DB via their API** — Clio does not store it. At session/render time, Clio's API **pulls it back**
from the partner, converts format, and renders it — no generation happens live during the meeting.
Hume (the voice layer) consumes this content to explain it; if a user profile is available (per Q2's
toggle), Hume's system prompt is instructed to read the profile's keywords and explain in terms
customized to that person. If no profile exists or the toggle is off, Hume explains generically from
the content alone and still answers questions. **Nothing is persisted by Clio in either direction —
everything flows through partner APIs.**

**Q4 (Orchestrator):** Is this two separate product tiers (a thin narrator vs. a full platform), or
one flexible API?
**A (Arun):** **One flexible API.** Partners configure it into either shape via toggles. Billing:
prepay for whichever capabilities you actually use.

**Q5 (Orchestrator, challenged rather than asked):** Is this really a net scope *reduction*, simply
reusing recent modules?
**Orchestrator's position (given before Arun's answer):** Partially agree — the consumer-facing
surface shrinks substantially and the hardest infrastructure (live Meet join, Hume voice) is reused
directly, but multi-tenant billing, white-label hosting, the partner content/profile API contract,
and sub-tenant account hierarchy are genuinely new. Net engineering effort is probably comparable to
where Clio already is, not smaller — it's a different shape of complexity (less consumer-growth
surface, more multi-tenant-platform surface), not simply less total work. Full breakdown in
Section 4.
**A (Arun):** Agreed with this framing.

---

## 3. Orchestrator's Objective-by-Objective Impact Analysis

Against `CORE_OBJECTIVES.md` (approved 2026-06-07). Final version, incorporating all corrections
from the Q&A above.

### Objective 1 — User Learning Profile is the Intelligence Layer
**Status: MODIFIED, survives.** Originally assumed Clio is the system of record for a persistent,
evolving per-user profile stored in Clio's own DB. Under the new model, Clio still **computes** the
profile (from de-identified transcripts, same 4-dimension structure: knowledge, intellectual,
psychological, business-lens) but never owns storage. Storage is delegated to the partner, opt-in
per partner via a configuration toggle, and fetched back via API at the start of every session where
enabled. If a partner never enables the toggle, there is no cross-session profile continuity for
their users at all — purely session-scoped.

### Objective 2 — Speak the User's Language
**Status: MODIFIED, survives, mechanism shifts.** Personalization no longer happens by generating a
different script text per user ahead of time. It happens **live, at explanation time**: Hume's
system prompt is instructed to check for a fetched user profile and, if present, explain the
(fixed, reused) content using that person's vocabulary and framing. If absent, Hume explains
generically. The "same concept, three different sessions for three different users" test case from
the original objective still holds — it's just implemented as a live inference-time instruction
rather than a generation-time artifact.

### Objective 3 — Content Static, Script + Visualization Adaptive
**Status: MODIFIED, survives, converges with the Template Designer thread.** "Static" content
generation becomes stronger than originally conceived: content is generated once per partner+topic
via the Designer, approved by the partner, pushed to the partner's DB, and reused across every
session on that topic for that partner's users — not regenerated per individual. "Adaptive" moves
entirely into Objective 2's live-narration mechanism rather than being baked into pre-generated
script text. The 3-level design-properties model (app/template/component) described in Section 1.2
is the literal mechanism for partner customization here, and is the same structure as the paused
Template Designer brainstorm's core idea.

### Objective 4 — Smart Topic Delta
**Status: LARGELY UNCHANGED.** The bridging/delta logic is unaffected. It's now exposed as an
optional, toggle-gated capability callable via API instead of being the only path a user experiences.

### Objective 5 — Just-in-Time Personalization via Profile, Not Just-in-Time Generation
**Status: LARGELY UNCHANGED, recontextualized.** The async background-generation pipeline
(SubtopicOutline → Visualization + Script in parallel, ready before use rather than generated live)
holds as-is. What changes: the trigger moves from a personal daily cron to a partner-initiated
session/API call, and the destination moves from "ready in Clio's own dashboard before the user
clicks Start" to "pushed to the partner's DB, pulled back by Clio at render time." Orchestrator's
initial read overstated how much rework this objective needed — Arun's Q3 clarification confirmed
the core architecture survives essentially intact.

### Objective 6 — API is the Integration Layer, UI is a Display Layer
**Status: BECOMES THE CORE OF THE BUSINESS MODEL.** No longer just an internal architecture
principle — it's the product. Every data flow (content push/pull, profile push/pull) is API-mediated
with zero Clio-side persistence of partner or end-user data, except de-identified transcripts kept
for Clio's own quality/prompt-tuning purposes. This objective needs new dimensions it doesn't have
today: partner-level API keys (not just per-user JWTs), usage-metering hooks, white-label rendering
under a partner's own domain, and a two-tier account hierarchy for sub-tenant delegation
(Capgemini → Hartford).

---

## 4. Scope: What's Cut, What's Reused, What's Genuinely New

**Genuinely cut (real reduction, not just deprioritized — B2C is killed):**
- Landing page, pricing page, self-serve signup, individual Stripe checkout
- Gamification (AI Readiness Score, streak counter)
- Scheduled async delivery (daily 7am email, Sunday digest) — the Inngest cron-nurture model
- SMS entirely (Twilio) — no more direct-to-consumer messaging
- Individual auth/onboarding as the primary product entry point (Clerk-per-executive)

**Reused directly (the expensive, hard-to-rebuild pieces):**
- Recall.ai live Google Meet bot — untouched by the pivot, just re-triggered by a partner API call
  instead of a personal "Let's go" click
- Hume voice integration — same, now driven by a system prompt that conditionally reads a fetched
  profile
- The `template_library` / TMPL-01..07 admin review-and-approve tool — functionally a prototype of
  the partner-facing Designer, scoped today to Arun as sole admin; the approve/regenerate/slot-
  allowlist workflow generalizes rather than getting rebuilt from scratch
- SubtopicOutline → Visualization + Script generation pipeline — reused, re-pointed to push output to
  a partner's DB instead of Clio's own
- The 3-level design-properties thinking from the paused Template Designer brainstorm — the entire
  26-item requirements doc turns out to be the spec for the partner Designer

**Genuinely new (not reuse — worth naming honestly rather than calling this "smaller"):**
- Multi-tenant partner API keys (today's auth is one JWT per individual user; partner-level trust
  boundaries are a different model)
- Metered/prepaid billing ledger with top-up and 80%-threshold alerts (Stripe SDK carries over, but
  the billing architecture itself is new)
- White-label hosting under a partner's own domain
- The push-to-partner-DB / pull-from-partner-DB content and profile contract — nothing today pushes
  Clio-generated content out to an external database
- Sub-tenant account hierarchy (Capgemini → Hartford) — no such concept exists in the current schema

**Orchestrator's conclusion (agreed by Arun):** Real reduction in consumer-facing/growth surface,
real reuse of the hardest infrastructure, but net engineering effort is comparable to — not smaller
than — where Clio already is. It's a different shape of complexity, not less of it.

---

## 5. Open Items Not Yet Resolved (Round 1)

1. Should the CEO Feature Brief explicitly state B2C is being **retired outright** as a hard premise,
   so no retired surface (landing page, gamification, SMS, cron delivery) gets preserved by default
   out of caution? Orchestrator raised this; not yet explicitly confirmed by Arun.
2. Should the paused AI Template Designer brainstorm formally **resume as the design mechanism** for
   this pivot's Type 2 Designer, rather than proceed as separate work? Orchestrator's recommendation
   is yes (Section 0); not yet explicitly confirmed by Arun.
3. The partner content/profile API contract (exact JSON/HTML schema partners must conform to) is not
   yet defined — belongs to the BA spec phase, not this brainstorm.
4. Migration/disposition of any existing B2C data or signed-up users, if any exist, is not yet
   addressed — operational detail, not an objectives-level question.

## 6. Orchestrator's Recommended Next Steps (Round 1)

1. Do **not** rewrite `CORE_OBJECTIVES.md` directly. Hand this brainstorm to the CEO Agent as Feature
   Brief input, per the standing CEO → BA → Dev governance chain in `CLAUDE.md`.
2. Explicitly flag in that brief that B2C is killed (hard premise, not a soft deprioritization) so
   the CEO Agent doesn't hedge or try to preserve any retired surface.
3. Resume the paused AI Template Designer brainstorm as the design mechanism for the Type 2 partner
   Designer — these are the same initiative, not separate work.
4. Awaiting Arun's go-ahead to dispatch the CEO Agent with this full context.

---

## 7. Round 2 — Operational & Monetization Requirements (same session, 2026-07-12)

### 7.1 Clerk scope — confirmed
Clerk manages **client/partner admin accounts only** (the people at Capgemini/Pluralsight who log
into Clio to use the Designer/Configurator/billing). It never manages end-user identity in any form.
Confirmed by Arun.

### 7.2 Internal admin page (Clio-side, cross-client operational view)
**Arun's requirement:** One admin page to track, per client: revenue, minutes and LLM/AI usage,
whether they're trending toward exhausting either pool soon, next billing date, whether a card is on
file, and payment type. Explicitly not payment details — Stripe owns that.

**Orchestrator's recommendation:** Build at `/dashboard/admin/clients`, parallel to the existing
`/dashboard/admin/templates` pattern. Per-client row: name/tier/contract status, revenue (lifetime +
current period), balance (minutes and AI-credits remaining/used), a **burn-rate projection**
(days-until-exhausted per pool, computed from recent usage velocity, sortable so "at risk" clients
surface without manual checking), next billing date (from the Stripe subscription/invoice object),
and payment method on file (yes/no + card brand/last4 + payment type — sourced from Stripe's
PaymentMethod object by reference, never raw card data).

### 7.3 Partner-facing dashboard + usage ledger — open question, not yet resolved
**Arun's requirement:** Each client gets the Designer/Configurator/Template Designer plus a dashboard
showing end-user usage details. Since Clio doesn't save end-user info, usage has to be sent to the
partner via API POST whenever it happens — per-session minute usage, and each LLM-generation event
(topic, session/content, prerequisite generation) recorded separately.

**Orchestrator's recommendation:** Distinguish "end-user identity" (never stored by Clio — confirmed
policy) from "usage transaction records" (session/topic/content/prerequisite events, minutes,
timestamps, keyed to an **opaque** session/end-user reference, no name/email). Clio needs to persist
that ledger — it's what powers both this dashboard and the admin page in 7.2, and what billing runs
against. Each ledger write should simultaneously update the partner's Clio-hosted dashboard and fire
a **signed webhook POST** to the partner's own API (same signature-verification standard as the
existing Stripe/Twilio handlers), so the partner can correlate it with their own identity data if
they want deeper analytics on their side.

**Not yet resolved:** does Arun intend true zero-storage on Clio's side (dashboard/billing numbers
computed live by round-tripping to the partner's API instead), or is the ledger-with-opaque-reference
model above what he meant? Orchestrator flagged this as materially different and is awaiting Arun's
answer.

### 7.4 Pricing / credit model — DECIDED: Option B (single unified wallet)
**Arun's requirement:** A single payment splits into two credit pools (voice-minutes, AI/LLM usage) —
example given: $20 → $15 voice / $5 AI, adjustable down to 100%/0%. Requested recommendations on
charging structure, the pool split, and enterprise tiering (small / medium / large org price tags).

**Orchestrator's recommendation, presented as an alternative — Arun confirmed Option B:**
- ~~Option A (Arun's original framing): dual pools, allocated at purchase time.~~ Rejected — risked
  stranded credit (a partner exhausts one pool while holding unused balance in the other, forcing an
  unplanned second purchase).
- **Option B (DECIDED):** a single unified credit wallet, metered at different published burn rates
  per product (per voice-minute rate, per LLM-generation-call rate). No upfront split decision
  needed — the wallet reflects actual usage mix automatically, and the 80%-threshold alert only has
  to watch one number. Same pattern Twilio/OpenAI-style usage-metered platforms use.
- **Blocking gap, still open:** actual per-unit burn rates depend on Clio's real COGS (Hume/Recall.ai
  per-minute cost, Claude per-call cost), which Orchestrator does not have and should not estimate
  with false precision. Still needed from Arun (or deferred to BA phase) before rates can be set.
- **Enterprise tiering recommendation:** structure by commitment size and support level, not feature
  gating (features stay uniform per the "one flexible API" decision in Section 2, Q4):
  - *Self-serve / small org* — pay-as-you-go, no minimum, standard rate, card-only via Stripe, no
    dedicated support
  - *Mid-market* — monthly minimum commitment unlocks a volume discount, still self-serve, priority
    support channel
  - *Enterprise* — annual contract, negotiated volume discount, dedicated contact, invoicing/ACH
    option in addition to card, assisted SSO and custom-domain setup

### 7.5 Custom domain / subdomain architecture — recommended, not yet confirmed
**Arun's requirement:** If a partner registers a domain or subdomain and configures it, the API
send/receive should work without further development effort per new partner.

**Orchestrator's recommendation:**
1. **Subdomain-first as the zero-friction default** — partner picks a slug in the Configurator (e.g.
   `capgemini.getclio.ai`), live instantly on Clio's existing wildcard domain/cert, no DNS work by
   the partner.
2. **Custom domain as an upgrade path** — partner enters their own domain, Clio calls the **Vercel
   Domains API** to register it, shows the CNAME/TXT record to add, Vercel auto-issues SSL on
   verification. Matches the existing Vercel-hosted stack, not new infra.
3. **Tenant resolution at the edge** — Next.js middleware reads the `Host` header per request, looks
   up the owning partner via a `custom_domain` column, injects tenant context. Same pattern as
   Vercel's own multi-tenant "Platforms" reference architecture.
4. Outbound direction (Clio → partner API for content/profile/usage webhooks) is simpler — just a
   settings field (base URL + auth token), no DNS/cert work since it's the partner's own
   infrastructure receiving the call.

### 7.6 Onboarding wizard — recommended, not yet confirmed
**Orchestrator's recommendation:** Yes. A linear guided wizard for first-time setup (Questionnaire →
Topics → Content → Visualization → Domain → Payment method → Go-live) with save-and-resume, since B2B
buyers often loop in IT/design stakeholders mid-setup. The domain-verification step should be
non-blocking (continue configuring other steps while DNS propagates). After initial setup, drop the
wizard framing — configuration becomes directly editable via the Configurator, not a repeated wizard
flow.

## 8. Open Items Not Yet Resolved (Round 2)

1. Ledger storage model (7.3) — opaque-reference usage ledger on Clio's side vs. true zero-storage
   with live round-trips to the partner's API. Awaiting Arun's answer.
2. ~~Credit model (7.4)~~ — **DECIDED 2026-07-12: Option B, single unified wallet.**
3. Real COGS figures for voice-minutes and per-LLM-call cost — needed to set actual credit burn
   rates and tier pricing; not something Orchestrator has or should estimate.
4. Subdomain-first-with-custom-domain-upgrade (7.5) and the wizard (7.6) — both recommended by
   Orchestrator, not yet explicitly confirmed by Arun.

## 9. Not Yet Done

- No CEO Feature Brief written.
- No BA Requirement Document written.
- No changes to `CORE_OBJECTIVES.md`, code, or schema.
- Awaiting Arun's confirmation on Round 1 and Round 2 open items before CEO Agent dispatch.
