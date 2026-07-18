# Feature Brief: B2B-20 — Configurator Left-Nav Restructuring (replace the linear wizard)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-17

---

## What Arun Said (verbatim, 2026-07-17)

> "i dont want Questionnaire, Topics, Content, Visualization, Domain, Payment [, Go-live] like a
> wizard. group them and categorize them accordingly and have a left pane from where user selects and
> updates the options. make it intuitive, use claude design to design it very modern and smooth and
> responsive. all screens in our application has to be responsive and smooth and mobile friendly."

---

## The Problem Being Solved

Today the partner configures Clio through **two entirely separate UI patterns** covering nearly the
same set of config areas, and the primary one — the first-run experience — is a **forced linear
wizard**. That is the wrong shape for a configuration surface. A partner setting up (or, more often,
*returning to adjust*) their integration should be able to look at everything they can configure in
one glance and jump straight to the thing they want to change — the way any modern SaaS settings
dashboard works — not be marched through seven steps in a fixed order.

Two concrete problems:

1. **Forced linearity.** The wizard (`WizardClient.tsx`) sequences `questionnaire → topics → content
   → visualization → domain → payment → go_live` and gates forward movement (`Continue →` /
   per-step `advance` validation, `partner_onboarding_progress` save-and-resume). Its step indicator
   already lets a partner click *back* to completed steps, but forward sections stay locked until the
   prior one is done. Arun wants free-form navigation: a **left pane** the partner selects from, with
   the chosen section's options in the main panel.

2. **Two-pattern duplication.** The wizard is onboarding-only. A *second*, unrelated pattern —
   the Configurator Home (`HomeClient.tsx`) — appears only *after* go-live, showing the config areas
   as a **flat grid of cards**, each a separate full-page navigation. So the same partner learns one
   navigation model to set up and a different one to maintain. Arun's phrase "selects **and updates**
   the options" points at one persistent surface for both.

This is squarely in service of **CORE_OBJECTIVES v3, Objective 4** — "the partner can configure
everything easily in our portal… After configuration they need not use our application." A single,
intuitive configuration surface *is* that objective made real.

---

## What Success Looks Like

- The partner opens the Configurator and sees a **persistent left pane** listing every config
  section, **grouped into a small number of sensible categories** (not a flat list of seven).
- They can **click directly into any section** and edit it; the main panel swaps to that section
  **smoothly**. No forced order, no locked-until-previous gating for navigation.
- Each section shows a **completion indicator** (done / incomplete) so the partner still knows what's
  finished — the wizard's completion tracking carries over *in spirit*, just not as a linear gate.
- **"Go Live" still exists as a deliberate activation action** that validates the required sections
  are complete before flipping the partner live — but it is an action the partner takes when ready,
  not the terminal step of a forced march.
- The whole thing is **genuinely modern, smooth, and fully responsive/mobile-friendly** — the left
  pane collapses/hides appropriately on small screens; nothing is horizontally clipped on a phone.
- Every existing section still does exactly what it does today (Questionnaire builder, Topics,
  Content, Visualization, Domain, Payment/plan selection, Go-live). This is a **navigation/layout
  restructuring, not a rebuild of any section's internals.**

---

## What I Found In the Code (so the BA doesn't re-derive it)

I traced the current implementation before writing this. Key facts the BA must build on:

**A. The `embedded` reuse pattern is real and current.** Each shared section client
(`QuestionnaireBuilderClient`, `TopicsConfigClient`, `ContentConfigClient`, `VisualizationClient`,
`DomainConfigClient`) accepts an `embedded?: boolean` prop: when `embedded`, it renders bare content;
otherwise it wraps itself in `<ConfiguratorShell>`. The wizard already renders all five this way
inside its panel. **This same discipline is how the new left-nav panel should host each section** —
reuse the section components as-is, do not fork them.

**B. The two surfaces do NOT cover the same section set — there's a real asymmetry the BA must
reconcile:**
- **Wizard** (7 items): Questionnaire, Topics, Content, Visualization, Domain, **Payment**, **Go-live**
- **Home** (6 items): Questionnaire, Topics, Content, Domain, **Integration**, Visualization

So **Integration** exists only on Home (and its client has *no* `embedded` prop — it never went
through the wizard), while **Payment** and **Go-live** exist only in the wizard. A unified left-nav
must decide where all eight things live. (Payment is already the B2B-13 plan-tier + top-up step;
Integration is API credentials/OAuth clients.)

