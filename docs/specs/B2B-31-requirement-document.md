# B2B-31 — Partner Showcase Demo (Channel-Partner "Showcase" Tab) — Requirement Document
Version: 1.0
Status: DRAFT — pending CEO review
Author: Business Analyst Agent
Date: 2026-07-19
Source brief: `.claude/agents/clio/feature-briefs/B2B-31-partner-showcase-demo.md` (v2.0)

> Scope in one line: a new **"Showcase"** 5th tab in `ChannelPartnerShell`, visible only to a
> `channel_partner`-kind account with a new `partner_accounts.showcase_access_enabled = true` flag
> (checked in addition to `requireChannelPartnerAdmin()`), holding two sub-views — **Content** (title/
> subtitle/body, persisted indefinitely, one row per account) and **Visualization** (an on-demand
> Anthropic call groups Content into 2–3 topics; per topic Arun pastes an excerpt and Saves, which
> runs the real `selectTemplate`/`generateTemplateData` pipeline and renders the result via the real
> `TemplateRenderer`, exactly as production sessions do) — plus a new public, no-Clerk-session render
> route (`/showcase-render/[id]`) per generated visualization, and a final read-only panel that
> assembles the exact `POST /api/partner/v1/sessions` JSON payload (verified against the live
> `CreateSessionSchema`) for Arun to copy into Postman. Three new tables
> (`partner_showcase_content`/`_topics`/`_visualizations`), fully isolated from every real
> partner-content table, with no expiry/cleanup job of any kind. Zero changes to any existing
> production route, schema, or pipeline function — this brief is 100% new files plus one new column
> and one new nav-array entry on an existing shell component.

A live database check (via the Supabase MCP `execute_sql` tool, `select … from partner_accounts where
account_kind = 'channel_partner'`) was run before finalizing §0 point 8 below — see that section for
what it found, including a pre-existing duplicate-row condition worth flagging.

---

## 0. Naming & Technical Decisions (read first — governs every section below)

The CEO brief listed 8 points as explicit BA discretion (its own "Scope for BA to Finalize" list).
Resolved below, all as technical decisions — none of these touch product shape (what Showcase does,
who can see it, what it produces), so none are escalated to Arun; Section 11 is empty.

