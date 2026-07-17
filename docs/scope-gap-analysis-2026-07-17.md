# Scope Gap Analysis — Arun's Exclusive Scope vs. What Is Built

Date: 2026-07-17 | Author: CEO Agent | For: Arun's review
Source of truth for intent: `CORE_OBJECTIVES.md` v3 (Arun's verbatim 5-point objective + point-6
backlog).
Source of truth for build state: `docs/b2b-pivot-status.md` Feature Briefs table (B2B-01…B2B-16), a
code audit this session having confirmed B2B-01…B2B-15 are genuinely built, plus direct code reads of
the session API, render pipeline, and glitch dashboard cited below.

> **This document informs planning. It authorizes no build and no deletion.** Every "remove" candidate
> is named for Arun's review only, per the standing "no delete without approval" rule.

---

## The scope statement being measured against

Arun's point 2 defines the exact call flow; point 3 says **"the above are the only scope that we need
to perform."** The measuring stick is therefore narrow and specific:

1. Partner initiates a call (meeting URL + ID) via API.
2. Partner supplies **Title / Sub-title / content to explain** — as **HTML pages (auth-gated) and/or
   images**, **multiple pages/images**, each with a **sub-title transition point** telling the bot
   when to advance to the next page/image. Rendered live in **Clio's headless browser**.
3. Bot joins, explains, **transitions pages as it progresses.**
4. Transcript captured.
5. Clio ends the call.
6. Post-call: Clio returns **insights (questions asked + user analysis)** to the customer.
7. **Application-glitch log** for Clio — frequency analysis, **status-to-closure tracking**, **RCA**.
8. Billing: **per voice-minute.**

---

## List 1 — In-Scope AND Built

These serve Arun's flow and already exist (labels trusted from the status tracker per the task's
stated audit; the starred items I additionally confirmed by direct code read this session).

| # | Flow step | What's built | Where |
|---|-----------|--------------|-------|
| 1 | Call initiation via API | `POST /api/partner/v1/sessions` accepts `meeting_url` + content ref, dispatches the bot ★ | `app/api/partner/v1/sessions/route.ts` |
| 2 | Bot joins the meeting | Attendee (meeting-bot) + Hume EVI (voice) pipeline, live in prod since 2026-07-04 | V-02 / `lib/partner/session-init.ts`, `lib/meeting-bot/attendee.ts` |
| 3 | Live render + page transitions | Headless-browser render path pulls content, resolves theme/template per section, provisions Hume, advances visuals live ★ | `lib/partner/live-render.ts`, `lib/partner/render-data.ts`, `/app/partner-render/[clio_session_ref]` |
| 4 | Multi-page/section walkthrough | Clio's template/visualization system (27 templates, tab/marker navigation, server-side transcript-driven advance) | B2B-03 / `lib/templates/*`, HUME-NATIVE-02 |
| 5 | Call ends | Hume-native `end_session` tool + timeout backstop + Attendee-webhook fallback completion | `inngest/session-timer.ts`, B2B-10 |
| 6 | Transcript capture | Attendee transcript normalized; Hume chat_id captured for partner sessions | B2B-09, B2B-10 |
| 7 | Post-call insights to customer | Extraction pipeline → action items + questions/user-analysis + glitches, pushed via `session.insights_ready` webhook | B2B-09 / `inngest/hume-action-item-extractor.ts`, `lib/partner/webhooks.ts` |
| 8 | Glitch log (partial — see List 2) | Internal glitch dashboard with per-pattern frequency (count, first/last seen) ★ | B2B-09 / `app/dashboard/admin/glitches` |
| 9 | Per-minute billing | Prepaid wallet metered per `usage_events` (`usage.voice_minute`), versioned rates, idempotent decrement | B2B-04 / `lib/partner/webhooks.ts`, migration 075 |
| 10 | Configure-once portal | Designer/Configurator (questionnaire, topics, content, theme, templates, domain), self-serve signup, API keys/OAuth2, onboarding wizard | B2B-03/05/06 |
| 11 | API-first + Clio-internal dashboard | Full `/api/partner/v1/*` surface + Developer Portal (docs + playground); Clio-internal admin pages (`/dashboard/admin/clients`, `/glitches`) | B2B-02/07 |

---

## List 2 — In-Scope but MISSING or INCOMPLETE

The three the task asked me to trace precisely, plus one billing note, are first. Each is grounded in
a direct code read, not the tracker's prose.

### 2a. Partner-supplied arbitrary HTML pages / images with sub-title transition points — **NOT supported today (fundamental architectural gap)**

**Arun's flow:** the partner passes Title/Sub-title and **HTML pages (auth-gated) or images**,
multiple of them, each tagged with the **sub-title at which the bot transitions** to the next — and
Clio renders these in its headless browser.