**C. The routing gate.** `configurator/page.tsx` redirects to `/wizard` when
`partner_accounts.onboarding_completed_at` is null, else renders Home. The two surfaces are today
**temporally mutually exclusive** per partner — wizard before go-live, Home after. Any unification
changes this redirect.

**D. Responsive today = effectively none.** Every Configurator file is built with **inline
`style={{}}` objects**, hardcoded pixel padding (`'16px 32px'`, `padding: 32`), fixed `maxWidth`, and
a hardcoded `gridTemplateColumns: 'repeat(3, 1fr)'` on Home. Inline styles **cannot express media
queries**, so the surface is not mobile-capable as written. This matters: delivering the responsive
requirement is not a tweak — the new shell needs an actual responsive mechanism. Note that per
CLAUDE.md the project's declared styling standard is **Tailwind** ("no custom CSS files"), yet these
Configurator screens diverged into inline styles. Framer Motion is approved and available but **not
currently imported anywhere in the Configurator** — smooth section-switching can be done with it or
with CSS transitions; **no new dependency is required** either way.

**E. Non-linear navigation is already half-built.** The wizard's `StepIndicator` supports
click-to-jump for any *completed* step. The gap is only that forward/incomplete steps are locked and
that the layout is a top step-rail rather than a left pane.

---

## My Recommendation on the Structural Question (unify vs. redesign-wizard-only)

The BA task raised the genuine architectural question: redesign the wizard alone (leaving the
separate card-grid Home in place), or **unify both into one persistent left-nav surface** used for
both first-run setup and ongoing editing?

**My recommendation: unify.** One left-nav Configurator surface, used both during initial setup and
forever after. Reasoning:
1. Arun's own words — "selects **and updates** the options" — describe an ongoing-editing surface,
   not a one-time funnel.
2. **CORE_OBJECTIVES Objective 4** wants a single "configure everything easily" portal; two divergent
   navigation models for the same config areas is the opposite of that.
3. It eliminates the two-pattern duplication permanently instead of leaving a redesigned wizard beside
   a stale card grid — and it neatly dissolves the non-responsive `repeat(3,1fr)` Home grid, since the
   card grid is *replaced* by the left nav rather than needing its own mobile fix.
4. The pieces are already close: the shared screens support `embedded`, and the step indicator
   already does jump-to-completed.

I'm confident enough in this direction to make it the **recommended basis for the spec** — but it is
structurally significant (it changes the first-run funnel and the `onboarding_completed_at` redirect),
so I am **not locking it as immovable**. If, while speccing, the BA finds a real reason unification
harms the first-run conversion/activation path (e.g. brand-new partners genuinely need a guided order
to not bounce), stop and escalate to me before proceeding — that becomes an Arun-level call.

**Proposed grouping (relationship-based, for the BA to validate — not final).** Group by what each
section actually configures:
- **Learning setup** — how end users enter and what gets taught: *Questionnaire, Topics, Content*
- **Presentation & delivery** — how it looks and where/how it's reached: *Visualization, Domain,
  Integration*
- **Billing** — funding the usage: *Payment / Plan*
- **Go Live** — not a category but a **pinned activation action** in the nav (validates required
  sections, then activates)

The BA owns finalizing the grouping (with a wireframe and a labeled example of each group) — including
resolving where Integration, Payment, and Go-live sit in the unified model.

---

## Known Constraints (from Arun + CLAUDE.md — enforce these)

1. **Do NOT touch B2B-16's top-level nav** (`ConfiguratorNavShell`: the Configurator / API / Docs
   tab row and billing-health banner). This brief restructures the layout **inside** the Configurator
   tab's content area, beneath that nav — not the nav above it.
2. **Do NOT change the design system's colors or typography.** Work within the existing `COLORS`
   token set in `_shared.tsx` (dark-void `#080808`, surface `#111111`, purple `#7C3AED` accent). The
   ask is interaction design and visual polish — spacing, hierarchy, hover/active states, smooth
   section-switching — at a modern SaaS-dashboard bar, **not a new brand**.
3. **No new npm dependencies** without explicit written justification. Confirm the existing stack
   (Tailwind, Framer Motion, Lucide) covers smooth transitions before reaching for anything new — it
   does.
4. **Preserve all sections' functionality.** Reuse each section's existing component via the
   `embedded` pattern; do not rebuild what any section does internally.
