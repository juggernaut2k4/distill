# Feature Brief: B2B-03 — Designer/Configurator
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-13

## Series context
Third of five sequenced Feature Briefs for the B2C → B2B/B2B2C pivot (see
`docs/b2b-pivot-status.md` for the full dependency graph). Unblocked now that
B2B-02 (Partner API & multi-tenant architecture) has landed — `partner_accounts`,
`partner_admin_users`, `partner_api_keys`, `partner_sessions`,
`webhook_dispatch_log`, the content/profile push-pull contract, and the
`/partner-render/[clio_session_ref]` route (currently a placeholder stub) all
already exist. This brief builds directly on top of that, does not re-derive it.

Scope precisely — do **not** pull the following into this spec, even though
they touch the same surface area:
- Billing numbers, the unified credit wallet, burn-rate math, enterprise
  tiering, or the `/dashboard/admin/clients` admin page — that is B2B-04. If
  a Designer action should be a billable event (e.g. an AI skeleton
  generation call), this brief specifies *that it fires a `usage_events`
  record via the mechanism B2B-02 already built* — it does not set the price.
- Subdomain provisioning, custom-domain verification, the Vercel Domains API
  integration, or Host-header tenant-resolution middleware — that is B2B-05.
  Where the Designer needs a "your portal's domain" field, treat it as a
  settings value the Configurator UI displays/edits, not infrastructure this
  brief builds.
- The onboarding wizard sequence (Questionnaire → Topics → Content →
  Visualization → Domain → Payment → Go-live) as a guided first-run flow —
  that's B2B-05 per `docs/brainstorm-b2b-platform-pivot.md` §7. This brief
  builds the underlying configuration screens and mechanisms each wizard step
  would drive; it does not build the wizard's step sequencing/save-and-resume
  shell.

