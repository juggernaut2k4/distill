# Brainstorm — Sales-Partner (Channel) Model, Subdomain Routing, and Direct-Partner Field Requirements

**Status:** Design converged with Arun 2026-07-18, in a direct chat discussion (not yet run through the CEO → BA → Dev chain). This document is the durable record of that discussion — the next step is CEO Feature Briefs, not code, per this project's governance model.

---

## 1. Terminology (locked)

A naming collision surfaced mid-discussion and was resolved:

| Term | Meaning | Status |
|---|---|---|
| **super-admin** | Clio's own top-level operator(s). Seeded with `hello.arunprakash83@gmail.com`; more addable, all equal peers. | Built, B2B-21. |
| **internal-staff** | Clio's own employees, invited by a super-admin from the admin dashboard, tagged to specific existing partner accounts to help manage them (account-manager-style role). **This is what B2B-21 built and shipped under the name "sales-partner" — that label is now renamed to "internal-staff."** Every internal-staff activity must be logged and visible to super-admin (not yet built). | Renamed from B2B-21's "sales-partner"; activity logging is new work. |
| **sales-partner** | An external reseller/channel company (e.g. "ai-learn.com" in the worked example) that is itself a paying Clio customer, with its own login, its own branding, and its own downstream clients. Self-registers (not invited). Explicitly **not** called "reseller" — Arun's call: "reseller sounds more industrialistic rather than a business alliance." | New concept, not yet built. |
| **partner** | An end customer of Clio's infrastructure (e.g. "Pluralsight" in the worked example). Either self-registers directly with no sales-partner in the chain, or exists as a client record owned by a sales-partner — in the latter case the partner **never logs into Clio themselves**, ever (confirmed, not just "not yet"). | Direct-partner flow exists (B2B-06); sales-partner-owned client flow is new. |

Visibility rules (confirmed):
- **Super-admin** sees every partner and every sales-partner, plus every internal-staff member's activity log.
- **Sales-partner** sees only their own clients' details, usage, and billing — never another sales-partner's clients, never Clio-internal data.
- **Internal-staff** retains B2B-21's existing scoped-to-tagged-partners access; unchanged by this document except for the rename and the new activity-log requirement.

---

## 2. The two scenarios (worked example: Pluralsight)

### Scenario A — direct (no sales-partner)
Pluralsight registers directly with Clio. They receive one Clio-hosted address, `pluralsight.hello-clio.com`, to post session-trigger requests to. Clio pushes results (transcript, psychology notes, duration) to whatever webhook URL Pluralsight themselves registered, on Pluralsight's own domain. Two-party relationship: Clio ↔ Pluralsight.

