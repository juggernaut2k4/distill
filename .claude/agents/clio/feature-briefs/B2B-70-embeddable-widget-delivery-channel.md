# Feature Brief: B2B-70 — Embeddable Widget Delivery Channel ("Learn with AI" in-page)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-08-03

**Numbering note:** highest ID currently in `docs/b2b-pivot-status.md` and
`.claude/agents/clio/feature-briefs/` is B2B-66 (`B2B-66-marin-adaptive-teaching-persona.md`).
This brief is **B2B-70**. Confirmed via directory listing before filing — no collision.

---

## What Arun Said

From tonight's live brainstorm (his own direct decision, relayed to me by the Orchestrator as this
session's input, not an Orchestrator interpretation):

Clio's only delivery channel today is a meeting-bot (Attendee.dev, formerly Recall.ai) joining a real
Google Meet/Zoom/Teams call. When pitched to a self-serve, in-app learning reseller like Pluralsight,
the standing objection is "why does my learner need to join a Google Meet to talk to an AI?" — a real,
blocking objection for exactly the resellers Clio wants next.

Decision: build a second, wholly separate delivery channel — an embeddable widget. A "Learn with AI"
button on the reseller's own page opens a video-player-style container, rendered directly in the
reseller's own page/domain, running the identical teaching experience (content pages, voice AI,
verification questions), with **no meeting platform, no Attendee/Recall.ai bot, and no Google
Meet/Zoom/Teams involved at all.**

Arun was explicit and repeated it multiple times: **the existing meeting-bot channel is not to be
modified, broken, or put at risk in any way.** This is additive. Reuse existing code by importing it,
never by editing it.

Two integration patterns, phased:
- **Pattern A (ship first):** reseller's own backend calls a new Clio API using their existing private
  partner API key (same auth as the meeting-bot flow), gets back a session ref + embed URL, renders it
  in an iframe on their own page.
- **Pattern B (fast-follow, not day one):** pure script-tag drop-in, zero reseller backend work,
  browser calls Clio directly using a new public, domain-scoped "widget key" issued at container
  registration, validated server-side against the calling domain, rate-limited.

An **MCP path** (a reseller's own AI copilot deciding mid-conversation to hand off to Clio) is
confirmed wanted but explicitly **not a priority** — design the session-creation contract so it *could*
become an MCP tool later without a rewrite; do not build the MCP server now.

**Container registration** happens through Clio's own partner dashboard (mirroring the existing
Configurator flow): a reseller (or a channel-partner sub-account) registers a container specifying
allowed domain(s) and content/topic mapping, and receives a `container_id` (and, for Pattern B later, a
domain-scoped public widget key). A session-creation request must reference a valid registered
`container_id` — no registered container → no valid key → no session → nothing billable. This is what
closes the "grab the widget without ever going through us" loophole Arun specifically worried about.

**Billing** works identically to today regardless of pattern — Clio's own backend is always the
metering point (session creation + duration), never the reseller's. Reuse the existing wallet/billing
infrastructure as-is; this is a new entry point into the same metered model, not a new billing model.

**First tangible output Arun wants:** a prototype/demo — a new tab inside the existing `/demo` area
showing the widget in action, plus the corresponding container-registration surface under the existing
admin/demo area. This ships ahead of the full production reseller-facing integration.

## Independent Verification (done directly against live code before writing this brief)

I did not take the reusability claims on faith. Checked directly:

1. **Next available Feature Brief ID.** `ls .claude/agents/clio/feature-briefs/*.md` and
   `grep` of `docs/b2b-pivot-status.md` both top out at B2B-66. B2B-70 is unclaimed. Confirmed.
2. **No prior widget/embed concept exists in the pivot record.** `grep -i "widget|embed|drop-in"` across
   `docs/brainstorm-b2b-platform-pivot.md` and `BACKLOG.md` returns nothing relevant. This is genuinely
   new scope, not a duplicate or a resurrection of something already spec'd. Confirmed.
3. **The meeting-bot's role is purely a bridge into a real call, not core to the teaching experience.**
   `lib/meeting-bot/attendee.ts` line 50: "Attendee loads walkthroughUrl in headless Chromium" — the bot
   is a browser-automation wrapper around the same render page, using its virtual mic/speaker to carry
   audio into a real Google Meet call. Nothing in the teaching page itself requires a meeting platform.
   This directly supports Arun's claim that a widget with no bot and no real call is architecturally
   sound, not just plausible. Confirmed.
