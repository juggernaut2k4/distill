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

## Part 2 — Visual-by-visual review (live notes)

Filled in as we go. One entry per page.

| # | Page | Status | Arun's feedback | Action taken |
|---|------|--------|------------------|--------------|
| 1 | `what-is-claude` (input/output flow) | **Done — rebuilt as static infographic** | Redesigned 3x live with Arun: (1) "no hovering, animated lines are good" → removed all interactivity, kept ambient dash-flow/pulse animation; (2) "doesn't have the learning meat" → replaced vague safety paragraph with real Constitutional AI/RLAIF content; (3) "1-line overview + highlight containers" → added overview line + 3 highlight cards; (4) hard constraint: fit 100% viewport, zero scrollbar, on mobile/tablet/desktop | Content rewritten (`app/demo/_content.ts`), visual rebuilt (`WhatIsClaudeVisual.tsx`) with overview line, 3 highlight cards, "How Claude is trained" 3-step loop, "What Claude can do" input/output diagram. Built a shared `FitToViewport` shrink-to-fit wrapper (`_fit-to-viewport.tsx`) into `_shell.tsx` — measures natural content height, scales down to fit below nav. One live bug found+fixed: initial version left 20px mobile overflow (bottom padding not budgeted into the available-height calc) — fixed in `9db13eb`. **Verified live 2026-07-22**: mobile (375x812), tablet (768x1024), desktop (1280x800) all measured `scrollHeight === innerHeight`, 0px overflow, no runtime errors, content legible at all 3 sizes. |
| 2 | `model-family` (capability/speed chart) | Pending review | — | — |
| 3 | `modes-of-interaction` (mode switcher) | Pending review | — | — |
| 4 | `choosing-the-right-model` (decision wizard) | Pending review | — | — |
| 5 | `what-makes-claude-different` (flip cards) | Pending review | — | — |

Note: the `FitToViewport` wrapper lives in the *shared* `_shell.tsx`, so it now applies to all 5
visual pages automatically. Only `what-is-claude`'s own internal spacing was tightened with
`clamp()` to reduce how much scaling is needed — the other 4 still use their original fixed-px
spacing from the earlier interactive-visuals build, so they may need the same tightening pass once
reviewed.

### Detailed notes per page

(Appended below as each page is reviewed.)
