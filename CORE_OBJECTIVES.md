# Clio — Core Business Objectives

Version: 3.0 | Owner: Arun | Date: 2026-07-17
Status: APPROVED AS THE FINAL OBJECTIVE — referenced at every Feature Brief, every sprint review,
every build validation.
Supersedes: v2.0 (approved 2026-07-13, `docs/specs/B2B-01-requirement-document.md`). v2.0 remains a
valid, more detailed elaboration of the same pivot; where v3 and v2.0 differ in *scope emphasis*, v3
governs — it is Arun's own restatement of what the product is and, explicitly, what it is *not*.

> These are non-negotiable product principles. Every Feature Brief, every build, every sprint must be
> validated against these. A build that breaks any of these, or that adds surface outside the scope
> Arun has drawn here, is not shippable without a new explicit instruction from him.

---

## How to read this document

This version is written **around Arun's own five numbered points**, captured verbatim on 2026-07-17,
plus a sixth item (super-admin + sales-partner system) that he explicitly asked to be **held in the
backlog for its own brainstorm**, not built yet.

Two things carry forward from v2.0 unchanged and still bind, because Arun did not retract them and
they are load-bearing for the whole model — they are restated in condensed form below rather than
dropped:

- **B2C is killed** (hard premise, anti-resurrection clause).
- **The Non-Negotiable Data Boundary** (Clio computes signal; Clio is never the system of record for
  partner or end-user data).

The detailed objective-by-objective elaboration (the "Six Objectives," the two-partner-archetype
matrix, the falsifiable test cases) lives in v2.0 / `docs/specs/B2B-01-requirement-document.md` and is
**not contradicted** by v3 — v3 is the sharper statement of *scope*, not a replacement for that
mechanism-level detail.

---

## Carried Forward From v2.0 (still binding)

### Hard Premise: B2C Is Killed
Clio's original B2C product — self-serve individual sign-up, consumer landing/pricing pages, gamified
engagement (AI Readiness Score, streaks), scheduled SMS/email delivery, individual Clerk accounts as
the product entry point — is **retired, not paused**. No agent may resurrect any B2C surface, copy,
flow, or schema by inferring intent from git history, `archive/b2c-legacy`, or prior sessions.
Resurrecting any of it requires a new, explicit instruction from Arun.

### The Non-Negotiable Data Boundary
**Clio computes signal. Clio never becomes the system of record for partner or end-user data.** The
sole exception is de-identified interaction transcripts, retained only for Clio's own
quality-improvement and prompt-tuning, carrying no user-identifying information. Everything
else — end-user identity, learning profile, generated content, session history — is either never
stored by Clio, or computed and pushed to the partner's own database via the partner's API (opt-in per
partner, per configuration toggle). This holds regardless of how the internal usage-ledger question is
resolved. (Verbatim source and full falsifiable statement: v2.0.)

---

## What Clio Is (Arun's Own Framing, 2026-07-17)

Clio is an **AI Voice Learning Infrastructure that is completely configured, controlled, and
implemented through an API. It is API-driven.** A partner or customer configures everything in Clio's
portal once; after configuration they need not use the application again — the running product is
driven entirely through the API. Clio itself keeps a dashboard for its *own* internal use (targeting,
oversight).

---

## The Five Objectives (Arun's Numbered Points, Verbatim Intent)

### Objective 1 — API-Driven Voice Learning Infrastructure
> "Ours is an AI Voice Learning Infrastructure that can be completely configured, controlled and
> implemented through API. It is API-driven."

Every capability Clio offers must be reachable and drivable through the API. The portal
(Configurator) exists to *configure*; the API exists to *run*. No capability may exist that is only
reachable through Clio's own UI with no equivalent API path. The UI is a display and configuration
layer over the API — never a required runtime path.

### Objective 2 — The End-to-End Session Call Flow (the product's spine)
This is the exact flow Arun specified. It is stated here as the canonical sequence every build serves:

