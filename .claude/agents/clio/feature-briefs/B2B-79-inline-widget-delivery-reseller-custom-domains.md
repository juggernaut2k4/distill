# Feature Brief: B2B-79 — Inline Iframe Delivery & Mandatory Per-Sales-Partner Custom Domains

From: CEO Agent (on behalf of Arun)
To: Business Analyst Agent
Priority: P0 — every real sales-partner's `render_url` depends on this; no exceptions were left open
Date: 2026-08-11
Status: **SPEC-WRITING ONLY. Arun has explicitly said "don't build it."** No code, no DNS/domain
registration, no UI is authorized from this brief. The BA's deliverable is a complete Requirement
Document. Nothing proceeds to a developer agent until Arun has approved that document through the
normal CEO review gate.

**Numbering note:** this is B2B-79, following B2B-77 and B2B-78 in this same brief batch, all from
the same brainstorm session.

**Naming note (2026-08-11, resolved after this brief was first drafted):** the brainstorm session
used "reseller" for the account type; Arun has confirmed (B2B-77 Section 0) this is the already-
shipped "sales-partner" entity from B2B-26/28. **This brief uses "sales-partner" for all
human-facing/narrative references.** No wire-level field names in this brief are affected by the
rename (this brief has none of its own — it produces domain infrastructure, not API request/
response fields).

**Source of truth for this brief:** `docs/2026-08-10-voice-language-brainstorm.md`, the "Delivery
mode & white-label domains" section — decisions D15 through D18. Read every "reseller" in that source
doc as "sales-partner."

**Dependency:** reads naturally after B2B-78 (the session pipeline whose `render_url` this domain
mechanism ultimately serves), but its actual build work (Vercel Domains API integration, DNS
verification, dashboard UI) does not require B2B-78 to be complete — the two can be spec'd and built
in parallel. It also intersects with B2B-77's role model only lightly (a sales-partner manages their
own domain; this doesn't touch client/end_user/internal_staff at all).

---

## 1. What Arun Said / How This Design Was Reached

- **Delivery is a genuine inline iframe, not a redirect or new tab (D15).** Clicking "learn along
  with AI" on the client's own page (worked example: `pluralsight.com/learnClaude`) reveals an
  iframe embedded directly on that same page, pushing existing content down to make room. The
  end_user never leaves the client's page or sees a separate address bar.
- **Every sales-partner must have their own custom domain for the iframe `src` — no shared
  `hello-clio.com` fallback, no exceptions (D16).** The reasoning matters: even though a true inline
  iframe is invisible to the end_user, the *client's own security/IT team* still has to explicitly
  whitelist whatever domain the iframe loads from (CSP `frame-src`, firewall policy). Asking a
  client to whitelist an unfamiliar shared vendor domain they have no direct relationship with is a
  much harder sell than whitelisting a domain tied to the sales-partner they already have a
  contract with. This is a sales/trust argument, not a technical one — the BA should preserve it in
  the spec so a future reader understands why "no shared fallback" is a deliberate choice, not an
  oversight.
- **The mechanism (confirmed, nothing changes hands) — D16:**
  1. Sales-partner picks a subdomain of a domain they already own (e.g. `widget.ailearn.com`).
  2. Sales-partner adds one CNAME record on their own DNS provider, pointing that subdomain at a
     target Vercel gives us. Clio never touches or accesses the sales-partner's domain account.
  3. Clio registers that domain against its Vercel project via the Vercel Domains API (already an
     approved integration in this codebase for exactly this purpose, per B2B-05). Vercel checks DNS
     actually points to us, then auto-issues a TLS certificate — no domain purchase or ownership
     transfer.
  4. Clio's own database records which domain belongs to which sales-partner; host-based routing
     (already an existing pattern in `middleware.ts` for a different purpose) recognizes the
     incoming `Host` header and serves the same underlying session logic regardless of which
     registered domain the request arrived on.
