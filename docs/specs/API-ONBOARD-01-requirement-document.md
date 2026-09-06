# Requirement Document: API-ONBOARD-01 — Integration + API docs clarity pass

Status: Approved by CEO agent, 2026-09-06. Section 11 empty — no open questions.

## 1. Summary

Add a plain-language "how this works" framing to the API docs page
(`/dashboard/configurator/api`), and sharpen the Integration screen's explanation of
`outbound_base_url`, so a newly-invited partner understands the integration model — one call out,
one webhook back — before they hit the full technical endpoint list. Copy/layout only; no API,
webhook-dispatch, or billing-webhook behavior changes.

## 2. Background

DOMAIN-GUIDE-01 (shipped same session) rewrote the Domain screen to lead with the recommended path
and explain the mechanism in plain language instead of just tabulating fields. Arun and the
Orchestrator agreed the same pass is now due on Integration + the API docs page — the next two
screens a newly-invited partner actually needs to use.

## 3. Users & Roles

Partner-admin users (self-serve API integrators) on `/dashboard/configurator`, specifically a
partner in their first session with this product who has not yet called the API. Not applicable to
end users (no end-user-facing surface touched).

## 4. Scope

### 4.A — API docs page (`ApiClient.tsx` + `content.ts`)

Add a **Quick start** entry as a new, distinct nav selection — first item in the left nav, above
the `Auth` category group, visually set apart (bold/highlighted, matching the existing active-item
treatment already used for a selected endpoint). It is the default selected view on page load
(replacing today's default of the first Auth endpoint).

Quick start panel content (plain language, matching the DOMAIN-GUIDE-01 register — explain the
mechanism, not a field dump):
- One call out: `POST /api/partner/v1/sessions` — give it a meeting URL and your content pages,
  it starts a live session.
- One call back: after the session ends, Clio sends a `session.insights_ready` event to the base
  URL you set on the Integration page — carrying a summary, topics of interest, engagement style,
  suggested next topics, and any action items captured during the session.
- One line clarifying the shared webhook URL: that same URL also receives other event types
  (usage/billing events, covered separately) — check `event_type` to find `session.insights_ready`
  among them.
- One line on `GET /sessions/:id`: optional, for checking status — not a required step in the
  normal flow.
- A short pointer line into the existing endpoint list/playground for anyone who wants the full
  detail or wants to try a live call.

No changes to the existing 9 endpoint docs, the webhook doc's field table, the curl-snippet
builder, or the live Playground's request/response mechanics.

Webhook doc pane (`WebhookDoc()`): add one short plain-language sentence directly above the existing
`verificationRecipe` formula, explaining what it's for ("confirms the request really came from Clio
and wasn't altered in transit") — the formula itself is unchanged, still the precise spec a partner
engineer needs.

### 4.B — Integration screen (`IntegrationClient.tsx`)

`OutboundWebhooksCard`'s intro paragraph currently reads: "The base URL Clio uses to reach your
systems — for delivering usage events and any future integration calls." Replace with wording that
leads with the concrete value (receiving the summary/action-items after a session ends) and keeps
the existing usage-events mention as secondary, e.g.: "The base URL Clio uses to reach your
systems — this is where you receive the summary and action items after each session ends, plus
usage events, e.g. ...". Exact copy is at the implementer's discretion within this framing; must
stay consistent with the Quick start panel's language (`learner_insight` / `action_items`
vocabulary) and must not claim anything about billing behavior beyond what already exists.

`ApiCredentialsCard`'s existing copy ("Generate a client ID and secret for your own backend to call
the Clio API") is already clear and in scope for a first-time reader — no change required.

### 4.C — Explicitly out of scope

- The usage/billing webhook's own framing, event-type documentation, or dispatch behavior.
- `lib/partner/webhooks.ts` and any other route/API behavior.
- Redesigning the endpoint list order, categories, or the Playground itself.
- `GO_LIVE_REQUIRED_STEPS` / go-live gating — unaffected by this pass.

## 5. User Flows

1. New partner opens `/dashboard/configurator/api` → lands on Quick start (default selection) →
   reads the 1-out/1-in model → clicks into `sessions_create` or `widget_sessions_create` in the nav
   for full detail, or opens the Playground to try a real call.
2. New partner opens `/dashboard/configurator/integration` → reads the API base URL card → now
   understands the field's purpose (receiving insights) before filling it in.

## 6. Screens & Components

- `ApiClient.tsx`: new `QuickStartDoc()` component, new `'quickstart'` value added to the
  `NavSelection` union, new nav button rendered above the category loop, `selectedId` initial state
  changed to `'quickstart'`.
- `IntegrationClient.tsx`: one paragraph of copy changed in `OutboundWebhooksCard`'s `editing` and
  configured-state renders (both branches currently repeat similar framing — Section 4.B's line to
  update the description; the "Clio appends a path per integration point" line in the configured
  state is unchanged, it's mechanical not conceptual).
- No new files, no new dependencies.

## 7. Data & API Contracts

Unchanged. No request/response shapes, routes, or webhook payloads change.

## 8. Responsive / Mobile

Both screens already use the standing responsive patterns (`ApiClient.tsx`'s existing
`@media (max-width: 860px)` block collapses the 3-pane grid to stacked panes; `IntegrationClient.tsx`
uses the shared `Card`/`ConfiguratorShell` components which are already responsive). The new Quick
start nav button and panel content reuse the exact same style objects as existing nav
buttons/panels, so no new responsive work is needed — verified by reading the existing CSS block
before implementation.

## 9. Acceptance Criteria

- [ ] Loading `/dashboard/configurator/api` with no prior selection shows the Quick start panel by
      default, with a clearly-marked "Quick start" item at the top of the left nav.
- [ ] Quick start panel states, in plain language: the outbound `sessions` call, the inbound
      `session.insights_ready` webhook and what it carries, that the webhook URL is shared with
      other event types, and that `GET /sessions/:id` is optional/status-only.
- [ ] All 9 existing endpoint docs and the webhook doc's field table/signature/retry sections render
      unchanged.
- [ ] The webhook doc pane shows one new plain-language sentence directly above the existing
      verification formula; the formula text itself is byte-for-byte unchanged.
- [ ] Integration screen's API base URL card copy mentions receiving session insights
      (summary/action items), not only usage events.
- [ ] `npx tsc --noEmit` clean.
- [ ] No changes outside `ApiClient.tsx`, `IntegrationClient.tsx`, and (if needed for the new nav
      item's type) `content.ts`.

## 10. Non-Goals

Redesigning the endpoint reference format; adding new endpoints or fields; changing the billing/
usage webhook's documentation or behavior; changing `GO_LIVE_REQUIRED_STEPS`.

## 11. Open Questions

None.

## 12. Future Considerations

- A dedicated, separate billing/usage-webhook clarity pass (tomorrow morning, per Arun).
- Possibly splitting the multiplexed webhook doc into two nav entries (insights vs. usage) once the
  billing conversation lands — not decided here.