| # | Open point (from CEO brief) | Resolution |
|---|---|---|
| 1 | Access-allowlist schema + Orchestrator update mechanism | A single new **column**, `partner_accounts.showcase_access_enabled BOOLEAN NOT NULL DEFAULT false`, not a new table. A new small table would need its own RLS policy, its own index, and a join on every access check for a flag that only ever applies to a handful of rows on one already-existing table — a column is the smaller diff and mirrors this codebase's own precedent (`revenue_share_percent`, B2B-28, is exactly this pattern: a nullable/defaulted column on `partner_accounts`, scoped to `channel_partner`-kind rows only via the same DB-level invariant trigger). The check is added as a new `requireShowcaseAccess()` function (§6.2) that calls `requireChannelPartnerAdmin()` first, then reads this column — "applied in that order" per the brief. The Orchestrator's live update mechanism (§6.1) is a one-line `UPDATE … WHERE id IN (SELECT partner_account_id FROM partner_admin_users WHERE clerk_user_id = '<id>')` — scoped by Clerk user id, not by a single `partner_accounts.id`, for a reason found during the live DB check (see point 8 below) — no UI, no redeploy, exactly as the brief asked. |
| 2 | Route tree | Private: 5th `ChannelPartnerShell` nav tab **"Showcase"**, `/dashboard/channel-partner/showcase` (Content, default) and `/dashboard/channel-partner/showcase/visualization` (Visualization) — two sibling `page.tsx` files under one route, matching this shell's own existing one-page-per-tab convention (`settings/page.tsx`, `clients/page.tsx`, `team/page.tsx`), not a single page with client-side tab-switch state. A small local two-item sub-nav (`Content \| Visualization`) sits inside the Showcase pages themselves, styled like the Configurator's own top tab row (API/Docs/Known Bugs) — these are two views within Showcase, not two more `ChannelPartnerShell`-level nav items, since promoting them to the shell nav would make the shell's primary nav 6 items deep for a feature only one person ever sees. Public: **`/showcase-render/[visualizationId]`** — a new top-level route (not nested under `/dashboard`), directly parallel to `/partner-render/[clio_session_ref]` (ground truth 5), never Clerk-gated. |
| 3 | Data model for Content + Visualization | Three new tables, §6.0 — `partner_showcase_content` (1 row per channel-partner account, unique on `partner_account_id`), `partner_showcase_topics` (2–3 rows per Content, from the LLM grouping call), `partner_showcase_visualizations` (1 row per topic once Saved, holding the pasted excerpt, the generated `TemplateSection` JSON, and the `transition_trigger`). None of these three tables is read or written by any existing partner-content code path (`partner_content_items`, `partner_sessions`, `partner_content_sources` is the one exception — read-only reuse, point 6) — a query against any real partner-content table can never accidentally return Showcase's rows or vice versa, since they don't share a table at all. |
| 4 | LLM topic-grouping call — prompt shape, model, file location | New file `lib/partner/showcase.ts` (not `content-generation.ts` — that file is the real partner-content pipeline; Showcase's grouping call and its mock/prompt shape are demo-only and must not live beside or be confused with production logic). Model `claude-sonnet-4-6` (matches `buildPartnerOutline`'s existing choice, `lib/partner/content-generation.ts`). Same `isPlaceholder` `ANTHROPIC_API_KEY` guard convention, copied verbatim. Full prompt/mock shape in §6.3. |
| 5 | Per-topic Save → template generation → canvas pipeline | Exact call sequence in §6.4: `selectTemplate(topicTitle, 'middle')` (no `templateHint` — none is available, since there's no `buildPartnerOutline` step here) → `generateTemplateData(templateType, topicTitle, contentTitle, { role: 'partner end user', industry: 'general', maturity: 'intermediate' }, undefined, contentSpec)`, where `contentSpec` is built by a new **pure, non-LLM** helper `deriveContentSpecFromExcerpt()` (§6.4) that turns Arun's pasted excerpt into the `{ headline, items, so_what, summary }` shape `generateTemplateData` requires to actually use the excerpt (see the finding under §6.4 — `contentSpec` is silently ignored unless `items.length > 0`, so a naive pass-through would drop the excerpt entirely). The resulting `data` is wrapped into a real `TemplateSection` object exactly as `runPartnerContentGeneration` already does (`lib/partner/content-generation.ts` lines 238–249) and rendered via the real `TemplateRenderer` component (`components/templates/TemplateRenderer.tsx`) — the canvas is `TemplateRenderer`, not a new component, matching `KBSessionPreview.tsx`'s existing single-section-preview pattern (§6.5). |
| 6 | Final "copy this JSON payload" panel — UI + assembly | §6.7. Read-only `<pre>` block + "Copy JSON" button (`navigator.clipboard.writeText`), enabled only once every current topic has a saved visualization. Assembles `{ meeting_url: "REPLACE_WITH_MEETING_URL", title, subtitle, content_to_explain, content_pages: [...], content_source_id }` — every field sourced from the persisted Content/Topic/Visualization rows, validated client-side against the same shape `CreateSessionSchema` enforces server-side (AT-6 below proves this end to end). |
| 7 | Default `transition_trigger` template | Exact string: **`` `Now let's look at ${topicTitle}.` ``** — the literal wording the CEO brief itself suggested, used verbatim, not paraphrased. |
| 8 | Confirm the dummy demo account already exists | **Confirmed, with a caveat the CEO brief's ground truth 2 didn't anticipate.** A live query (`select … from partner_accounts pa left join partner_admin_users pau … where pa.account_kind = 'channel_partner'`) found **4** `channel_partner`-kind rows across **2** distinct Clerk user ids — not one row per user as ground truth 2's idempotency claim implies. Each of the 2 Clerk users has **2** rows (created ~200–400ms apart, same day), which looks like a duplicate-insert race in `createOrClaimPartnerAccount`'s idempotency check under concurrent calls — a pre-existing bug, out of scope for this brief to fix (not something B2B-31 introduced or is asked to touch). This matters here only because `getChannelPartnerAccountForClerkUser()` resolves to *one* of a user's rows via `Array.find()`, whose result is not guaranteed stable across requests when 2 rows exist for the same user. **Consequence for this brief:** the access-grant SQL in §6.1 targets `showcase_access_enabled = true` on every `partner_accounts` row reachable via `partner_admin_users.clerk_user_id = '<Arun's Clerk user id>'` (a subquery, not a single hardcoded row id) — so regardless of which of Arun's 2 duplicate rows a given request resolves to, both are flagged and the gate passes either way. Which of the 2 distinct Clerk user ids found is actually Arun's own login is operational knowledge (confirmed via Clerk dashboard at deploy time), not a product question — not escalated. |

---

## 1. Purpose

Every live sales-partner demo today requires either screen-sharing the raw-JSON `PlaygroundClient.tsx`
(no visual rendering, not built for a sales pitch) or hand-assembling a `content_pages` JSON payload
from scratch with no way to preview what it will render as before dispatching a real meeting bot.
Showcase gives Arun a private, persistent tool — inside his own existing channel-partner dashboard,
gated so no one else can see it — to type in real content, watch it become the same rendered visuals
a real partner integration would produce, and walk away with a copy-pasteable, schema-valid payload
for the real `POST /api/partner/v1/sessions` endpoint. It doubles as a lightweight regression check
against the real `/api/partner/v1/content-sources` and template-generation pipeline, since nothing
about the payload it produces is synthetic — every URL, id, and JSON field it emits is a real row in
a real (if demo-scoped) table, reachable the same way a real partner integration reaches it.

**Failure without this:** every future sales-partner call either falls back to the unpolished
Playground JSON view or costs Arun manual JSON-assembly time before each demo, with no visual proof
the payload will render correctly until it's live in front of a prospect.

---

## 2. User Story

As Arun, acting as his own channel-partner demo account,
I want to type or paste real content, save it, and have it grouped into 2–3 topics I can each turn
into a real rendered visualization using Clio's actual template pipeline,
So that I can show a prospective sales-partner exactly what the real API-driven integration produces,
without screen-sharing raw JSON or hand-building a payload from scratch.

As Arun,
I want everything I enter or generate in Showcase to persist indefinitely, editable and re-savable
across many future demo calls, with nothing auto-deleted,
So that I can reuse and refine the same demo content across multiple prospect conversations without
redoing the setup each time.

As Arun,
I want the final output to be the exact, valid JSON payload for the real session-dispatch endpoint,
So that I can paste it into Postman, add the meeting URL for whichever call I'm on, and fire it
manually when I'm ready — with no second dispatch mechanism to trust.

As the Orchestrator,
I want to flip Showcase access on or off for a specific account, live, without a redeploy,
So that I can disable it the moment Arun says a round of demos is done, per his own explicit
instruction, without shipping code each time.

---

## 3. Trigger / Entry Point

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | Allowlisted channel-partner admin opens their dashboard | `GET /dashboard/channel-partner` | Clerk session + `requireChannelPartnerAdmin` (unchanged) | — |
| E-2 | Same user clicks the "Showcase" nav tab | `GET /dashboard/channel-partner/showcase` | Clerk session + `requireShowcaseAccess` (NEW, §6.2) | `partner_accounts.showcase_access_enabled = true` on the caller's own channel-partner account |
| E-3 | Non-allowlisted channel-partner admin directly navigates to the same URL | `GET /dashboard/channel-partner/showcase` | Same gate | `showcase_access_enabled = false` (or the "Showcase" tab is not even rendered in nav, §4) → redirected, never sees the page (AT-1) |
| E-4 | User edits Content and clicks Save | `PATCH /api/channel-partner/showcase/content` | Clerk session + `requireShowcaseAccess` | On Content tab |
| E-5 | User opens the Visualization tab for the first time (no topics yet for the current Content) | `GET /dashboard/channel-partner/showcase/visualization` → auto-fires `POST /api/channel-partner/showcase/topics` on mount | Clerk session + `requireShowcaseAccess` | Content row exists (has been saved at least once) |
| E-6 | User clicks "Regenerate topics" | `POST /api/channel-partner/showcase/topics` (explicit, same route as E-5) | Clerk session + `requireShowcaseAccess` | On Visualization tab |
| E-7 | User clicks a topic link | Client-side only — expands that topic's canvas + excerpt textbox | — | Topics loaded |
| E-8 | User pastes an excerpt and clicks Save (per topic) | `PATCH /api/channel-partner/showcase/visualizations/[topicId]` | Clerk session + `requireShowcaseAccess` | Excerpt textbox non-empty |
| E-9 | Meeting bot's headless browser loads a generated visualization's render URL | `GET /showcase-render/[visualizationId]` | **None** — public, no Clerk session (mirrors `/partner-render/[clio_session_ref]`) | Visualization row exists with a saved `template_section` |
| E-10 | User views the final payload panel (auto-visible once every topic has a saved visualization) | Client-side assembly from already-loaded state, plus a one-time `POST /api/channel-partner/showcase/content-source` (idempotent) to resolve `content_source_id` | Clerk session + `requireShowcaseAccess` | All current topics have a saved visualization |
| E-11 | Orchestrator flips access for an account | Direct SQL via Supabase admin tooling (§6.1) — not a UI action | Supabase project access (Orchestrator-only) | — |

---

## 4. Screen / Flow Description

### `ChannelPartnerShell` nav (MODIFIED)

`navItems` gains a 5th entry, **conditionally rendered**: `{ key: 'showcase', label: 'Showcase', href:
'/dashboard/channel-partner/showcase' }`, appended only when the shell is told the current account has
`showcase_access_enabled = true` (a new `showShowcaseTab: boolean` prop `ChannelPartnerShell` accepts,
default `false`, so every existing caller — `page.tsx`, `clients/page.tsx`, `team/page.tsx`,
`settings/page.tsx` — is unaffected unless a caller explicitly passes `true`; Dashboard/Clients/
Team/Settings pages fetch the flag alongside their existing account resolution and pass it through).
A non-allowlisted admin never sees a 5th tab at all — not a visible-but-403 tab, an absent one, which
is a stronger UX signal than a greyed-out link and avoids advertising a feature's existence to an
audience it isn't for.

### `/dashboard/channel-partner/showcase` — Content tab (NEW)

`ChannelPartnerShell`-wrapped (`active="showcase"`, `showShowcaseTab={true}`). Inside the shell's
content area, a local two-item sub-nav row (`Content` underlined/active, `Visualization` plain,
identical visual pattern to the Configurator's own top-tab row — `borderBottom: 2px solid
COLORS.purple` on the active item) sits above the page body.

New client component `ShowcaseContentClient.tsx`, fetching `GET /api/channel-partner/showcase/content`
on mount:

- Heading `"Content"` (`text-white text-2xl font-bold`).
- Sub-line: `"What you enter here persists indefinitely and is reused across demo calls until you
  change it."` (`COLORS.textSecondary`, `fontSize: 13`) — sets expectations up front per Arun's own
  "never deleted until I say so" requirement.
- Label `"Title"`, text input, `maxLength={200}`, pre-filled with the saved value or, if no row exists
  yet, the placeholder sample text `"How Clio Works"` (grey placeholder text, not a pre-filled value —
  Save is required to actually persist a first row).
- Label `"Subtitle"`, text input, `maxLength={300}`, sample placeholder `"A live look at AI-narrated
  learning"`.
- Label `"Content"`, multi-line textarea (`rows={10}`), `maxLength={5000}` (matches
  `CreateSessionSchema`'s own `content_to_explain` cap, so nothing typed here can ever fail that
  schema check downstream), sample placeholder `"Paste or write the material you want to walk a
  prospective partner through during a live demo call..."`.
- `"Save"` button (`PrimaryButton`, disabled while unchanged from the last-loaded value or while
  in-flight, inline `Loader2` spinner on submit) — identical dirty-state pattern to
  `SettingsClient.tsx` (ground truth 8): `unchanged = title === saved.title && subtitle ===
  saved.subtitle && contentToExplain === saved.contentToExplain`.
- Inline success flash `"Saved."` for 1.5s; inline error `"Couldn't save. Try again."` on failure —
  same precedent as every other inline-save screen in this codebase.

### `/dashboard/channel-partner/showcase/visualization` — Visualization tab (NEW)

`ChannelPartnerShell`-wrapped, same sub-nav, `Visualization` now the active/underlined item.

New client component `ShowcaseVisualizationClient.tsx`, fetching `GET
/api/channel-partner/showcase/topics` on mount.

**No Content saved yet (`content_id` doesn't exist):**
```
Nothing to visualize yet. Add and save some Content first.  [ Go to Content → ]
```
(`COLORS.textSecondary`, link to `/dashboard/channel-partner/showcase`.)

**Content exists, no topics yet (first visit, or after Content was saved with zero prior topics):**
Auto-fires `POST /api/channel-partner/showcase/topics` on mount, no click required. While in flight:
`<Loader2 className="animate-spin" /> "Grouping your content into topics..."`. On success: topics
render as a vertical list of clickable text links (`text-white`, `hover:text-[COLORS.purple]`), each
prefixed with a small numbered badge (`1.`, `2.`, `3.`) — 2–3 items. On failure:
`"Couldn't group your content into topics. Try again."` + `"Retry"` button (re-fires the same POST).

**Topics already exist (every subsequent visit):** topics render immediately from the loaded list —
**no automatic re-call of the LLM grouping endpoint** (§0 point 3's resolution: re-grouping on every
visit would risk silently orphaning a topic a Visualization was already saved against, contradicting
"never deleted until I say so"). A `"Regenerate topics"` button (`SecondaryButton`, top-right of the
topic list) is always visible once at least one topic exists, and re-fires the same POST on click —
this **appends** newly generated topics; it does **not** delete existing topic rows or their saved
Visualizations (§6.3, §9 Edge Case).

**Clicking a topic link** expands an inline panel directly below it (accordion-style — clicking a
different topic collapses the previous one, matching this codebase's general single-open-panel
convention):

```
┌─────────────────────────────────────────────────────────┐
│  [ Canvas: TemplateRenderer output, or "Not generated    │
│    yet — paste an excerpt below and Save." placeholder ] │
│                                                             │
│  Excerpt from your Content for this topic                  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ (multi-line textarea, empty until pasted)              │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  Transition phrase (spoken cue to move to this topic)      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Now let's look at {topic title}.                       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  Render URL: https://.../showcase-render/<id>   [ Copy ]  │
│  (shown only once a visualization has been saved)          │
│                                                             │
│                                          [ Save ]           │
└─────────────────────────────────────────────────────────┘
```

- The canvas is the real `TemplateRenderer` component rendering the topic's saved
  `template_section` (or, before any Save, a plain placeholder message — never a blank white box, per
  the standing "no AI-generated content on an undefined screen" caution, which does not block the
  Save-triggered generation itself, only an unprompted auto-render before Arun has supplied an
  excerpt).
- Excerpt textarea: `maxLength={4000}`, empty by default (never pre-filled — the excerpt is always
  Arun's own pasted text, per the CEO brief's explicit design).
- Transition-phrase input: pre-filled with the default template (§0 point 7) the moment the topic
  panel first opens, fully editable thereafter, persisted alongside the excerpt on Save (not a
  separate save action).
- **Save button state (AT-4):** disabled whenever the excerpt textarea is empty (`excerpt.trim() ===
  ''`); re-enabled the instant the excerpt has any content and on every subsequent edit to either the
  excerpt or the transition phrase (dirty-state re-arms exactly like `SettingsClient.tsx`, except here
  the *baseline* to compare against is "was anything generated yet" rather than "did the value
  change from the last save" — see §6.6 for the precise `disabled` expression, which also covers the
  re-edit-after-first-save case).
- On Save: button shows `Loader2` + `"Generating..."` while `PATCH
  /api/channel-partner/showcase/visualizations/[topicId]` runs the real template pipeline
  server-side (§6.4) — this can take several seconds (a real Anthropic call), same expectation-setting
  as `KBSessionPreview`'s own generation UX. On success, the canvas re-renders with the new
  `TemplateRenderer` output and the render URL appears/updates below it. On failure: `"Couldn't
  generate a visualization. Try again."` inline, canvas keeps showing the last successful render (or
  the placeholder, if this was the first attempt).

**Final payload panel** — appears below the topic list, only once **every currently-listed topic**
has a saved visualization (§6.7):

```
┌─────────────────────────────────────────────────────────┐
│  Session payload — ready to copy                           │
│  Paste this into Postman, add your own meeting_url, and    │
│  fire POST /api/partner/v1/sessions when you're live.      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ { "meeting_url": "REPLACE_WITH_MEETING_URL", ... }    │ │
│  └─────────────────────────────────────────────────────┘ │
│                                          [ Copy JSON ]     │
└─────────────────────────────────────────────────────────┘
```

Before every topic has a saved visualization: this panel does not render at all (not a disabled/greyed
version — absent, so there's never a temptation to copy an incomplete payload).

### `/showcase-render/[visualizationId]` — public render (NEW)

No Clerk session, no `ChannelPartnerShell`, no chrome of any kind — full-screen `TemplateRenderer`
output only, exactly mirroring `/partner-render/[clio_session_ref]/page.tsx`'s own minimal shape
(§6.5). Not-found or not-yet-generated states render the same `ThemedMessage`-style centered
dark-background message that file already uses (reused pattern, not a new visual language): `"This
visualization could not be found."`

---

## 5. Visual Examples

### Content tab — empty state (first visit, nothing saved yet)

```
┌───────────────────────────────────────────────────────────┐
│  Content                                       Visualization │
│  ──────                                                       │
│  Content                                                       │
│  What you enter here persists indefinitely and is reused       │
│  across demo calls until you change it.                        │
│                                                                 │
│  Title                                                          │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ How Clio Works                                          │     │
│  └─────────────────────────────────────────────────────┘     │
│  Subtitle                                                        │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ A live look at AI-narrated learning                     │     │
│  └─────────────────────────────────────────────────────┘     │
│  Content                                                          │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Paste or write the material you want to walk a           │     │
│  │ prospective partner through during a live demo call...   │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                    [ Save ]    │
└───────────────────────────────────────────────────────────┘
```

### Visualization tab — topics grouped, none visualized yet

```
┌───────────────────────────────────────────────────────────┐
│  Content                                       Visualization │
│                                              ──────────────── │
│                                          [ Regenerate topics ] │
│  1. What Clio Does During a Live Meeting                       │
│  2. How the AI Narration Adapts in Real Time                   │
│  3. Setting Up an Integration in Under 10 Minutes               │
└───────────────────────────────────────────────────────────┘
```

### Visualization tab — one topic expanded, not yet visualized

```
┌───────────────────────────────────────────────────────────┐
│  1. What Clio Does During a Live Meeting            [open]▾ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Not generated yet — paste an excerpt below and Save.  │ │
│  │                                                          │ │
│  │  Excerpt from your Content for this topic                │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │                                                    │    │ │
│  │  └───────────────────────────────────────────────┘    │ │
│  │  Transition phrase                                       │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │ Now let's look at What Clio Does During a Live   │    │ │
│  │  │ Meeting.                                           │    │ │
│  │  └───────────────────────────────────────────────┘    │ │
│  │                                     [ Save (disabled) ]│ │
│  └─────────────────────────────────────────────────────┘ │
│  2. How the AI Narration Adapts in Real Time                   │
│  3. Setting Up an Integration in Under 10 Minutes               │
└───────────────────────────────────────────────────────────┘
```

### Visualization tab — topic visualized

```
┌───────────────────────────────────────────────────────────┐
│  1. What Clio Does During a Live Meeting            [open]▾ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  [ Rendered TemplateRenderer canvas — real visual ]     │ │
│  │                                                          │ │
│  │  Excerpt from your Content for this topic                │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │ Clio joins as a bot, watches the meeting content, │    │ │
│  │  │ and narrates a synced visual...                    │    │ │
│  │  └───────────────────────────────────────────────┘    │ │
│  │  Transition phrase                                       │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │ Now let's look at What Clio Does During a Live   │    │ │
│  │  │ Meeting.                                           │    │ │
│  │  └───────────────────────────────────────────────┘    │ │
│  │  Render URL: https://hello-clio.com/showcase-render/     │ │
│  │  8f2a...             [ Copy ]                             │ │
│  │                                              [ Save ]    │ │
│  └─────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

### Final payload panel (all topics visualized)

```
┌───────────────────────────────────────────────────────────┐
│  Session payload — ready to copy                             │
│  Paste this into Postman, add your own meeting_url, and      │
│  fire POST /api/partner/v1/sessions when you're live.        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ {                                                        │   │
│  │   "meeting_url": "REPLACE_WITH_MEETING_URL",              │   │
│  │   "title": "How Clio Works",                               │   │
│  │   "subtitle": "A live look at AI-narrated learning",       │   │
│  │   "content_to_explain": "...",                              │   │
│  │   "content_pages": [                                        │   │
│  │     { "url": "https://.../showcase-render/8f2a...",          │   │
│  │       "media_type": "html",                                  │   │
│  │       "title": "What Clio Does During a Live Meeting",       │   │
│  │       "transition_trigger": "Now let's look at ..." },        │   │
│  │     ...                                                        │   │
│  │   ],                                                            │   │
│  │   "content_source_id": "c3f1..."                                │   │
│  │ }                                                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                              [ Copy JSON ]     │
└───────────────────────────────────────────────────────────┘
```

### Public render — visualization not found

```
┌─────────────────────────────────────┐
│                                       │
│              ◌ (spinner ring)         │
│  This visualization could not be     │
│  found.                               │
│                                       │
└─────────────────────────────────────┘
```

---

## 6. Data Requirements

### 6.0 New migration `089_b2b31_showcase_demo.sql`

```sql
-- B2B-31 — Partner Showcase Demo. See docs/specs/B2B-31-requirement-document.md §0/§6.

-- ─── Access allowlist: one column, not a new table (§0 point 1) ────────────
ALTER TABLE partner_accounts
  ADD COLUMN IF NOT EXISTS showcase_access_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN partner_accounts.showcase_access_enabled IS
  'B2B-31: gates the private "Showcase" tab (lib/partner/auth.ts requireShowcaseAccess). Meaningful
  only on a channel_partner-kind row (enforced by check_account_kind_invariants, extended below).
  Flipped directly via SQL by the Orchestrator, scoped by clerk_user_id via partner_admin_users, not
  a UI toggle — see requirement doc §0 point 1/8 for why a clerk_user_id-scoped UPDATE is required
  rather than one on a single partner_accounts.id.';

-- Extend the existing invariant trigger (B2B-26 §6.15, B2B-28 §6.1 precedent) — same pattern as
-- revenue_share_percent: this flag must never be true on a direct-partner (account_kind='partner') row.
CREATE OR REPLACE FUNCTION check_account_kind_invariants()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.account_kind = 'channel_partner' AND NEW.owning_channel_partner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A channel_partner-kind partner_accounts row cannot itself have an owning_channel_partner_id (no nested sales-partner chains)';
  END IF;

  IF NEW.owning_channel_partner_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM partner_accounts
      WHERE id = NEW.owning_channel_partner_id AND account_kind = 'channel_partner'
    ) THEN
      RAISE EXCEPTION 'owning_channel_partner_id must reference a partner_accounts row with account_kind = channel_partner';
    END IF;
  END IF;

  IF NEW.revenue_share_percent IS NOT NULL AND NEW.account_kind <> 'channel_partner' THEN
    RAISE EXCEPTION 'revenue_share_percent may only be set on a channel_partner-kind partner_accounts row';
  END IF;

  -- NEW (B2B-31)
  IF NEW.showcase_access_enabled = true AND NEW.account_kind <> 'channel_partner' THEN
    RAISE EXCEPTION 'showcase_access_enabled may only be set on a channel_partner-kind partner_accounts row';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_account_kind_invariants ON partner_accounts;
CREATE TRIGGER enforce_account_kind_invariants
  BEFORE INSERT OR UPDATE OF account_kind, owning_channel_partner_id, revenue_share_percent, showcase_access_enabled
  ON partner_accounts
  FOR EACH ROW EXECUTE PROCEDURE check_account_kind_invariants();

-- ─── partner_showcase_content: one row per channel-partner account (§0 point 3) ─
CREATE TABLE IF NOT EXISTS partner_showcase_content (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  title              TEXT,
  subtitle           TEXT,
  content_to_explain TEXT,
  content_source_id  UUID REFERENCES partner_content_sources(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_partner_showcase_content_updated_at
  BEFORE UPDATE ON partner_showcase_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── partner_showcase_topics: 2-3 rows per Content, from the LLM grouping call ─
CREATE TABLE IF NOT EXISTS partner_showcase_topics (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  showcase_content_id      UUID NOT NULL REFERENCES partner_showcase_content(id) ON DELETE CASCADE,
  partner_account_id       UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  title                    TEXT NOT NULL,
  position                 SMALLINT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_showcase_topics_content
  ON partner_showcase_topics(showcase_content_id);

-- ─── partner_showcase_visualizations: 1 row per topic, once Saved ──────────
CREATE TABLE IF NOT EXISTS partner_showcase_visualizations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  showcase_topic_id   UUID NOT NULL UNIQUE REFERENCES partner_showcase_topics(id) ON DELETE CASCADE,
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  excerpt_text        TEXT NOT NULL,
  transition_trigger  TEXT NOT NULL,
  template_section    JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_partner_showcase_visualizations_updated_at
  BEFORE UPDATE ON partner_showcase_visualizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE partner_showcase_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_showcase_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_showcase_visualizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_showcase_content"
  ON partner_showcase_content FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on partner_showcase_topics"
  ON partner_showcase_topics FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on partner_showcase_visualizations"
  ON partner_showcase_visualizations FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_showcase_content IS
  'B2B-31: Showcase demo content, one row per channel_partner-kind partner_accounts row. NEVER read
  by any real partner-content pipeline (content-generation.ts, personalizer, session-content-generator)
  — fully isolated, no expiry job, no cleanup. See requirement doc §0 point 3.';
COMMENT ON TABLE partner_showcase_topics IS
  'B2B-31: LLM-grouped topics from partner_showcase_content, via lib/partner/showcase.ts groupShowcaseContentIntoTopics(). No expiry.';
COMMENT ON TABLE partner_showcase_visualizations IS
  'B2B-31: one saved, rendered visualization per topic — real TemplateSection JSON, produced by the
  real selectTemplate/generateTemplateData pipeline. Rendered publicly, no auth, at
  /showcase-render/[id]. No expiry.';
```

No changes to `partner_content_sources`, `partner_sessions`, `partner_content_items`, or any migration
file before 089.

### 6.1 Orchestrator access-toggle SQL pattern (documented, no UI — §0 point 1)

```sql
-- Grant Showcase access to a specific Clerk user's channel-partner account(s):
UPDATE partner_accounts
SET showcase_access_enabled = true
WHERE id IN (
  SELECT partner_account_id FROM partner_admin_users
  WHERE clerk_user_id = '<clerk_user_id>'
) AND account_kind = 'channel_partner';

-- Revoke (same shape, false):
UPDATE partner_accounts SET showcase_access_enabled = false
WHERE id IN (SELECT partner_account_id FROM partner_admin_users WHERE clerk_user_id = '<clerk_user_id>')
  AND account_kind = 'channel_partner';
```

Run via the Supabase MCP `execute_sql` tool (or the Supabase dashboard) directly by the Orchestrator —
no new admin UI, per the CEO brief's own "doesn't need its own UI" allowance. The `WHERE id IN (SELECT
… clerk_user_id = …)` shape (rather than a single `partner_accounts.id`) is deliberate — see §0 point 8
for why Arun's own account currently has 2 duplicate `channel_partner`-kind rows.

### 6.2 `lib/partner/auth.ts` — `requireShowcaseAccess` (NEW)

```ts
type ShowcaseAccessResult =
  | { clerkUserId: string; partnerAccountId: string; error: null }
  | { clerkUserId: null; partnerAccountId: null; error: NextResponse }

/**
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §6.2). Gate for every
 * /dashboard/channel-partner/showcase* page and every /api/channel-partner/showcase/*
 * route. Calls requireChannelPartnerAdmin() first (same account resolution as
 * every other channel-partner route), THEN checks the new
 * showcase_access_enabled column — in that order, so even a genuine
 * channel-partner admin who isn't allowlisted gets the same 403 a
 * non-channel-partner caller would. Same indistinguishable-403 convention as
 * every other auth function in this file (no info leak about *why*).
 */
export async function requireShowcaseAccess(): Promise<ShowcaseAccessResult> {
  const cp = await requireChannelPartnerAdmin()
  if (cp.error) return { clerkUserId: null, partnerAccountId: null, error: cp.error }

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('showcase_access_enabled')
    .eq('id', cp.partnerAccountId)
    .maybeSingle()

  if (!data?.showcase_access_enabled) {
    return {
      clerkUserId: null,
      partnerAccountId: null,
      error: NextResponse.json(errorEnvelope('forbidden', 'Showcase is not enabled for this account.'), { status: 403 }),
    }
  }

  return { clerkUserId: cp.clerkUserId, partnerAccountId: cp.partnerAccountId, error: null }
}
```

`ChannelPartnerShell`'s `showShowcaseTab` prop is populated by each page's own server component
reading the same `showcase_access_enabled` column directly (a cheap, already-open `partner_accounts`
read alongside each page's existing account resolution) — not by calling `requireShowcaseAccess()`
itself on every non-Showcase page (that would 403 the whole page load for something that should just
hide one nav tab). Only the actual `/showcase*` pages/routes call `requireShowcaseAccess()`.

### 6.3 `lib/partner/showcase.ts` — topic grouping (NEW)

```ts
import { createSupabaseAdminClient } from '@/lib/supabase'

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

export interface ShowcaseContentInput {
  title: string | null
  subtitle: string | null
  contentToExplain: string | null
}

/**
 * B2B-31 (requirement doc §0 point 4, §6.3). Groups the saved Showcase Content
 * into 2-3 topic titles. Demo-only — deliberately NOT lib/partner/content-generation.ts,
 * which is the real partner-content pipeline. Same isPlaceholder ANTHROPIC_API_KEY
 * guard convention as buildPartnerOutline (content-generation.ts) and
 * generateTemplateData (templates/generator.ts).
 */
export async function groupShowcaseContentIntoTopics(input: ShowcaseContentInput): Promise<string[]> {
  const body = [input.title, input.subtitle, input.contentToExplain].filter(Boolean).join('\n\n')

  if (isPlaceholder) {
    // Deterministic mock: naive paragraph/sentence split into up to 3 short titles.
    const chunks = body.split(/\n\n+/).filter((c) => c.trim().length > 0).slice(0, 3)
    if (chunks.length >= 2) return chunks.map((c) => c.trim().slice(0, 60))
    return ['Overview', 'How It Works', 'Getting Started'].slice(0, Math.max(2, Math.min(3, chunks.length || 2)))
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `You are grouping a piece of content into 2-3 distinct topics for a product demo.
Content:
"""
${body.slice(0, 5000)}
"""
Return ONLY a JSON array of 2 or 3 short topic title strings (max 8 words each), no markdown, no
explanation, e.g. ["Topic one title", "Topic two title", "Topic three title"]. Titles must be
distinct facets of the content above, ordered as they'd naturally be presented in a walkthrough.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  const raw = textBlock && 'text' in textBlock ? textBlock.text : '[]'
  const parsed = JSON.parse(raw.replace(/^```json\s*|```\s*$/g, ''))
  const titles = Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  return titles.slice(0, 3).length >= 2 ? titles.slice(0, 3) : ['Overview', 'How It Works']
}

/** Appends newly grouped topics after the current max `position` for this Content row — never deletes existing rows (§9). */
export async function regenerateShowcaseTopics(partnerAccountId: string, showcaseContentId: string, input: ShowcaseContentInput): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const titles = await groupShowcaseContentIntoTopics(input)

  const { data: existing } = await supabase
    .from('partner_showcase_topics')
    .select('position')
    .eq('showcase_content_id', showcaseContentId)
    .order('position', { ascending: false })
    .limit(1)

  const startPosition = (existing?.[0]?.position ?? -1) + 1

  await supabase.from('partner_showcase_topics').insert(
    titles.map((title, i) => ({
      showcase_content_id: showcaseContentId,
      partner_account_id: partnerAccountId,
      title,
      position: startPosition + i,
    }))
  )
}
```

`POST /api/channel-partner/showcase/topics` calls `regenerateShowcaseTopics` when the caller's topic
list is currently empty (E-5, no button needed — auto-fires) **or** when explicitly invoked via the
"Regenerate topics" button (E-6) — same function either way; the client-side distinction (auto vs.
button) is purely about when the fetch is triggered, not a different server behavior.

### 6.4 Per-topic Save → template pipeline (`lib/partner/showcase.ts`, continued)

```ts
import { selectTemplate } from '@/lib/templates/selector'
import { generateTemplateData } from '@/lib/templates/generator'
import type { TemplateSection, TemplateName } from '@/lib/templates/types'

/**
 * B2B-31 (requirement doc §0 point 5). Pure, non-LLM. generateTemplateData's
 * contentSpec block is silently skipped when contentSpec.items.length === 0
 * (lib/templates/generator.ts ~line 1128: `contentSpec && contentSpec.items.length > 0`)
 * — a naive { summary: excerpt, items: [] } pass-through would make the LLM
 * ignore Arun's excerpt entirely. This derives a non-empty items[] via simple
 * sentence/line splitting so the excerpt actually reaches the generation prompt.
 */
export function deriveContentSpecFromExcerpt(topicTitle: string, excerpt: string) {
  const items = excerpt
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 5)
  const safeItems = items.length > 0 ? items : [excerpt.trim().slice(0, 200)]
  return {
    headline: topicTitle,
    items: safeItems,
    so_what: `Understanding ${topicTitle} matters for how you evaluate Clio.`,
    summary: excerpt,
  }
}

/**
 * Runs the real template pipeline for one Showcase topic — same functions
 * runPartnerContentGeneration (content-generation.ts) uses for real partner
 * content, minus buildPartnerOutline/generateTrainingScript (no session/
 * narration script needed here — the canvas is the whole deliverable).
 */
export async function generateShowcaseVisualization(topicTitle: string, contentTitle: string, excerpt: string, visualizationId: string): Promise<TemplateSection> {
  const userContext = { role: 'partner end user', industry: 'general', maturity: 'intermediate' }
  const templateType: TemplateName = selectTemplate(topicTitle, 'middle')
  const contentSpec = deriveContentSpecFromExcerpt(topicTitle, excerpt)
  const data = await generateTemplateData(templateType, topicTitle, contentTitle, userContext, undefined, contentSpec)

  return {
    id: visualizationId,
    type: templateType,
    data,
    meta: { subtopicTitle: topicTitle, sessionTitle: contentTitle, userRole: userContext.role, userIndustry: userContext.industry },
    status: 'ready',
  } as TemplateSection
}
```

`selectTemplate(topicTitle, 'middle')` (never `'first'`/`'last'`) matches
`runPartnerContentGeneration`'s own call (`content-generation.ts` line 223) — Showcase has no
structural first/last concept, so every topic gets the full keyword-matched template range. No
`templateHint` is passed (no `buildPartnerOutline` step exists here to produce one) — the selector's
own keyword matching against `topicTitle` is the sole input, identical to what a real partner topic
with no hint would get.

### 6.5 Canvas + public render (NEW files, reusing `TemplateRenderer` verbatim)

`ShowcaseVisualizationClient.tsx`'s per-topic canvas:
```tsx
{visualization ? (
  <TemplateRenderer section={visualization.templateSection} isActive={true} />
) : (
  <div className="flex h-64 items-center justify-center bg-[#080808] rounded-xl border border-[#1a1a1a]">
    <p className="text-[#475569] text-sm">Not generated yet — paste an excerpt below and Save.</p>
  </div>
)}
```

`app/showcase-render/[visualizationId]/page.tsx` (NEW, public, mirrors `/partner-render/
[clio_session_ref]/page.tsx`'s own shape exactly):
```tsx
import { createSupabaseAdminClient } from '@/lib/supabase'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import type { TemplateSection } from '@/lib/templates/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function NotFoundMessage() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 24 }}>
      <p style={{ fontSize: 14, maxWidth: 420 }}>This visualization could not be found.</p>
    </div>
  )
}

export default async function ShowcaseRenderPage({ params }: { params: { visualizationId: string } }) {
  if (!UUID_RE.test(params.visualizationId)) return <NotFoundMessage />

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_showcase_visualizations')
    .select('template_section')
    .eq('id', params.visualizationId)
    .maybeSingle()

  if (!data?.template_section) return <NotFoundMessage />

  const section = data.template_section as TemplateSection
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#080808' }}>
      <TemplateRenderer section={section} isActive={true} />
    </div>
  )
}
```

Zero Clerk import anywhere in this file — matching ground truth 5's own "public, no Clerk session"
precedent exactly, confirmed reachable the same way the meeting-bot's headless browser reaches
`/partner-render/*` today.

### 6.6 API routes (all NEW)

| Route | Method | Behavior |
|---|---|---|
| `app/api/channel-partner/showcase/content/route.ts` | `GET` | `requireShowcaseAccess()`; returns the caller's `partner_showcase_content` row (or `{ title: null, subtitle: null, content_to_explain: null }` if none exists yet) |
| same file | `PATCH` | Zod: `{ title: z.string().max(200).optional().nullable(), subtitle: z.string().max(300).optional().nullable(), contentToExplain: z.string().max(5000).optional().nullable() }`; upserts on `partner_account_id` (unique constraint, §6.0) |
| `app/api/channel-partner/showcase/topics/route.ts` | `GET` | Returns `{ topics: [{ id, title, position, visualization: {...} \| null }] }` — a single query joining `partner_showcase_topics` → `partner_showcase_visualizations` (left join) so the client gets topic + visualization state in one round-trip |
| same file | `POST` | Calls `regenerateShowcaseTopics` (§6.3); 422 if no Content row exists yet (`{ error: { code: 'content_required', message: 'Save some Content first.' } }`) |
| `app/api/channel-partner/showcase/visualizations/[topicId]/route.ts` | `PATCH` | Zod: `{ excerpt: z.string().min(1).max(4000), transitionTrigger: z.string().min(1).max(500) }`; verifies the topic belongs to the caller's own account (`partner_account_id` match, same ownership-check convention as `requireChannelPartnerClientAccess`); calls `generateShowcaseVisualization`; upserts on `showcase_topic_id` (unique constraint, §6.0) |
| `app/api/channel-partner/showcase/content-source/route.ts` | `POST` | Idempotent — see §6.7; returns `{ content_source_id }` |

`Save` button `disabled` expression (§4, AT-4) in `ShowcaseVisualizationClient.tsx`:
```ts
const disabled = excerpt.trim() === '' || saving
```
— deliberately **not** gated on "unchanged from last save" the way `SettingsClient.tsx`'s Company-info
Save is: re-clicking Save with the *same* excerpt must stay available (e.g. Arun wants to regenerate
after a template-pipeline hiccup), and per AT-4's own wording ("re-enables on any edit") the only hard
requirement is non-empty content, which this expression satisfies exactly — any edit that keeps the
field non-empty leaves the button enabled throughout, and an edit that empties it disables it again.

### 6.7 Final payload assembly (`ShowcaseVisualizationClient.tsx`, client-side) + content-source registration

```ts
async function ensureContentSource(): Promise<string> {
  const res = await fetch('/api/channel-partner/showcase/content-source', { method: 'POST' })
  const data = await res.json()
  return data.content_source_id as string
}
```

`app/api/channel-partner/showcase/content-source/route.ts` (`POST`):
```ts
export async function POST() {
  const access = await requireShowcaseAccess()
  if (access.error) return access.error

  const supabase = createSupabaseAdminClient()
  const { data: content } = await supabase
    .from('partner_showcase_content')
    .select('id, content_source_id')
    .eq('partner_account_id', access.partnerAccountId)
    .maybeSingle()

  if (!content) return NextResponse.json({ error: { code: 'content_required', message: 'Save some Content first.' } }, { status: 422 })
  if (content.content_source_id) return NextResponse.json({ content_source_id: content.content_source_id })

  // Same insert shape as POST /api/partner/v1/content-sources for auth_type='none'
  // (app/api/partner/v1/content-sources/route.ts lines 80-84) — inserted directly
  // rather than via an HTTP round-trip to that endpoint, since that endpoint is
  // gated by requirePartnerApiKey (a partner API key), and a channel_partner-kind
  // account has no Configurator access to ever generate one (requirePartnerAdmin's
  // B2B-26 §6.14 block). Byte-identical row shape either way.
  const { data: inserted, error } = await supabase
    .from('partner_content_sources')
    .insert({ partner_account_id: access.partnerAccountId, auth_type: 'none', label: 'Showcase demo' })
    .select('id')
    .single()

  if (error || !inserted) return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to register content source.' } }, { status: 500 })

  await supabase.from('partner_showcase_content').update({ content_source_id: inserted.id }).eq('id', content.id)
  return NextResponse.json({ content_source_id: inserted.id as string })
}
```

Payload assembly (fires `ensureContentSource()` once, on first render of the panel, then builds):
```ts
const payload = {
  meeting_url: 'REPLACE_WITH_MEETING_URL',
  title: content.title ?? undefined,
  subtitle: content.subtitle ?? undefined,
  content_to_explain: content.contentToExplain ?? undefined,
  content_pages: topics.map((t) => ({
    url: `${window.location.origin}/showcase-render/${t.visualization!.id}`,
    media_type: 'html' as const,
    title: t.title,
    transition_trigger: t.visualization!.transitionTrigger,
  })),
  content_source_id: contentSourceId,
}
```

This shape satisfies `CreateSessionSchema` (`lib/partner/session-schema.ts`) field-for-field:
`meeting_url` (valid URL string — `REPLACE_WITH_MEETING_URL` is not itself a valid URL, so Arun must
edit it before firing, which is the intended behavior, not a bug), `content_pages` (array of `{url,
media_type, title, transition_trigger}` matching `ContentPageSchema` exactly, `subtitle` omitted per
page since Showcase doesn't collect a per-page subtitle), `content_source_id` present whenever
`content_pages` is present (satisfies the `.refine()` at line 53-55), and no `partner_topic_ref`/
`content_ref` set (satisfies the "exactly one of inline/reference" refine at line 41-46). AT-6 verifies
this by literally running the assembled object through `CreateSessionSchema.safeParse()` in a test.

---

## 7. Success Criteria (Acceptance Tests)

✓ **AT-1 (access control).** Given a `channel_partner`-kind account with `showcase_access_enabled =
false`, when its admin navigates directly to `/dashboard/channel-partner/showcase`, then the response
is a 403 from `requireShowcaseAccess()` and the "Showcase" nav tab is absent from `ChannelPartnerShell`
on every other page that account can reach.

✓ **AT-2 (public render, no auth).** Given a saved `partner_showcase_visualizations` row, when its
`/showcase-render/[id]` URL is requested with no Clerk session/cookie of any kind (a fresh,
unauthenticated `fetch`), then the page returns 200 and renders the `TemplateRenderer` output, not a
sign-in redirect.

✓ **AT-3 (persistence, no auto-deletion).** Given Content saved with a title/subtitle/body and one
topic Visualized, when the browser is closed and the same account logs back in a week later with no
scheduled job having run in between, then both the Content and Visualization rows are unchanged and
still load exactly as saved — confirmed by inspecting `partner_showcase_content`/`_visualizations` for
the complete absence of any `expires_at` column or cron reference anywhere in this brief's schema
(§6.0) or code (unlike `partner_content_items`, which does have `expires_at` + a deletion cron —
deliberately not reused here, ground truth/§0 point 3).

✓ **AT-4 (Save button dirty-state).** Given a topic panel with an empty excerpt textarea, when the
page loads, then the Save button is disabled; when any character is typed into the excerpt, then Save
becomes enabled; when the excerpt is fully deleted again, then Save becomes disabled again; when a
visualization already exists and the excerpt is edited further, then Save re-enables from its
post-save disabled-while-unchanged... — precisely, per §6.6's resolved expression, Save's only gate is
non-empty excerpt content, so it never appears disabled after a successful save while text remains
present.

✓ **AT-5 (real template pipeline reuse, not a fork).** Given a topic with a pasted excerpt, when Save
is clicked, then the network tab shows no new/duplicate template-schema logic — `selectTemplate` and
`generateTemplateData` are called with the exact signatures documented in §6.4, and the resulting
`TemplateSection.type` is one of the same `TemplateName` values a real partner session can produce
(verified by asserting the returned `type` is in `VALID_TEMPLATE_NAMES`, `lib/templates/selector.ts`).

✓ **AT-6 (payload validity end-to-end).** Given all topics for a Content row are visualized, when the
final panel's assembled JSON (with `meeting_url` manually replaced by a real URL string) is run through
`CreateSessionSchema.safeParse()` in a test, then `success === true` with zero validation errors.

✓ **AT-7 (empty state).** Given a fresh, never-used Showcase (no Content row exists), when the
Visualization tab is opened directly, then it shows `"Nothing to visualize yet. Add and save some
Content first."` and does **not** attempt the topic-grouping call (no wasted Anthropic call against
empty content).

✓ **AT-8 (error state — topic grouping failure).** Given the Anthropic API call inside
`groupShowcaseContentIntoTopics` throws (network error, malformed JSON response), when
`POST /api/channel-partner/showcase/topics` is called, then it returns a 500 with a generic error body
and the client shows `"Couldn't group your content into topics. Try again."` with a working `"Retry"`
button — no partial/malformed topic rows are ever inserted (the insert only runs after the full
`titles` array is successfully parsed).

✓ **AT-9 (regenerate topics does not delete).** Given topic 1 already has a saved visualization, when
"Regenerate topics" is clicked and produces 3 new topic titles, then `partner_showcase_topics` gains 3
new rows (higher `position` values) and topic 1's original row and its `partner_showcase_visualizations`
row are both still present, unmodified, and still render correctly at their existing `/showcase-render/
[id]` URL.

✓ **AT-10 (mock fallback, no live API key).** Given `ANTHROPIC_API_KEY` is a `PLACEHOLDER_` value in
the environment, when Content is saved and Visualization is opened, then `groupShowcaseContentIntoTopics`
and `generateTemplateData` both take their existing mock branches (no network call, no thrown error) and
the full flow — Save Content → group topics → paste excerpt → Save → canvas renders → payload panel
appears — completes end-to-end using only mock data.

---

## 8. Error States

| Input / call | Failure | User sees |
|---|---|---|
| `PATCH /api/channel-partner/showcase/content` | Server error | Inline `"Couldn't save. Try again."` |
| `POST /api/channel-partner/showcase/topics` | No Content row yet | 422, client never fires this call in that state (AT-7) — defensive-only on the server |
| `POST /api/channel-partner/showcase/topics` | Anthropic call throws / malformed JSON | 500, `"Couldn't group your content into topics. Try again."` + `"Retry"` (AT-8) |
| `PATCH /api/channel-partner/showcase/visualizations/[topicId]` | Topic not found or not owned by caller | 403/404, identical indistinguishable-error convention as `requireChannelPartnerClientAccess` |
| `PATCH /api/channel-partner/showcase/visualizations/[topicId]` | `generateTemplateData`/Anthropic call fails | 500, `"Couldn't generate a visualization. Try again."`; canvas keeps its last successful state (or placeholder) |
| `POST /api/channel-partner/showcase/content-source` | Insert fails | 500, generic error; final payload panel simply doesn't render `content_source_id` yet — no partial/broken JSON is ever shown |
| `/showcase-render/[visualizationId]` | Malformed UUID, or no matching row | Same `NotFoundMessage` component either way, no distinction (matches the codebase's existing no-info-leak convention) |
| Excerpt textarea | Exceeds 4000 chars | Native `maxLength` truncation, no separate error state needed |

---

## 9. Edge Cases

- **Regenerating topics never deletes anything** (AT-9) — new topics are appended at incrementing
  `position` values; any topic whose Visualization was already saved keeps rendering at its existing
  URL even after regeneration, satisfying "anything I enter or save should not be deleted or removed
  until I say so" literally, not just for Content.
- **A topic can be re-visualized any number of times.** Saving a new excerpt against a topic that
  already has a visualization runs the pipeline again and `UPDATE`s the existing row (unique
  constraint on `showcase_topic_id`) rather than inserting a second row — the render URL (tied to the
  visualization row's `id`, not the topic's) stays stable across re-saves, so a URL already pasted into
  a previous Postman payload keeps working and simply shows the newest content next time it's fetched.
- **The final payload panel recomputes live** as topics/visualizations change — it is not a one-time
  snapshot; adding a 4th topic via "Regenerate topics" and visualizing it makes the panel disappear
  again until that 4th topic is also visualized (the "every currently-listed topic" gate, §4), then
  reappear with 4 `content_pages` entries.
- **Two different channel-partner accounts can each have Showcase access simultaneously** (nothing in
  this design assumes exactly one allowlisted account) — every table is scoped by `partner_account_id`,
  so two allowlisted accounts' Content/Topics/Visualizations never collide or leak into each other.
- **A non-allowlisted channel-partner admin who already knows a `/showcase-render/[id]` URL from
  somewhere can still view it** — this is intentional, not a gap: the render route is deliberately
  public by design (mirrors `/partner-render/*`), and a rendered demo visual carries no sensitive data
  beyond whatever text Arun chose to paste into a public-facing demo.
- **Mobile/responsive:** every new Showcase page uses the same fluid `clamp()`/Tailwind pattern as
  `SHELL_CONTENT_STYLE` and the rest of `app/dashboard/channel-partner/*` — no new hardcoded
  pixel-width caps, per the standing responsive policy (`CLAUDE.md`). `/showcase-render/[id]` inherits
  `TemplateRenderer`'s own existing responsive behavior unmodified (same component real sessions use).
- **A Clerk session expiring mid-Visualization-flow** hits the same 401 every other
  `requireChannelPartnerAdmin`-gated call already has — no new handling needed.
- **The duplicate-`channel_partner`-row condition found in §0 point 8** is a pre-existing bug in
  `createOrClaimPartnerAccount`'s idempotency check, not something this brief introduces or is asked to
  fix — flagged here for visibility, not remediated in this scope. Showcase's own access-grant SQL
  (§6.1) is written to be correct regardless of whether it's ever fixed.

---

## 10. Out of Scope

- Fixing the duplicate-`channel_partner`-account-row condition (§0 point 8) — a separate, pre-existing
  bug, not part of this brief.
- Any change to `POST /api/partner/v1/sessions`, `CreateSessionSchema`, `generateTransitionMarkers`, or
  any other file under `lib/content/transition-markers.ts` — all confirmed unmodified reuse (Revision
  Note correction 5, ground truth 3/7).
- Any new dispatch/proxy mechanism — Arun fires the real endpoint manually via Postman, exactly as the
  CEO brief specifies (Revision Note correction 4). Nothing in this brief calls
  `dispatchMeetingBot`/`POST /api/partner/v1/sessions` on Showcase's behalf, automatically or otherwise.
- Rate limiting or budget caps on any Showcase-specific call — removed from scope per the brief
  (Revision Note correction 1); Showcase's Anthropic calls (topic grouping, template generation) carry
  whatever cost they carry, same as any other authenticated internal tool in this codebase.
- Any UI for browsing/managing multiple past Content "versions" — there is exactly one Content row per
  account, overwritten on Save, not a history/versioning feature.
- Editing or deleting individual topics/visualizations independently of the flows described above (no
  "delete this topic" button) — consistent with "nothing is deleted until I say so"; if a topic is no
  longer wanted for a given demo, Arun simply doesn't include its `content_pages` entry when copying
  the final JSON (the payload only ever includes topics with a saved visualization, and nothing forces
  every topic ever created to appear in every future payload — though as currently specified, all
  visualized topics under the current Content row do appear; a future "exclude this topic from payload"
  toggle is a natural follow-on, not built here).
- Any change to `ChannelPartnerShell`'s Dashboard/Clients/Team/Settings tabs beyond the new conditional
  5th nav entry.

---

## 11. Open Questions

None. Every point the CEO brief listed under "Scope for BA to Finalize" (§0's table above) is resolved
as a concrete technical decision, including the live-DB-check finding under point 8, which is reported
as fact (with a design that is robust to it) rather than escalated as a question.

---

## 12. Dependencies

- B2B-26 (`account_kind`, `channel_partner`, `ChannelPartnerShell`, `requireChannelPartnerAdmin`,
  `getChannelPartnerAccountForClerkUser`, the `check_account_kind_invariants` trigger) — must exist; it
  does, shipped, migration 086.
- B2B-28 (`revenue_share_percent`, the invariant-trigger-extension precedent this brief's own
  `showcase_access_enabled` column follows) — must exist; it does, shipped, migration 088.
- B2B-29 (`SettingsClient.tsx`'s dirty-state Save pattern, `ChannelPartnerShell`'s 4-tab nav as the
  base this brief adds a 5th tab to) — must exist; it does, shipped.
- B2B-19 (`CreateSessionSchema`, `ContentPageSchema`, `generateTransitionMarkers`,
  `POST /api/partner/v1/content-sources`, inline-content mode on `POST /api/partner/v1/sessions`) —
  must exist; it does, shipped, migration 083.
- B2B-03 (`lib/templates/generator.ts`'s `generateTemplateData`, `lib/templates/selector.ts`'s
  `selectTemplate`, `components/templates/TemplateRenderer.tsx`, the full `TemplateName`/
  `TemplateSection` type system) — must exist; it does, shipped.
- `lib/partner/content-generation.ts`'s `runPartnerContentGeneration` as the structural precedent this
  brief's own `generateShowcaseVisualization` mirrors (minus the outline/script steps) — must exist; it
  does, shipped.
- No new external vendor, package, or environment variable. `ANTHROPIC_API_KEY` (already approved,
  already present) is the only credential this brief's new code touches.