**What the API actually accepts today** (`app/api/partner/v1/sessions/route.ts`, lines 20–31): the
session-create body takes only `meeting_url`, `partner_topic_ref` (a string reference) and/or
`content_ref` (a UUID). There is **no field for inline content, no field for HTML pages, no field for
images, and no field for sub-title transition markers.** Content is *referenced*, never *passed*.

**What the referenced content must be** (`lib/partner/live-render.ts` lines 90–203; `render-data.ts`
lines 63–80): at render time Clio pulls the content from the partner's outbound API
(`GET {outbound_base_url}/content?content_ref=…`) or from Designer-pushed storage, and
`extractSections()` requires it to be a **`TemplateSection[]`** — Clio's own discriminated union of **27
fixed structured template types** (`TopicHero`, `ConceptDefinition`, `ComparisonTable`,
`TwoByTwoMatrix`, … — `lib/templates/types.ts` lines 465–493). Each section is structured `data`
conforming to a specific Clio schema.

**What this means precisely:**
- A partner **cannot** hand Clio a raw HTML page or an image and have it rendered. The content must be
  authored into (or generated into) Clio's structured template schema.
- Page/visual **transitions are driven by Clio's server-side transcript-watching + `show_visual` /
  `advance_tab` mechanism tied to template sections** — **not** by a partner-specified "advance at this
  sub-title" marker. There is no code path that reads a partner-supplied transition point.
- The system is still built **around Clio-authored (or Clio-schema) templates/topics**, exactly as
  Arun's point 2 does *not* describe. His flow is "partner brings their own pages/images + transition
  cues"; the build is "partner's content is expressed as Clio template sections, Clio decides
  transitions."

**Open question for Arun (do not resolve unilaterally):** Is the intended model (i) a genuinely new
inline-content contract — partner POSTs HTML/image URLs + sub-title transition points on the session
call, rendered as-is in the headless browser — replacing/augmenting the template-section model? Or
(ii) is the current Designer-authored template model an acceptable realization of "provide content,"
with "HTML pages / images / sub-title transitions" being the *authoring input* the Designer should
accept and convert? These are materially different builds. This is the single biggest divergence
between the stated scope and the codebase and should be resolved before further content-pipeline work.

### 2b. Glitch log — frequency YES, status-to-closure NO, RCA NO — **incomplete against Arun's bar**

**Arun's bar (point 2, step 7):** "like a log so we can constantly analyze for frequent issues,
**status of issues to track to closure** etc, perform **root cause analysis** etc."

**What's built** (`app/dashboard/admin/glitches/GlitchDashboardClient.tsx`, and
`app/api/admin/glitches/route.ts` + `summary/route.ts`): a **read-only two-panel analytics table.**
- Panel 1 "Glitch Patterns": aggregate count per (glitch_type × partner) with first-seen/last-seen —
  **this satisfies frequency analysis.** ✅
- Panel 2 "All Glitches": one row per glitch (partner, session, type, description, extracted-at) with
  partner/type filters.

**What's missing against the bar:**
- **No status field anywhere.** The `GlitchRow` interface (lines 41–49) has no `status` — there is no
  open / investigating / resolved / closed state, no way to **track an issue to closure.** ❌
- **No root-cause-analysis capability** — no RCA notes, no linking of related glitches, no assignment,
  no state transitions, no resolution record. ❌
- It is purely observational: you can *see* frequency, you cannot *work* an issue.