1. **Partner initiates a call** with the meeting details — meeting URL and ID.
2. **Partner provides the content to explain:**
   - Title, sub-title, and the content to explain.
   - HTML pages accessible through authentication (with the auth/certification details or credentials
     needed to reach them), and/or images.
   - The partner may pass **multiple pages or images**, and must be able to **specify the sub-title
     (transition point) at which the bot should transition from the previous page/image to the next**.
   - This material is **rendered during the call through Clio's headless browser.**
3. **Clio's bot joins the call**, explains the information, and **transitions the page/image as it
   progresses through the content**, driven by the sub-title transition points.
4. **Clio captures the transcript.**
5. **Clio's application ends the call** after the session.
6. **After the call**, Clio fetches the transcript and **provides the customer real insights** —
   questions asked, and user analysis.
7. **Glitches in Clio's own application are logged** so Clio can fix them. This log must support
   constant analysis for frequent issues, **status of issues tracked to closure**, and **root-cause
   analysis**.

### Objective 3 — This Is the Only Scope
> "The above are the only scope that we need to perform."

Objective 2's call flow is the **complete and exclusive product scope.** Anything not in service of
that flow is a candidate for removal, not a feature to preserve by default. New capability outside
this flow requires a new explicit instruction from Arun — it is not added because it "seems useful" or
because it already exists in the codebase.

**Pricing is charged by the minutes the partner uses Clio's AI Voice bot.** The pricing model must be
analyzed thoroughly against this per-minute basis. (See the Gap Analysis note on how any bundled/plan
pricing must reconcile to this per-minute statement.)

### Objective 4 — Configure Once in the Portal, Then Run by API
> "We need to build our application so the partner can configure everything easily in our portal.
> After configuration they need not use our application. But we can have a dashboard that we will use
> to target."

- The partner configures **everything** they need, easily, in Clio's portal.
- After configuration, the partner does **not** need to return to Clio's application — the product
  runs through the API.
- Clio retains a **dashboard for its own internal use** ("that we will use to target"). This is
  Clio's, not the partner's operational surface.

### Objective 5 — Keep / Reuse / Remove To Fit This Scope
> "Whatever we need to keep it, reuse it — we will do it. Whatever is not applicable or we don't need,
> we can remove it."

The existing codebase is treated as raw material. Anything that serves Objective 2's flow is kept and
reused. Anything that does not is a **named candidate for removal** — surfaced for Arun's review, never
auto-deleted (per the standing "no delete without approval" rule). The Gap Analysis
(`docs/scope-gap-analysis-2026-07-17.md`) is the first pass at drawing that keep/remove line.

---

## Backlog (Held for its Own Brainstorm — NOT a Built Objective)

### Two-Tier Admin System — Super-Admin + Sales-Partner Program
> "We need 2 types of admin page. 1) A super-admin page for me which will give me complete control,
> insights and view on each and every partner, details of the sales partner who brought it, % of
> sales that goes to them — which means we need a way to onboard our sales partner and enter the % of
> sales they will get, deducting expenses. We need a digital agreement that they will sign to get
> onboarded as a sales partner. It should define clearly what products they will sell, what they will
> be responsible for, and what geographical location and languages they will be responsible for. We
> will brainstorm more on this but keep this in the backlog."

Arun was explicit that this is **backlog, pending its own brainstorm — not a spec, not a build.**
Captured here so it is not lost. In scope for that future brainstorm:

1. **Super-admin console (for Arun):** complete control, insights, and per-partner visibility across
   every partner account, including which sales partner brought each one.
2. **Sales-partner program:**
   - A way to **onboard a sales partner** and record their **% of sales** (net of expenses).
   - A **digital agreement** the sales partner signs to be onboarded, defining: which products they
     sell, their responsibilities, and their geographic + language territory.

**Governance note:** this item does not enter the CEO → BA → Dev chain until Arun runs the brainstorm
he named. No agent may begin building any part of it from this document alone.

---

## Out of Scope for This Document

This document states objectives and scope boundaries only. It does not specify the partner API
contract, Configurator UI requirements, billing rate tables, domain/white-label infrastructure, or
the super-admin/sales-partner design. Each of those is (or will be) a separately sequenced Feature
Brief. The current build's actual state against these objectives is tracked in
`docs/b2b-pivot-status.md` and assessed in `docs/scope-gap-analysis-2026-07-17.md`.
