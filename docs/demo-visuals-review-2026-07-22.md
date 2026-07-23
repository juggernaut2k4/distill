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

## Part 2 — Visual-by-visual review (live notes)

Filled in as we go. One entry per page.

| # | Page | Status | Arun's feedback | Action taken |
|---|------|--------|------------------|--------------|
| 1 | `what-is-claude` (input/output flow) | Pending review | — | — |
| 2 | `model-family` (capability/speed chart) | Pending review | — | — |
| 3 | `modes-of-interaction` (mode switcher) | Pending review | — | — |
| 4 | `choosing-the-right-model` (decision wizard) | Pending review | — | — |
| 5 | `what-makes-claude-different` (flip cards) | Pending review | — | — |

### Detailed notes per page

(Appended below as each page is reviewed.)