4. **`lib/partner/auth.ts`'s `requirePartnerApiKey`** is a real, already-shipped, provider-agnostic
   partner-API-key auth path (`Authorization: Bearer clio_live_sk_...` / OAuth2 client-credentials),
   already used by `/api/partner/v1/*` routes, already enforcing per-partner-account rate limiting and
   `accountKind` (`partner` vs `channel_partner`) distinctions. This is a real, reusable auth
   foundation for Pattern A — no new auth system needed for that pattern, exactly as Arun asserted.
   Confirmed.
5. **`lib/partner/live-render.ts`** exports `resolveLiveSessionRender` and `buildInlineSessionContent` —
   real, already-shipped content-resolution functions independent of any specific route or the
   meeting-bot dispatch path. Reusable by import. Confirmed.
6. **The `/demo` area is real and has a clear extension point.** `app/(demo)/demo/page.tsx` and
   `app/(demo)/demo/[slug]/` exist today with topic-specific subfolders (`oop-fundamentals`,
   `claude-ai`). Adding a new tab/route here is additive, not a restructure. The admin dashboard
   (`app/(with-clerk)/dashboard/admin/page.tsx`) already has a precedent pattern for single-purpose
   admin cards (`VoiceProviderCard.tsx`, `DemoAccessCard.tsx`, `DemoPerformanceToggleCard.tsx`) that a
   new container-registration card can follow structurally. Confirmed as a viable pattern to specify
   against — exact UX still needs full BA definition (see Questions for BA).

One claim I am **not** independently verifying here and am flagging as a real technical risk for
architecture/BA to resolve, not asserting as settled: whether the existing `PartnerRenderClient.tsx`
render path can be pointed at unmodified from an iframe (same route, different container: reseller's
page instead of Attendee's headless Chromium), or whether it needs a new thin wrapper page that reuses
its internals (voice adapter, content resolution, tool-call handlers) without touching the file itself.
Both keep the "never modify" constraint intact; which one is right is an architecture call, not a
guess I should make in this brief.

## The Problem Being Solved

Clio currently cannot be sold to — or piloted with — a self-serve, in-app learning reseller (the
Pluralsight-shaped buyer) because the only delivery mechanism forces the reseller's end user out of
their own product and into a scheduled Google Meet call. That is a structural, not cosmetic, blocker
for this entire class of reseller, which Arun has identified as the next stage of Clio's B2B2C growth.

## What Success Looks Like

- A reseller's own web page can show a "Learn with AI" button that opens Clio's teaching experience
  in-page (iframe), with zero meeting platform involved, and get the same content-pages + voice AI +
  verification-question experience a Google Meet participant gets today.
- The existing Google Meet/Attendee delivery channel is provably unaffected: same session contract,
  same render path, same tests, all still green, with zero code changes to the files Arun named as
  off-limits (see Known Constraints).
- A reseller can be onboarded to the widget channel via Clio's own dashboard (register a container →
  get a `container_id`) without any code being written on Clio's side per-reseller.
- Every widget session is metered through the same wallet/billing pipeline as today — no separate
  billing logic, no unbillable path.
- Arun can see it working: a `/demo` tab shows the widget live, and the container-registration surface
  is visible under the existing admin/demo area — before any resellers see a production version.

## Known Constraints (non-negotiable, verbatim from Arun via tonight's brainstorm)

- **Do not modify, and do not put at risk in any way:**
  `lib/meeting-bot/attendee.ts`, `lib/meeting-bot/recall.ts`, `lib/meeting-bot/agentcall.ts`,
  `lib/meeting-bot/provider.ts`, `lib/meeting-bot/types.ts`; `dispatchMeetingBot` in
  `lib/partner/session-init.ts`; the existing `POST /api/partner/v1/sessions` route (not modified, not
  branched inside — a new route is required for the widget channel); `PartnerRenderClient.tsx` and its
  whole render path; any existing `partner_sessions` row/behavior for meeting-bot sessions.
- **Reuse only by import, never by edit** — `lib/voice/hume-adapter.ts`,
  `lib/voice/openai-realtime-adapter.ts`, the prompt-assembly modules
  (`lib/voice/openai-realtime-prompt-template.ts`, `lib/voice/hume-native/prompt-template.ts`),
  `lib/partner/live-render.ts`'s `resolveLiveSessionRender` / `buildInlineSessionContent`, and
  `lib/partner/auth.ts`'s `requirePartnerApiKey` (Pattern A only — Pattern B needs a new, separate,
  public/domain-scoped key type; it must not reuse the private partner API key client-side).
- **Verification bar, stated explicitly by Arun:** no existing test file should need to change for this
  feature to ship. The BA's acceptance criteria and the eventual QA Gate must treat "zero diff to any
  existing test file" as a pass/fail check, not a nice-to-have.
