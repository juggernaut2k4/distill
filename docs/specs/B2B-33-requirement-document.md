# B2B-33 — "Learn with AI" Demo: Real Bot Dispatch with Per-Topic Meeting URL — Requirement Document
Version: 1.0
Status: DRAFT — pending CEO review
Author: Business Analyst Agent
Date: 2026-07-23
Source brief: `.claude/agents/clio/feature-briefs/B2B-33-demo-learn-with-ai-bot-dispatch.md`

> Scope in one line: a new **Meeting** tab on each `/demo/{slug}` topic page (public, no-auth) where a
> Google Meet URL is saved per topic (passcode-gated write, unlimited-read); once saved, the existing
> **Learn with AI** button dispatches Clio's real meeting bot into that URL via a new server-only route
> that assembles the topic's chapters into the real B2B-19 inline-content payload
> (`content_pages[]`, one per chapter, each with a deterministic `transition_trigger`) and calls the
> real, unmodified `POST /api/partner/v1/sessions` server-to-server, authenticated as a brand-new
> dedicated internal partner account (**"Clio Internal — Public Demo"**, `test_mode: true` only, never
> touching any real partner's account or `balance_usd`). One new table (`demo_meeting_urls`). No AI
> generation anywhere in this feature's write path — all narration content is the already-authored
> `Chapter.blocks` text already live in `app/demo/_content.ts`. All 5 of the CEO brief's delegated
> questions are resolved below as concrete, literal decisions. Section 11 is empty.

---

## 0. Decisions Table (read first — governs every section below)

The CEO brief delegated 5 questions to the BA ("BA's call," "BA should design," "document explicitly").
All 5 are resolved here as concrete, buildable decisions — none are left open.

| # | CEO brief question | Resolution |
|---|---|---|
| 1 | Exact shape of the new meeting-URL table, migration, RLS posture, access pattern | **New table `demo_meeting_urls`**: `slug TEXT PRIMARY KEY`, `meeting_url TEXT NOT NULL`, `last_dispatch_attempted_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. RLS enabled, **one policy only** — `"Service role full access on demo_meeting_urls"` (`USING (auth.role() = 'service_role')`) — mirroring every other table in this codebase's public/no-auth-surface precedent (`test_harness_topics`/`test_harness_screens`, migration 092). No policy is created for `anon` or `authenticated` roles, so PostgREST denies all non-service-role access by default even if a browser-side Supabase key were ever introduced. **Access pattern, explicit:** `DemoTopicClient.tsx` (a client component) never talks to Supabase directly — it exists only through two new Next.js Route Handlers (§6.1) that use `createSupabaseAdminClient()` (the service-role client) server-side. §4/§6 below detail exactly which route does what. |
| 2 | Content-source registration: one-time seed vs. lazy per-dispatch registration | **One-time, via a real call to the existing `POST /api/partner/v1/content-sources` endpoint, made once by the Orchestrator as part of provisioning** — not a raw migration SQL insert, and not lazy per-dispatch registration. Reasoning: `partner_content_sources` rows for `auth_type: 'none'` carry no URL and no credential (§ confirmed by reading `lib/partner/content-sources.ts` — the row is just an auth-mechanism marker, not tied to any specific page URL), so **one single content source, shared by both demo topics and every dispatch**, is sufficient — there is nothing per-topic or per-dispatch to register. Calling the real endpoint (rather than hand-writing an insert) exercises the real code path once, at provisioning time, exactly mirroring B2B-32's own "one API call, one env var, one-time infra step" precedent for its API key. The resulting `content_source_id` is recorded in a new env var, `PLACEHOLDER_DEMO_CONTENT_SOURCE_ID`, until the Orchestrator completes this one-time call — this is infrastructure provisioning (§12 Dependencies), not code this feature's Dev agent writes. |
| 3 | Dispatch route shape | **`POST /api/demo/[slug]/dispatch`** — public, **not** passcode-checked (passcode gates Save only, per Known Constraints — see §0 point "why dispatch isn't passcode-gated" below), but rate-limited per topic slug (§6.3, a BA-designed technical safeguard closing a residual abuse gap the CEO brief didn't explicitly name — see note below). Loads the saved `meeting_url` from `demo_meeting_urls`; 422s with a clear reason if none is saved. Assembles `content_pages[]` from the static `DEMO_TOPICS` chapter data (§6.2 — exact algorithm, deterministic, no AI call). Calls `POST {NEXT_PUBLIC_APP_URL}/api/partner/v1/sessions` server-to-server using `Authorization: Bearer ${DEMO_PARTNER_API_KEY}` (new server-only env var, never sent to the browser), with `test_mode` implied `true` because that key is minted in `mode: 'test'` (§12). Full request/response contract in §6.3. |
| 4 | Post-click UI states (loading / success / error) | Fully specified with exact copy in §4 Screen D and §5 wireframes D1–D4. Four states: idle (enabled/disabled per saved-URL presence), in-flight (spinner, disabled), success (session dispatched confirmation), error (one generic public-safe message covering every failure cause — no vendor name, no billing internals, ever exposed to a public visitor). |
| 5 | Passcode UX for the Save gate | Fully specified in §4 Screen C and §5 wireframes C1–C4. A second field on the Meeting tab form, `type="password"`, labelled "Passcode", required alongside the URL field; wrong passcode surfaces an inline error under that field; the passcode value is never stored client-side (not in `localStorage`/`sessionStorage`, not pre-filled on reload) and must be re-entered for every save, including edits to an already-saved URL. |

**Why dispatch (not just Save) needed an additional technical safeguard, resolved here as a BA technical decision, not a product-shape change:** the CEO brief explicitly scoped the passcode gate to the Save action only ("gate the Save action \[...\] not page viewing, not the tab itself"), and CEO Resolution 3 only requires the button to be disabled until a URL is saved — neither says anything about limiting *repeat* clicks of an already-enabled button. Read literally, once any legitimate URL is saved, an anonymous visitor could click "Learn with AI" an unlimited number of times, causing the real bot to repeatedly (even if harmlessly, `test_mode`-billed) join Arun's own saved meeting on demand — a residual abuse/nuisance vector the brief's own reasoning ("an unprotected save box lets anyone \[...\] point Clio's bot at an arbitrary Google Meet, on demand, for free") would apply equally to. Per `CLAUDE.md`'s "Autonomy boundary: technical vs. product decisions," rate-limiting a write endpoint is a technical/error-handling decision (full BA/Dev autonomy), not a UX/product one — it changes no visible screen, copy, or button behavior in the success case, only what happens on rapid repeat-click. **Resolution:** the dispatch route enforces a **3-minute cooldown per topic slug** (§6.3) — a second dispatch attempt for the same `slug` within 3 minutes of the previous attempt (success or failure) returns `429` with the same generic public-safe copy used for other dispatch failures (§4 Screen D, error state), so a bored or malicious repeat-clicker cannot cost-spam the vendor call, while Arun retesting a few minutes apart is unaffected.

---

## 1. Purpose

The public "Learn with AI" demo at `test.hello-clio.com/demo` exists to prove, to anyone who lands on
it, that Clio's real product works: a real bot joining a real meeting and narrating real content,
switching visuals as it moves through subtopics — not a mockup. Today the "Learn with AI" button on
every demo topic page is a dead click that shows "Demo only — nothing is wired up behind this button
yet." This feature closes that gap: it wires the button to Clio's real, already-built session-dispatch
pipeline (the same one real partners use), scoped to a Google Meet URL the demo operator (Arun) saves
on the page itself.

Without this feature, the single most important proof point of the entire demo surface — "the bot
actually works, watch it happen live" — cannot be demonstrated at all. The demo remains permanently
inert, and every visitor who clicks "Learn with AI" is met with an explicit admission that the product
isn't really there.

---

## 2. User Story

As **Arun (the demo operator)**,
I want to paste a Google Meet URL into a topic's Meeting tab, save it behind a passcode, and click
"Learn with AI",
So that Clio's real bot joins that meeting and narrates the topic's real chapter content, switching
visuals chapter-by-chapter, as a live proof of the product to whoever I'm demoing to.

As **a public visitor to `/demo/{slug}`** (anyone who finds the page),
I want to see the Meeting tab and the "Learn with AI" button behave predictably — disabled with a clear
reason if no meeting is set up, or dispatching the bot if one is,
So that I understand what the button does even if I can't (and shouldn't be able to, without the
passcode) change what meeting it joins.

---

## 3. Trigger / Entry Point

- **Route:** `/demo/{slug}` where `slug` is `claude-ai` or `oop-fundamentals` (the two existing
  `DEMO_TOPICS` entries). This is an existing page — no new route for the tab itself.
- **New API routes (server-only, no page UI of their own):**
  - `GET /api/demo/[slug]/meeting` — reads the currently saved meeting URL for that topic.
  - `POST /api/demo/[slug]/meeting` — saves/overwrites the meeting URL for that topic (passcode-checked).
  - `POST /api/demo/[slug]/dispatch` — dispatches the bot into the saved meeting URL (rate-limited, not
    passcode-checked).
- **Trigger actions:**
  - Meeting tab click → `GET /api/demo/[slug]/meeting` fires (see §9 Edge Case on *why* this must also
    fire on initial page load, not just on Meeting-tab click, because of the button's disabled state).
  - Save button click (Meeting tab) → `POST /api/demo/[slug]/meeting`.
  - "Learn with AI" button click → `POST /api/demo/[slug]/dispatch`.
- **State required:** none. `/demo/*` remains fully public, no Clerk session, no login, matching the
  Known Constraint that this surface must stay unauthenticated. The passcode is a shared secret checked
  per-request, not a login/session.
- **Host scoping:** exactly like the rest of `/demo/*`, these three new API routes must resolve **only**
  on the `TEST_HARNESS_HOST` (`test.hello-clio.com`) — not on the main app origin. This requires
  extending `lib/test-harness/paths.ts`'s `isDemoPath()` to also match `/api/demo/(.*)`, not just
  `/demo` and `/demo/(.*)` (§6.6 — a gap that exists today because these routes didn't exist yet when
  `isDemoPath` was written for B2B-32).

---

## 4. Screen / Flow Description

### Screen A — Existing topic page, tab row (modified)

The existing `TABS` constant in `DemoTopicClient.tsx` is:
`['Course Overview', 'Transcript', 'Visuals', 'Resources', 'Discussion', 'Learning Check']`.

It becomes:
`['Course Overview', 'Transcript', 'Visuals', 'Resources', 'Discussion', 'Meeting', 'Learning Check']`

— **Meeting** inserted immediately after **Discussion** and before **Learning Check**, per the CEO
brief's own ordering ("at the end of topic page where you have discussion, learning check, add one
more option called meeting" — read as "in that same tab row, after Discussion"). Same tab styling as
every other tab (`tabStyle(active)` from `_styles.ts` — active tab gets the purple underline, inactive
tabs are muted, exactly like the other 6). No new visual treatment invented for this one tab.

### Screen B — "Learn with AI" button, in the action bar (modified)

The existing action bar (`actionBarStyle`) already has three items: Start Course, Bookmark, and
"✨ Learn with AI" (`aiButtonStyle`). The button element itself is unchanged in styling. Its **behavior**
changes completely — see Screen D for the 4 states.

On initial page mount (not gated behind clicking the Meeting tab), the page fires
`GET /api/demo/[slug]/meeting` to learn whether a URL is already saved, because the button's
enabled/disabled state depends on that answer and must be correct the instant the page renders, before
any tab is clicked. See §9 Edge Case 1.

### Screen C — Meeting tab content (new)

**State C1 — No URL saved yet, form empty (default/first ever visit to this topic):**

- A short static intro line: `For this demo, paste the Google Meet URL you want Clio's bot to join, then Save.`
  (`chapterBodyStyle`-styled paragraph, `color: COLORS.textMuted`).
- A labelled text input, full width up to `max-w-[520px]`:
  - Label text above the input: `Google Meet URL`
  - `<input type="url" placeholder="https://meet.google.com/xxx-xxxx-xxx">`
  - Styled to match the codebase's existing input-less pattern (no prior form input exists in
    `_styles.ts` to reuse verbatim — new style object `meetingInputStyle` needed, built from the same
    tokens: `background: COLORS.surface`, `border: 1px solid COLORS.border`, `borderRadius: 8`,
    `padding: '12px 14px'`, `color: COLORS.textPrimary`, `fontSize: 14`, `width: '100%'`, focus state
    `border-color: COLORS.accent`).
- A second labelled field directly below it, same width:
  - Label text: `Passcode`
  - `<input type="password" placeholder="Passcode">`, same `meetingInputStyle`.
- Below both fields, a **Save** button (`primaryButtonStyle`, same visual weight as "Start Course"),
  disabled (visually dimmed, `cursor: not-allowed`, no click handler fires) until **both** fields are
  non-empty. This is a client-side convenience only — the real check is server-side (§6.1).
- No pre-existing saved-URL display, because none exists yet.

**State C2 — URL already saved (returning visit, or right after a successful save):**

- Directly above the form, a read-only summary line:
  `Currently saved: `**`https://meet.google.com/abc-defg-hij`**` — saved Jul 22, 2026, 4:03 PM.`
  (the URL rendered as plain text, not a clickable link — clicking it would navigate a public visitor
  into Arun's live meeting, which is not desired; `updated_at` formatted via `date-fns` in the
  demo-page's local rendering, no timezone conversion needed for this internal tool — displayed as the
  server's UTC value formatted with `date-fns`'s default `format()`, e.g. `MMM d, yyyy, h:mm a`).
- The form below it (same two fields as C1) is **always present and always empty on load** — the URL
  field is **not** pre-filled with the existing value (avoids ever displaying a previously-entered value
  in an editable input that a screenshot or shoulder-surf could capture more easily than the read-only
  line above; also sidesteps "is this the old value or did autofill touch it" ambiguity). Placeholder
  text changes to reflect editing intent: `placeholder="Paste a new Google Meet URL to replace the saved one"`.
- Passcode field: same as C1, always empty, always required to save again — **the passcode is never
  waived for "just editing an existing value."**
- Save button: same enable/disable rule as C1 (both fields non-empty).

**State C3 — Save in flight:**

- Save button text changes to `Saving…`, disabled, both input fields disabled (`readOnly`) for the
  duration of the request.

**State C4 — Save result:**

- **Success:** both fields clear immediately, an inline green confirmation line appears directly under
  the Save button for 4 seconds then fades: `✓ Saved.` (`color: COLORS.green`). The read-only summary
  line above the form (C2) updates immediately to the new URL/timestamp without a page reload (the
  save response returns the saved row; the client updates its local state from that response, no second
  GET needed).
- **Wrong passcode:** inline red error line under the Passcode field only:
  `Incorrect passcode.` (`color: COLORS.red` — a new token needed in `_styles.ts`'s `COLORS`, e.g.
  `#ef4444`, since no red exists there today). Both fields keep whatever the user typed (do **not**
  clear the URL field on a passcode failure — only clear on success, so the user doesn't have to retype
  a URL they got right). Save button re-enables immediately.
- **Invalid URL** (fails `z.string().url()` or doesn't start with `https://` — §6.1): inline red error
  under the URL field: `Enter a valid https:// meeting URL.`
- **Network/server error** (500, timeout): inline red error under the Save button, same position as the
  success message would occupy: `Couldn't save — try again.`

### Screen D — "Learn with AI" button states (the CEO brief's Question 4, resolved)

**State D1 — No URL saved (button disabled):**

- Button renders visually dimmed (same `aiButtonStyle` background/gradient at reduced opacity, e.g.
  `opacity: 0.5`), `cursor: not-allowed`, `disabled` attribute set — no click handler fires at all.
- Inline note immediately to the right of the button (same position/style as the existing
  `aiClicked` note that currently reads "Demo only — nothing is wired up behind this button yet"):
  `Save a meeting URL in the Meeting tab to enable this.`
- **While the initial `GET /api/demo/[slug]/meeting` fetch is still in flight** (page just loaded), the
  button renders in this same disabled/dimmed visual state but with **no note text at all** — avoids a
  flash of "Save a meeting URL..." for a topic that actually already has one saved, which would
  self-correct a beat later and read as buggy. Once the fetch resolves, the button/note update to
  whichever of D1 or D2 is correct — no loading spinner needed for this specific fetch, since the delay
  is expected to be well under a second server round-trip.

**State D2 — URL saved, idle (button enabled):**

- Button renders exactly as it does today (`aiButtonStyle`, full opacity, `cursor: pointer`), no note
  text next to it.

**State D3 — Dispatch in flight (button clicked):**

- Button text changes from `✨ Learn with AI` to `Dispatching bot…`, button becomes disabled
  (`cursor: not-allowed`, same dimmed treatment as D1) for the duration of the request — prevents
  double-click spam on top of the server-side 3-minute cooldown (§0).
- No separate spinner icon needed; the text change is the loading indicator (matches the codebase's
  existing minimal-affordance style — no spinner component exists anywhere else in `_styles.ts`).

**State D4 — Dispatch result:**

- **Success (`status: 'dispatched'`):** button is replaced by a static, non-interactive confirmation
  chip for the rest of that page load: `✓ Bot is joining the meeting.` (styled like `pillStyle` but with
  `color: COLORS.green`, `borderColor: COLORS.green`). A page reload resets the button back to D2 (idle,
  clickable again) — the 3-minute per-slug cooldown, not the frontend, is what actually prevents an
  immediate re-dispatch; if the visitor reloads and clicks again inside the cooldown window, they get
  the D4 error state below with the cooldown message.
- **Any failure** (`no_meeting_url`, `rate_limited`, `dispatch_failed` — §6.3's exact status values):
  button re-enables (back to D2's clickable style) and an inline note appears next to it, in
  `color: COLORS.red`, using **one of exactly two messages**, never a raw/technical one:
  - Rate-limited (`429`): `Learn with AI was just triggered for this course. Try again in a few minutes.`
  - Everything else (`no_meeting_url` defensive case, `dispatch_failed`, network error, any 4xx/5xx from
    the dispatch route): `Something went wrong starting the bot. Try again in a moment.`
  No vendor name, no `card_required`/`trial_exhausted`/HTTP status code, no raw upstream error message
  is ever rendered — the dispatch route itself is responsible for this collapse (§6.3), not the client.

---

## 5. Visual Examples

**A1 — Tab row (any tab active), Meeting tab present:**
```
┌───────────────────────────────────────────────────────────────────────┐
│  Course Overview   Transcript   Visuals   Resources   Discussion       │
│  Meeting   Learning Check                                              │
│  ─────────                                                             │
└───────────────────────────────────────────────────────────────────────┘
```

**B1 — Action bar, button disabled (no URL saved):**
```
┌───────────────────────────────────────────────────────────────────────┐
│  [▶ Start Course]  [Bookmark]  [✨ Learn with AI (dimmed)]              │
│                     Save a meeting URL in the Meeting tab to enable    │
│                     this.                                              │
└───────────────────────────────────────────────────────────────────────┘
```

**B2 — Action bar, button enabled (URL saved):**
```
┌───────────────────────────────────────────────────────────────────────┐
│  [▶ Start Course]  [Bookmark]  [✨ Learn with AI]                       │
└───────────────────────────────────────────────────────────────────────┘
```

**C1 — Meeting tab, nothing saved yet:**
```
┌───────────────────────────────────────────────────────────────────────┐
│  For this demo, paste the Google Meet URL you want Clio's bot to      │
│  join, then Save.                                                     │
│                                                                         │
│  Google Meet URL                                                       │
│  [https://meet.google.com/xxx-xxxx-xxx                        ]       │
│                                                                         │
│  Passcode                                                              │
│  [••••••••                                                    ]       │
│                                                                         │
│  [Save]  (disabled until both fields are filled)                       │
└───────────────────────────────────────────────────────────────────────┘
```

**C2 — Meeting tab, URL already saved:**
```
┌───────────────────────────────────────────────────────────────────────┐
│  Currently saved: https://meet.google.com/abc-defg-hij                │
│  — saved Jul 22, 2026, 4:03 PM.                                        │
│                                                                         │
│  Google Meet URL                                                       │
│  [Paste a new Google Meet URL to replace the saved one         ]      │
│                                                                         │
│  Passcode                                                              │
│  [••••••••                                                    ]       │
│                                                                         │
│  [Save]                                                                │
└───────────────────────────────────────────────────────────────────────┘
```

**C4-err — Meeting tab, wrong passcode:**
```
┌───────────────────────────────────────────────────────────────────────┐
│  Google Meet URL                                                       │
│  [https://meet.google.com/abc-defg-hij                        ]       │
│                                                                         │
│  Passcode                                                              │
│  [••••••••                                                    ]       │
│  Incorrect passcode.                                                   │
│                                                                         │
│  [Save]                                                                │
└───────────────────────────────────────────────────────────────────────┘
```

**D3 — Dispatch in flight:**
```
┌───────────────────────────────────────────────────────────────────────┐
│  [▶ Start Course]  [Bookmark]  [Dispatching bot… (dimmed, disabled)]   │
└───────────────────────────────────────────────────────────────────────┘
```

**D4-success — Dispatch succeeded:**
```
┌───────────────────────────────────────────────────────────────────────┐
│  [▶ Start Course]  [Bookmark]  (✓ Bot is joining the meeting.)         │
└───────────────────────────────────────────────────────────────────────┘
```

**D4-error — Dispatch failed:**
```
┌───────────────────────────────────────────────────────────────────────┐
│  [▶ Start Course]  [Bookmark]  [✨ Learn with AI]                       │
│                     Something went wrong starting the bot. Try again   │
│                     in a moment.                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### 6.0 New table

```sql
CREATE TABLE IF NOT EXISTS demo_meeting_urls (
  slug                        TEXT PRIMARY KEY,
  meeting_url                 TEXT NOT NULL,
  last_dispatch_attempted_at  TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_demo_meeting_urls_updated_at
  BEFORE UPDATE ON demo_meeting_urls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE demo_meeting_urls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on demo_meeting_urls"
  ON demo_meeting_urls FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE demo_meeting_urls IS
  'B2B-33: one row per public "Learn with AI" demo topic slug, holding the Google Meet URL Arun wants
  Clio''s bot to join for that demo. Public-write (passcode-gated at the API layer, not RLS — this
  table has no anon/authenticated policy at all) and public-read (no passcode on the GET). Not a
  partner-facing table; the slug is app/demo/_content.ts''s DemoTopic.slug, not a DB foreign key,
  because demo topics are static in-code data, not DB-backed.';
```

Migration file: `supabase/migrations/093_b2b33_demo_meeting_dispatch.sql` (next sequential number after
`092_b2b32_internal_content_test_harness.sql`). This same migration file also contains the dedicated
internal partner account insert (§12) since both are one-time, additive, infra-adjacent changes for
this brief, mirroring migration 092's own combined table-creation-plus-storage-bucket precedent.

### 6.1 `GET /api/demo/[slug]/meeting`

- No auth, no passcode (page-viewing-equivalent read, per Known Constraints).
- 404 if `slug` isn't `claude-ai` or `oop-fundamentals` (validated against `getDemoTopicBySlug` from
  `app/demo/_content.ts`, not just "any string").
- Reads `demo_meeting_urls` by `slug` via `createSupabaseAdminClient()`.
- Response `200`: `{ meeting_url: string | null, updated_at: string | null }` — both `null` if no row
  exists yet (not a 404; "no meeting saved yet" is a normal, expected state, not an error).

### 6.2 `POST /api/demo/[slug]/meeting`

- Zod body schema:
  ```ts
  const SaveMeetingUrlSchema = z.object({
    meeting_url: z.string().url().refine((u) => u.startsWith('https://'), {
      message: 'meeting_url must be an https:// URL',
    }),
    passcode: z.string().min(1),
  })
  ```
  This matches — no more, no less — the real pipeline's own `CreateSessionSchema.meeting_url` validation
  ceiling (`z.string().url()`), plus an explicit `https://` requirement (Known Constraint: "confirm/
  require the same validation the real pipeline already applies"; the real pipeline never receives a
  non-`https://` URL in practice since Google Meet URLs are always `https://`, but nothing in
  `CreateSessionSchema` enforces that scheme today — this route adds that one extra floor rather than
  silently trusting `z.string().url()` alone, since this route's `meeting_url` is public-write in a way
  the real API's never is).
- 422 on Zod failure — response `{ error: { code: 'validation_failed', message, details } }`.
- 401 if `passcode !== process.env.DEMO_MEETING_PASSCODE` (constant-time string comparison — reuse the
  same pattern `checkTestHarnessBasicAuth` already uses in `lib/test-harness/basic-auth.ts` for its own
  credential compare, applied here to a single string instead of a user/password pair). Response:
  `{ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }`.
- 404 if `slug` isn't one of the two known demo slugs (same check as §6.1).
- On success: `upsert` into `demo_meeting_urls` (`slug` as the conflict target), setting `meeting_url`.
  Does **not** touch `last_dispatch_attempted_at`. Response `200`:
  `{ meeting_url: string, updated_at: string }` (the just-saved row, so the client can update Screen C2
  without a second GET).

### 6.3 `POST /api/demo/[slug]/dispatch`

- No passcode check (§0).
- 404 if `slug` isn't one of the two known demo slugs.
- Loads the `demo_meeting_urls` row for `slug`. If none exists (`meeting_url` never saved): `422`,
  `{ error: { code: 'no_meeting_url', message: 'No meeting URL has been saved for this topic yet.' } }`
  — this should be unreachable in normal use since the button is disabled in that state (D1), but the
  route must still defend against a direct API call bypassing the UI.
- **Rate-limit check (§0):** if `last_dispatch_attempted_at` is non-null and less than 3 minutes ago,
  `429`, `{ error: { code: 'rate_limited', message: 'Try again in a few minutes.' } }`. Otherwise,
  immediately `UPDATE demo_meeting_urls SET last_dispatch_attempted_at = NOW() WHERE slug = $1` (before
  the outbound call, so two near-simultaneous requests both racing past the read-check still can't both
  proceed — small accepted race window, not a financial system, "good enough" per Known Constraint's
  own cost framing of this whole surface as free/test-mode).
- **Payload assembly** (deterministic, no AI call, per Known Constraint "No AI-generated content on
  this screen"):
  ```ts
  const topic = getDemoTopicBySlug(slug) // app/demo/_content.ts — throws/404s if somehow missing here,
                                          // already guaranteed present by the earlier slug check

  const content_pages = topic.chapters.map((ch) => ({
    url: `${process.env.NEXT_PUBLIC_APP_URL}/demo/${slug}/visuals/${ch.id}`,
    media_type: 'html' as const,
    title: ch.title,
    transition_trigger: `Move on once "${ch.title}" has been fully explained.`,
  }))

  const expected_duration_minutes = topic.chapters.reduce((sum, ch) => {
    const m = parseInt(ch.durationLabel, 10)
    return sum + (Number.isNaN(m) ? 0 : m)
  }, 0)
  // identical parsing logic to DemoTopicClient.tsx's existing totalMinutes computation —
  // every current chapter's durationLabel is a plain "Nm" string, never "1h Nm", so parseInt is exact.

  const body = {
    meeting_url: savedRow.meeting_url,
    content_pages,
    content_source_id: process.env.DEMO_CONTENT_SOURCE_ID,
    content_to_explain: topic.overview,
    title: topic.title,
    subtitle: topic.subtitle,
    expected_duration_minutes,
    partner_reference: slug,
  }
  ```
  `transition_trigger` is built from `Chapter.title` alone (not the first paragraph) — CEO Resolution 5
  allowed either; `title`-only is chosen here for a short, deterministic, always-well-formed sentence
  regardless of a chapter's first paragraph shape (some chapters open with a code block, not prose —
  see `app/demo/_content.ts`'s `classes-and-objects` chapter, whose first block is a `paragraph` but
  several chapters' *second* block is `code`; title-only sidesteps ever having to pick a fallback for a
  chapter whose first block isn't prose).
- **Outbound call:**
  ```
  POST {NEXT_PUBLIC_APP_URL}/api/partner/v1/sessions
  Authorization: Bearer ${process.env.DEMO_PARTNER_API_KEY}
  Content-Type: application/json
  <body above>
  ```
  This is a same-origin, server-to-server call to Clio's own existing endpoint — not a third-party call,
  so it does not require a new approved-vendor entry (`CLAUDE.md`'s "Network access rules" govern calls
  to *external* APIs; this is Clio calling Clio).
- **Response mapping** — the dispatch route **never forwards the upstream response body verbatim** to
  the public client (Known Constraint's billing/data-isolation framing + the general no-info-leak
  convention already used by `redactVendorIdentifiers`/`requirePartnerAdmin`'s indistinguishable-403
  pattern elsewhere in this codebase):
  | Upstream `/api/partner/v1/sessions` outcome | This route's response |
  |---|---|
  | `201` with `status: 'bot_active'` | `200 { status: 'dispatched', clio_session_ref }` |
  | `201` with `status: 'bot_dispatch_failed'` | `502 { error: { code: 'dispatch_failed', message: 'Something went wrong starting the bot. Try again in a moment.' } }` (upstream's own redacted `error` string is logged server-side via `console.error`, never returned) |
  | `402` (`card_required` / `trial_exhausted`) | `502 { error: { code: 'dispatch_failed', message: 'Something went wrong starting the bot. Try again in a moment.' } }` (same generic message — a public visitor must never learn this is a billing-configuration issue on Clio's internal account; logged server-side with the real code for Arun to notice in Vercel logs) |
  | Network error / timeout calling `/api/partner/v1/sessions` | Same `502`, same generic message |
  | Any other non-2xx | Same `502`, same generic message |

  The client-side mapping in §4 Screen D collapses this further to exactly two visible messages
  (rate-limited vs. everything-else) — the route's own `dispatch_failed` code is the "everything else"
  bucket.

### 6.4 Data read from the database

- `demo_meeting_urls` — `slug`, `meeting_url`, `updated_at` (GET route); `slug`, `meeting_url`,
  `last_dispatch_attempted_at` (dispatch route, for the rate-limit check).
- `partner_content_sources` / `partner_wallets` / `partner_api_keys` / `partner_accounts` — read
  indirectly, inside the real `/api/partner/v1/sessions` route this feature calls, not directly by any
  new code in this feature.

### 6.5 Data written to the database

- `demo_meeting_urls` — upserted by the Save route (`meeting_url`, `updated_at`); updated by the
  dispatch route (`last_dispatch_attempted_at` only).
- `partner_sessions` — written by the real `/api/partner/v1/sessions` route this feature calls, exactly
  as it is for any real partner call; not written directly by any new code in this feature.

### 6.6 APIs called

- Own: `POST {NEXT_PUBLIC_APP_URL}/api/partner/v1/sessions` (server-to-server, §6.3).
- One-time, Orchestrator-only, not runtime code: `POST {NEXT_PUBLIC_APP_URL}/api/partner/v1/
  content-sources` (§0 point 2, §12) and `POST {NEXT_PUBLIC_APP_URL}/api/admin/partner-keys` (§12).

### 6.7 `localStorage` / `sessionStorage`

None. The meeting URL and passcode are never persisted client-side in any form — every page load
re-fetches the current saved URL from the server (§6.1), and the passcode field is always empty on
render, never pre-filled, never cached.

### 6.8 Middleware / routing changes

- `lib/test-harness/paths.ts`'s `isDemoPath()` extended:
  ```ts
  export function isDemoPath(pathname: string): boolean {
    return (
      pathname === '/demo' ||
      pathname.startsWith('/demo/') ||
      pathname === '/api/demo' ||
      pathname.startsWith('/api/demo/')
    )
  }
  ```
  This single change automatically (a) lets the three new routes pass through the existing
  `TEST_HARNESS_HOST` early-bypass branch in `middleware.ts` (`if (isDemoPath(pathname)) return
  NextResponse.next()`), and (b) extends the existing defense-in-depth 404 (`if (isDemoPath(pathname))
  return neutralNotFoundResponse()`) to also block these three routes on every host other than
  `test.hello-clio.com` — no other line in `middleware.ts` needs to change, since both branches already
  key off `isDemoPath()`.
- No change to Clerk's `isPublicRoute` list is needed: `/api/*` routes already skip the Clerk
  `auth().protect()` gate entirely (`middleware.ts`'s existing `const isApiRoute = ...; if (!isApiRoute
  && !isPublicRoute(request))`), so the three new API routes need no entry there.

---

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given a demo topic page with no saved meeting URL, when the page loads, then the "Learn with AI"
   button is disabled and, once the initial `GET /api/demo/[slug]/meeting` resolves, shows the note
   "Save a meeting URL in the Meeting tab to enable this."
2. ✓ Given the Meeting tab with an empty URL field or empty passcode field, when the user looks at the
   Save button, then it is disabled (no click handler fires).
3. ✓ Given a correct passcode and a valid `https://` URL, when Save is clicked, then
   `POST /api/demo/[slug]/meeting` returns `200`, `demo_meeting_urls` is upserted with that `slug`, the
   form clears, "✓ Saved." appears, and the "Currently saved" summary line updates without a page reload.
4. ✓ Given an incorrect passcode, when Save is clicked, then the route returns `401`, no row is written
   or changed in `demo_meeting_urls`, and "Incorrect passcode." appears under the Passcode field only
   (the URL field's typed value is preserved, not cleared).
5. ✓ Given a saved meeting URL, when "Learn with AI" is clicked, then the button shows "Dispatching
   bot…" and is disabled for the duration of the request.
6. ✓ Given a saved meeting URL and a healthy dispatch, when `POST /api/demo/[slug]/dispatch` resolves
   with `status: 'dispatched'`, then the button is replaced with "✓ Bot is joining the meeting." for the
   rest of that page load, and `demo_meeting_urls.last_dispatch_attempted_at` for that slug is updated
   to the dispatch time.
7. ✓ Given a dispatch was attempted for a slug less than 3 minutes ago, when "Learn with AI" is clicked
   again (a fresh page load, so the frontend's own D4-success lock doesn't apply), then
   `POST /api/demo/[slug]/dispatch` returns `429`, and the UI shows exactly "Learn with AI was just
   triggered for this course. Try again in a few minutes." — never the underlying `429`/`rate_limited`
   code.
8. ✓ Given the real `/api/partner/v1/sessions` call returns any failure (dispatch failure, `402`,
   network error), when the dispatch route responds, then the public client receives only the generic
   message "Something went wrong starting the bot. Try again in a moment." — never a vendor name, HTTP
   status, or the words "card," "trial," "balance," or "Attendee"/"Recall" in the response body.
9. ✓ Given `content_pages[]` is assembled for a dispatch, then it contains exactly one entry per chapter
   in that topic (5 for `claude-ai`, 7 for `oop-fundamentals`), each `url` pointing at the topic's
   already-live `/demo/{slug}/visuals/{chapterId}` static page, and each `transition_trigger` following
   the exact template `Move on once "{chapter.title}" has been fully explained.`
10. ✓ Given any request to `/demo/*` or `/api/demo/*` arrives on a host other than `test.hello-clio.com`
    (e.g. the main app origin), then it resolves to the existing neutral 404 response, identical to
    every other test-harness/demo path today.
11. ✓ Given the dedicated "Clio Internal — Public Demo" partner account's API key, when any dispatch
    from this feature fires, then the resulting `partner_sessions` row has `test_mode = true` and
    `partner_account_id` equal to that dedicated account's id — never any other partner account's id,
    and `balance_usd` on any other partner's wallet is never read or modified by this feature.

---

## 8. Error States

| Input / call | Failure | User sees |
|---|---|---|
| Meeting URL field | Not a valid URL, or not `https://` | Inline: "Enter a valid https:// meeting URL." |
| Passcode field | Empty | Save button stays disabled — no server round-trip happens |
| Passcode field | Wrong value (server-checked) | Inline: "Incorrect passcode." under that field |
| Save request | Network/500 error | Inline: "Couldn't save — try again." |
| Save request | Slow network | No explicit spinner beyond the "Saving…" button-text state (§4 Screen C3) — sufficient given the short, low-latency nature of a single-row upsert; no separate skeleton/placeholder needed |
| Dispatch request | No meeting URL saved (defensive, unreachable via normal UI) | `422 no_meeting_url` → generic "Something went wrong starting the bot. Try again in a moment." (same collapse as every other dispatch failure — §4 Screen D never distinguishes this from `dispatch_failed` to the visitor, since a well-behaved UI should never let them trigger this specific case) |
| Dispatch request | Rate-limited (< 3 min since last attempt for this slug) | "Learn with AI was just triggered for this course. Try again in a few minutes." |
| Dispatch request | Upstream `/api/partner/v1/sessions` returns `bot_dispatch_failed`, `402`, or any error | "Something went wrong starting the bot. Try again in a moment." |
| Dispatch request | Network/timeout calling the upstream sessions endpoint | Same generic message as above |
| `GET` meeting-URL fetch on page load | Fails (network/500) | Button falls back to the disabled/no-note treatment (§4 State D1's "fetch in flight" sub-state) rather than assuming a URL is saved — fails closed, never fails open into an enabled button with no known-good URL behind it |

---

## 9. Edge Cases

1. **Button state depends on a client-side fetch, and the page is statically generated.** Confirmed by
   reading `app/demo/[slug]/page.tsx`: it uses `generateStaticParams()`, meaning the page is prerendered
   at build time. A server-fetched prop for the saved meeting URL would bake in a build-time value and
   go stale the moment someone saves a new URL post-deploy, with no redeploy to refresh it. This is why
   `DemoTopicClient.tsx` (already a client component) must fetch `GET /api/demo/[slug]/meeting` itself,
   on mount, independent of which tab is active — not read it from a server-rendered prop.
2. **Two demo topics only, forever (for this brief).** `slug` is validated against the two literal
   `DEMO_TOPICS` entries, not treated as an arbitrary partner-controlled string — a third demo topic
   added later needs no schema change (the table is already keyed by `slug` generically), but the two
   new API routes' 404-on-unknown-slug check is written against `getDemoTopicBySlug()`, so it
   automatically covers any future addition to `DEMO_TOPICS` with zero further change.
3. **Same meeting URL saved for both topics simultaneously.** Fully supported and expected — each topic
   has its own row (`slug` is the primary key), so `claude-ai` and `oop-fundamentals` can have
   different, the same, or no meeting URL independently. Arun could point both demos at the same Meet
   call if giving one combined walkthrough.
4. **Rapid double-click on "Learn with AI" before the D3 in-flight state visually updates.** The button
   is disabled synchronously on click (before the network request even starts), so a double-click within
   the same render frame cannot fire two requests from one page's own state — the 3-minute server-side
   cooldown is the defense against a *second page load* or a *different visitor* re-triggering it, not
   against this specific single-page double-click, which is already prevented client-side.
5. **Visitor opens the Meeting tab, sees the currently-saved URL, and never intends to change it — no
   passcode friction for viewing.** Fully by design (§0/Known Constraints): the `GET` route has no
   passcode; only `POST` (Save) does.
6. **Mobile layout.** Per the standing responsive rule, the new Meeting tab's two input fields and Save
   button stack full-width on narrow viewports (`max-width: min(520px, 100%)` on the field container,
   no hardcoded pixel cap that would overflow a phone screen), and the tab row itself already scrolls
   horizontally on overflow (`tabRowStyle`'s existing `overflowX: 'auto'`) — the 7th tab (Meeting) simply
   becomes one more scrollable tab, no layout change needed there. The action bar's "Learn with AI"
   button and its inline note already wrap via `actionBarStyle`'s existing `flexWrap: 'wrap'` — the new,
   longer note copy ("Save a meeting URL in the Meeting tab to enable this.") wraps to a second line on
   narrow viewports rather than overflowing, verified against the existing `flexWrap` behavior already
   present for the current, shorter placeholder note.
7. **Two demo topics, two independent 3-minute cooldowns.** The rate limit is per-`slug`, not global —
   dispatching `claude-ai` does not block a simultaneous dispatch of `oop-fundamentals`.
8. **The dedicated internal partner account's wallet has no card on file yet at build time.** Flagged
   explicitly and non-blocking for writing this spec or building the code (§12) — but a real risk for
   tomorrow's live test if not resolved before then, since `POST /api/partner/v1/sessions` unconditionally
   rejects any `test_mode` request with `card_required` (`402`) if `partner_wallets.stripe_default_
   payment_method_id` is null for that account (B2B-27, "no grandfathering," confirmed by reading
   `app/api/partner/v1/sessions/route.ts` lines 160–180). This feature's own code handles that outcome
   correctly (it collapses to the same generic "Something went wrong" message, §6.3/§8) — but Arun should
   know, before clicking Learn with AI tomorrow, that a Stripe test-mode card must be attached to the new
   "Clio Internal — Public Demo" wallet first, or every dispatch will fail with this cause. **Exact fix:**
   `POST /api/admin/billing/card-verification` (`requirePartnerAdmin`-gated, `lib/stripe.ts`'s
   `createCardVerificationCheckoutSession()` → `getOrCreateStripeCustomer()`) returns a zero-dollar,
   `mode: 'setup'` Stripe Checkout URL; completing it with a Stripe test-mode card (e.g.
   `4242 4242 4242 4242`) lets the Stripe webhook sync `stripe_default_payment_method_id` onto the
   wallet automatically. See §12's provisioning step 4 for the full ordered sequence.

---

## 10. Out of Scope

- No change to the **content** of any demo topic — `app/demo/_content.ts`'s chapter text is used
  verbatim, never edited, summarized, or regenerated by this feature.
- No AI-generated `transition_trigger` text — the template in §6.3 is fixed and deterministic.
- No editing or deleting a saved meeting URL from any UI other than overwriting it via Save (no explicit
  "Clear" or "Delete" action).
- No history of previously-saved meeting URLs — `demo_meeting_urls` holds exactly one current value per
  slug; overwriting is destructive, matching Arun's own framing ("any url that is present in that box
  will be sent to the bot").
- No display of `clio_session_ref`, `provider_bot_id`, `provider_name`, or any other internal/vendor
  identifier to the public visitor — internal-only, server-log-only (§6.3).
- No rate-limiting UI countdown ("try again in 2m 14s") — the copy is static ("try again in a few
  minutes"), not a live timer.
- No new Clerk auth, no user accounts, no session/login concept anywhere on `/demo/*` — the passcode is
  a shared secret, not a credential tied to an identity.
- No change to how the bot behaves once dispatched (voice, pacing, quiz/learning-check behavior) — this
  feature only gets the bot into the meeting with the right content payload; everything downstream is
  the existing, unmodified B2B-19/real-session runtime.
- No admin UI to view/manage all saved demo meeting URLs across topics in one place — each topic's own
  Meeting tab is the only place to see/change its URL.
- **No live-trigger verification during this build.** Per explicit instruction, this feature is built
  and verified with static checks only (`tsc`, `npm run build`, unit/integration tests with the
  `/api/partner/v1/sessions` call mocked) — no test in this build's own verification pass may save a
  real meeting URL and click "Learn with AI" against the real endpoint, or otherwise cause a real
  bot-join attempt. End-to-end live verification is deferred to Arun testing it himself. See §7's
  acceptance criteria for what unit/integration tests must cover with the upstream call mocked, and the
  explicit warning below.

> **BUILD-TIME WARNING FOR THE DEV AGENT.** Do not, at any point while implementing or "verifying" this
> feature, actually call the real `/api/partner/v1/sessions` endpoint with a real `meeting_url`, and do
> not save a real Google Meet URL and click "Learn with AI" end-to-end against the live dispatch route.
> Unit and integration tests must mock `dispatchMeetingBot` / the outbound `fetch` to
> `/api/partner/v1/sessions` — never let a test path actually reach the real meeting-bot provider. Static
> verification only: `npx tsc --noEmit`, `npm run build`, mocked unit/integration tests for the three new
> routes, and a UI check of the four button/form states using mocked API responses. Arun tests the real,
> live trigger himself tomorrow morning.

---

## 11. Open Questions

None. All 5 questions delegated to the BA in the CEO Feature Brief are resolved in §0 above.

---

## 12. Dependencies

- **B2B-19** (inline content delivery, `CreateSessionSchema`, `content_pages[]`, transition markers,
  `dispatchMeetingBot`) — done; this brief is a new caller of that existing, unmodified contract.
- **B2B-06/B2B-27** (`partner_wallets`, funding/card-on-file guardrails, `test_mode` semantics) — done;
  this brief's dedicated account relies on `test_mode: true` to stay outside the live-mode funding
  guardrail, exactly as B2B-32's account does, but is still subject to B2B-27's unconditional
  card-on-file check for test mode (see the provisioning step below and Edge Case 8).
- **B2B-31** (`content_source_id`/`auth_type: 'none'` registration precedent) — done; same registration
  mechanism reused (§0 point 2).
- **B2B-32** (dedicated internal `partner_accounts` row pattern — precedent only, not the same row; that
  account remains on hold and untouched by this brief).
- The already-live static visual pages under `/demo/{slug}/visuals/{chapterId}` for both topics.
- `lib/test-harness/paths.ts`'s `isDemoPath()` and the existing `TEST_HARNESS_HOST` middleware branch
  (B2B-32) — extended, not replaced (§6.8).

### One-time infrastructure provisioning (Orchestrator, before this feature can dispatch for real — not code this feature's Dev agent writes, but required before Arun's live test tomorrow)

1. **Create the dedicated partner account** (direct SQL insert in the same migration file, mirroring
   B2B-32's own precedent):
   ```sql
   INSERT INTO partner_accounts (name, status)
   VALUES ('Clio Internal — Public Demo', 'active');
   -- account_kind defaults to 'partner' (migration 086) — correct, not 'channel_partner'.
   ```
2. **Mint a test-mode API key** for that account via the existing `POST /api/admin/partner-keys`
   endpoint (`{ partner_account_id: <new id>, mode: 'test', label: 'B2B-33 demo dispatch' }`) — requires
   a `partner_admin_users` row linking Arun's Clerk user id to the new account first (same mechanism
   B2B-32 used). Store the returned key in `DEMO_PARTNER_API_KEY` (server-only env var).
3. **Register the shared content source** via `POST /api/partner/v1/content-sources`
   (`{ auth_type: 'none', label: 'Demo visual pages' }`), authenticated with the key from step 2. Store
   the returned `content_source_id` in `DEMO_CONTENT_SOURCE_ID`.
4. **Attach a Stripe test-mode card on file** to that account's `partner_wallets` row
   (`stripe_default_payment_method_id`) — required because `POST /api/partner/v1/sessions` rejects every
   `test_mode` request with `402 card_required` if this is null, with no exception (B2B-27). **Exact
   mechanism, confirmed against real code — `POST /api/admin/billing/card-verification`**
   (`app/api/admin/billing/card-verification/route.ts`, B2B-27):
   - Clerk-authenticated via `requirePartnerAdmin(partner_account_id)` — the same authorization pattern
     used everywhere else in this provisioning sequence, so it only works once step 2 above has added
     Arun's Clerk user id to `partner_admin_users` for the new account.
   - Body: `{ partner_account_id: <new account id> }`. Internally calls
     `createCardVerificationCheckoutSession()` (`lib/stripe.ts`), which calls
     `getOrCreateStripeCustomer()` (`lib/stripe.ts:381`) to lazily upsert the `partner_wallets` row with
     `stripe_customer_id` set **before** creating a zero-dollar Stripe Checkout session in
     `mode: 'setup'` — this upsert matters because the Stripe webhook's `applyPaymentMethodToWallet`
     does a plain `.update()` keyed on `stripe_customer_id`, not an upsert, so the wallet row must
     already exist with that column populated or the webhook silently no-ops.
   - Response `201 { checkout_url }`. Complete that checkout with a Stripe **test-mode** card (e.g.
     Stripe's published `4242 4242 4242 4242`) — no real card, no real charge is possible in test mode
     regardless of which card number is used.
   - Stripe's `checkout.session.completed`/`setup_intent.succeeded` webhook then syncs
     `partner_wallets.stripe_default_payment_method_id` for this account automatically — no further
     manual step once the checkout is completed.

   **Flagged explicitly per Edge Case 8: without this full sequence completed, every dispatch attempt
   will fail with the generic "Something went wrong" message tomorrow, for a reason invisible from the
   public UI** — Arun/Orchestrator should confirm this is done (steps 1–4, in order) before relying on a
   live demo.

### New environment variables (`.env.local.example`)

```
# B2B-33 — "Learn with AI" demo dispatch
PLACEHOLDER_DEMO_MEETING_PASSCODE=PLACEHOLDER_DEMO_MEETING_PASSCODE
DEMO_PARTNER_API_KEY=PLACEHOLDER_DEMO_PARTNER_API_KEY
DEMO_CONTENT_SOURCE_ID=PLACEHOLDER_DEMO_CONTENT_SOURCE_ID
```
(`DEMO_MEETING_PASSCODE`, not prefixed `NEXT_PUBLIC_`, read server-side only in the Save route;
`DEMO_PARTNER_API_KEY` never sent to the browser, used only inside the dispatch route's server-to-server
call.)
