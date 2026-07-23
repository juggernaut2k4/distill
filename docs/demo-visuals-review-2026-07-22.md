# "Learn with AI" Demo — Build Log & Visuals Review Notes (2026-07-22)

Live at `test.hello-clio.com`. This doc has two parts: (1) what's been built so far, for
reference, and (2) a running log of Arun's page-by-page visual review, updated live as we go.

---

## Part 1 — What's been built so far

### B2B-32: Internal Content Test Harness (`test.hello-clio.com`)

Arun's original ask: a page separate from hello-clio.com to hand-author test topics (title,
subtitle, body, HTML/image screens) and dispatch them through the real partner content-delivery
API — a deterministic way to pressure-test the pipeline independent of AI-generated content.

Routed through the full CEO → BA → Dev chain. Built:
- Migration 092: isolated `test_harness_topics`/`_screens` tables + private Supabase Storage bucket
- `middleware.ts`: Host-header branch for `test.hello-clio.com`, HTTP Basic Auth gate
- Topic list, topic/screen authoring (sandboxed iframe preview), payload review with an in-tool
  "Dispatch now" button and a downloadable Postman collection
- Pasted HTML served publicly at `/test-harness-render/[id]` behind `Content-Security-Policy:
  sandbox allow-scripts`

DNS (`test.hello-clio.com A 76.76.21.21`, Cloudflare, DNS-only), Vercel domain alias, and env vars
set. One-time account provisioned (`f6af5e8f-f595-4fd8-a019-f10cab854ef4`, "Clio Internal — Test
Harness"), Arun granted admin access.

**Status: fully built and deployed, then put ON HOLD by Arun** ("lets put this on hold for now")
before the test-mode API key was ever minted — so the authoring tool itself has never been
exercised with real data yet.

Live bug found and fixed during this build: `crypto.timingSafeEqual` (Node-only) crashed
`middleware.ts`'s Edge runtime the moment valid Basic Auth credentials were supplied. Fixed with a
manual constant-time comparator.

### "Learn with AI" demo catalog (`/demo`)

A *separate*, fully public (no sign-in) surface on the same `test.hello-clio.com` subdomain —
Arun's next ask, independent of the paused harness. Purpose: a Pluralsight-style course-catalog
mockup, colors/layout inspired by the reference screenshots Arun shared (no logo — "just the
colors"), branded "Learn with AI" throughout.

Two hand-authored demo topics, content confirmed with Arun before building:
- **Demo 1 — "Claude AI: Models & Capabilities"** (non-technical): what Claude is, the model
  family (Opus/Sonnet/Haiku/Fable), modes of interaction, choosing the right model, differentiators
- **Demo 2 — "Object-Oriented Programming Fundamentals"** (technical, Arun's own suggestion):
  classes/objects, the four pillars, real Python code snippets, real-world reasoning for each

Built:
- `/demo` — catalog list page, two demo cards
- `/demo/[slug]` — course detail page: byline, duration/level/rating pills, action buttons, a
  5-tab layout (Course Overview / Transcript / Resources / Discussion / Learning Check)

Host-isolation: `/demo/*` is public (no Clerk session needed) but still scoped to
`test.hello-clio.com` only — 404s on `hello-clio.com`/`www.hello-clio.com` via the same
defense-in-depth pattern the harness itself uses.

### Visuals tab + 5 interactive pages

Arun's next ask: a 6th tab ("Visuals") on the course page, scoped to the Claude AI topic only for
now, linking to 5 dedicated pages — one per existing chapter — each with an interactive visual
explainer. Arun later corrected: **interactivity itself isn't the requirement** — what matters is
that the visuals look good and are well-designed. Noted for this round of work.

Built, one hand-made component per chapter (`/demo/claude-ai/visuals/[chapterId]`):
1. **what-is-claude** — animated input/output flow diagram (pills either side of a "Claude" node)
2. **model-family** — capability-vs-speed scatter chart, 4 models plotted, click to select
3. **modes-of-interaction** — segmented control (Chat/Extended Thinking/Agentic/Embedded), each
   with its own small animation
4. **choosing-the-right-model** — 2-question decision wizard recommending a model
5. **what-makes-claude-different** — 4-card flip grid (safety, context, agentic use, artifacts)

### First design-review pass (this session, earlier)

Ran `/design-review` across all 8 pages. Found and fixed one bug: the Sonnet/Fable labels
overlapped on the model-family chart (their data points sit close together). Fixed, verified live.

**Arun's verdict just now: "nope the visuals are not good."** The automated pass didn't catch what
he actually wants fixed — so we're switching to going through the 5 visual pages one by one with
his direct feedback instead of another automated pass.

---

## Standing checklist — apply to every remaining page

Distilled from the `what-is-claude` rebuild (page 1). Requirements are product rules from Arun;
learnings are the technical patterns that make them stick. Apply both before/while reviewing each
of the remaining 4 pages.

**Requirements**
1. No interactivity — no hover, no click-to-reveal, no tabs/toggles inside the visual. Everything
   visible at once.
2. Ambient motion is welcome, interaction is not — animated connector lines, a subtle pulse/glow on
   a focal node, etc. are good. The line is passive vs. requires-user-action.
3. Teach, don't just illustrate — each visual needs real conceptual "meat," not a decorative
   restatement of the transcript in shapes. Ask: does this explain a mechanism, or just re-draw
   what's already in the text?
4. Preferred structural pattern: 1-line overview + a small grid of highlight/summary cards. Default
   to this shape unless a page's content clearly calls for something else.
5. Zero scrollbar on any device is a hard constraint — the whole page (nav + content) must fit one
   viewport on mobile, tablet, and desktop. No exceptions.
6. Legibility beats compression — tighten content size first (clamp()) so the fit-to-viewport scale
   factor stays close to 1, rather than leaning on the scale transform alone.

**Technical learnings**
1. `FitToViewport` is shared infra in `_shell.tsx` — already wraps all 5 pages, nothing to re-plumb.
2. Convert fixed-px spacing to `clamp(minPx, Nvh, maxPx)`, tied to viewport height. Reduces natural
   (pre-scale) content height on short viewports so less scaling is needed. The 4 pages below this
   line still use original fixed-px spacing from the earlier interactive build — do this pass first.
3. Budget the *entire* available-height chain in `FitToViewport`'s calc, not just the top offset —
   any container padding after the measured content in normal flow must be subtracted too (this is
   what the 20px mobile bug on page 1 was).
4. Verify with `document.documentElement.scrollHeight` vs `window.innerHeight` directly, never by
   eyeballing a screenshot — the 20px bug was invisible in a screenshot but obvious in the numbers.
5. `'use client'` is required the moment a component uses `<style jsx>` — easy to drop by accident
   during a refactor that also removes an unrelated hook import.
6. lucide-react icons over text/emoji labels — keep icon sourcing consistent across pages.

---

## Scope decision — Visuals extended to both topics (2026-07-22)

Originally the Visuals tab was "scoped to the Claude AI topic only for now" — OOP showed a static
"unavailable" placeholder. Arun asked to extend the same treatment to **both** topics ("create the
checklist of all the sub-topics for both the topics and make the changes as you did here"), and
asked for CEO Agent sign-off given this lifts a previously-stated scope limit.

**CEO decision (routed via Orchestrator, 2026-07-22):**
- Approved — build out both topics, not just finish Claude AI.
- BA gate skipped for this: mechanical extension of an already-approved, already-live-reviewed
  pattern on an internal/no-auth test surface, not a new product surface. Direct build + live
  review with Arun (the same workflow already used for pages 1–2), not a formal spec cycle.
- OOP-specific guidance (code-heavy chapters): show a short curated code excerpt (~5–8 lines, static
  syntax-color tokens, no runtime execution/highlighting library) with 2–3 labeled callouts
  explaining what each part does and why it matters — annotate, don't just reprint the snippet.
  Where a concept is inherently comparative (encapsulation, inheritance, polymorphism), a
  before/after or without-this-pattern/with-this-pattern card pair is a valid variant of the
  standard "overview + card grid" shape.
- Build one OOP page first and live-review it with Arun before batch-building the rest, the same
  way `what-is-claude` needed 3 live iterations before the pattern was locked in — do not build all
  7 blind.
- `app/demo/[slug]/DemoTopicClient.tsx`'s hardcoded `topic.slug === 'claude-ai'` gate needs removing
  so OOP's Visuals tab activates instead of showing "unavailable."

## Standing checklist — applies to every remaining page, both topics

(Unchanged from the Claude AI pages — see above. Requirements 1–6 and technical learnings 1–6 apply
identically to OOP pages, plus the OOP-specific code-excerpt guidance in the scope decision above.)

---

## Part 2 — Visual-by-visual review checklist (live notes)

All 12 subtopics across both demo topics. Filled in as each page is reviewed.

### Demo 1 — Claude AI: Models & Capabilities (5 subtopics)

| # | Page | Status | Arun's feedback | Action taken |
|---|------|--------|------------------|--------------|
| 1 | `what-is-claude` (input/output flow) | **Done — rebuilt as static infographic** | Redesigned 3x live with Arun: (1) "no hovering, animated lines are good" → removed all interactivity, kept ambient dash-flow/pulse animation; (2) "doesn't have the learning meat" → replaced vague safety paragraph with real Constitutional AI/RLAIF content; (3) "1-line overview + highlight containers" → added overview line + 3 highlight cards; (4) hard constraint: fit 100% viewport, zero scrollbar, on mobile/tablet/desktop | Content rewritten (`app/demo/_content.ts`), visual rebuilt (`WhatIsClaudeVisual.tsx`) with overview line, 3 highlight cards, "How Claude is trained" 3-step loop, "What Claude can do" input/output diagram. Built a shared `FitToViewport` shrink-to-fit wrapper (`_fit-to-viewport.tsx`) into `_shell.tsx` — measures natural content height, scales down to fit below nav. One live bug found+fixed: initial version left 20px mobile overflow (bottom padding not budgeted into the available-height calc) — fixed in `9db13eb`. **Verified live 2026-07-22**: mobile (375x812), tablet (768x1024), desktop (1280x800) all measured `scrollHeight === innerHeight`, 0px overflow, no runtime errors, content legible at all 3 sizes. |
| 2 | `model-family` (capability/speed chart) | **Done — rebuilt as static infographic** | Arun approved the proposed rebuild direction ("yes rebuild"), and flagged in passing that the `what-is-claude` page subtitle didn't align with its content. | Chart is now fully static (removed `useState`/`onClick` — 0 clickable elements measured live), all 4 model dots+labels always visible. Added overview line, a generation-improvement callout ("current-gen Haiku can often outperform an older-gen Opus") pulled from the transcript but previously missing, and a 4-card grid below the chart with every model's description visible at once, color-matched to its chart dot. Both page subtitles fixed: `model-family`'s referenced clicking ("pick a point on the chart") which no longer applies; `what-is-claude`'s was stale, duplicated a line already in the visual, and didn't match its Constitutional AI framing — replaced with "A constitutional AI, trained to critique and improve its own answers." **Verified live 2026-07-22** (`f8b455e`): mobile/tablet/desktop all `scrollHeight === innerHeight`, 0px overflow, 0 clickable elements, no runtime errors, all 4 models legible at every size. |
| 3 | `modes-of-interaction` (mode switcher) | **Done — rebuilt as static infographic** | Extension of the same interactivity rule (no explicit per-page feedback needed — same violation as pages 1-2). | Removed the 4-way segmented control and `useState` entirely — all 4 modes (chat, extended thinking, agentic, embedded) now render as always-visible cards with the real transcript description each (old version showed a bare label only, no explanation) plus a small ambient visual retained from the original per-mode animations. Page subtitle updated (old one assumed picking a mode). **Live bug found during verification and fixed** (`ac68663`): the 4-card grid's `auto-fit minmax(280px)` produced 3 columns + an orphaned 4th card with wasted space at desktop width — replaced with an explicit 2-column grid above a 560px breakpoint via a scoped media query, clean 2x2 at tablet/desktop, single column on mobile. **Verified live 2026-07-22**: mobile/tablet/desktop all `scrollHeight === innerHeight`, 0px overflow, 0 clickable elements, clean 2x2 grid on desktop (no orphan), no runtime errors. |
| 4 | `choosing-the-right-model` (decision wizard) | **Done — rebuilt as static infographic** (built autonomously, not yet reviewed live by Arun) | Arun: "push it and complete both topics fully and push it. i will check tomorrow morning" — authorized completing the remaining pages without further per-page live checkpoints. | Removed the 2-question wizard and both `useState` hooks entirely. All 4 model recommendations (Opus/Sonnet/Haiku/Fable) now show simultaneously as cards with their real "when to use" reasoning from the transcript, color-matched to the model-family chart's palette for visual continuity across pages. Added a "common production pattern" section — a static triage flow diagram (Request → Haiku triage → simple/done or escalate to Sonnet/Opus) with animated dash-flow connector lines — surfacing a transcript sentence the old wizard never showed at all. Page subtitle updated (old one described the wizard mechanic). |
| 5 | `what-makes-claude-different` (flip cards) | **Done — rebuilt as static infographic** (built autonomously, not yet reviewed live by Arun) | Same authorization as row 4. | Removed the click-to-flip mechanic and `useState` entirely. All 4 differentiator cards (safety-first training, long context windows, agentic tool use, artifacts) show their full explanation directly — no "click to flip →" prompt, no hidden back-face content. Page subtitle updated (old one described the flip mechanic). |

Note: the `FitToViewport` wrapper lives in the *shared* `_shell.tsx`, so it now applies to all 5
Claude AI visual pages automatically. Only pages 1–2's own internal spacing was tightened with
`clamp()` to reduce how much scaling is needed — pages 3–5 still use their original fixed-px
spacing from the earlier interactive-visuals build, so they'll need the same tightening pass when
reviewed.

### Demo 2 — Object-Oriented Programming Fundamentals (7 subtopics)

Built end-to-end in one pass per Arun's "complete both topics fully" authorization — all 7 are new
builds (no prior interactive version to rebuild from). Component files live under
`app/demo/oop-fundamentals/visuals/`, mirroring the Claude AI directory pattern (own `_shell.tsx` +
`_fit-to-viewport.tsx`, duplicated rather than shared across topics for isolation — `_visual-styles.ts`
added as a shared token file across the 7 OOP components only, to keep the code-excerpt/callout/card
styling consistent without repeating it in every file). `DemoTopicClient.tsx`'s hardcoded
`topic.slug === 'claude-ai'` gate replaced with a `VISUAL_TOPICS` set covering both topics, and the
Visuals tab's href now derives from `topic.slug` generically instead of a hardcoded path.

Applied the CEO's code-heavy-chapter guidance throughout: short curated excerpts (~5–8 lines) from
the real transcript code, not full reprints, each with 2–3 labeled callouts explaining what the code
does and why it matters; before/after comparison cards for the inherently comparative chapters
(encapsulation, polymorphism) and for `why-oop`'s procedural-vs-object framing.

| # | Page | Status | Arun's feedback | Action taken |
|---|------|--------|------------------|--------------|
| 6 | `why-oop` (why structure code this way) | **Done — built** (not yet reviewed live by Arun) | Covered by the CEO-approved scope decision + "complete both topics fully" authorization above. | No code excerpt (transcript has none for this chapter) — overview line, a "without structure vs. with objects" comparison pair, and a 3-card recap of what OOP buys you (reuse, enforced rules, shared vocabulary). |
| 7 | `classes-and-objects` (blueprint vs. instance) | **Done — built** | Same. | Code excerpt: the `Car` class constructor + `drive()`. Callouts: `__init__` as constructor, `self` scoping per-instance state. Paired with a static visual showing `my_car`/`your_car` holding independently different `odometer` values — makes the "separate state per object" point concrete rather than just asserted. |
| 8 | `encapsulation` (controlled access to state) | **Done — built** | Same. | Code excerpt: `BankAccount.deposit()` validating before mutating `_balance`. Callouts on the internal-by-convention attribute and validate-before-mutate pattern. Before/after card pair: what breaks without encapsulation (any code can set an invalid balance) vs. what encapsulation guarantees (`deposit()`/`withdraw()` are the only doors in). |
| 9 | `abstraction` (interface vs. implementation) | **Done — built** | Same. | Code excerpt: `PaymentProcessor` abstract interface + `checkout()` depending only on it. Callouts on interface-stability. A diagram shows Stripe/PayPal as existing implementations and Apple Pay added as a new one — visually demonstrating a new provider slots in without touching `checkout()`. |
| 10 | `inheritance` (shared base, specialized subclass) | **Done — built** | Same. | Code excerpt: `Animal.describe()`/`speak()` with `Dog` overriding `speak()`. Callouts on shared-vs-overridden methods. A small class tree diagram (Animal → Dog, Cat) shows each subclass's overridden `speak()` output. |
| 11 | `polymorphism` (same call, per-type behavior) | **Done — built** | Same. | Code excerpt: `sum(shape.area() for shape in shapes)` with no type checks. Callouts on per-type correct behavior and the caller never checking concrete type. Before/after card pair: `if isinstance(...)` branch sprawl without polymorphism vs. zero-change extensibility with it. |
| 12 | `oop-in-the-real-world` (the four pillars together) | **Done — built** | Same. | No code excerpt (transcript is a wrap-up, not new code) — a 4-card recap of each pillar's payoff, plus a "where you'll see it" list of real-world examples (web frameworks, game engines, enterprise systems) pulled directly from the transcript. |

### Detailed notes per page

(Appended below as each page is reviewed.)

### Overnight completion note (2026-07-22, late session)

Arun signed off on page 3 (`modes-of-interaction`) live, then said: **"looks good push it and
complete both topics fully and push it. i will check tomorrow morning."** This explicitly authorized
finishing the remaining Claude AI pages (4–5) and all 7 OOP pages without further per-page live
review checkpoints tonight — a change from the earlier "build one OOP page first and live-review it"
guidance, superseded by Arun's own direct instruction to complete and push everything now.

All 5 Claude AI pages and all 7 OOP pages are now built and pushed. Every commit was verified with
the real `npm run build`, `npx tsc --noEmit`, and the full test suite (606/607 — the one failure is
the pre-existing, unrelated voice-gap-watchdog/minutes_ledger mock-table issue) before pushing.
**Pages 4, 5, and all 7 OOP pages have NOT yet been through a live-deploy scroll/interactivity/
runtime-error verification pass or Arun's visual review** — that's the first thing to do when picking
this back up, before considering the "one by one" review closed out.