- **Voice provider choice is orthogonal to delivery-channel choice** — either Hume or OpenAI Realtime
  works unchanged for the widget, since both already connect browser-to-voice-API directly with no
  meeting platform dependency. No new voice-provider decision is implied by this brief.
- **Container registration is the only thing that makes a session valid/billable** — no registered
  container → no valid key → no session. This must be enforced server-side on every session-creation
  path this brief adds, not just documented as intent.
- **Standing responsive/mobile-friendly rule applies** (per `CLAUDE.md`'s standing story): any new
  screen this brief touches — the admin container-registration surface, the new `/demo` tab, and the
  widget's own in-iframe rendering — must be genuinely responsive using the fluid/`clamp()` pattern,
  not a fixed-width layout, as part of this same change.

## Phasing (explicit, per Arun)

1. Pattern A (server-to-server) + container registration (admin) + `/demo` tab prototype — **this
   brief's in-scope deliverable.**
2. Pattern B (public widget key, script-tag drop-in) — fast-follow, not day one. The BA should design
   the container/key data model in this brief so Pattern B is additive later (e.g., a key `type` or
   second key column), but must not build Pattern B's public-key issuance or client-side session
   creation now.
3. MCP exposure of the session-creation contract — design-for-later only (keep the contract clean
   enough to wrap as an MCP tool), no MCP server, no MCP work at all in this brief.

## Questions for BA (must all be answered in the Requirement Document — Section 11 empty before I approve)

1. **New API contract for Pattern A session creation.** Exact route (new, distinct from
   `/api/partner/v1/sessions`), request/response shape (Zod schema), how `container_id` is validated,
   how the embed URL is minted and scoped (must it be single-use / short-lived / session-bound?).
2. **`container` data model.** New table(s) — fields for `partner_account_id`, allowed domain(s),
   content/topic mapping, `container_id` generation, and a schema shape that leaves room for Pattern
   B's public widget key later without a migration rewrite. Follow the existing partner-schema
   conventions (see `lib/partner/auth.ts`'s `accountKind` pattern) rather than inventing a new style.
3. **Render-path decision:** does the widget iframe point at the existing `partner-render` route
   unmodified (same component, new caller), or does it need a new thin route that imports the same
   underlying pieces (voice adapter, content resolution, tool-call handlers) without touching
   `PartnerRenderClient.tsx`? Resolve this architecturally — do not guess, verify against how the
   render path currently assumes its caller (bot-in-headless-Chromium vs. a real browser tab) behaves
   for mic/speaker access.
4. **Admin container-registration screen** — full wireframe/example, not a placeholder description.
   Model it structurally after the existing admin card pattern (`VoiceProviderCard.tsx`,
   `DemoAccessCard.tsx`) but the BA must fully document copy, fields, empty state, and error states per
   Product Principle #2 ("Ambiguous UX = STOP").
5. **`/demo` tab** — full wireframe/example of what the new tab shows and how a demo session is
   triggered and rendered, including exactly what "the widget in action" looks like end-to-end.
6. **Rate limiting and abuse boundaries** for the new session-creation route — does it reuse
   `lib/partner/rate-limit.ts`'s existing route-class model as-is, or does the widget's traffic shape
   (potentially far higher session-creation frequency than the meeting-bot flow) need its own class?
7. **Acceptance tests and edge cases**, including explicitly: invalid/unregistered `container_id`,
   session-creation request from a reseller whose container's allowed-domain list doesn't match the
   embedding page (relevant now for Pattern A's iframe `src` origin, and forward-looking for Pattern
   B's domain check), and confirmation that zero existing test files require changes.

## Open Item I Have a Recommendation On, Not a Unilateral Decision

**Should the `/demo` tab prototype hit the real new Pattern A API end-to-end (using a demo/test
partner key, mirroring how B2B-31's showcase tooling already reuses the real `/sessions` API rather
than a fake endpoint), or should it be a simplified visual stub since Pattern B isn't being built and
there's no real external reseller yet?**

My recommendation: build it against the real new Pattern A endpoint with a demo/test container and
key, same precedent as B2B-31. This is the only version of "prototype" that actually proves the
contract works, and it costs little extra given Pattern A's endpoint has to be built for real anyway.
A stub would look like progress without validating the one thing this brief exists to prove. I'm
flagging this rather than deciding it silently because it does affect what gets built first and how
long that takes — please confirm before the BA finalizes Section 5 (or tell me if you want the cheaper
stub first and the real wiring as a fast-follow).

## What Happens Next

This brief goes to the Business Analyst Agent for a full 12-section Requirement Document — schema,
API contract, wireframes for both new screens, acceptance tests, and edge cases. Per `CLAUDE.md`'s
CEO→BA→Dev gate, I will not approve a spec with any open question in Section 11, and no developer
agent touches this until that approval happens. I'll route my recommendation above to Arun for a quick
confirm in parallel with BA drafting, so it doesn't block the BA from starting on everything else.

---

# Part 2 — 2026-08-03 Amendment: content is caller-supplied, not Clio-stored

From: CEO (Arun, direct, relayed verbatim by the Orchestrator per this project's known CEO-relay
limitation — treated as if Arun typed it directly, because he did)
To: Business Analyst Agent
Priority: P0 (course-correction on an already-built Pattern A; blocks nothing else, but the
already-built code must not ship as-is)
Date: 2026-08-03

**Status of Part 1 above:** superseded on the specific points amended below. Part 1's framing of the
problem, the two-pattern phasing, the MCP deferral, and the do-not-touch constraint list all still
hold. What changes is the trust/ownership model for widget-session content, and one new requirement
(bounded data retention) that Part 1 never addressed at all.

## What Arun said, verbatim, across this conversation, in order

1. "The content comes in API right then why I need to enter these details here" — the Orchestrator's
   built Pattern A required a human to open `/dashboard/admin` and hand-type page URLs into a form
   before a session could ever be created. Arun's objection: the reseller already has this content and
   already calls an API — a manual re-entry step defeats the purpose of it being an API integration.

2. "I don't understand. Please hold on. During demo I need to explain and showcase how it works in
   realtime. Demo page is considered as an external page where the reseller resides. For us all inputs
   come from reseller. We run the meeting and send our findings back to reseller. That is our scope.
   Any questions here?" — establishes the mental model this amendment is built on: `/demo` plays the
   role of "the reseller's own external system," not "Clio's own pre-configured content library." Every
   input (page URLs, narration, participant info) originates from the caller on each call. Clio's job
   is to run the session and hand back analysis — nothing more, nothing stored in between.

3. In response to the Orchestrator's clarifying question — "should `POST /api/partner/v1/widget-sessions`
   just accept `content_pages` directly in the request body, structurally the same as the existing
   inline-content mode on `/api/partner/v1/sessions` today, minus `meeting_url` and minus dispatching a
   bot — with no `partner_widget_containers` table and no admin registration UI at all, and
   `container_id` (if it survives) only as a passthrough reference string, not something Clio stores
   content against" — Arun replied:

   "Yes correct. We don't want to open data or store them. We pass the data to bot. Let it handle. Get
   the transcription and do our analysis then send back our findings. After sending no leftovers. CEO
   agent generate detailed requirements for each of the ask and build and review then approve."

## 1. Reversed content-ownership model

**Decision: `POST /api/partner/v1/widget-sessions` becomes structurally identical to the existing,
do-not-touch `/api/partner/v1/sessions` route's Option 1 (inline-content) mode — minus `meeting_url`,
minus bot dispatch.** Verified directly against `lib/partner/session-schema.ts`'s `CreateSessionSchema`
and `ContentPageSchema`, and `app/api/partner/v1/sessions/route.ts`'s own inline-mode handling (lines
144–202: `assertUrlSafe()` per page at request time, `generateTransitionMarkers()`, insert with
`content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/`expected_duration_minutes`
taken straight from the request body — never from a stored row).

The rewritten `CreateWidgetSessionSchema` (same file, `lib/partner/widget-session-schema.ts`) becomes:

```ts
{
  content_pages: ContentPageSchema[] (min 1, required) — reused import from lib/partner/session-schema.ts,
    not redefined,
  content_source_id?: string (uuid) — required together with content_pages, same refine rule
    CreateSessionSchema already enforces (".refine(!content_pages || content_source_id)"),
  content_to_explain?: string (max 5000),
  content_title?: string (max 200),
  content_subtitle?: string (max 300),
  expected_duration_minutes?: number (int, positive, max 600) — defaults to
    DEFAULT_EXPECTED_DURATION_MINUTES (30) when omitted, imported from session-schema.ts, not
    redefined,
  end_user_name: string (required, 1-200, trimmed),
  end_user_role?: string (max 200),
  end_user_industry?: string (max 200),
  partner_end_user_ref?: string (max 256, printable ASCII),
  partner_reference?: string (max 256, printable ASCII),
  reseller_unique_id?: string (max 256, printable ASCII),
  language?: string (max 60),
  reseller_id: string (uuid, required),
  client_id?: string (uuid) — required only for account_kind='channel_partner', same as today,
}
```

**`container_id` is retired, not replaced with a passthrough field.** This is the one place I am
making a technical call rather than leaving it for the BA to guess, because Arun's "yes correct" was
affirming the reversal in general, not specifically mandating a surviving field. Reasoning: the
existing schema already has two purpose-built, free-form caller-supplied correlation fields —
`partner_reference` and `reseller_unique_id` — that exist for exactly this purpose (a reseller's own
bookkeeping/billing correlation string, echoed back, never resolved against any Clio-side table).
Adding a third field (`container_id`) that does nothing but duplicate that same role would be dead
weight — no FK, no lookup, no billing behavior hangs off it. A reseller integrating Pattern A uses
`partner_reference`/`reseller_unique_id` exactly as an inline meeting-bot integrator already does
today. No new field.

**No content-URL safety check is skipped by this change.** The admin container-registration route
used to run `assertUrlSafe()` once, at registration time. That entire concept is gone. In its place,
the rewritten `widget-sessions` route must run the identical per-page `assertUrlSafe()` loop the
existing `/sessions` route already runs at request time for its own inline mode (verified: lines
166–176 of `app/api/partner/v1/sessions/route.ts` — reject with `422` /
`content_url_rejected`-equivalent code on any unsafe URL, matching that route's existing error shape
as closely as this new route's own error-code conventions allow). This is not new protection being
invented — it is the same protection the do-not-touch route already has, now needed here because
content arrives per-call instead of once at registration.

## 2. Disposition of already-built artifacts (decisive, not deferred to Dev's judgment)

| Artifact | Disposition | Why |
|---|---|---|
| `partner_widget_containers` table (migration 108) | **Drop.** New migration `109_*.sql` with `DROP TABLE IF EXISTS partner_widget_containers CASCADE;` (cascades the FK from `demo_widget_container_map` and from `partner_sessions.container_id`). Already applied to production — this is a real rollback, not a no-op. | No content is pre-registered anymore; nothing reads or writes this table once the rewrite lands. |
| `demo_widget_container_map` table (migration 108) | **Drop**, same migration. | Existed only to pair a container to a demo slug — no containers, no pairing needed. |
| `partner_sessions.container_id` column (migration 108) | **Drop the column** in the same migration (`ALTER TABLE partner_sessions DROP COLUMN IF EXISTS container_id;`). Keep `delivery_channel` (`'meeting_bot' \| 'widget'`) — still needed, still additive, still correct. | Vestigial once the FK target is gone; leaving a dangling nullable column that's never populated is worse than removing it cleanly while the feature is still pre-launch (zero real widget-channel sessions exist yet — confirmed nothing external depends on this column). |
| `app/api/admin/widget-container/route.ts` + `/resync/route.ts` | **Delete both files.** | Container registration doesn't exist anymore. |
| `app/(with-clerk)/dashboard/admin/WidgetContainerCard.tsx` | **Delete file.** | Same reason. |
| `app/(with-clerk)/dashboard/admin/page.tsx` | **Edit** — remove the `WidgetContainerCard` import and its `<WidgetContainerCard />` render call (2 lines, per current grep). Leave `VoiceProviderCard`/`DemoAccessCard`/`DemoPerformanceToggleCard` untouched. | Restores the admin page to its pre-B2B-70 composition; nothing else on that page is affected. |
| `lib/partner/widget-session-schema.ts` | **Rewrite in place**, same file, same exported name `CreateWidgetSessionSchema` (per §1 above). | No reason to rename — it's a new file, not on the do-not-touch list, and nothing outside this feature imports it yet. |
| `app/api/partner/v1/widget-sessions/route.ts` | **Rewrite in place**, same file, same route path. See §1 and §3. | Same reasoning. |
| `lib/partner/wallet-gate.ts` | **Keep, unchanged.** Verified: `resolveWalletGate()` takes `(partnerAccountId, mode, expectedDurationMinutes)` — none of its inputs or logic reference `container_id` or any container row. It is already content-model-agnostic. | No rework needed. |
| `lib/partner/rate-limit.ts`'s `widget_sessions_create` class | **Keep, unchanged.** | Rate limiting is about call frequency, orthogonal to where content comes from. |
| `inngest/partner-trial-cutoff.ts`'s widened backstop-sweep status list (`'widget_active'` added) | **Keep, unchanged.** | Sessions still land in `widget_active`; the recovery gap this closed is unaffected by the content-ownership change. |
| `app/api/demo/[slug]/widget-status/route.ts` | **Keep, unchanged — verified zero container references anywhere in this file.** It queries `partner_sessions` directly by `slug` + `delivery_channel='widget'` + `status`; it never touches `demo_widget_container_map` or any container table. | Confirmed by direct read; no rework needed, not even a comment update. |
| `app/api/demo/[slug]/widget-dispatch/route.ts` | **Rewrite.** Must stop looking up `demo_widget_container_map`/`container_id` entirely. Must instead assemble `content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/`expected_duration_minutes` itself, from `getDemoTopicBySlug()` + `flattenBlocksToNarrationText()` — **the exact same construction the existing Meeting-tab's `app/api/demo/[slug]/dispatch/route.ts` already does** (verified: lines 170–193 of that file — identical `DEMO_CONTENT_BASE_URL`-rooted URL building, identical `content_text` flattening, identical `expected_duration_minutes` sum-of-chapter-durations). Then call the rewritten `POST /api/partner/v1/widget-sessions` with that inline payload, same `DEMO_PARTNER_API_KEY`/`DEMO_PARTNER_ACCOUNT_ID` server-to-server pattern already in place. Keep the existing `end_user_name` body field, the passcode gate (`resolveDemoPasscodeToAccount`), the duplicate-active-session guard, and the `demo_dispatches` billing-attribution insert — none of that depended on containers and all of it is still correct. | This is now a structural twin of the Meeting-tab dispatch route in every respect except which upstream endpoint it calls and that it returns `render_url` — exactly Part 1's own original framing, before the container detour. |
| `app/(demo)/demo/[slug]/DemoTopicClient.tsx` — "Widget Demo" tab | **Rewrite the tab's states.** The container-dependent "No widget container is registered for this course yet" state is retired entirely — with content assembled automatically at dispatch time (same as the Meeting tab), the Widget Demo tab becomes unconditionally available for every demo topic, no admin precondition. Every other piece (`widgetActive`/`widgetSessionRef`/`widgetRenderUrl` state, the iframe with `allow="microphone; autoplay"`, the "End session" flow, the name/passcode inputs, the `widget-status` restore-on-load effect) is unchanged — none of it referenced containers directly; only the dispatch error-handling branch for `no_widget_container` (line ~522-523, `"register one in Admin → Widget containers"`) needs to go, since that admin surface no longer exists. | Confirmed by direct read of `DemoTopicClient.tsx` (lines 353-366, 466-533, 1010-1125) — the container dependency is narrow (one error-code branch and the copy pointing at the now-deleted admin card), not structural to the tab. |
| Tests: `tests/unit/b2b70-widget-active-backstop.test.ts`, `tests/unit/b2b70-widget-rate-limit.test.ts` | **Keep, unchanged** — these test the `widget_active` status list widening and the rate-limit class, neither of which changes. | Confirmed their subject matter is orthogonal to content-ownership. |
| `tests/unit/b2b70-widget-session-schema.test.ts` | **Rewrite** — it currently tests the container-only `CreateWidgetSessionSchema`; must be updated to test the new inline-content shape. This is a **new** version of an already-new (not pre-existing) test file, so it does not violate the "zero diff to any existing test file" gate — that gate protects tests that predate this feature, not this feature's own tests changing shape mid-flight before ever shipping. | Consistent with Part 1's own acceptance-test framing. |

## 3. The "no leftovers" data-retention requirement

This is genuinely new scope — Part 1 never addressed data retention at all. Spelled out precisely,
resolving every ambiguity with a concrete decision (verified against live code, not assumed):

**What counts as "the data"?** Arun's own words scope it: *"We pass the data to bot... After sending no
leftovers."* "The data" is the reseller-supplied teaching material passed into the session at creation
time — `content_pages`, `content_to_explain`, `content_title`, `content_subtitle` on the
`partner_sessions` row — plus one derived artifact that embeds that same material verbatim:
`assembled_prompt_snapshot` (verified: `lib/partner/live-render.ts`'s `buildInlineSessionContent()`
copies every page's `content_text` and the session-level narration fields directly into the assembled
prompt string, which is then persisted to `partner_sessions.assembled_prompt_snapshot` — leaving that
column populated after "purging" the source columns would be a back door, not a purge).

**What does NOT count as "the data":** `end_user_name`/`end_user_role`/`end_user_industry`,
`partner_reference`/`reseller_unique_id`/`partner_end_user_ref`, `conversation_language` — these are
session/participant metadata, not reseller content, and every existing session (meeting-bot or widget)
already retains them indefinitely with no complaint from Arun about that. Nothing in his statement
targets end-user identity fields; narrowing "no leftovers" to reseller content only avoids inventing a
retention rule he did not ask for.

**What counts as "our findings"?** Confirmed by direct read of `lib/partner/webhooks.ts` and
`inngest/partner-session-insights-extractor.ts`: the existing, unmodified
`session.completed`/`usage.voice_minute`/`session.insights_ready` webhook events, dispatched through
`recordBillableEvent()`/`recordInsightsReadyEvent()`. Nothing new is needed here — these already are
"our findings," already sent back to the reseller today.

**Mechanically, when does the purge fire, and on what trigger?**

Verified: `extractInsightsForPartnerSession()` (`inngest/partner-session-insights-extractor.ts`) never
reads `partner_sessions.content_pages`/`content_to_explain`/etc. at all — it reads the Hume transcript
(`fetchAllTranscriptEvents`) or the OpenAI Redis-stored transcript
(`getStoredTranscriptTurns`/B2B-63), never the teaching content itself. **Purging the content columns
has zero effect on the insights-extraction pipeline's ability to run, at any point.** This means the
purge can safely fire as soon as findings have been recorded, without waiting on the extraction
pipeline to need that data again (it never did).

Decision: add one new, additive step inside `inngest/partner-session-insights-extractor.ts`, gated to
`delivery_channel = 'widget'` sessions only (§ scope decision below):

- In `extractInsightsForPartnerSession()`, immediately after the `recordInsightsReadyEvent()` call
  succeeds (both the `'success'`/`'success_empty'` path), null out
  `content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/`assembled_prompt_snapshot`
  on that `partner_sessions` row, scoped to `delivery_channel = 'widget'`.
- In `markInsightsExtractionFailed()`, do the same at the point it fires its own
  `recordInsightsReadyEvent()` call (the `attempt_count >= 3` permanent-failure branch) — a session
  whose transcript extraction permanently failed still had its findings-attempt "sent" (the
  `extraction_status: 'failed'` webhook payload is itself a finding), and the reseller's own content
  is no more needed after a permanent failure than after a success.
- **Edge case requiring its own fix, not covered by the above:** a widget session rejected at the
  wallet-gate stage (`card_required`/`trial_exhausted`/`funding_required`/`balance_exhausted`) never
  reaches `widget_active`, never emits `clio/partner-session.ended`, and so never enters the extraction
  pipeline at all — verified directly in `app/api/partner/v1/widget-sessions/route.ts`: the
  `partner_sessions` row is inserted (with `content_pages` already written) *before* the wallet gate
  runs, and a gate rejection only does `.update({ status: 'failed', end_reason: ... })`, never touching
  content columns. Fix: that same rejection-branch `.update()` call must also null the content columns
  in the identical write, so a session that never actually ran leaves nothing behind either — if
  anything this case is a *stronger* instance of "no leftovers" than a completed session, since no bot
  ever spoke this content, and it costs nothing extra (same UPDATE statement, more columns).

**"What if the webhook send fails — retry before purging, or is 'sent' defined as 'attempted'?"**
Decision, with reasoning: **"sent" = the `session.insights_ready` reference event has been recorded**
(i.e. `recordInsightsReadyEvent()`'s `webhook_dispatch_log` insert has completed), not "HTTP-delivered
to the reseller's endpoint." Verified why this must be the definition, not a preference: actual HTTP
delivery happens asynchronously via `inngest/partner-webhook-dispatcher.ts`'s `attemptDispatch()`, and
`attemptDispatch()` explicitly treats a partner account with no `outbound_base_url` configured as
`'skipped_no_endpoint'` — **left pending indefinitely, by design** (`lib/partner/webhooks.ts`, line
~804: *"Leave as pending indefinitely ... until the partner configures their endpoint"*). Clio's own
internal demo account (`DEMO_PARTNER_ACCOUNT_ID`) almost certainly has no `outbound_base_url`
configured — it is not a real reseller. If purge waited on confirmed HTTP delivery, content would
**never** purge for the very account this feature's own `/demo` tab uses to prove the contract works,
which cannot be the intended behavior. Tying "sent" to the same recording step every other billable
event in this codebase already treats as "the event has occurred" (fire-and-forget dispatch is this
codebase's established convention throughout `webhooks.ts`) is consistent, not a new precedent.

**Does "no leftovers" apply only to the widget channel, or retroactively to the existing meeting-bot
inline-content flow too?** Flagged explicitly, not assumed either way: **scoped to
`delivery_channel = 'widget'` only for this build.** Two independent reasons, not just one:
(1) least blast radius — Arun's statement was made entirely in the context of this widget-channel
redesign conversation, never mentioning the meeting-bot flow; (2) it is structurally *required* by the
existing "never modify the meeting-bot channel's own behavior" constraint carried forward from Part 1
— `inngest/partner-session-insights-extractor.ts` is not on the do-not-touch file list, but *changing
its retention behavior for `delivery_channel = 'meeting_bot'` sessions* would still be a behavior
change to that channel, which Arun was explicit and repeated about never doing. Gating the new purge
step to `delivery_channel = 'widget'` satisfies both the do-not-touch spirit and the narrower reading
of what Arun asked for. **The meeting-bot-flow question is logged as a separate, real follow-up
question for Arun** (not resolved here, not silently dropped) — see the Punch List / Report to
Orchestrator below.

**Interaction with the B2B-65 demo Performance tab:** verified directly —
`inngest/partner-session-insights-extractor.ts`'s own write (`demo_performance_visible`,
`action_items`, `glitches`, `learner_insight`) is entirely to `partner_session_insights`, a wholly
separate table from `partner_sessions`. The Performance tab reads only `partner_session_insights`
columns, never `partner_sessions.content_pages`. **No conflict** — confirmed, not assumed.

## 4. Hard constraints carried forward unchanged (restated so this amendment is self-contained)

- `lib/meeting-bot/*`, `dispatchMeetingBot` (`lib/partner/session-init.ts`),
  `app/api/partner/v1/sessions/route.ts`, and `PartnerRenderClient.tsx`/its whole render path: **never
  modified**, by this amendment or anything in Part 1. Nothing in this amendment touches any of them —
  confirmed by re-reading every file this amendment names against that list before filing it.
- **Zero pre-existing test file may gain a diff.** The three `tests/unit/b2b70-*.test.ts` files are not
  pre-existing (they were written tonight, for this same feature, before it ever shipped) — rewriting
  one of them (`b2b70-widget-session-schema.test.ts`) to match the corrected shape is not a violation of
  this gate; it would only be a violation if a test file that predates B2B-70 needed a diff, which none
  does.
- Standing responsive/mobile-friendly rule still applies to the Widget Demo tab's rewritten markup —
  unchanged requirement, nothing about this amendment affects layout.

## Punch List for the Orchestrator (ordered)

**Delete:**
1. `app/api/admin/widget-container/route.ts`
2. `app/api/admin/widget-container/resync/route.ts`
3. `app/(with-clerk)/dashboard/admin/WidgetContainerCard.tsx`

**Edit (remove container references, no other change):**
4. `app/(with-clerk)/dashboard/admin/page.tsx` — remove the `WidgetContainerCard` import + render call.

**New migration (production rollback — table already applied live):**
5. `supabase/migrations/109_b2b70_widget_inline_content_amendment.sql` — `DROP TABLE IF EXISTS
   demo_widget_container_map;` then `DROP TABLE IF EXISTS partner_widget_containers CASCADE;` then
   `ALTER TABLE partner_sessions DROP COLUMN IF EXISTS container_id;` then the new
   `content_pages`/`content_to_explain`/`content_title`/`content_subtitle`/`assembled_prompt_snapshot`
   purge is just `UPDATE`s at runtime, no schema change needed for that (columns already exist and are
   already nullable).

**Rewrite:**
6. `lib/partner/widget-session-schema.ts` — inline-content shape per §1.
7. `app/api/partner/v1/widget-sessions/route.ts` — inline content, `assertUrlSafe()` per page (mirroring
   the existing `/sessions` route's own inline-mode check), no container lookup, wallet-gate rejection
   branch also nulls content columns per §3's edge case.
8. `app/api/demo/[slug]/widget-dispatch/route.ts` — assemble `content_pages` itself from
   `getDemoTopicBySlug()`/`flattenBlocksToNarrationText()`, mirroring the existing Meeting-tab dispatch
   route; drop the `demo_widget_container_map` lookup and the `no_widget_container` error branch.
9. `app/(demo)/demo/[slug]/DemoTopicClient.tsx` — Widget Demo tab: remove the container-not-registered
   state and its `no_widget_container` error copy; tab becomes unconditionally available like the
   Meeting tab.
10. `inngest/partner-session-insights-extractor.ts` — add the widget-scoped content-purge step in both
    `extractInsightsForPartnerSession()`'s terminal branch and `markInsightsExtractionFailed()`'s
    `attempt_count >= 3` branch.
11. `tests/unit/b2b70-widget-session-schema.test.ts` — rewrite for the new inline schema.

**Keep unchanged (verified, do not touch during this rework):**
12. `lib/partner/wallet-gate.ts`, `lib/partner/rate-limit.ts` (`widget_sessions_create` class),
    `inngest/partner-trial-cutoff.ts`'s widened backstop query, `app/api/demo/[slug]/widget-status/route.ts`,
    `tests/unit/b2b70-widget-active-backstop.test.ts`, `tests/unit/b2b70-widget-rate-limit.test.ts`.

**Real open question for Arun (not resolved here, flagged deliberately):** should the new "no leftovers"
content-purge rule apply retroactively to the existing meeting-bot inline-content flow too, or is it
widget-channel-only as scoped above? Recommendation: widget-only for now (see §3 reasoning); meeting-bot
retroactive purge as a separate, future, explicitly-scoped brief if Arun wants it.