Authoritative sources, read in full before starting:
- `CORE_OBJECTIVES.md` v2.0 (repo root), specifically **Objective 3** ("Content
  Static, Script + Visualization Adaptive") — the 3-level configuration model
  (application/product level, template level, component/container level) is
  this brief's structural spine. Objective 3 states explicitly that it
  describes *what* the model must achieve, not *which brief* owns building
  it — this brief is that answer, confirmed by B2B-02's own Out of Scope and
  Dependencies sections (see below). Also read Objective 6 (white-label, zero
  Clio branding) and the falsifiable-test language under Objective 3 (same
  generated content rendered for two partners with different visualization
  config must differ in configured ways; content must never be regenerated
  per end user).
- `architecture.md` Section 5 — names `/partner-render/[clio_session_ref]` as
  a placeholder stub only, and states in its own words: "the point where
  B2B-03 (Designer/Configurator... per CORE_OBJECTIVES.md §Objective 3) must
  pick this up." Section 6 documents the content/profile push-pull contract
  this brief's render path must call.
- `docs/specs/B2B-02-requirement-document.md` Section 10 (Out of Scope) and
  Section 12 (Dependencies) — both sections name this brief directly and
  state the real `/partner-render/[clio_session_ref]` experience (content
  pull, Hume-driving, white-label styling) is B2B-03's scope, "named as a
  direct dependency... not assume it's already solved."
- `docs/brainstorm-b2b-platform-pivot.md` §1.2 (Type 2 / No-Platform Partner
  requirements: Questionnaire, Topics, Visualization) and §0 (this brief
  formally merges the paused 26-requirement AI Template Designer brainstorm
  into the pivot, per Arun's own recommendation there).
- `docs/brainstorm-ai-template-designer.md` — the original 26-requirement
  list in full, and its one explicit open question (quoted below, now
  resolved).
- `.claude/agents/clio/requirement-docs/RTV-04-template-library-and-approval.md`
  — the existing `/dashboard/admin/templates` tool and `template_library`
  table. This is Clio's own **global, single-tenant, Arun-is-sole-approver**
  template gate (0/27 templates currently approved, per
  `MEMORY.md`/`docs/action-items.json`). It has no partner concept at all.
  How partner-configured templates interact with it is a live design question
  this brief must resolve — see "Known Constraints" below, not something
  already answered.

## What Arun Said
Two rounds of direct instruction, both captured verbatim in the dispatch that
produced this brief:

1. **Scope**: "we need to make sure that other partner changes impact all
   other customers so each partner should be isolated and modular (parameter
   driven) from their configuration screen." This is a hard multi-tenant
   isolation requirement — one partner's configuration must never leak into
   or affect another partner's experience. It must be a first-class
   architectural constraint in the BA spec, not an implementation detail left
   to be inferred.
2. **Who uses this tool**: customer/partner-facing, not end-user-facing.
   Partner-admin humans (authenticated via Clerk, the partner-admin scope
   from B2B-01/B2B-02 — never the partner API keys, which are for
   programmatic partner→Clio calls) log in themselves and configure their own
   setup. Their own end users never see or touch this tool.

This resolves the one open question the original brainstorm left unanswered
(`docs/brainstorm-ai-template-designer.md` §2, item 1, quoted verbatim):

> "Internal tool vs. customer-facing. Is this designer meant to stay
> something only you (or an internal admin team) use to build/tune Clio's
> own templates faster — or could it eventually become something Clio's
> customers use themselves (e.g. to customize their own branded template
> library)? This materially changes scope: an internal tool can assume one
> 'user' (you) with one design system (Clio's own brand); a customer-facing
> version needs per-tenant design systems, permissions, and a much higher bar
> on guardrails against a customer breaking their own templates."

**My read: this is resolved, cleanly, in favor of the higher-bar branch.**
Arun's answer ("customer facing but not end-user facing") is the
per-tenant-design-systems-and-permissions branch the original question
flagged as the harder path — and his isolation instruction is exactly the
"guardrail against a customer breaking their own templates [or anyone
else's]" the question anticipated needing. I don't see residual ambiguity
here worth escalating back to Arun; the BA should treat both points above as
settled and build the isolation model the harder branch requires.

## The Problem Being Solved
Today, two things partner-facing configuration depends on exist only as
placeholders or don't exist at all:

1. **No configuration authoring surface.** A No-Platform partner (e.g.
   Capgemini) has no way to build their own onboarding questionnaire, choose
   whether Clio or they supply topics/content, or configure how sessions look
   (theme, template behavior, per-element styling) for their own white-label
   portal. B2B-02 built the auth and data-transport layer these choices would
   flow through; nothing today lets a partner actually make the choices.
2. **No real render path to apply those choices.** `/partner-render/[clio_session_ref]`
   is a static placeholder. Even if configuration existed, nothing pulls
   partner-approved content, applies the partner's visualization config, and
   drives Hume against it with zero Clio branding. Every No-Platform partner
   session — the core Type 2 product — is unbuildable until this exists.
3. **The 26-item AI Template Designer brainstorm has been sitting paused**
   since before the pivot, waiting on exactly the scope question Arun just
   answered. Its content (visual template editing, AI-recommended skeletons,
   free-text template discovery, a preference-learning meter) turns out to be
   the literal mechanism Type 2 partners need — this brief is where that
   merger becomes real requirements instead of a parked brainstorm.

## What Success Looks Like
A BA spec exists that, once built, means:

1. **A partner-admin Configurator UI exists**, Clerk-authenticated,
   partner-account-scoped, reachable only by that partner's own
   `partner_admin_users`. It covers three configuration domains per
   `docs/brainstorm-b2b-platform-pivot.md` §1.2:
   - **Questionnaire builder** — partner authors their own onboarding
     questions/screens (single- or multi-page, partner's choice); Clio
     renders what they build; submissions are forwarded to the partner's own
     endpoint the same way content/profile already push-pull (see Known
     Constraints — this must not become a new persisted-data exception).
   - **Topics** — a toggle: Clio LLM-generates topics vs. partner supplies
     its own list via API/JSON, plus a *separate* toggle for LLM-generated
     vs. partner-supplied prerequisites/topic deltas. Two independent
     toggles, not one combined setting.
   - **Content** — a toggle: Clio LLM-generates session content vs. partner
     supplies predefined content. The spec should determine whether this
     reuses the existing content-generation pipeline
     (`lib/content/generator.ts` family) with a partner-scoped trigger, or
     needs new plumbing — don't assume either without checking.
2. **The 3-level visualization configuration model is implemented**, exactly
   as scoped in `CORE_OBJECTIVES.md` Objective 3 and elaborated by the
   original brainstorm's item 14: application/product level (global theme,
   layout — one setting per partner), template level (properties shared by
   every instance of a given content template for that partner), and
   component/container level (per-element styling and behavior: fill/
   outline/neon, motion, spacing, arrows/connectors for flow templates —
   configurable per element type). Every level must be partner-scoped; a
   change at any level for Partner A must be provably inert for Partner B
   (see Known Constraints — isolation).
3. **AI-assisted template authoring exists**, covering the relevant original
   26 requirements: AI-recommended skeleton generation for new template types
   using the partner's own already-configured design system (items 11, 13);
   data-shape-aware and accessibility-aware template recommendation (items
   18, 19); free-text template discovery, where a partner describes what
   they want and AI maps it to an existing template or flags a genuine gap
   (item 20); quick property editing (color, background, font, spacing,
   motion) without code (items 4–9); and a sample-data/realistic-preview fill
   before publish (items 10, 16). Human override is always available, even
   after a confident AI generation (item 25) — no AI action in this tool ever
   auto-applies without an explicit human confirm step.
4. **A "preference meter" and a separate per-request confidence signal
   exist** (items 23, 26): the meter tracks, per partner, how well Clio has
   learned that partner's taste in color/font/CSS over time; the confidence
   signal is a distinct, shorter-lived "how sure am I about this specific
   request" indicator. A full meter may unlock proactive generation offers
   (item 24), but per item 25, "proactive" still means *offered*, never
   auto-applied.
5. **The real `/partner-render/[clio_session_ref]` experience is built**,
   replacing the B2B-02 placeholder: pulls partner-approved content via the
   existing content-pull contract, applies that partner's 3-level
   visualization config, drives Hume against the pulled content, and renders
   with zero Clio branding (Objective 6). This is explicitly in scope here
   per `architecture.md` Section 5 and the B2B-02 spec's Dependencies
   section — do not treat it as solved or defer it. This is also the one
   piece of this brief that IS end-user-facing (the partner's own end users
   see this render output during a live session) — that is a different
   surface from the Configurator authoring tool itself, which stays
   partner-admin-only per Arun's instruction. The spec must be explicit about
   this distinction so nobody reads "not end-user-facing" as applying to the
   render path too.
6. **Multi-tenant isolation is designed as a first-class mechanism, not
   inferred.** The spec must state concretely how a Partner A configuration
   change is structurally prevented from affecting Partner B — table-level
   `partner_account_id` scoping, query-level tenant guards, or RLS (the BA
   should pick and justify one, consistent with whatever B2B-02 already
   established for `partner_sessions` etc.) — and the acceptance criteria
   must include a test proving isolation (e.g. changing Partner A's
   component-level button styling and confirming Partner B's rendered output
   is byte-for-byte unaffected).
7. **A decision on how partner-authored templates interact with the existing
   `RTV-04` global approval gate** (`template_library`, `/dashboard/admin/
   templates`, Arun as sole approver) — see Known Constraints for my
   recommended default; the spec must state the resolution explicitly, not
   leave it implicit.

## Known Constraints
- **Isolation is non-negotiable and structural, per Arun's own words** quoted
  above — this is the single most important constraint in this brief. Every
  new table this brief introduces must be partner-scoped from creation, not
  retrofitted.
- **The Configurator authoring tool is partner-admin-only; the render output
  it produces is not.** Don't let "not end-user-facing" bleed into how the
  render path (item 5 above) is scoped — that experience is exactly what a
  No-Platform partner's end users see.
- **No new persisted-data exception.** Per `CORE_OBJECTIVES.md`'s data
  boundary (already the charter for B2B-02) and reinforced by the standing
  "Content Generation Timing Rule" project convention (generate in
  background before approval, only *display* after approval — do not persist
  speculative content on undefined or unapproved screens): questionnaire
  submissions, like content and profile, should be forwarded to the
  partner's own endpoint via the existing push-pull shape, not newly
  persisted in Clio's DB as a system-of-record exception. If the BA finds a
  operational reason a thin delivery-log entry is needed (mirroring
  `webhook_dispatch_log`'s audit/retry purpose, not a data-of-record
  purpose), that's fine — spec it as that, explicitly, not as silent scope
  creep.
- **Never let a Designer screen be undefined and AI-filled.** Per this
  project's standing rule against using AI-generated output to populate
  user-facing screens whose content requirements are undefined: the
  Configurator's own UI (its forms, buttons, layout) must be fully specified
  by the BA like any other screen — AI assistance is a *feature the tool
  offers to partners* (skeleton generation, free-text discovery), not a
  shortcut for leaving the tool's own screens under-specified.
- **RTV-04 interaction — my recommendation, not yet Arun-confirmed.** RTV-04's
  `template_library`/approval gate is Clio's own global, single-approver
  (Arun), single-tenant mechanism with no partner concept — it was built
  entirely before partner customization existed and doesn't address it. My
  default recommendation for the BA to spec: (a) partner-level
  *parameterization* of an already-approved base template (color, font,
  spacing, component-level overrides within an existing template type) is
  partner self-serve, instantly live, and never touches `template_library` or
  requires Arun's sign-off — this is "modular, parameter-driven" exactly per
  Arun's own framing; (b) a partner requesting or AI-generating a wholly
  *new template type* (brainstorm items 3, 11, 12 — not a parameterization of
  an existing one) is a different case, since it becomes a new reusable
  skeleton, not just a settings change, and I'm not confident it should ship
  live without any review. If the BA's design of (b) genuinely forks between
  "needs no review," "needs the partner's own internal review," or "needs a
  partner-scoped analog of the RTV-04 gate," **that finding should come back
  to me rather than being silently resolved** — this bears on brand/quality
  risk exposure for Clio even though it's the partner's own brand being
  rendered, and Arun already established himself as the sole approver for
  Clio's global template set, which signals he cares about this control
  point. I am not confident enough in a single answer to (b) to hand it to a
  developer as settled; I am confident enough in (a) to let the BA spec it
  directly.
- **Vendor/meeting-bot abstraction still applies.** The render path (item 5)
  sits downstream of `MeetingBotProvider` per B2B-02's contract — do not
  hardcode Recall.ai or Attendee specifics into this brief's scope.
- **Billable Designer actions must use the existing usage-event mechanism.**
  Per `docs/brainstorm-b2b-platform-pivot.md`'s billing model (itemized:
  AI/LLM generation calls + voice-minutes), any AI action in this tool that
  should be a billable "generation call" (skeleton generation, free-text
  mapping, sample-data fill) must fire a `usage_events` record via B2B-02's
  existing mechanism — this brief does not set a price, but it must not
  invent a parallel, unmetered path either.

## Questions for BA
1. **Content-generation reuse** — confirm whether the "Content toggle"
   (LLM-generates vs. partner-supplied) hooks into the existing
   `lib/content/generator.ts`/personalizer pipeline with a partner-scoped
   trigger, or needs new plumbing. Technical judgment call, your authority;
   just don't assume without checking, since that pipeline currently has no
   partner concept at all.
2. **Preference-meter mechanics** — what specifically increments/decrements
   it, and what "full" means before proactive-generation offers (item 24)
   unlock. This is a genuine design-space question with no wrong answer in
   the source material; use your judgment and document it concretely enough
   to be testable.
3. **Free-text template discovery's "flag a gap" path** (item 20) — when AI
   can't map a partner's free-text request to any existing template, what
   happens? Does it queue as a request for AI-recommended skeleton generation
   (item 11) automatically, or surface as a distinct "no match" state
   requiring the partner to explicitly choose next steps? Your judgment;
   just make it concrete, not left as prose.
4. **RTV-04 interaction, branch (b)** — see the dedicated Known Constraints
   item above. Follow that instruction: spec branch (a) directly, and if
   branch (b) forks in a way that isn't a simple "partner self-review before
   publish," escalate that specific finding to me rather than picking an
   answer you're not confident in.
5. **Isolation mechanism choice** (RLS vs. application-level tenant guard vs.
   both) — technical decision within your authority, but the spec must name
   one concretely and the acceptance criteria must include an isolation
   proof test as described under "What Success Looks Like" item 6.

## Approval note
I've read `CORE_OBJECTIVES.md` v2.0 (Objective 3 and Objective 6 in full),
`architecture.md` (Sections 5 and 6 specifically, plus the full auth/table
model), `docs/specs/B2B-02-requirement-document.md` (Sections 10 and 12
specifically), `docs/brainstorm-b2b-platform-pivot.md` §0, §1.2, and §7,
`docs/brainstorm-ai-template-designer.md` in full including its one open
question, `docs/b2b-pivot-status.md`'s current Live Status table, and
`.claude/agents/clio/requirement-docs/RTV-04-template-library-and-approval.md`
in full before writing this brief.

I'm confident in Arun's two direct scope decisions (customer/partner-facing
not end-user-facing; hard per-partner isolation) and have written them as
settled, non-negotiable constraints above — I don't believe either needs to
go back to him. The one item I'm genuinely not confident resolving myself is
the RTV-04 interaction for wholly-new partner-generated template types
(branch (b) above); I've given the BA a recommended default for the
lower-risk case and an explicit instruction to escalate the harder case back
to me rather than guess, so it doesn't silently ship either fully gated or
fully open. I will review the completed Requirement Document against this
brief and against `CORE_OBJECTIVES.md` Objective 3's falsifiable test before
approving it for build.
