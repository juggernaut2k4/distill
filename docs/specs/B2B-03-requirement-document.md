# B2B-03 — Designer/Configurator
# Requirement Document

Version: 1.1
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-13

Changelog: v1.1 — incorporated the CEO Agent's resolution of Section 11 Q1 (RTV-04 interaction, branch
(b): wholly-new partner-authored template types). Section 11 is now empty; Sections 6.4, 7, 8, 10, and 12
updated accordingly. See Section 11 for the resolution summary.

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-03-designer-configurator.md`
Authoritative source material (all read in full): `CORE_OBJECTIVES.md` v2.0 (Objectives 1–3, 6
specifically), `architecture.md` Sections 1–11 (B2B-02, read in full — this document extends it with
a new Section 12 rather than duplicating it), `docs/specs/B2B-02-requirement-document.md` (Sections 4,
6, 9, 10, 12 specifically), `docs/brainstorm-b2b-platform-pivot.md` §1.2, §7.5, §7.6,
`docs/brainstorm-ai-template-designer.md` (all 26 requirements), `.claude/agents/clio/requirement-docs/
RTV-04-template-library-and-approval.md` (full — the existing global approval gate this document must
interact with), `docs/b2b-pivot-status.md` Live Status table, and the following live code, read
directly rather than assumed: `lib/partner/auth.ts` (`requirePartnerAdmin`, `requirePartnerApiKey`),
`lib/partner/render-data.ts` (`pullPartnerContent`, `pullPartnerProfile` — already built and tested,
not yet wired into any render experience), `lib/partner/session-init.ts`, `app/partner-render/
[clio_session_ref]/page.tsx` (the current placeholder stub this document replaces), `lib/content/
session-content-generator.ts`, `lib/content/script-generator.ts`, `lib/templates/generator.ts`,
`lib/templates/selector.ts`, `lib/templates/types.ts`, `lib/content/generator.ts` +
`lib/content/personalizer.ts` (the retired B2C daily-tip pipeline — read specifically to confirm it is
**not** the reuse target for this brief's Content toggle, see Section 6), `supabase/migrations/
071_b2b02_partner_accounts_and_api_keys.sql` and `072_b2b02_usage_events_resolution_a.sql` (exact
current schema, extended by this document, not re-derived).

Companion artifact produced alongside this document: `architecture.md` Section 12 (new) — exact table
schemas, API route map, and the render-path sequence flow. Per the precedent `docs/specs/
B2B-02-requirement-document.md` set, this document states requirements and acceptance criteria;
`architecture.md` states the design that satisfies them. Where the two could ever drift, `architecture.md`
is the implementation-detail source of truth.

---

## Template Adaptation Note

This brief spans two genuinely different kinds of surface — a partner-admin authoring tool (Configurator,
several screens) and a single end-user-facing live-session render experience — plus one end-user-facing
questionnaire-rendering surface. The standard template is applied in full for all of these; Section 4/5
are organized by surface (4.A Configurator, 4.B End-user Questionnaire render, 4.C Live-session render)
rather than by a single linear flow, because that is how a developer will actually build and test them
(different auth models, different audiences, different design languages).

---

## 1. Purpose

Two things partner-facing configuration depends on exist today only as placeholders or not at all.
First: a No-Platform partner (Capgemini) has no way to author their own onboarding questionnaire,
choose whether Clio or they supply topics/content, or configure how sessions look (theme, per-template
behavior, per-element styling) for their own white-label experience — B2B-02 built the auth and
data-transport layer these choices flow through, but nothing today lets a partner actually make them.
Second: `/partner-render/[clio_session_ref]` is a static placeholder — even once configuration exists,
nothing pulls partner-approved content, applies a partner's visualization configuration, or drives Hume
against it with zero Clio branding.

**Failure without this document:** every No-Platform partner session — the entire Type 2 product, one
of Clio's two equally-first-class partner archetypes per `CORE_OBJECTIVES.md` — remains unbuildable.
Separately, the 26-item AI Template Designer brainstorm (paused since before the pivot) never converts
into buildable requirements, and Objective 3's 3-level configuration model (application/template/
component) remains a described-but-unimplemented mechanism, meaning Objective 3's own falsifiable test
("the same generated content, rendered for two partners with different visualization config, differs in
configured ways") cannot be verified because nothing implements per-partner rendering at all yet.

## 2. User Stories

**Story 1 — Partner-admin, first-time configuration (e.g. Capgemini's design lead)**
As a Clerk-authenticated partner-admin logging into Clio's Configurator,
I want to author my own onboarding questionnaire, choose where topics/prerequisites/content come from,
and set my brand's theme, template, and component-level styling,
So that my own end users experience a fully white-labeled product with zero visible Clio branding,
without needing engineering effort from Clio for each choice.

**Story 2 — Partner-admin, AI-assisted customization**
As the same partner-admin, working faster than hand-tuning every CSS property one at a time,
I want AI to propose realistic sample-filled previews, recommend the best-fit existing template for data
I describe, and map free-text descriptions of what I want to show onto Clio's template library,
So that I get speed without losing final say — nothing I didn't explicitly confirm ever goes live.

**Story 3 — A partner's end user, filling out the partner's questionnaire**
As an employee of Hartford Insurance (Capgemini's sub-tenant) who has never heard of Clio,
I want to answer Capgemini's own onboarding questions in a screen that looks and behaves like
Capgemini's own product,
So that I never see or need to know a third-party AI vendor is involved.

**Story 4 — A partner's end user, in a live session**
As the same Hartford employee, now in a live Google Meet session Clio's AI has joined,
I want the visuals, colors, and narration style to look and feel like Capgemini's own branded product,
narrated in a voice/persona that never announces itself as "Clio,"
So that the experience is indistinguishable from a first-party Capgemini product.

**Story 5 — Arun (existing RTV-04 sole design approver)**
As the person who personally reviews every visual design Clio's own template library ships,
I want a partner's ability to parameterize (not fork) an already-approved base template to require no
new sign-off from me — since it changes only CSS-level properties, not the underlying skeleton I already
approved — while anything that creates a genuinely new template skeleton stays gated until I've resolved
how that case should work,
So that partners move fast on the low-risk case without me becoming a bottleneck, while the
higher-risk case (a wholly new AI-authored skeleton reaching real end users) never ships without an
explicit answer from me first.

## 3. Trigger / Entry Point

This brief has multiple independent entry points, grouped by auth model:

- **Configurator (Clerk-authenticated partner-admin):** `/dashboard/configurator` and its sub-routes
  (Section 4.A). Reachable only after Clerk sign-in; every route additionally requires a
  `partner_admin_users` row for the `partner_account_id` being edited (enforced by the existing
  `requirePartnerAdmin()`, `lib/partner/auth.ts`, reused verbatim, not reimplemented). `middleware.ts`
  is extended to add `/dashboard/configurator/*` and `/api/admin/configurator/*` to its Clerk-protected
  route set (the same one-line pattern B2B-02 used to add `/api/admin/partner-keys*`).
- **End-user questionnaire render:** `GET /partner-questionnaire/[partner_account_id]`, triggered when
  a partner's own end user is directed there by the partner's own product (URL is Clio-hosted today;
  once B2B-05 lands, the same content resolves under the partner's own domain via Host-header
  middleware — this document does not build that routing, only the content it will route to). No auth —
  matches the partner's own end-user-identity model (Clio has none, per the Non-Negotiable Data
  Boundary).
- **Live-session render:** `GET /partner-render/[clio_session_ref]`, triggered by the meeting-bot's
  headless browser exactly as B2B-02 already built (`dispatchMeetingBot()` passes this URL to
  `createBot()`) — this document replaces the placeholder page body, not the trigger mechanism, which
  is unchanged.
- **Billable AI-authoring actions** (skeleton-parameterization preview, free-text discovery, sample-data
  fill): triggered by explicit partner-admin button clicks inside the Configurator (Section 4.A.4) —
  never automatic, per item 25's non-negotiable human-confirm requirement.

## 4. Screen / Flow Description

### 4.A The Configurator (Clerk-authenticated, partner-admin-only)

**Design system for this surface**, stated explicitly per `CLAUDE.md`'s rule against inventing a visual
direction silently: this is an **internal-tool surface** (Clio's own UI, used by partner-admin humans,
not Clio's end customers' end users) — it reuses the existing dark internal-admin convention already
established at `/dashboard/admin/templates` (RTV-04): `bg-[#080808]` page background, `bg-[#111111]`
cards with `border-[#222222]`, purple `#7C3AED`/cyan `#06B6D4`/amber `#F59E0B` accents, white/`#94A3B8`/
`#475569` text, Inter typeface. This is a deliberate, justified choice (not the retired B2C consumer
design system, and not the partner's own white-label theme, which applies only to Sections 4.B/4.C) —
the Configurator is Clio's own product surface, the same category as the existing template-approval
admin tool, and inherits its established look rather than inventing a new one.

#### 4.A.0 Configurator Home — `/dashboard/configurator`

```
┌──────────────────────────────────────────────────────────────────┐
│  Clio Configurator                          [Capgemini ▾]  [Arun@…]│
│                                                                     │
│  Design profile: ▓▓▓▓▓▓▓░░░  62%                                  │
│  (Clio is still learning your visual preferences. Full profile     │
│   unlocks proactive design suggestions.)                          │
│                                                                     │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐           │
│  │ Questionnaire │ │ Topics        │ │ Content       │           │
│  │ 1 published   │ │ Clio-generated│ │ Partner-supplied│         │
│  │ [Open →]      │ │ [Open →]      │ │ [Open →]      │           │
│  └───────────────┘ └───────────────┘ └───────────────┘           │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Visualization                                                │  │
│  │ Theme: Capgemini Blue · 3 templates parameterized            │  │
│  │ [Open →]                                                      │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```
- Top bar: "Clio Configurator" (left), a partner-account switcher dropdown (only rendered if the
  authenticated Clerk user has more than one `partner_admin_users` row; otherwise shows the single
  partner's name as static text), Clerk `<UserButton>` (existing component, reused).
- Design-profile bar: reads `partner_design_preference.score` (Section 6/Section 4.A.4's preference
  meter — 0–100), a thin horizontal bar (`h-2`, `bg-[#7C3AED]` fill on `bg-[#222222]` track), the exact
  percentage as a number, and the static explanatory line shown above (text never changes based on
  score, only the bar and percentage do).
- Three domain cards (Questionnaire / Topics / Content) — each shows the domain's own one-line status
  summary (exact source strings: `"{N} published"` / `"{N} draft"` for Questionnaire; `"Clio-generated"`
  or `"Partner-supplied"` for the currently-selected toggle value on Topics; same for Content) and an
  `[Open →]` link to that domain's own screen.
- Visualization card (full-width, below the three): shows the current theme's partner-assigned label
  (Section 4.A.4, `partner_theme_config.theme_label`, defaults to `"Untitled theme"` if never set) and a
  count of templates with any Level B/C configuration set (`"N templates parameterized"`, 0 if none).

#### 4.A.1 Questionnaire Builder — `/dashboard/configurator/questionnaire`

**Screen state 1 — List (default, or empty state if none exist yet):**
```
┌──────────────────────────────────────────────────────────────────┐
│ ← Configurator          Questionnaire Builder                     │
│                                                          [+ New]   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Onboarding v2                          [PUBLISHED]         │   │
│  │ 5 questions · 1 page                                       │   │
│  │ [Edit]  [View live]  [Unpublish]                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ No draft questionnaires.                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```
Only one questionnaire may be `PUBLISHED` at a time per partner (enforced server-side, see Section 6);
any number of `DRAFT` questionnaires may exist. Empty state (no questionnaire of any status exists yet):
a single centered line, `"No questionnaire yet. Create one to let your end users onboard themselves."` +
the same `[+ New]` button.

**Screen state 2 — Edit (question-by-question builder):**
```
┌──────────────────────────────────────────────────────────────────┐
│ ← All questionnaires      Onboarding v2 (draft)          [Publish]│
│                                                                     │
│  Layout:  ( ) All questions on one page   (•) One question per page│
│                                                                     │
│  1. What's your role?                                    [Edit][×]│
│     Type: Multiple choice · 4 options · Required                  │
│  2. What industry are you in?                             [Edit][×]│
│     Type: Multiple choice · 6 options · Required                  │
│                                                                     │
│  [+ Add question]                                                  │
└──────────────────────────────────────────────────────────────────┘
```
`[+ Add question]` opens an inline form (not a modal): `Question text` (text input, required, max 200
chars), `Type` (select: `Multiple choice` | `Short text` | `Yes/No`), for `Multiple choice` an
`Options` repeatable text-input list (min 2, max 8, each max 60 chars, `[+ Add option]` /
`[Remove]` per row), `Required` (checkbox, default checked). `[Save question]` / `[Cancel]`. Editing an
existing question opens the identical form pre-filled, `[Save question]` replaces `[Add question]`.
Reordering: drag-handle (`⠿` icon) on the left of each question row, standard drag-to-reorder (Framer
Motion `Reorder.Group`, matching this codebase's existing drag-list conventions where present).
`[Publish]` is disabled (greyed, tooltip `"Add at least one question first"`) until ≥1 question exists;
on click, sets this questionnaire `status = 'published'` and any other `published` questionnaire for
this partner to `draft` (single-publish invariant, Section 6).

#### 4.A.2 Topics Config — `/dashboard/configurator/topics`

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Configurator            Topics                                  │
│                                                                     │
│  Where do topics come from?                                       │
│  (•) Clio generates topics automatically                          │
│  ( ) We supply our own topic list                                 │
│      Your topics endpoint: [ https://api.capgemini.../topics    ] │
│      Clio calls GET {this URL} at session-selection time.         │
│                                                                     │
│  Where do prerequisites / topic deltas come from?                 │
│  (•) Clio generates prerequisites automatically                   │
│  ( ) We supply our own prerequisite list                          │
│                                                                     │
│  [Save changes]                                                    │
└──────────────────────────────────────────────────────────────────┘
```
Two **independent** radio-button pairs, exactly per the CEO brief's explicit instruction that these are
two separate toggles, not one combined setting. The "Your topics endpoint" text field appears only when
`"We supply our own topic list"` is selected (conditional reveal, no page reload); it reuses the
partner's already-configured `outbound_base_url` as a read-only prefix if already set (shown as
`{outbound_base_url}/topics`, non-editable here — the base URL itself is set via B2B-02's existing
`PATCH /api/admin/partner-accounts/:id/outbound-config`, not duplicated in this screen). `[Save changes]`
is disabled until at least one toggle's value differs from what's currently saved.

#### 4.A.3 Content Config — `/dashboard/configurator/content`

**Screen state 1 — Toggle + content list:**
```
┌──────────────────────────────────────────────────────────────────┐
│ ← Configurator            Content                                 │
│                                                                     │
│  Where does session content come from?                            │
│  (•) Clio generates content automatically                         │
│  ( ) We supply our own predefined content                         │
│                                                                     │
│  Generated content (this partner only)                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ "AI Governance Basics"           [READY FOR REVIEW]         │   │
│  │ Generated 2 hours ago                                       │   │
│  │ [Review & approve]                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ "Vendor Risk Assessment"                    [APPROVED]      │   │
│  │ Pushed to your endpoint 2026-07-12                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [+ Generate content for a new topic]                             │
└──────────────────────────────────────────────────────────────────┘
```
Only visible/actionable when `"Clio generates content automatically"` is selected — if the partner
selects `"We supply our own predefined content"`, this entire list section is replaced with a single
line: `"You're supplying your own content — Clio pulls it from {outbound_base_url}/content at session
time. No action needed here."` `[+ Generate content for a new topic]` opens an inline form:
`Topic reference` (text input, required — this becomes `partner_topic_ref`), `[Generate]`. On submit,
the item appears immediately in the list with status `GENERATING` (see Screen state 2), transitioning to
`READY FOR REVIEW` once the background pipeline completes (poll every 5s while any item is in
`GENERATING` state, matching this codebase's existing poll-based status patterns rather than introducing
new websocket infrastructure).

**Screen state 2 — Generating (transient):**
```
│  │ "AI Governance Basics"                    [GENERATING…]     │   │
│  │ Started 30 seconds ago — this can take a minute or two.     │   │
```

**Screen state 3 — Review & approve (opens on click, full detail view):**
```
┌──────────────────────────────────────────────────────────────────┐
│ ← Content list       "AI Governance Basics" — Review               │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │       [ live-rendered preview, your theme applied ]           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  3 sections generated · template: Heatmap, StepFlow, KeyTakeaway   │
│                                                                     │
│  [Approve & push to my endpoint]   [Regenerate]   [Discard]        │
└──────────────────────────────────────────────────────────────────┘
```
Preview renders using the **same `TemplateRenderer` component** the live session uses (Section 4.C),
themed with this partner's already-configured Level A/B/C visualization settings (Section 4.A.4) — so
what the partner approves is a true preview of what their end users will actually see, not an
approximation. `[Approve & push to my endpoint]`: calls `pushPartnerContent()` (existing, tested,
Section 6.1 of `architecture.md`); on `2xx` the item transitions to `APPROVED`, its draft payload is
deleted from Clio's DB (Section 6 below — this is not a permanent Clio-side record); on failure, an
inline error banner (`"Couldn't push to {outbound_base_url} — {status code}. Your draft is saved; try
again."`) and the item stays `READY FOR REVIEW` with its draft intact for retry. `[Regenerate]`:
discards the current draft, re-triggers generation for the same `partner_topic_ref`, returns to
`GENERATING`. `[Discard]`: deletes the draft entirely, removes the item from the list, no confirmation
modal (low-cost, reversible-by-regenerating action).

#### 4.A.4 Visualization — `/dashboard/configurator/visualization`

**Screen state 1 — Theme (Application/product level):**
```
┌──────────────────────────────────────────────────────────────────┐
│ ← Configurator            Visualization  ›  Theme                 │
│                                                                     │
│  Theme name: [ Capgemini Blue                                   ] │
│                                                                     │
│  Primary color    [■ #1A56DB]     Secondary color  [■ #0E3A8C]    │
│  Accent color     [■ #22C55E]                                     │
│  Font family       [ Inter ▾ ]  (Inter · Roboto · Source Sans Pro │
│                                    · IBM Plex Sans · system-ui)   │
│  Corner style       ( ) Sharp  (•) Soft  ( ) Rounded               │
│  Spacing            ( ) Compact  (•) Standard  ( ) Spacious         │
│                                                                     │
│  [Live preview: sample TopicHero card rendered with these values]  │
│                                                                     │
│  [Save theme]                                                      │
└──────────────────────────────────────────────────────────────────┘
```
Color pickers accept only strict 6-digit hex (`^#[0-9A-Fa-f]{6}$`, validated client- and server-side —
no raw CSS/arbitrary string ever accepted, closing off any injection surface). `Font family` is a fixed
5-option allowlist (no free text) — matches this project's existing "no CDN-hosted scripts" posture:
all 5 are already-available system/Google Fonts bundled the same way `Inter` is today, not
dynamically loaded from a partner-supplied URL. `Corner style`/`Spacing` are fixed 3-option enums, not
raw pixel input, keeping every template's fixed-size guarantees (RTV-04 Section 4.1) intact regardless
of theme choice. `[Save theme]` records a `+1` (or `-1` on immediate revert within 24h) preference
signal (Section 4.A.4's meter, defined concretely in Section 6).

**Screen state 2 — Template list (Template level entry point):**
```
┌──────────────────────────────────────────────────────────────────┐
│ ← Visualization            Templates                              │
│                                                                     │
│  [ Search or describe what you want to show...            ] [Go]  │
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ Heatmap       │ │ StepFlow      │ │ ComparisonTable│            │
│  │ ✓ Parameterized│ │ Not customized│ │ Not customized│            │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
│  ... (only templates where template_library.status='approved'    │
│       are shown — see note below)                                 │
│                                                                     │
│  0 of 27 Clio templates are currently available to customize.     │
│  (Arun hasn't approved any base templates yet — check back soon.) │
└──────────────────────────────────────────────────────────────────┘
```
**This is a real, honest current-state consequence, not a hypothetical**: per RTV-04, 0 of 27 base
templates are `approved` today. Until Arun approves at least one, this grid is empty and the note above
is literally what every partner sees. This is intentional, not a bug — Section 12 (Dependencies) states
it as an operational dependency this brief has on RTV-04's own separate approval workflow, not something
this brief can shortcut. The search/describe box is the free-text discovery entry point (item 20,
detailed in Screen state 4 below).

**Screen state 3 — Template detail (Template + Component level editor):**
```
┌──────────────────────────────────────────────────────────────────┐
│ ← Templates            Heatmap                                    │
│                                                                     │
│  Template-level                                                    │
│  Title override:  [                                              ]│
│  Show "So what?" footer:  (•) Yes  ( ) No                          │
│  Motion:  (•) On  ( ) Off                                          │
│  Color variant:  ( ) Default  (•) Lighter  ( ) Darker               │
│                                                                     │
│  Component-level                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Cell                                                        │   │
│  │ Style: ( ) Fill  (•) Outline  ( ) Neon                       │   │
│  │ Color ramp: [■→■→■]  (uses your theme's accent family)      │   │
│  │ Motion: (•) Fade-in stagger  ( ) None                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Legend                                                      │   │
│  │ Style: (•) Fill  ( ) Outline  ( ) Neon                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [ Live preview, sample data, your config applied ]                │
│  [Fill with realistic sample data]                                 │
│                                                                     │
│  [Save]                                                             │
└──────────────────────────────────────────────────────────────────┘
```
Component-level cards are fixed per template type (`Heatmap` has `Cell` + `Legend`; `Overlay` has `Zone
marker` + `Connector` + `Callout card`; every other template's component slot list is derived from its
own `*Data` interface's structural sub-elements, following the identical logic RTV-04 already used to
describe all 23 existing templates against their confirmed schemas without opening each renderer
individually). `[Fill with realistic sample data]` (item 10/16) triggers the sample-fill AI action
(Section 4.A.4 Screen state 5) — a billable action, confidence-labeled, never auto-applied to the saved
config (it only re-renders the live preview with fresh sample content; `[Save]` is a separate, explicit
action that persists the styling choices above, unaffected by what sample content happens to be
showing).

**Screen state 4 — Free-text template discovery (search box result):**
```
Partner types: "I need to show high, medium, low for these features"  [Go]

┌──────────────────────────────────────────────────────────────────┐
│ Best match: Heatmap                              Confidence: High │
│ "Graduated intensity across a small grid" — this is what you       │
│ described.                                                          │
│ [ live-rendered Heatmap, your theme applied, sample content ]       │
│ [Use this template]   [Not quite — see other options]              │
└──────────────────────────────────────────────────────────────────┘
```
`Confidence: High | Medium | Low` (Section 6's per-request confidence signal, computed fresh per
request, never stored). `[Use this template]` navigates to Screen state 3 for the matched template.
`[Not quite — see other options]` shows up to 3 next-best matches as smaller cards, same structure.

**Screen state 5 — No match found (free-text discovery, low confidence / no candidate above threshold):**
```
┌──────────────────────────────────────────────────────────────────┐
│ No existing template matches "a 3D rotating org chart with drill-  │
│ down" closely enough for Clio to recommend one confidently.        │
│                                                                     │
│  [Try describing it differently]                                    │
│  [Generate a new template]                                          │
│  [Browse the full template library instead]                        │
└──────────────────────────────────────────────────────────────────┘
```
Per Section 6 (Question 3's concrete resolution) and Section 11 Q1 (resolved): this is a **distinct,
explicit** state — free-text discovery never silently queues a skeleton-generation request on the
partner's behalf. `[Generate a new template]` triggers net-new skeleton generation against the free-text
description (constrained to the generation-safety boundary, Section 6.4), producing a `pending_review`
`partner_custom_templates` row shown in-place as a live preview with a `[Confirm & make live]` /
`[Discard]` pair (an in-place addition to this preview, not a separate screen state) — the template
renders to real end users only after the partner-admin explicitly confirms it (Section 6.4). `[Browse
the full template library instead]` returns to Screen state 2.

**Screen state 6 — Sample-fill preview (in-place update to Screen state 3's preview pane):**
No new screen — clicking `[Fill with realistic sample data]` on Screen state 3 replaces the preview
pane's content with freshly AI-generated realistic sample data (same underlying Anthropic client
pattern as `lib/templates/generator.ts`'s existing mock/LLM content generation, Section 6), tagged with
a small `Confidence: {High|Medium|Low}` badge in the pane's corner. This is ephemeral — never saved,
never pushed anywhere, purely a "does my styling look right with real-feeling content" check; the
partner's actual session content (Section 4.A.3) is generated and reviewed entirely separately.

### 4.B End-user questionnaire render — `/partner-questionnaire/[partner_account_id]` (no auth)

**Screen state 1 — Single-page layout:**
```
┌──────────────────────────────────────────────────────────────────┐
│  [partner theme applied — no Clio wordmark anywhere on this page] │
│                                                                     │
│  What's your role?                                                 │
│  ( ) VP / Director   ( ) Manager   ( ) Individual contributor      │
│  ( ) C-suite                                                       │
│                                                                     │
│  What industry are you in?                                         │
│  ( ) Financial services  ( ) Insurance  ( ) Retail  ...            │
│                                                                     │
│  [Submit]                                                           │
└──────────────────────────────────────────────────────────────────┘
```
Renders the partner's `published` questionnaire (Section 4.A.1) exactly as authored — question text,
option labels, required/optional, verbatim, no added copy of any kind. `[Submit]` is disabled until all
`required` questions have an answer. Styled entirely by the partner's Level A theme config (Section
4.A.4) — no Clio dark-admin styling leaks into this page (this page and the Configurator, Section 4.A,
are visually unrelated on purpose).

**Screen state 2 — Multi-page layout:** identical question rendering, one question per screen, a thin
progress indicator at top (`"Question 2 of 5"`, plain text — no themed progress bar invented beyond what
the partner's theme config already covers, since a progress-bar-specific color isn't one of the
configurable properties in Section 4.A.4 v1), `[Back]` / `[Next]` (last screen's `[Next]` becomes
`[Submit]`).

**Screen state 3 — Submission success:**
```
┌──────────────────────────────────────────────────────────────────┐
│  Thanks — you're all set.                                          │
└──────────────────────────────────────────────────────────────────┘
```
Deliberately minimal per the "never AI-fill an undefined screen" rule — this document does not invent
a branded thank-you page, redirect logic, or next-step copy, because none of that is defined by any
approved source material. A partner wanting a custom success screen configures it themselves in a
future iteration; flagged in Section 10, not silently built.

**Screen state 4 — Submission failure (partner's endpoint unreachable/errored):**
```
┌──────────────────────────────────────────────────────────────────┐
│  Something went wrong submitting your answers. Please try again.   │
│  [Try again]                                                         │
└──────────────────────────────────────────────────────────────────┘
```
`[Try again]` re-POSTs the same already-collected answers (held only in the browser's in-memory form
state — never written to `localStorage`/`sessionStorage`, and never persisted server-side either, see
Section 6). No retry queue exists server-side; retry is entirely a client-initiated re-submission.

### 4.C Live-session render — `/partner-render/[clio_session_ref]` (replaces the B2B-02 placeholder)

**Screen state 1 — Loading (bot has joined, content pull in progress):**
```
┌──────────────────────────────────────────────────────────────────┐
│  [partner theme background, no Clio branding]                     │
│                                                                     │
│                    (brief loading indicator only)                  │
└──────────────────────────────────────────────────────────────────┘
```
A minimal, theme-colored loading state (a single centered spinner in the partner's accent color) while
`pullPartnerContent()` and (if enabled) `pullPartnerProfile()` resolve — typically sub-second, no
elaborate skeleton UI invented for what is a brief transitional state.

**Screen state 2 — Active session (template stack + voice):**
```
┌──────────────────────────────────────────────────────────────────┐
│  [partner theme applied throughout — colors, font, corner style,   │
│   spacing all resolved from Level A/B/C config]                   │
│                                                                     │
│  [ the pulled content's first template, rendered via the existing  │
│    TemplateRenderer component, themed per Section 6's CSS custom-  │
│    property resolution ]                                          │
│                                                                     │
│  (Hume voice session active — audio only, no visible chrome beyond │
│   what a given template itself renders; matches the existing       │
│   Hume-native in-session experience's own lack of a visible call-  │
│   control bar, reused as-is)                                       │
└──────────────────────────────────────────────────────────────────┘
```
Structurally the same "stack of templates driven by a live Hume voice session" experience as the
existing Hume-native `WalkthroughClient.tsx` flow, reused conceptually (not file-for-file, since that
component is tied to `sessions`/Clerk `user_id`) — this document specifies a parallel, partner-scoped
implementation, not a fork of that file into two divergent copies of business logic it doesn't need
(session-plan generation, feedback tracking, etc., none of which apply to a partner session). See
Section 6 for the exact pull/render/theme/voice sequence.

**Screen state 3 — Content unavailable (pull returned `unavailable` or `not_configured`):**
```
┌──────────────────────────────────────────────────────────────────┐
│  [partner theme background]                                       │
│  This session's content isn't available right now.                │
└──────────────────────────────────────────────────────────────────┘
```
Per `architecture.md` Section 5.3, a partner 404/failure on content pull is a legitimate, handled state,
not a crash — this is that state's literal screen, themed but otherwise unadorned (no invented retry
logic here since a live meeting bot cannot meaningfully "retry" mid-join in a way that changes the
outcome — the partner's own endpoint being down is their own operational issue to fix, surfaced plainly).

**Screen state 4 — Invalid/unknown session ref:** unchanged from the existing B2B-02 stub's behavior
(`"This session reference could not be found."`) — this document does not alter that already-correct
error case.

## 5. Visual Examples

All wireframes are inline in Section 4 (6 Configurator screens across 4 domains + 4 questionnaire-render
states + 4 live-session-render states = 14 total screen states, each reflecting either an exact
component/data-driven layout or an explicit, justified minimal-placeholder decision per `CLAUDE.md`'s
undefined-content rule). None are stubbed further than what Section 4 already states.

## 6. Data Requirements

Exact SQL, full API route map, and the render-path sequence diagram are in `architecture.md` Section 12
(new, added by this document). Summarized here, organized by mechanism:

### 6.1 Questionnaire
- **New table `partner_questionnaires`** (partner-scoped from creation): `id`, `partner_account_id` (FK,
  cascade), `status` (`draft`|`published`), `layout` (`single_page`|`multi_page`), `schema` (jsonb —
  array of `{id, text, type, options?, required}` question objects, validated by Zod against exactly the
  shape Section 4.A.1's builder produces), `created_at`, `updated_at`. Publishing enforces the
  single-published-per-partner invariant server-side (transactional: set target `published`, set any
  other row for the same `partner_account_id` back to `draft`, in one write).
- **Submissions are never persisted.** Per the CEO brief's explicit Known Constraints instruction
  ("must not become a new persisted-data exception"), `POST /partner-questionnaire/[partner_account_id]/
  submit` forwards the answer payload synchronously to `{outbound_base_url}/questionnaire-response`
  (new outbound contract suffix, same shape/auth discipline as the existing `/content`/`/profile`
  contracts in `architecture.md` Section 3.3) and is never written to any Clio table — matching the
  content/profile push pattern (`architecture.md` Section 6.1: synchronous, failure surfaced directly to
  the caller, never retried via a persisted queue) rather than the webhook-retry pattern, specifically
  because retrying would require holding the (potentially free-text, partner-defined) submission body in
  Clio's DB, which is exactly the persistence this constraint forbids.
- **Thin audit exception, explicitly scoped**: a new `questionnaire_dispatch_log` table records **only**
  `id`, `partner_account_id`, `submitted_at`, `delivery_status` (`delivered`|`failed`),
  `http_status_code` — **no payload column at all**. This exists purely so a partner-admin can see "did
  submissions actually reach us" without Clio ever holding what was submitted, satisfying the Known
  Constraints' explicit allowance for "a thin delivery-log entry... mirroring `webhook_dispatch_log`'s
  audit/retry purpose, not a data-of-record purpose" — with retry deliberately omitted (no payload
  stored to retry with); a failed delivery is surfaced to the end user immediately (Section 4.B Screen
  state 4) for a client-side retry instead.

### 6.2 Topics
- **New table `partner_topic_config`**: `id`, `partner_account_id` (FK, cascade, UNIQUE), `topics_source`
  (`clio_generated`|`partner_supplied`), `prerequisites_source` (`clio_generated`|`partner_supplied`),
  `updated_at`. Two genuinely independent columns, matching the CEO brief's explicit "two toggles, not
  one" instruction.
- **New outbound contract**: `GET {outbound_base_url}/topics` — pull-only, identical shape/auth
  discipline to the existing `/content` pull (`architecture.md` Section 6.2), used when
  `topics_source = 'partner_supplied'`. This closes the gap `docs/specs/B2B-02-requirement-document.md`
  Section 10 explicitly flagged and deferred to this brief ("Topic-list submission... flagged as likely
  B2B-03"). No push direction needed for topics (unlike content) — Clio never generates a topic *list*
  on the partner's behalf to push back; when `topics_source = 'clio_generated'`, topic generation is
  Clio's own internal curriculum logic (`lib/content/curriculum.ts`, reused as-is, unmodified by this
  brief), never round-tripped through the partner at all.

### 6.3 Content (the "content-generation reuse" question, Feature Brief Question 1 — resolved)
**Finding, stated directly per the Feature Brief's instruction not to assume**: `lib/content/
generator.ts` + `lib/content/personalizer.ts` are **not** the reuse target. Read in full — both are
keyed to the `users` table's `role`/`industry`/`ai_maturity`/`worry_tags` columns, `delivery_log`, and
`content_items`, and both produce ≤80-word daily-tip email/SMS copy for the retired B2C nurture cadence.
Reusing them would mean reusing retired B2C schema, which `CORE_OBJECTIVES.md`'s hard premise explicitly
forbids without a new, explicit instruction (none exists here).

**The correct reuse target is the existing session-content pipeline** — `lib/content/
session-content-generator.ts` (`SubSessionOutline` generation) → `lib/content/script-generator.ts`
(TEACH/CHECKPOINT/PROBE/CONTINUE script) → `lib/templates/generator.ts` + `lib/templates/selector.ts`
(visualization data + deterministic template assignment). This is the literal "SubtopicOutline →
Visualization + Script generated in parallel" pipeline `CORE_OBJECTIVES.md` Objective 5 names as reused
infrastructure, and it is already async/background-generation-shaped, not real-time. **New plumbing is
required, not a direct call-site reuse**: today's pipeline is keyed to `session_id`/`topic_id`/Clerk
`user_id` and reads prior-session history for "never repeat material" logic — none of which exists for a
partner-authored `partner_topic_ref` with no session/user history. This document specifies a new,
partner-scoped entry point (`generatePartnerContent(partnerAccountId, partnerTopicRef)`, `architecture.md`
Section 12) that calls the same three underlying Anthropic-backed generator functions with a
partner-shaped context object in place of the session/user-history object, omitting the
"builds_on previous session" continuity logic entirely (there is no prior session to build on for a
partner-topic-scoped generation — consistent with Objective 2's model, where continuity is a live,
profile-driven narration concern, not a generation-time one).
- **New table `partner_content_items`** (transient staging only, not a system of record): `id`,
  `partner_account_id` (FK, cascade), `partner_topic_ref`, `status`
  (`generating`|`ready_for_review`|`approved`|`rejected`), `draft_payload` (jsonb — the generated
  `SessionContentOutline` + rendered template data, exactly what Section 4.A.3's preview renders),
  `content_ref` (nullable UUID, minted on approval, becomes the value pushed as `content_ref` in
  `architecture.md` Section 6.1's push contract), `created_at`, `expires_at` (`created_at + 7 days`,
  hard TTL safety net). **`draft_payload` is deleted (column set to `NULL`, row otherwise kept for
  history) immediately on successful push (`approved`) or on `rejected`/`discard`** — this table
  intentionally never becomes a permanent Clio-side content store; it exists only to bridge the async
  generation window and the partner-admin's review action, which per this project's standing "Content
  Generation Timing Rule" (generate in background before approval, display only after) legitimately
  needs *some* server-side holding place between those two steps. A scheduled cleanup (reusing this
  codebase's existing Inngest cron pattern) hard-deletes any row past `expires_at` regardless of status,
  so this can never silently become permanent storage even if a partner never acts on a draft.
- **Billable event**: each generation call fires a `usage_events` row, `event_type =
  'llm_generation_content'` (already an allowed value, migration 072 — no schema change needed for this
  specific case since Content-toggle generation is exactly what that value was already defined for).

### 6.4 Visualization (3-level config) — the isolation mechanism (Feature Brief Question 5 — resolved)
**Isolation mechanism, named concretely, not inferred**: every new table introduced by this document
carries `partner_account_id UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE` from
creation (never retrofitted), Row Level Security enabled with the identical `"Service role full access"`-
only policy pattern B2B-02 established (no end-user-facing/partner-admin-facing Supabase RLS policy —
Clerk is not Supabase auth, so tenant isolation is enforced at the **application layer**, not RLS, for
every Configurator route, exactly matching B2B-02's own documented precedent for `partner_admin_users`
and `partner_accounts`). The concrete, testable mechanism: **every single Configurator API route
requires an explicit `partner_account_id` in its request** (body for POST/PATCH, path/query param for
GET), calls the existing `requirePartnerAdmin(partnerAccountId)` (`lib/partner/auth.ts`, reused verbatim)
before any DB access, and every subsequent read/write is explicitly scoped
`.eq('partner_account_id', partnerAccountId)` — there is no code path in any Configurator route that
reads or writes a config row without that scoping clause present. This is the same pattern B2B-02's own
`POST /api/admin/partner-keys` already uses (`partner_account_id` in the body, `requirePartnerAdmin()`
gate) — reused, not invented.

- **New table `partner_theme_config`** (Level A — Application/product): `id`, `partner_account_id` (FK,
  cascade, UNIQUE), `theme_label`, `primary_color`/`secondary_color`/`accent_color` (each `TEXT NOT
  NULL CHECK (... ~ '^#[0-9A-Fa-f]{6}$')`), `font_family` (`TEXT NOT NULL CHECK (font_family IN
  ('Inter','Roboto','Source Sans Pro','IBM Plex Sans','system-ui'))`), `corner_style`
  (`sharp`|`soft`|`rounded`), `spacing_scale` (`compact`|`standard`|`spacious`), `assistant_display_name`
  (`TEXT`, nullable — used in the Hume system prompt in place of "Clio," Section 6.6; defaults to a
  generic `"your AI guide"` if unset, never defaults to "Clio" for a partner-rendered session), `updated_at`.
- **New table `partner_template_config`** (Level B — Template): `id`, `partner_account_id` (FK, cascade),
  `template_name` (`TEXT NOT NULL REFERENCES template_library(template_name)` — see the RTV-04
  interaction note below), `title_override`, `show_so_what_footer` (bool, default true), `motion_enabled`
  (bool, default true), `color_variant` (`default`|`lighter`|`darker`), `updated_at`. `UNIQUE
  (partner_account_id, template_name)`.
- **New table `partner_component_config`** (Level C — Component/container): `id`, `partner_account_id`
  (FK, cascade), `template_name`, `component_slot` (`TEXT` — e.g. `'cell'`, `'legend'`, `'connector'`,
  `'callout_card'`; the fixed per-template slot set is documented in `architecture.md` Section 12,
  derived directly from each template's existing `*Data` interface's structural sub-elements, the same
  method RTV-04 already used to describe all 23 pre-existing templates without opening every renderer
  individually), `style_mode` (`fill`|`outline`|`neon`), `motion` (`none`|`fade`|`stagger`|`slide`),
  `updated_at`. `UNIQUE (partner_account_id, template_name, component_slot)`.
- **RTV-04 interaction, branch (a) — resolved directly, per the CEO brief's own recommended default**:
  `partner_template_config.template_name` may only reference a `template_library` row with
  `status = 'approved'`. Enforced two ways: (1) Screen state 2 (Section 4.A.4) only lists
  Level-B/C-configurable templates where `template_library.status = 'approved'`; (2) every
  Configurator write route re-checks this server-side (never trust the client-side list), returning
  `409 { error: 'template_not_approved' }` if a partner somehow targets an unapproved template name
  directly. This is the concrete mechanism by which "parameterizing an already-approved base template is
  partner self-serve, instantly live, never touches `template_library` or requires Arun's sign-off" (CEO
  brief's own words) actually holds: the *parameterization* action never writes to `template_library` at
  all (only to `partner_template_config`/`partner_component_config`), and is gated only by a template
  already having cleared Arun's *existing, separate* RTV-04 gate — not a new gate this brief invents.
- **Render-time theme resolution**: a new `resolvePartnerTheme(partnerAccountId, templateName):
  CSSCustomProperties` function (`architecture.md` Section 12) merges all three levels (Level A always
  applies; Level B/C apply only if a row exists for that `templateName`, falling back to Clio's own
  existing default token values otherwise) into a flat set of CSS custom properties (e.g.
  `--partner-primary`, `--partner-font-family`, `--partner-cell-style`), injected via a `<style>` block
  scoped to the render page. **Retrofit requirement, named explicitly, in scope for this brief**: the 27
  `template_library` renderers (`components/templates/renderers/*.tsx`) currently hardcode literal
  Tailwind arbitrary-value classes (e.g. `bg-[#7C3AED]`) per RTV-04's own confirmed shell documentation —
  true per-partner theming is structurally impossible until these resolve through `var(--partner-*,
  {Clio default})` CSS custom properties instead, with Clio's own existing hex values preserved as the
  CSS fallback (so Clio's own internal `/dashboard/admin/templates` preview, which never sets these
  custom properties, renders byte-identically to today). This retrofit is a mechanical, systematic
  change (not 27 independent design decisions) and is required for Objective 3's falsifiable test to be
  possible at all — flagged here as a concrete, sized piece of this brief's own scope, not a follow-up.

**RTV-04 interaction, branch (b) — resolved (Section 11 Q1, CEO Agent decision, 2026-07-13): wholly-new
partner-authored template types.** Ships as **partner self-serve** — gated only by the partner-admin's
own explicit confirm click, the identical human-override standard item 25 and the Level B/C
parameterization flows above already use — **not** a Clio-side review, and **not** a mandated
second partner-side approver. Reasoning, transcribed from the CEO's resolution: RTV-04's global-approval
gate exists because `template_library` is a *shared* asset with blast radius across every partner; a
net-new partner-authored template is privately scoped (`partner_account_id`-keyed), is never written to
`template_library`, and renders only inside that one partner's own white-labeled surface —
architecturally incapable of leaking anywhere else, given the identical isolation mechanism this section
already establishes for Level A/B/C. A mandatory Clio-side review gate here would also directly
contradict `CORE_OBJECTIVES.md` Objective 6's status (partner self-serve, API-first) and this document's
own branch-(3) scaling concern as originally raised in Section 11.

- **New table `partner_custom_templates`**: `id`, `partner_account_id` (FK, cascade), `template_label`
  (partner-chosen display name), `skeleton_schema` (`JSONB NOT NULL` — the generated structural
  definition, itself constrained to the generation-safety boundary below), `status` (`pending_review`|
  `live`, default `pending_review`), `source` (`'free_text_generated'`|`'skeleton_generated'` — which
  authoring entry point produced it, Screen state 5 vs. an equivalent skeleton-authoring path), `confirmed_at`
  (nullable, set the moment the partner-admin clicks confirm), `created_at`, `updated_at`. `UNIQUE
  (partner_account_id, template_label)`. Distinct from, and never written to, `template_library` — RTV-04's
  global gate, table, and 27-renderer set are entirely untouched by this resolution.
- **State transition**: `pending_review` (freshly AI-generated, visible only in the partner's own preview,
  never eligible for `selectTemplate()` or any real end-user render) → `live` (the partner-admin's own
  explicit `[Confirm & make live]` click — any single admin on that partner's account, no second-approver
  requirement, no Clio-side check of any kind). Only `live` rows are ever eligible to render.
- **Generation-safety boundary — distinct from the approval-chain question above, applies regardless of
  who can click confirm**: `skeleton_schema` output must be constrained to the same typed,
  enum-constrained, regex-validated schema primitives Level A/B/C already enforce in this section (fixed
  enums for style/motion/layout properties, `^#[0-9A-Fa-f]{6}$`-style hex validation for any color value,
  structural JSON only) — **never** raw CSS, HTML/markup, or executable code, whether supplied in the
  partner's free-text input or emitted by the LLM. This is a generation-safety/injection-protection
  boundary, not a brand-review gate. The generation pipeline must reject (never sanitize-and-render) any
  `skeleton_schema` payload that fails this validation; a rejected payload is not persisted and does not
  advance to `pending_review`.
- **Billing**: generating a net-new template skeleton is a billable event, following the same rule
  Section 6.5 already establishes ("no code path emits generation without going through the existing
  metering mechanism"). Uses a new, distinct `usage_events.event_type` value —
  `'llm_generation_new_template'` — kept separate from Section 6.5's `'llm_generation_skeleton'` (which
  denotes AI-assisted *parameterization* of an already-approved existing template, a different action)
  so usage reporting cannot conflate the two. No `usage_events` row fires for a rejected
  (safety-validation-failed) generation — only successful, persisted `pending_review` rows are billable,
  matching the existing "only genuine outcomes are billable" rule.

### 6.5 AI-assisted authoring (Feature Brief Questions 2 & 3 — resolved concretely)

**Preference meter (item 23/24) — new table `partner_design_preference`**: `id`, `partner_account_id`
(FK, cascade, UNIQUE), `score` (`INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100)`),
`domains_touched` (`jsonb`, array of distinct strings from `{'color','font','spacing','motion'}`),
`updated_at`. Concrete, testable mechanics (new function `recordPreferenceSignal(partnerAccountId,
signal)`):
- **+2** each time a partner manually saves a component- or template-level style property change that
  remains unreverted for ≥24 hours (checked by a delayed Inngest job scheduled at save time, not at
  read time, so this cannot be gamed by never reloading the page).
- **+5** each time a partner clicks `[Use this template]` (Screen state 4) or `[Approve & push]` on an
  AI-generated skeleton-parameterization or free-text match **without** first requesting a change to it.
- **+1** each time a Level A theme property (Section 4.A.4 Screen state 1) is saved and unreverted for
  ≥24 hours; the specific property's domain (`color`/`font`/`spacing`) is added to `domains_touched` if
  not already present.
- **−3** each time a partner clicks `[Not quite — see other options]` (Screen state 4) or otherwise
  explicitly rejects a confident AI suggestion.
- **−1** each time a saved property change is reverted within 24 hours of being set (signals
  experimentation, not a stable preference — excluded from the +2/+1 rule above by construction, since
  that rule only fires after the 24h window has passed unreverted).
- Score is clamped `[0, 100]`. **"Full" (unlocks proactive generation offers, item 24) = `score ≥ 70`
  AND `domains_touched` contains at least 3 of the 4 domains** — prevents "full" from being reachable via
  repeating one action type alone. Item 24's "proactive offer" itself (a suggested generation surfaced
  unprompted once the meter is full) is **explicitly out of scope for this document** (Section 10) — the
  meter and its exact full-threshold are fully specified and testable here; the proactive-offer UI/trigger
  is a natural, additive follow-on this document deliberately does not build now, since the CEO brief's
  "What Success Looks Like" item 4 requires the meter and confidence signal to exist, not that the
  proactive offer itself ships in this pass.

**Confidence signal (item 26) — ephemeral, per-request, never stored.** Every AI-authoring response
(skeleton-parameterization suggestion, free-text match, sample-fill) includes a `confidence:
'high'|'medium'|'low'` field computed fresh, not read from any table:
- **Free-text discovery**: string/keyword-similarity score between the partner's free text and each
  candidate template's canonical description + schema field names (`architecture.md` Section 12 documents
  the exact scoring function — a bounded, deterministic keyword-overlap heuristic, not a second LLM call,
  so this stays fast and cheap). `≥0.7` → `high`, `0.4–0.69` → `medium`, `<0.4` → `low` **and** triggers
  Screen state 5 ("No match found") if no candidate clears `0.4` at all.
- **Skeleton-parameterization / sample-fill**: `high` if the partner has ≥2 prior confirmed (unreverted
  ≥24h) property choices for the same `component_slot` type on any template (strong existing signal to
  extrapolate from); `medium` if 1 prior choice exists; `low` if none (first time Clio has any signal for
  this partner's taste in this specific slot type).
- Never gates whether a human-confirm step is required — per item 25, that is always required regardless
  of confidence; confidence only changes the review prompt's tone/prominence (Section 4.A.4's badge).

**Sample-fill / skeleton-parameterization / free-text discovery — billable events**: each fires a
`usage_events` row. **Migration required** (new migration, next in sequence after 072): extends
`usage_events.event_type`'s `CHECK` constraint with three new values —
`'llm_generation_skeleton'`, `'llm_generation_discovery'`, `'llm_generation_sample_fill'` — and documents
the corresponding new `generation_type` values (`'skeleton'`, `'discovery'`, `'sample_fill'`) in the
`webhook_dispatch_log` payload contract (`architecture.md` Section 7.3's existing `generation_type` enum,
extended). No pricing is set here (B2B-04's job, per the CEO brief's own boundary) — only that these
actions emit through the existing metering mechanism, never a parallel unmetered path.

### 6.6 Live-session render path (item 5)
Exact sequence (full detail in `architecture.md` Section 12):
1. Validate `clio_session_ref` against `partner_sessions` (existing logic, unchanged).
2. `pullPartnerContent()` (existing, tested, `lib/partner/render-data.ts`) using `content_ref` or
   `partner_topic_ref` from the `partner_sessions` row.
3. If `profile_sync_enabled`, `pullPartnerProfile()` (existing, tested) using `partner_end_user_ref`.
4. `resolvePartnerTheme(partnerAccountId, templateName)` (Section 6.4, new) for each pulled content
   section's template.
5. `selectTemplate()` (`lib/templates/selector.ts`, existing, pure, **reused verbatim, unmodified** —
   Objective 3's "decided once, never re-decided live" guarantee already holds by construction and needs
   no partner-specific fork) determines `templateName` per section from the pulled content's
   `template_hint`.
6. Render via the existing `TemplateRenderer` component, wrapped in the CSS custom properties from step
   4 — zero new template renderer components needed, only the token-resolution retrofit (Section 6.4).
7. Hume-native session config (`lib/voice/hume-native/config-provisioner.ts` + `prompt-template.ts`,
   reused) is built from: the pulled content's `coaching_narrative`/script segments, the pulled profile
   (if available, per Objective 2's live-narration mechanism — identical mechanism, new data source),
   and `partner_theme_config.assistant_display_name` in place of any hardcoded "Clio" self-reference in
   the system prompt (new, small prompt-template parameter — Objective 6's "zero Clio branding"
   requirement extends to the spoken persona, not just visual chrome).
8. On session end, this render path (not B2B-02, which explicitly deferred this call site) updates
   `partner_sessions.status = 'completed'`, `ended_at`, and fires the `usage.voice_minute` +
   `session.completed` webhook events via B2B-02's already-built dispatch mechanism — this is the
   "call-site instrumentation" `docs/specs/B2B-02-requirement-document.md` Section 10 named as
   explicitly out of its own scope and belonging to whichever brief builds the render-time minute
   tracking (this one).

### 6.7 Middleware / routing
`middleware.ts` extended (not replaced) to add `/dashboard/configurator/*` and
`/api/admin/configurator/*` to the existing Clerk-protected route set — the identical one-line pattern
B2B-02 used for `/api/admin/partner-keys*`.

**localStorage/sessionStorage**: none anywhere in this document's scope. The Configurator holds no
client-only state beyond normal in-flight form state; the questionnaire-render page holds in-memory-only
form answers during fill-out (never written to any browser storage API, per Section 4.B Screen state 4).

## 7. Success Criteria (Acceptance Tests)

✓ Given a partner-admin authenticated via Clerk with a `partner_admin_users` row for Partner A only,
when they call any `/api/admin/configurator/*` route with `partner_account_id` set to Partner B, then
the response is `403` and no read or write against Partner B's data occurs.

✓ **Isolation proof test (Feature Brief "What Success Looks Like" item 6, the single most important
test in this document)**: given Partner A changes `Heatmap`'s `Cell` component-level `style_mode` from
`fill` to `neon` and saves, when a `partner-render` page is rendered for a **Partner B** session using
the same `Heatmap` template (with Partner B's own, unrelated `partner_component_config` row, or no row
at all), then Partner B's rendered HTML/CSS-custom-property output is **byte-for-byte identical** to a
snapshot taken immediately before Partner A's change — proving the change is structurally inert for
Partner B, not merely "not visibly different in this one test."

✓ Given a partner has never configured a `partner_theme_config` row, when a `partner-render` page loads
a template for that partner, then every CSS custom property falls back to Clio's own existing default
token value (per Section 6.4) and the page renders without error — no partner may ever hit a broken
render due to missing configuration.

✓ Given a partner-admin publishes a questionnaire with 2 required questions, when an end user visits
`/partner-questionnaire/[partner_account_id]` and submits without answering one required question, then
`[Submit]` remains disabled and no HTTP call to the partner's `/questionnaire-response` endpoint is made.

✓ Given `profile_sync_enabled = false` for a partner, when that partner's live session renders, then no
HTTP call to `{outbound_base_url}/profile` occurs at any point in the render path's lifecycle (the exact
falsifiable test from `docs/specs/B2B-02-requirement-document.md` Section 7, now verified against a real
render path instead of only the underlying `pullPartnerProfile()` unit).

✓ Given a partner selects `topics_source = 'partner_supplied'` and no `outbound_base_url` is configured,
when Clio attempts to resolve that partner's topic list, then the result is `not_configured` (matching
`ContentPullResult`'s existing status shape, Section 6) — never a thrown error or a silent fallback to
Clio-generated topics (falling back would silently violate the partner's explicit toggle choice).

✓ Given a partner-admin clicks `[Generate content for a new topic]`, when the background pipeline
completes, then a `usage_events` row with `event_type = 'llm_generation_content'` exists, and the
`partner_content_items.draft_payload` is visible only via the review screen (Section 4.A.3) — never
pushed to the partner's endpoint until an explicit `[Approve & push]` click.

✓ Given a `partner_content_items` row reaches `approved` status, when the push to
`{outbound_base_url}/content` succeeds, then `draft_payload` is set to `NULL` in the same transaction —
proving Clio does not retain a permanent copy of approved content after handoff.

✓ Given `template_library.status != 'approved'` for a given `template_name`, when any partner attempts
`PATCH /api/admin/configurator/templates/[templateName]`, then the response is `409
{ error: 'template_not_approved' }` regardless of which partner account is making the request — proving
RTV-04's global gate is a real, enforced prerequisite for Level B/C configuration, not just a UI-level
suggestion.

✓ Given a partner's free-text description scores below the `0.4` match threshold against every candidate
template, when the partner submits it, then Screen state 5 ("No match found") renders and
`[Generate a new template]` fires skeleton generation only on that explicit click — no code path
silently queues a skeleton-generation request from the free-text submission alone.

✓ Given a partner-admin generates a net-new template skeleton and it reaches `partner_custom_templates.status
= 'pending_review'`, when any end user's live session renders before the partner-admin clicks `[Confirm &
make live]`, then that row is never selected by `selectTemplate()` or rendered on
`/partner-render/[clio_session_ref]` — only `status = 'live'` rows are ever eligible.

✓ Given an AI-generated `skeleton_schema` payload contains a value that fails the enum/regex safety
validation (Section 6.4) — e.g. a non-hex color string or embedded markup/CSS — when the generation
pipeline validates the payload, then the payload is rejected outright (never sanitized and rendered),
no `partner_custom_templates` row is persisted, and no `usage_events` row fires.

✓ Given a fresh partner account with zero prior Configurator actions, when `GET
/api/admin/configurator/preference-meter` is called, then `score = 0` and `domains_touched = []` —
proving the meter starts genuinely cold, not pre-seeded.

## 8. Error States

| Failure | User-visible behavior | Clio-side behavior |
|---|---|---|
| Configurator route called for a `partner_account_id` the caller doesn't administer | `403`, same error envelope shape as `architecture.md`'s existing pattern | No DB write |
| Questionnaire publish attempted with 0 questions | `[Publish]` stays disabled client-side; server also rejects with `422` if called directly | No status change |
| Questionnaire end-user submission, partner endpoint unreachable/non-2xx | Screen state 4 (Section 4.B), `[Try again]` | No DB write at all (nothing to roll back — never persisted in the first place) |
| Content generation pipeline fails (LLM error, malformed output) | Content list item shows `[GENERATION FAILED]`, `[Retry]` button | `partner_content_items.status` set to a new `failed` value (added to the CHECK list); no `usage_events` row for a failed call (only successful generations are billable) |
| `outbound_base_url` unset when a Level "generate & push" action fires | Same `not_configured` status as B2B-02's existing `pullPartnerContent()` contract, surfaced as `"Set up your endpoint first"` inline message | No push attempted |
| Free-text discovery, no candidate ≥0.4 | Screen state 5 | No `usage_events` row fired for a "no match" outcome — only genuine matches/generations are billable |
| Net-new skeleton generation fails the schema-safety validation (Section 6.4) | Preview shows `"Couldn't generate a safe template — try again or describe it differently."`; nothing advances to `pending_review` | No `partner_custom_templates` row persisted, no `usage_events` row for a rejected generation |
| Sample-fill / skeleton-parameterization AI call fails (Anthropic error/timeout) | Preview pane shows `"Couldn't generate a preview — try again."`, existing config unaffected | No `usage_events` row for a failed call |
| Live-session render, content pull fails | Screen state 3 (Section 4.C) | Session proceeds to `bot_active`→ eventually `completed`/`failed` per existing `partner_sessions.status` lifecycle, unaffected by content availability |
| `resolvePartnerTheme()` called for a partner with no config at all | Falls back fully to Clio defaults (Section 6.4), no error | No DB write, no error log (this is an expected, common first-session state) |
| Two partner-admins for the same partner save conflicting Level A theme values concurrently | Last write wins (matches `kb_qa_rules`/`template_library`'s existing established concurrency precedent) | No new locking mechanism introduced |

**Loading/slow-network states**: content generation (Section 4.A.3) is explicitly not near-instant
(multi-step LLM pipeline) — the polling UI (5s interval while `generating`) is the specified loading
state, not a spinner-and-wait pattern. Sample-fill/skeleton-parameterization/free-text discovery are
each single Anthropic calls, expected to resolve in a few seconds — a simple inline loading state
(`"Thinking..."` text replacing the action button, disabled during the call) is sufficient, no separate
skeleton UI specified for these.

## 9. Edge Cases

- **Partner-admin belongs to zero partner accounts** (Clerk session valid, no `partner_admin_users`
  row at all): every Configurator route returns `403`; the Configurator Home page itself
  (`/dashboard/configurator`) shows `"You don't administer any partner accounts."` — this is a real,
  reachable state (e.g. an admin removed from their team) and must not crash or infinite-redirect.
- **Partner-admin belongs to more than one partner account**: the account switcher (Section 4.A.0)
  handles this; every route call after switching includes the newly-selected `partner_account_id`
  explicitly — there is no implicit "current partner" server-side session state to get stale.
- **First-ever session for a partner with zero Configurator activity**: fully supported end-to-end —
  Level A/B/C all fall back to Clio defaults (Section 6.4), questionnaire render 404s cleanly if none
  published (a distinct, out-of-this-document's-defined-scope case, see Section 10), content pull
  returns `unavailable` if nothing was ever generated/pushed. No onboarding-order dependency.
- **A `template_library` row transitions from `approved` back to `pending_review`** (RTV-04 Section 9's
  own edge case: a `container_spec` change resets approval): any partner's existing
  `partner_template_config`/`partner_component_config` rows for that template are **not deleted** (a
  partner's prior styling choices are preserved), but the template stops appearing in Screen state 2's
  configurable list and any render referencing it falls back to Level A only (no Level B/C applied)
  until Arun re-approves — consistent with RTV-04's own rule that an approval is never a standing blank
  check.
- **A partner sets `content_source = 'partner_supplied'` after already having Clio-generated and
  approved content**: previously-approved content already pushed to the partner's endpoint is
  unaffected (it already left Clio's system entirely per Section 6.3); no new Clio-generated content is
  produced going forward; any `generating`/`ready_for_review` drafts in flight at the moment of the
  toggle switch are **not** auto-discarded (a partner may still want to finish reviewing something
  already in progress) — the toggle only affects the availability of `[+ Generate content for a new
  topic]` going forward.
- **Mobile vs. desktop, Configurator**: desktop-only, matching the existing `/dashboard/admin/templates`
  internal-tool precedent (Section 4.A's own design-system note) — not a customer-facing screen.
- **Mobile vs. desktop, questionnaire render / live-session render**: both are genuinely end-user-facing
  (Story 3/4) and must work on mobile — no desktop-only exception here. Layout is single-column and
  responsive by construction (the wireframes in Section 4.B/4.C are single-column already; no separate
  mobile wireframe is needed because there is no desktop-specific multi-column layout to diverge from).
- **Partner skips optional Level B/C configuration entirely, only sets Level A**: fully valid — Section
  6.4's fallback chain (Level C → Level B → Level A → Clio default) resolves cleanly at every level
  independently.
- **A partner's `assistant_display_name` is unset**: Hume system prompt uses the generic `"your AI
  guide"` fallback (Section 6.6), never defaults to "Clio" — this is the one place a missing-config
  fallback must **not** silently reuse Clio's own name, since that would violate Objective 6 for exactly
  the partners least likely to have noticed the field existed.

## 10. Out of Scope

Explicitly excluded, per the Feature Brief's own boundaries plus this document's own findings:

- **Wholly-new, from-scratch template-type generation is now in scope** (brainstorm items 3, 11, 12 —
  RTV-04 interaction branch (b)), resolved via Section 11 Q1 (CEO Agent decision, 2026-07-13; full
  mechanism in Section 6.4) — generate → `pending_review` preview → partner-admin `[Confirm & make
  live]` is fully specified and buildable now, on the same footing as parameterizing an already-approved
  base template, free-text mapping *onto* an existing template, and data-shape/accessibility
  recommendation *among* existing templates. **Narrowed, still genuinely out of scope**: editing,
  versioning, or deleting a `partner_custom_templates` row once it reaches `live` status. This document
  specifies only the generate → confirm path; a follow-up spec is needed if/when a partner needs to
  retire or revise an already-live custom template.
- **The proactive-generation offer itself** (item 24's "meter is full → AI proactively offers to
  generate"). The meter and its exact full-threshold are fully specified (Section 6.5); the
  unprompted-offer UI/trigger is a natural additive follow-on, not built in this pass — the CEO brief's
  success criteria requires the meter to exist, not that this specific downstream behavior ships now.
- **The end-user "browse topics and click Let's go" portal screen** bridging questionnaire submission
  and session initiation. Named explicitly rather than silently dropped: neither this brief's own "What
  Success Looks Like" list nor B2B-05's one-line scope description in `docs/b2b-pivot-status.md` clearly
  owns this screen — B2B-05's "onboarding wizard" (per `docs/brainstorm-b2b-platform-pivot.md` §7.6) is
  the **partner-admin's own** first-time account-setup wizard (Questionnaire→Topics→Content→
  Visualization→Domain→Payment→Go-live steps for configuring their account), a different thing from an
  **end user** picking a topic to start a session. Flagged in `docs/b2b-pivot-status.md` for explicit
  ownership assignment when B2B-05 is scoped, not silently included here or silently left unowned.
- **Subdomain/custom-domain routing** for `/partner-questionnaire/[partner_account_id]` or
  `/partner-render/[clio_session_ref]` under the partner's own domain — both remain Clio-hosted URLs
  today; B2B-05's Host-header middleware will route the partner's own domain to this same content later,
  transparently, per the Feature Brief's own scope boundary.
- **Billing rate tables, credit-pool math, the admin-dashboard UI at `/dashboard/admin/clients`** — B2B-04.
  This document specifies which actions fire `usage_events` and with what `event_type`; it sets no price.
- **A dedicated "your portal's domain" settings field UI** — per the Feature Brief's own instruction,
  treated purely as a settings value B2B-05 will define the editing screen for; not built here.
- **Retrofitting RTV-04's fixed-size containers onto the 23 pre-Heatmap/Overlay templates** — already an
  explicitly out-of-scope item in RTV-04 Section 10, unaffected by this document.
- **A custom branded questionnaire "thank you" screen** beyond the minimal placeholder in Section 4.B
  Screen state 3 — no source material defines what it should say, per `CLAUDE.md`'s undefined-content
  rule.

## 11. Open Questions

None.

**Q1 — RTV-04 interaction, branch (b): wholly-new partner-authored template types — RESOLVED (CEO Agent,
2026-07-13).** This document originally forked branch (b) into three candidates (no review at all /
partner's own internal second-approver / a partner-scoped analog of RTV-04's global gate) and escalated
to the CEO Agent rather than guessing, per the Feature Brief's own explicit instruction. The CEO Agent
resolved it as candidate (1), **partner self-serve** — gated only by the partner-admin's own explicit
confirm click, not a Clio-side review and not a mandated second partner-side approver — because a
partner's new template is privately scoped (`partner_account_id`-keyed), never written to the shared
`template_library` table, and renders only inside that one partner's own surface, architecturally
incapable of leaking to any other partner given Section 6.4's existing isolation mechanism; a mandatory
Clio-side gate would also have contradicted `CORE_OBJECTIVES.md` Objective 6's partner-self-serve,
API-first status. The resolution adds one requirement distinct from the approval-chain question itself:
net-new generation output is constrained to the same typed, enum-constrained, regex-validated schema
primitives already enforced for Level A/B/C configuration — a generation-safety/injection-protection
boundary, independent of who can click confirm. Net-new templates get their own partner-scoped
`pending_review`/`live` state (`partner_custom_templates`), distinct from and never touching
`template_library`; RTV-04 itself is untouched. Full mechanism: Section 6.4. Scope boundary: Section 10.

## 12. Dependencies

- **B2B-02** (done) — `partner_accounts`, `partner_admin_users`, `partner_api_keys`, `partner_sessions`,
  `webhook_dispatch_log`, `usage_events`, the content/profile push-pull contract, `requirePartnerAdmin()`,
  `pullPartnerContent()`/`pullPartnerProfile()` (all reused verbatim, not reimplemented), and the
  `/partner-render/[clio_session_ref]` placeholder this document replaces.
- **RTV-04** (built; template design-approval **not yet started** — 0/27 approved as of this writing) —
  a hard, real, current-state dependency, not hypothetical: Screen state 2 (Section 4.A.4) will show
  **zero** customizable templates to every partner until Arun begins approving base templates through
  the existing `/dashboard/admin/templates` tool. This document does not shortcut or duplicate that gate
  (Section 6.4's "RTV-04 interaction, branch (a)" resolution) — it is a genuine sequencing dependency
  worth surfacing to Arun/CEO Agent directly, since B2B-03 shipping code does not by itself make the
  Configurator useful without RTV-04's own separate approval work also progressing.
- **Existing infrastructure reused as-is, unmodified**: `lib/templates/selector.ts`'s `selectTemplate()`
  (Objective 3's "decided once" guarantee), `lib/content/curriculum.ts` (Clio-generated topic path),
  `lib/voice/hume-native/config-provisioner.ts` + `prompt-template.ts` (Hume session config), the
  existing `TemplateRenderer` component and all 27 `components/templates/renderers/*.tsx` files (styling
  retrofit only, per Section 6.4 — no renderer's structural layout logic changes).
- **New migration required** (this brief): `partner_questionnaires`, `questionnaire_dispatch_log`,
  `partner_topic_config`, `partner_content_items`, `partner_theme_config`, `partner_template_config`,
  `partner_component_config`, `partner_design_preference`, `partner_custom_templates` (Section 6.4,
  Section 11 Q1 resolution — all new tables); `usage_events.event_type` CHECK constraint extended with 4
  new values (3 from Section 6.5, plus `'llm_generation_new_template'` from Section 6.4's resolution);
  `partner_content_items.status` CHECK extended with `'failed'` (Section 8). Full DDL in `architecture.md`
  Section 12.
- **What this brief unblocks**: B2B-05 (needs `partner_theme_config`/questionnaire-render/session-render
  routes as the content Host-header routing will resolve a partner's own domain to), and closes the
  named dependency `docs/specs/B2B-02-requirement-document.md` Section 12 flagged directly ("B2B-03's own
  Feature Brief should explicitly scope this in" — done, Section 6.6).
- **Named dependency this document creates for B2B-04**: the 4 new `usage_events.event_type` values
  (Section 6.5, Section 6.4) and `llm_generation_content` events from Section 6.3 need pricing — B2B-04's
  own scope, not set here.
- **Follow-up flagged by `architecture.md` Section 12.6, not invented here**: how a `live`
  `partner_custom_templates` row actually enters `selectTemplate()`'s candidate pool at render time is
  real design work the Section 11 Q1 resolution did not cover — it establishes only that `live` rows
  must be eligible and `pending_review` rows must not (Section 7's acceptance test). This does not block
  the Configurator-side generate → preview → confirm flow (fully specified, Section 6.4), only the
  render-time selection wiring for an already-`live` custom template.