### Scenario B — via a sales-partner
"ai-learn.com" is a sales-partner. Pluralsight is one of ai-learn's clients — Pluralsight never registers with Clio. Instead:
- ai-learn signs up once, gets a sales-partner account and its own dashboard login.
- ai-learn creates a client record for Pluralsight (name + company URL) inside their dashboard.
- Clio issues a routing address scoped to both the sales-partner and the client: `pluralsight.ai-learn.hello-clio.com`. This is shown to ai-learn in their dashboard's left pane so they can configure their own systems to forward to it.
- ai-learn's own domain (e.g. `pluralsight.ai-learn.com`) is entirely their concern — Clio never sees or manages it. ai-learn is responsible for routing/forwarding requests from their own domain to the Clio-hosted address.
- Clio pushes results back to whatever URL ai-learn registered for that client (on ai-learn's own domain, e.g. `ai-learn.pluralsight.com` or `pluralsight.ai-learn.com` — Arun's own examples, either is fine, it's fully sales-partner-controlled). Clio never talks to Pluralsight directly, in either direction.

Three-party relationship, but Clio only ever directly interacts with the middle party: `partner → sales-partner → Clio`, both directions. Clio never skips the sales-partner to reach their client.

---

## 3. Inbound/outbound endpoint design (Arun's delegated question, answered and confirmed)

**Inbound (partner/sales-partner → Clio):** No new endpoint type. The existing `POST /api/partner/v1/sessions` (B2B-02/B2B-19) stays the actual API surface. What's new is a **subdomain routing/addressing layer** in front of it:
- Clio owns and hosts every `*.hello-clio.com` address (both `{client}.hello-clio.com` for direct partners and `{client}.{sales-partner}.hello-clio.com` for sales-partner-mediated clients).
- The subdomain is resolved server-side (Host-header lookup, reusing the tenant-resolution middleware pattern from the original B2B-05 domain work, repointed at the API surface instead of browser pages) to determine which `partner_account_id`'s config/docs apply.
- **Confirmed security design (Arun explicitly signed off, 2026-07-18): the subdomain is routing/addressing convenience only.** It is never trusted as authentication by itself — a Host header is spoofable. The caller must still present their API key/OAuth2 token in the request, exactly as today; the token is what actually proves identity. The subdomain only decides which tenant's configuration the request is routed against.

**Outbound (Clio → partner/sales-partner):** No new mechanism. Reuses the existing HMAC-signed webhook dispatch (`webhook_dispatch_log`, `session.insights_ready`, B2B-02/B2B-09). The registered `webhook_url` lives on the client's own `partner_account` row in both scenarios — for a sales-partner-mediated client, the sales-partner configures/edits that field on the client's behalf (since the client never logs in).

**Internal visibility (glitches/bugs) needs no new external push at all.** This is already solved by B2B-22 — a sales-partner's dashboard should surface all their clients' Known Bugs the same way B2B-22 already gives internal-staff an unscoped view across their tagged partners; it just needs extending to key off sales-partner-owned clients rather than only internal-staff tagging.

---

## 4. Billing model (confirmed)

- **Direct partner:** unchanged from today — one wallet, one consolidated charge (B2B-04/13).
- **Sales-partner:** **one shared wallet**, funded by the sales-partner only — their clients never pay Clio directly. The sales-partner's dashboard shows:
  - per-client usage and recharge/consumption detail
  - one consolidated total, which is what the sales-partner actually pays
  - an optional per-client usage cap (nullable = unlimited), which the sales-partner sets/clears per client, enforced against the shared pool as usage happens
  - the sales-partner tops up / extends the shared prepaid balance as it draws down

---

## 5. Switching sides

If a client currently under a sales-partner wants to go direct, there is **no migration path** — they must first have their sales-partner-owned relationship cancelled, then sign up fresh as a direct partner. This is a deliberate simplification: no reassignable foreign key to design around, no data-carryover logic needed.

---

## 6. New work surfaced by this discussion (not yet built)

1. Rename B2B-21's "sales-partner" role to "internal-staff" throughout schema/code/UI.
2. Internal-staff activity audit log, visible to super-admin.
3. New sales-partner entity: self-serve signup (flat model, not Clerk Organizations — same reasoning as B2B-21's internal-admin layer), client CRUD, own dashboard/login.
4. Super-admin global view across all partners and all sales-partners.
5. `*.hello-clio.com` subdomain routing layer — Host-header → tenant resolution, API-key/OAuth2 token still required for actual authentication.
6. Per-client `webhook_url` field, editable by the sales-partner on the client's behalf when a client has no login of its own.
7. Sales-partner shared-wallet billing: one wallet per sales-partner, per-client usage tracking, optional per-client caps, consolidated invoice view.
8. Per-client behavior/voice/language configuration UI (data layer exists via B2B-11's `partner_prompt_config`; no UI yet). Confirmed: a sales-partner can customize this separately per client, not one blanket setting for all.

---

## 7. Field/screen requirements (the original question this discussion returns to)

See the live conversation for the answer as of this document's writing — to be finalized once the CEO Feature Briefs for items 1–8 above are written and approved. Kept here as a pointer rather than duplicated, so this document doesn't drift out of sync with the approved specs once they exist.

---

## Next step

Not yet dispatched to the CEO agent. Proposed split into Feature Briefs, pending Arun's go-ahead:
- **(A)** Terminology rename + internal-staff activity log + super-admin global view
- **(B)** Sales-partner entity: self-serve signup, auth, client management, dashboard
- **(C)** Subdomain routing layer (`*.hello-clio.com`, Host-header tenant resolution)
- **(D)** Sales-partner billing model (shared wallet, per-client caps, consolidated invoicing)
- **(E)** Per-client behavior/voice/language configuration UI