- **Onboarding automation split (D17):** the DNS step (step 2 above) cannot be automated on Clio's
  side — Clio doesn't control the sales-partner's DNS account — but the sales-partner dashboard
  should generate the exact record to add and offer a "Verify" button with real-time pass/fail
  feedback. Steps 3–4 (registering/verifying with Vercel, issuing the cert) are fully automatable:
  sales-partner types their desired domain into a dashboard form, Clio calls the Vercel Domains API
  to register it, the same "Verify" button polls status, and the domain goes live the moment DNS
  confirms — zero manual admin work on Clio's side.
- **Pre-domain validation of the iframe mechanism itself is separable from the domain
  infrastructure (D18).** Whether embedding actually works — cross-origin, with microphone
  permission and a live WebRTC voice connection functioning inside a nested iframe — can and should
  be verified against a real, already-working `render_url` and a throwaway HTML file on any
  different origin, **before** any real sales-partner domain exists. Already checked: no
  `X-Frame-Options` or CSP `frame-ancestors` restriction exists anywhere in this app's config today,
  so there is no known code-level blocker. Two specific risks flagged for that test, not just "does
  it load": (a) the `<iframe>` tag needs an explicit `allow="microphone"` attribute or the browser
  silently denies mic access inside the frame even though the same page works standalone; (b) the
  actual live voice connection (WebRTC/audio to the voice vendor) working correctly from inside a
  nested iframe context, not just visual rendering.

---

## 2. The Problem Being Solved

Today's widget delivery has no concept of a sales-partner's own domain — sessions render wherever
the app itself is hosted. For a real white-label product, a client's IT/security team needs a
believable, trusted domain to whitelist for the iframe source, and the end_user must never perceive
Clio's own infrastructure at all. This brief builds the mechanism that lets every sales-partner
supply their own domain for that purpose, with as much of the setup automated as technically
possible given that Clio cannot touch a sales-partner's own DNS account.

---

## 3. What Success Looks Like

- A sales-partner, from their own dashboard, enters a subdomain they own, is shown the exact DNS
  record to add, adds it on their own DNS provider, clicks "Verify," and — once DNS actually
  resolves — sees that domain go live with a valid TLS certificate, with zero manual intervention
  from Clio's side.
- A session's `render_url` (produced by B2B-78's `bot-sessions`) resolves on that sales-partner's
  own domain, not `hello-clio.com`.
- A client's own page embeds that `render_url` in a genuine inline iframe — pushing existing page
  content down, no new tab, no visible address-bar change — and the live voice session works
  correctly inside that iframe, including microphone access.
- This has been proven end-to-end on a throwaway cross-origin test **before** any real sales-partner
  domain exists, so any iframe/mic/WebRTC problem is caught early and cheaply, not discovered on a
  sales-partner's first real integration attempt.

---

## 4. Known Constraints (binding — do not relax)

- **C1 — No shared fallback domain, ever, no exceptions.** Every sales-partner's `render_url`
  resolves on a domain they registered themselves. Do not build or leave in place any path where a
  sales-partner ships to production on `hello-clio.com`.
- **C2 — Clio never touches a sales-partner's DNS account.** The only sales-partner-side manual
  step is adding one CNAME record. Everything else is Clio-automated via the Vercel Domains API.
- **C3 — Genuine inline iframe, not a redirect or new tab.** This is a hard UX requirement, not a
  preference — the entire trust argument in Section 1 depends on the end_user never leaving the
  client's own page.
- **C4 — The iframe/mic/WebRTC validation (D18) is a required, standalone test step**, not folded
  invisibly into "build the domain feature and see if it works." It must be run and its result
  (pass/fail, and exactly what was checked) recorded before this feature is considered load-bearing
  for a real sales-partner.
- **C5 — No CDN-hosted scripts, no relaxing of this codebase's existing CSP/frame posture** beyond
  what's strictly needed to allow the sales-partner's own domain to embed the widget — per this
  project's standing security rules (CLAUDE.md).

---

## 5. Prior Art the BA Must Read Before Designing