5. **Implement literally.** This is a layout/navigation restructuring. No new configuration
   capabilities, no speculative AI-populated screens, nothing outside CORE_OBJECTIVES scope.

---

## Scope Boundary — the app-wide responsive statement is NOT in this brief

Arun's instruction has two parts and I am deliberately splitting them:

- **(a) In scope here:** the new left-nav Configurator layout this brief produces must be **fully
  responsive and mobile-friendly** — a hard acceptance requirement of B2B-20, scoped to the new shell
  and its navigation behavior.
- **(b) NOT in scope here:** "all screens in our application has to be responsive and smooth and
  mobile friendly." That is an app-wide audit of *every* existing screen (marketing, admin, session
  surfaces, developer portal, etc.) — a large, separate undertaking. Folding it silently into this
  brief would balloon and stall it. **I am flagging it as its own future brief — candidate
  "B2B-21 — App-wide responsive / mobile audit"** — for Arun to sequence separately. Orchestrator:
  log B2B-21 as a proposed follow-on in `docs/b2b-pivot-status.md`; do not begin it under this brief.

One honest note for that future brief: the Configurator's inline-style approach (finding D above) is
likely representative of other screens, so the app-wide effort may be as much a styling-mechanism
migration as a per-screen tweak. That's context for B2B-21, not work for B2B-20.

---

## Questions for the BA to Resolve (Section 11 must end empty before dev)

These are the genuine open questions I need the Requirement Document to answer — with wireframes and
concrete examples, not prose:

1. **Unification confirmation & the first-run path.** Assuming my "unify" recommendation: what does a
   *brand-new* partner (nothing configured) see on first entry vs. a *returning* partner? Same
   left-nav surface for both? If the first-run needs any lightweight "start here" affordance (e.g. an
   empty-state highlight, a suggested-order hint) short of a forced gate, spec it explicitly. What
   happens to the `configurator/page.tsx` `onboarding_completed_at` redirect?

2. **"Go Live" in a non-linear model.** Where does Go-live live in the left nav (pinned action?
   footer button? its own always-visible item?), what exactly does it validate as "required"
   (which sections are mandatory vs. optional/skippable — the wizard currently allows "Skip for
   now"), and what's the post-go-live state of the nav (does the surface change at all, or is it
   identical, just with the partner now live)?

3. **The section-set asymmetry (finding B).** In the unified nav, where do **Integration**
   (currently Home-only, no `embedded` support), **Payment** (currently wizard-only), and **Go-live**
   each sit? Integration's client will need an `embedded` path added — confirm that's in scope as a
   mechanical addition (I believe it is; it's the same pattern, not a rebuild).

4. **Final grouping & labels.** Validate or revise my proposed 3-groups-plus-Go-Live structure, with
   a wireframe showing each group, its section items, and the category labels the partner actually
   sees.

5. **Completion indicators.** What signals "done" per section? The wizard relies on
   `partner_onboarding_progress` + a couple of live-checkable endpoints (published-questionnaire
   count, domain subdomain slug), and explicitly *cannot* cheaply derive done/not-done for
   topics/content/visualization/payment (those GETs return default-filled values, not null). Spec how
   each section's indicator is computed without adding heavy new read paths — reuse the existing
   progress model where possible.

6. **Responsive behavior, concretely.** Left-pane behavior at desktop / tablet / mobile widths
   (persistent? collapsible? off-canvas drawer with a hamburger?), and the styling mechanism for the
   new shell given the inline-style reality (finding D). Do the reused `embedded` section internals
   get touched for responsiveness, or only the new shell/nav? (My steer: keep section internals
   as-is for this brief; make the new shell + nav responsive; note any section that visibly breaks on
   mobile as a B2B-21 candidate rather than fixing it here — except where unification already removes
   the offending layout, like Home's 3-col card grid.)

7. **Motion spec.** Define the section-switch transition (Framer Motion vs. CSS), hover/active states
   on nav items, and the collapse/expand animation — concrete enough that "smooth" is testable, not
   subjective. Confirm no new dependency.

---

## CEO Review Gate

Per the governance chain, I will review the completed Requirement Document before any developer
starts. I will **not** approve it if Section 11 has open questions, if the grouping is described in
fewer than three lines without a wireframe, or if the responsive behavior is asserted rather than
specified per breakpoint. Send it back to me when all twelve sections are filled and every question
above is answered with an example.