**Scope nuance to confirm:** these glitches are **end-user-session conversational glitches**
(`misunderstanding`, `repetition`, `confusion_about_clio`, `derailment`, `other`), extracted from
partner-session transcripts. Arun's phrase "glitches to our application so we can fix" plausibly means
exactly this (signals about where Clio's bot underperformed). If instead he also means
**application-level engineering faults/errors** (crashes, API failures, render errors), that is a
*second, separate* log that does not exist at all today. Worth a one-line confirmation from Arun on
which he means; either way the status-to-closure + RCA workflow is unbuilt.

### 2c. "Configure once, then never return to the app" — **architecturally true for running sessions; the clean partner dashboard is IN FLIGHT, not done**

**Running sessions are already API-driven** (List 1 #1/#11), so the core of "after configuration they
need not use our application" holds — a partner drives sessions by API without logging in.

**But what a partner *sees* when they do log in is not yet the lean surface Arun described.** Per the
B2B-16 brief (`.claude/agents/clio/feature-briefs/B2B-16-partner-dashboard-simplification-configurator-api-docs.md`,
dated 2026-07-17, **brief written, not yet built**): today a partner admin is exposed to a confusing
mix of **System A** (the real Configurator — 7 equal-weight cards, with "API details" and
"Documentation" buried inside a single Developer card) **and System B** (dead B2C individual-subscriber
nav: Dashboard / My Plan / Sessions / Knowledge Base / Phone Setup / Settings). Arun's target
end-state — a partner logs in and sees exactly **Configurator / API / Docs** and nothing else — is
what B2B-16 is meant to deliver and has **not shipped.** Until it does, "they need not use our
application, and when they do it's clean" is only half true.

### 2d. Billing model — per-minute is built; reconcile the recurring plan tiers to point 3

Point 3 states flatly: **"we charge by minutes they use our AI Voice bot."** The metered per-minute
wallet (B2B-04) matches this directly. **B2B-13** additionally added **recurring monthly/annual plan
tiers with bundled/included allowances.** This *may* be compatible — a plan can be a prepaid bundle of
minutes — but it is **not self-evidently the same thing** as "charge by minutes used," and it was
added during live testing, after the objective was written. **Flagged for Arun to confirm**, not
silently assumed either way (see List 3 for the mirror-image framing). Also note **LLM-generation-call
metering** (`usage_events` beyond `voice_minute`, for No-Platform partners) exists in the build but is
not named in point 3's "by minutes" statement — confirm whether generation-call billing is in or out.

### 2e. Pricing "needs to be analyzed thoroughly" — deferred, by prior decision

Arun's point 3 asks for thorough pricing analysis. Real COGS numbers are **deferred (F-02)** —
the build runs on stale May-2026 placeholder rates
(`cogs_placeholder_2026_05_no_margin`). This is a known, accepted deferral, surfaced here only so it's
not forgotten: the "analyze pricing thoroughly" ask is not yet done.

---

## List 3 — Built but now potentially OUT OF SCOPE (removal candidates — for Arun's review only)

Per Objective 5 ("whatever is not applicable or we don't need, we can remove it") — named precisely,
**not deleted.**

| # | Item | Why it may be out of scope | Confidence / caution |
|---|------|----------------------------|----------------------|
| 1 | **Recurring plan tiers (B2B-13)** — monthly/annual subscriptions with included allowances | Point 3 says "we charge by minutes." A subscription plan is a different billing shape. | **Low-confidence removal — more likely a reconcile than a delete.** A plan *as a prepaid minutes bundle* is compatible; a plan that decouples price from minutes used is not. **Do not remove without Arun confirming** whether plans stay as prepaid-minute bundles or go. (Mirror of 2d.) |
| 2 | **Residual B2C dashboard surface (System B)** — `My Plan` / `Sessions` / `Knowledge Base` / `Phone Setup` nav + backing pages, individual-subscription checkout | Not part of the partner call flow; B2B-14/16 already identify this as dead B2C weight. | **Higher confidence** — B2B-16 already scopes this for removal, pending Arun's "yes proceed" carried into the build. `app/plan` / `app/checkout` are load-bearing for the current subscription gate, so removal must replace that gate first (B2B-14 flagged this). |
| 3 | **B2C-era Clerk webhook** (`app/api/webhooks/clerk/route.ts`) — retired `users` table, B2C welcome email, abandoned-onboarding timer | Fires on every Clerk sign-up but serves the retired B2C identity model. | Medium — already flagged as a cleanup candidate in B2B-06 notes; conflating it with partner-admin linking would be wrong. Name for removal. |
| 4 | **Profile / topic-delta / async-generation machinery for No-Platform partners** (Designer content generation, smart topic delta, background pipeline) | Point 2's flow describes a Platform-partner-style "here's my content, narrate it." Arun's exclusive-scope statement does not mention Clio *generating* curricula. | **Do NOT treat as removal without Arun** — this is the entire No-Platform (Capgemini) archetype from v2.0. It may be in scope under "provide the content to explain" being Designer-authored (see 2a open question). **Flag, don't cut** — its fate depends on the 2a resolution. |

---

## The three questions that must go to Arun before further build

1. **Content model (2a):** inline partner HTML/images + sub-title transition points as a new session
   contract, or Designer-authored template sections as the realization of "provide content"? Biggest
   divergence; blocks content-pipeline direction.
2. **Glitch log (2b):** confirm it means end-user-session conversational glitches (extend the existing
   dashboard with status-to-closure + RCA), and/or a separate application-error log. Either way the
   workflow layer is unbuilt.
3. **Billing (2d / List 3 #1):** does "charge by minutes" retire the recurring plan tiers, or are
   plans kept as prepaid minute bundles? And is LLM-generation-call billing in or out?

These are genuine product-shape calls. They are surfaced, not resolved. Nothing here authorizes a
build or a deletion.