- `.claude/agents/clio/feature-briefs/B2B-05-domain-whitelabel-infra.md` — the existing Vercel
  Domains API integration and white-label domain infra this brief extends. Do not re-derive the
  Vercel API mechanics from scratch if B2B-05 already solved them; confirm what's reusable versus
  what's genuinely new for the per-sales-partner-self-service angle.
- `middleware.ts` — the existing host-based routing pattern referenced in D16, built for a different
  purpose; confirm exactly what it does today and how cleanly a new host→sales-partner resolution
  slots in alongside it without disturbing its current use.
- Whatever CSP / `X-Frame-Options` configuration exists today (checked already, per D18, to be
  absent — the BA should re-verify directly rather than trust the brainstorm log's claim at face
  value, since this is a security-relevant fact the spec will depend on).
- `@vercel/sdk` usage elsewhere in the codebase (already an approved vendor per CLAUDE.md, added for
  exactly this purpose per B2B-05).

---

## 6. Questions for the BA to Resolve (Section 11 must be empty on delivery)

1. **Domain table/schema.** Design the table mapping domain → sales-partner (`partner_accounts`
   with `account_kind='channel_partner'`, per B2B-77's resolved terminology table — confirm the
   exact foreign key against B2B-77 before finalizing), including verification status,
   cert-issuance status, and timestamps for each state transition.
2. **Dashboard UI, full wireframe-level detail.** Per this project's standing "ambiguous UX = STOP"
   rule, this cannot ship as a one-line "sales-partner enters a domain" bullet. Specify: the form
   for entering a desired subdomain, the generated DNS-record display (exact copy, exact record
   type/value shown), the "Verify" button's states (checking / verified / failed, with what failure
   messaging), and what the sales-partner sees before and after verification succeeds.
3. **Polling mechanism for "Verify."** Synchronous check-on-click, or a background job with the UI
   polling status? Specify exactly, including expected latency and what the UI shows while waiting.
4. **Failure and edge cases the BA must specify explicitly, not leave implicit:**
   - Sales-partner enters a domain they don't actually control (DNS never resolves) — what does the
     UI show after some number of failed verification attempts, and is there a hard timeout on an
     unverified domain?
   - Sales-partner wants to change their domain after already going live on one — is this
     supported, and what happens to `render_url`s already issued against the old domain?
   - Two sales-partners attempt to register overlapping/conflicting domains — what happens?
5. **The D18 test — who runs it and when, and what "pass" means precisely.** Specify the exact test
   procedure (already outlined in Section 1) as a concrete, checkable acceptance test with a
   pass/fail bar for both the microphone-permission check and the live WebRTC-in-iframe check, so
   this isn't re-litigated informally later.
6. **Coordinate information architecture with B2B-78's Section 6 item 9.** B2B-78 separately needs a
   sales-partner-facing UI for managing passcodes/API keys/`bot_id` aliases. Propose where domain
   management sits relative to that — same settings area, same page, or deliberately separate — as
   one coherent piece of IA, not two independently-designed screens bolted together after the fact.

---

## 7. Explicitly Out of Scope

- Domain **purchase** or ownership transfer of any kind — this is strictly a DNS-pointing and
  platform-verification mechanism; Clio never buys, sells, or holds a sales-partner's domain.
- Any change to the meeting-bot / inline (`partner-render`) delivery channel's own domain handling,
  unless the BA's investigation finds it's already sharing the exact same mechanism this brief
  builds (confirm, don't assume either way).
- Any relaxation of this app's CSP/frame posture beyond what a verified sales-partner domain
  specifically needs.

---

## 8. Sequencing Note for the Orchestrator

Can be spec'd and, once approved, built in parallel with B2B-78. The D18 iframe/mic/WebRTC
validation test can and should be run early — it needs only one already-working `render_url` from
the current (pre-B2B-78) `widget-sessions` flow, not the new pipeline — so treat it as a fast,
low-risk de-risking step the Orchestrator can schedule ahead of the rest of this brief's build, once
this spec is approved.
