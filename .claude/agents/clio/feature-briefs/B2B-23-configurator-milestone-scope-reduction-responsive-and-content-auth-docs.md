# Feature Brief: B2B-23 — Configurator Milestone Scope Reduction, Fully-Responsive Shell, and Partner Content-Auth Documentation

<!-- Note: originally drafted as B2B-21, then self-reassigned to B2B-22; Orchestrator ratified final ID as B2B-23 on 2026-07-18 by actual file mtime order after a 4-way parallel ID collision (B2B-21=internal-admin-identity, B2B-22=partner-facing-known-bugs, B2B-23=this brief, B2B-24=configurator-dashboard-overview-landing). -->

ID: B2B-23

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 (unblocks the current milestone demo — the Configurator must reflect only what the API-driven flow needs)
Date: 2026-07-18
Depends on / builds on: B2B-16 (Configurator/API/Docs nav shell), B2B-19 (inline content delivery + content-source auth), B2B-20 (Configurator left-nav restructuring + Go-Live gate)

---

## 0. The Milestone This Serves (read first — it is the lens for everything below)

Arun's milestone, verbatim:

> "our milestone is, to run a complete session without any human interventions when we trigger the bot and push the api with content, visual urls or images in the meeting platform"

This is the **fully API-driven flow built in B2B-19 (Option 1)**: a partner registers their content-source auth **once via API**, then triggers a session **via API** with inline content + visual URLs/images, and Clio's bot runs the whole session in the meeting platform with **zero portal interaction**. There is no Clio-hosted partner-facing web page in this flow, and Clio does not generate the learning content (that is the retired/deferred Option 2 path).

Every Configurator section is being judged against this one question: **does the API-driven milestone need it?** Arun has already gone through all seven sections and given a decided disposition. This brief implements that disposition literally. It is not open for reinterpretation — except for the one item (C5/Domain) explicitly flagged below as a real, investigated ambiguity that needs Arun's decision.

This brief has **three workstreams**, all P0, that can be specced together but are logically distinct:

- **WS-1 — Configurator visible-scope reduction** (hide C1–C4, keep C6/C7, resolve C5, update the Go-Live required set)
- **WS-2 — Fully-responsive Configurator shell** (fix the hard 960px cap; establish Clio's standard responsive pattern)
- **WS-3 — Partner content-auth documentation + gap audit** (document exactly what a partner must send for content/visual auth, per auth type; surface any genuine gaps)

---

## 1. What Arun Said (verbatim, per section)

Arun walked the seven Configurator sections (built in B2B-20: left-nav + panel — Questionnaire / Topics / Content / Visualization / Domain / Integration / Payment) against the milestone and gave this numbered disposition:

- **C1 Questionnaire** — "hide it not needed now."
- **C2 Topics** — "we dont need the list of topics. the session title, subtitle and content passed in api. so this is not needed now. hide it."
- **C3 Content** — "no need in ui. we need it pass through api."
- **C4 Visualization** — "not needed. hide it. visualization urls or images and auth is sent through api." Plus: *"let me know if you identify any gaps in accessing that. document everything you want from the partner so they can send you the expected auth or format."*
- **C5 Domain** — "domain is the information needed to which we will add the api urls so we can build that api endpoint for our communication (www.reqres.in -> whereas for each api they can append with /people etc)."
- **C6 Integration** — "this needs to be passed along with api. for security reasons if you want a keyword or password to encrypt so our application will use this word to decrypt the sent auth, then that info we can store it."
- **C7 Payment** — "this is needed."

On the Go-Live gate, when asked whether B2B-20's required set should be updated to reflect the hides, Arun said **"yes do it."**

On responsiveness: *"i want our application to be fully responsive no matter the resolution, pixels, or screen size are."*

---

## 2. The Problem Being Solved

**WS-1:** The Configurator currently presents all seven sections as equally relevant (`ConfiguratorSurface.tsx` `NAV_GROUPS`: "Learning experience" = Questionnaire/Topics/Content/Visualization; "Delivery & integration" = Domain/Integration; "Billing" = Payment). Four of these (Questionnaire, Topics, Content, Visualization) drive Clio's own content-generation / self-serve-onboarding path — the exact opposite of the API-driven milestone where the partner supplies session title/subtitle/content/visual-URLs/auth entirely through the API. Leaving them visible tells a partner they must configure things the milestone flow ignores. It creates friction and confusion on a surface meant for a partner integrating via API. Arun wants the Configurator to show **only** what the API-driven milestone actually requires.

**WS-2:** `app/dashboard/configurator/_shared.tsx` hard-caps the entire nav+panel content column at `maxWidth: 960px` (line 84 on `ConfiguratorShell`; line 238 on `ConfiguratorNavShell`). On any normal desktop monitor this leaves large dead space to the right, which reads as unfinished and cheap on a surface partners will judge Clio by. Arun wants the application fully responsive at any resolution — and wants this to become Clio's **standard responsive pattern going forward**, not a one-off.

**WS-3:** For the milestone, the partner sends content + visual auth through the API. Arun explicitly asked us to (a) audit whether there are any **gaps** in how a partner can hand Clio the auth/format it needs to fetch their content and images, and (b) **document everything** a partner must send, per auth type, so they can integrate without back-and-forth. This documentation is destined for the Docs page (`app/dashboard/configurator/docs/DocsClient.tsx`).

---

## 3. What Success Looks Like

- A partner opening the Configurator sees only the sections the API-driven milestone needs — no dead-end "Learning experience" configuration they'll never use in this flow.
- The Configurator uses the full width of the screen at any resolution, scaling spacing/typography smoothly, capped only far enough out (~1800–2000px) to prevent absurd line lengths on ultrawide monitors. The fix is written as a reusable pattern future screens follow.
- A partner can read one clear Docs section that tells them **exactly** what fields to send for each content-auth type (and what formats Clio expects), with any real gaps in Clio's current auth coverage identified and either closed or explicitly documented as "not yet supported."
- The Go-Live gate no longer requires a now-hidden section, and requires the set that actually matters for the API-driven milestone.

---

## 4. Known Constraints (must / must-not)

1. **Implement the C1–C4 hides literally.** Hide, do not delete. The sections' code, routes, DB tables, and wizard steps remain intact and functional — this is a **visibility change in the Configurator nav/panel only**. B2C is retired but these are B2B Option-2 surfaces that may return; do not rip them out. (Governance: "no delete without approval"; "no impact on existing.")
2. **"Hide" means removed from the Configurator's `NAV_GROUPS` / section switcher**, so a partner cannot navigate to them from the Configurator. The BA must define precisely what happens if a hidden section's route is reached directly (e.g., `?section=topics` deep link) — see Questions.
3. **Keep C6 Integration and C7 Payment visible and unchanged** in behavior (aside from the C6 encryption-keyword evaluation below, which is a *maybe*, not a mandate).
4. **Do not resolve C5 by guessing.** Investigation is done (Section 6); it produced a specific ambiguity that needs Arun's decision. The BA must treat C5 as blocked on the CEO escalation in Section 8 and spec the rest around it.
5. **Do not use AI-generated content to populate the Docs page.** WS-3 documentation is factual, derived from the actual code (`content-sources.ts`, the content-sources POST route, `live-render.ts`, `ssrf.ts`). No speculative AI copy.
6. **Responsive fix must not regress** the existing `ConfiguratorSurface` layout, which already deliberately cancels the NavShell's fixed 32px padding (see its lines ~182–183 comment) to own its own responsive padding. The `_shared.tsx` change must compose with that, not fight it.
7. **Scope boundary vs `/design-review`:** this brief owns product-shape and layout-*mechanism* changes only. Final visual polish (spacing rhythm, type scale, hierarchy, AI-slop cleanup) is a separate `/design-review` pass that should run **after** this lands (see Section 9). Do not attempt both in one pass.

---

## 5. Detailed Disposition & Certain Decisions (WS-1)

The BA should spec these as decided:

| Sec | Name | Disposition | Certainty |
|-----|------|-------------|-----------|
| C1 | Questionnaire | **Hide** from Configurator nav | Decided |
| C2 | Topics | **Hide** | Decided |
| C3 | Content | **Hide** | Decided |
| C4 | Visualization | **Hide** | Decided |
| C5 | Domain | **RESOLVED 2026-07-18 — Option A (Section 8): Hide** white-label Domain section; `outbound_base_url` in Integration already covers Arun's described need | Decided |
| C6 | Integration | **Keep visible, unchanged.** Optional encryption-keyword = evaluate, recommend defer (Section 7) | Decided (keep); keyword = recommend defer |
| C7 | Payment | **Keep visible, unchanged** | Decided |

**Consequence — empty nav group:** hiding C1–C4 empties the entire "Learning experience" `NAV_GROUP`. The BA must spec that the group heading disappears when it has no visible items (no orphan heading, no empty section). If C5/Domain is also hidden (pending Arun), "Delivery & integration" collapses to just Integration — the BA should handle group headings generically (render a heading only if it has ≥1 visible item) rather than hard-coding, so the C5 outcome doesn't require a second code change.

**Go-Live required set (WS-1, partially certain):**
- Current: `GO_LIVE_REQUIRED_STEPS = ['questionnaire', 'payment']` in `lib/partner/wizard.ts`.
- **Certain:** `'questionnaire'` must be **removed** — it is now a hidden, milestone-irrelevant section; gating Go-Live on it is wrong.
- **Certain:** `'payment'` stays.
- **Open (C5-dependent):** what, if anything, replaces questionnaire. The load-bearing thing for the API-driven milestone is that the partner has configured how Clio reaches them / authenticates outward — which today lives in **Integration** (`outbound_base_url`) and in the **content-source** registration (B2B-19). **Technical gap the BA must resolve:** the wizard's `WizardStep` type and `checkStepComplete()` have **no `'integration'` case** — Integration is a nav section but not a wizard step, so it currently cannot be named in `GO_LIVE_REQUIRED_STEPS`. If the required set should include Integration, the BA must define an `integration` completion check (e.g., `outbound_base_url IS NOT NULL`, or a registered content source exists) and wire it in. Do not assume; spec it explicitly once C5 resolves. Likely landing point: `['integration', 'payment']`, possibly `+ domain` depending on C5 — but the BA states the final set only after Arun answers Section 8.

---

## 6. C5/Domain — Investigation Findings (do not skip; this is the crux)

I investigated the code precisely before writing this, because Arun's C5 description does not map cleanly onto the section currently labeled "Domain." Two **distinct** concepts already exist in the codebase:

**(A) The current "Domain" section** — B2B-05. Files: `lib/partner/domain-settings.ts`, `app/dashboard/configurator/domain/DomainConfigClient.tsx`. It configures **Clio-owned white-label hosting**: `partner_accounts.subdomain_slug` (e.g. `partner.hello-clio.com`) and an optional verified `custom_domain`, via the Vercel Domains API. This is **inbound** — where an end-user's browser *reaches* a Clio-hosted partner page (e.g. `/partner-questionnaire/{id}`). Its Go-Live completion check is "has a `subdomain_slug`." This concept belongs to the Clio-hosted-page family (same family as C1 Questionnaire) — which the API-driven milestone does **not** use.

**(B) `outbound_base_url`** — B2B-02. Stored on `partner_accounts.outbound_base_url`; **edited today inside the Integration section** (`IntegrationClient.tsx`). It is the **partner's own API base URL that Clio calls outward**, appending paths: `{outbound_base_url}/content`, `/profile`, `/topics`, `/questionnaire-response`, `/webhooks/usage` (see `render-data.ts`, `topics-config.ts`, `questionnaire.ts`, `webhooks.ts`). This is **exactly** Arun's description: a base like `www.reqres.in` to which Clio appends `/people` etc.

**Finding:** Arun's C5 "Domain" *description* matches concept **(B), `outbound_base_url`, which already exists and already lives in the Integration section (C6, staying visible)** — not concept (A), the section currently *labeled* "Domain." The section named "Domain" is white-label hosting, which the milestone doesn't need.

This is a genuine ambiguity about Arun's **intent**, because his mental model ("Domain") sits between two existing things. It resolves three plausible ways — escalated in Section 8. The BA must **not** pick one.

---

## 7. C6 Integration — Encryption-Keyword Evaluation (CEO recommendation: defer)

Arun *offered* (did not mandate) an additional partner-supplied encryption keyword/passphrase: "if you want a keyword or password to encrypt so our application will use this word to decrypt the sent auth, then that info we can store it."

**What already exists (B2B-19):** content-source credentials (a partner's Bearer token, or an OAuth2 `{client_id, client_secret}` blob) are encrypted at rest with **AES-256-GCM** using Clio's own key (`PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY`, scrypt-derived; `lib/partner/crypto.ts`), never stored plaintext, format `v1:<iv>:<tag>:<data>`.

**CEO security-design read (for the BA to document; recommend affirm):** A partner-supplied passphrase adds *no* meaningful protection over what's already built **if Clio stores it alongside the ciphertext** — which Clio must, because Clio has to decrypt-and-replay the credential *outward* at fetch time to authenticate to the partner's server. A key stored next to the data it protects is equivalent to Clio's own managed key against the realistic threat (a Clio-DB compromise). It would only add value under a per-request-passphrase model (partner re-supplies the secret on every session trigger and Clio never persists it) — which is a materially different, heavier integration model that the milestone does not need. **Recommendation: defer the partner-supplied keyword.** Document the existing AES-256-GCM-at-rest as the mechanism; do not add a partner-passphrase field for this milestone. If Arun still wants it, it's a fast-follow with its own brief. The BA should document this reasoning and the decision, and confirm with CEO before finalizing.

---

## 8. 🔴 CEO ESCALATION — NEEDS ARUN'S DECISION (C5/Domain)

**Context:** We're reducing the Configurator to only what the API-driven milestone needs. Arun's disposition for the "Domain" section was: *"domain is the information needed to which we will add the api urls so we can build that api endpoint for our communication (www.reqres.in -> for each api they append /people)."* Investigation (Section 6) shows that description matches Clio's existing `outbound_base_url` — which already lives in the **Integration** section — and does **not** match the section currently *labeled* "Domain" (which is white-label subdomain/custom-domain hosting, a different concept the milestone doesn't use).

**Blocker:** What does Arun want done with "Domain"? His words describe a thing that already exists elsewhere, and the section bearing that name is something else. I won't guess between these.

**Options considered:**
- **Option A (CEO-recommended):** Arun's described need is *already built* as `outbound_base_url` in the Integration section. So: **hide the current white-label "Domain" section** (it serves the retired Clio-hosted-page path, not the milestone), and make sure the partner's API base URL is clearly presented in Integration (relabel/clarify that field if needed). Nothing new to build for the base-URL concept. Go-Live required set → `['integration', 'payment']`.
- **Option B:** Arun wants a dedicated, clearly-labeled "API Base URL / Domain" section separate from Integration, even though the field already exists in Integration. We'd surface `outbound_base_url` into its own section for prominence, and still hide the white-label Domain section. More UI, some redundancy with Integration.
- **Option C:** Arun genuinely means the current white-label "Domain" (subdomain hosting) and believes it's needed for the milestone. Investigation says it is **not** on the API-driven critical path (no Clio-hosted page in that flow), so this is the least likely — but I'm naming it so Arun can correct me if the meeting/bot flow relies on a partner domain in a way I've missed.

**Recommendation:** Option A. It matches Arun's description to what already exists, keeps the surface lean, and needs no new build — only hiding the white-label Domain section and clarifying the base-URL field's presentation in Integration.

**Please reply with your decision (A / B / C, or a correction) so the BA can finalize the C5 disposition and the Go-Live required set.**

> **✅ RESOLVED by Arun, 2026-07-18: "a"** — **Option A confirmed.** Hide the current white-label
> "Domain" section (`lib/partner/domain-settings.ts` / `DomainConfigClient.tsx`) — it serves the
> retired Clio-hosted-page path, not the milestone. `outbound_base_url` in the Integration section
> already covers Arun's described need; clarify/relabel that field's presentation there rather than
> building anything new. **Go-Live required set: `['integration', 'payment']`** — the BA must define
> the `integration` completion check (`outbound_base_url IS NOT NULL`, or a registered content source
> exists per B2B-19) and wire it into `checkStepComplete()`/`GO_LIVE_REQUIRED_STEPS`, since neither
> currently has an `integration` case (Section 6/7's named technical gap).
>
> **Section 11 blocker on C5 is now CLOSED.** Nothing in this brief remains blocked — the BA can
> finalize the full Requirement Document, including WS-1's Go-Live gate change, without further
> escalation.

---

## 9. WS-2 — Fully-Responsive Shell (mechanism spec for the BA)

**The bug:** `app/dashboard/configurator/_shared.tsx`
- Line 84 — `ConfiguratorShell` content wrapper: `padding: 32, maxWidth: 960, margin: '0 auto'`
- Line 238 — `ConfiguratorNavShell` content wrapper: `padding: 32, maxWidth: 960, margin: '0 auto'`

Both hard-cap the content column at 960px, leaving dead space on normal desktop widths.

**Agreed direction (Arun approved):** replace the hard pixel cap with a **fluid, tiered** system:
- No hard cap below a very wide ceiling (~1800–2000px), and that ceiling exists purely to stop absurd line lengths on ultrawide monitors — not to box content into 960px.
- Spacing and typography scale **smoothly** between breakpoints using `clamp()` + Tailwind responsive utilities, rather than jumping at fixed points.
- This becomes **Clio's standard responsive pattern going forward** (already logged in `BACKLOG.md` "🎨 STANDING STORY — Responsive/mobile-friendly by default" and referenced in `CLAUDE.md`). Document it clearly enough (a short pattern note + the reusable wrapper) that future screens follow it instead of re-hardcoding caps.

**Technical reality the BA must address:** the shared shells use **inline `style={{}}` objects, not Tailwind classes**. `clamp()` works fine inline; **media-query breakpoints do not work in inline styles.** So achieving true tiered/responsive behavior requires either (a) migrating these wrappers to `className` with Tailwind responsive utilities, or (b) a small CSS module / style block for the breakpoint tiers, with `clamp()` for the smooth-scaling padding/max-width. The BA should choose and specify one approach, apply it to **both** wrappers (lines 84 and 238), and confirm it composes with `ConfiguratorSurface`'s existing padding-cancel workaround (its ~lines 182–183). Fix the `_shared.tsx` shells specifically in this brief; the reusable pattern is the durable output.

**Out of scope for WS-2:** re-theming, spacing-rhythm polish, type-scale redesign — that's the follow-on `/design-review` pass. WS-2 is the *layout mechanism* (kill the cap, go fluid/tiered, make it reusable) only.

---

## 10. WS-3 — Partner Content-Auth Documentation + Gap Audit (spec for the BA)

**Deliverable:** partner-facing documentation content for `app/dashboard/configurator/docs/DocsClient.tsx` that states exactly what a partner sends to register a content source and how Clio fetches their content/images — plus a gap audit. All facts derive from code, not AI invention.

**What the code actually supports today** (from `content-sources.ts` + `POST /api/partner/v1/content-sources` Zod schemas + `live-render.ts`/`ssrf.ts`) — the BA should verify and turn into partner-facing field tables:

- **`auth_type: 'none'`** — public URLs; fields: `label?`. No auth header sent.
- **`auth_type: 'static_bearer'`** — fields: `token` (required), `header_name?` (default `Authorization`), `header_scheme?` (default `Bearer`; empty string ⇒ raw header value with no scheme prefix), `label?`. Clio sends `{header_name}: {header_scheme} {token}`.
- **`auth_type: 'oauth2_client_credentials'`** — RFC 6749 §4.4 against the **partner's own** token endpoint (Clio is the client). Fields: `token_url` (required, valid URL), `client_id` (required), `client_secret` (required), `scope?`, `audience?`, `label?`. Clio fetches a token (HTTP Basic client auth, `grant_type=client_credentials`), caches it per source, and sends `Authorization: Bearer <token>` when fetching pages.
- **`presigned_url`, `mtls`** — documented enum values **rejected at registration** (422 with a clear message); never stored. Docs must say these are not yet supported.

**At session-trigger time:** the partner passes content + visual URLs/images inline and references a registered `content_source_id`; Clio replays the resolved auth **outward** to fetch, **SSRF-guarded** (`ssrf.ts`): partner endpoints must be **publicly reachable** (no loopback/private-IP/link-local), a 15s timeout applies, and redirects are handled `manual` (i.e., a redirecting endpoint will not be followed). Partners need to know these constraints.

**Candidate gaps to audit and either close or document as "not supported"** (BA confirms each against the code; escalate any that need a product decision rather than a doc line):
1. **API-key-in-query-param auth** — `static_bearer` covers header-based keys but not `?api_key=...` query-param auth some partner APIs use. Real gap for the milestone? (Many content/image APIs use query-param keys.)
2. **Multiple/custom static headers** — only a single header name/value pair is supported; multi-header auth is not.
3. **Presigned / expiring URLs for images** — if a partner's images are behind presigned URLs, they may work under `auth_type: 'none'` (the signature is *in* the URL) — clarify this explicitly, since `presigned_url` as an *auth type* is rejected but a presigned URL passed as the image URL itself is fine.
4. **Expected content/image formats** — the Docs must state what Clio expects when it fetches a content URL (content-type/shape) and any image constraints (formats, size, must be directly fetchable). Verify against `live-render.ts`.
5. **Public-reachability / no-redirect / timeout constraints** — document as partner requirements (from `ssrf.ts` + the fetch config).

The output of WS-3 is (a) the Docs content and (b) a short gap list; genuine product gaps (e.g., "we should add query-param key auth") get logged to `BACKLOG.md` and, if they'd change the milestone's viability, escalated to CEO — they are **not** silently built in this brief.

---

## 11. Files In Scope (for the BA's "Files Changed" section — confirm/expand)

- `app/dashboard/configurator/ConfiguratorSurface.tsx` — `NAV_GROUPS`, `SECTION_LABEL`, `CANONICAL_ORDER`, first-incomplete default, group-heading-only-if-nonempty logic, direct-deep-link-to-hidden-section behavior (WS-1)
- `lib/partner/wizard.ts` — `GO_LIVE_REQUIRED_STEPS` (remove `questionnaire`; C5-dependent addition), and a new `integration` completion check if the resolved required set needs it (WS-1)
- `lib/partner/configurator-status.ts` — the status shape the nav dots read; align with hidden sections (WS-1)
- `app/dashboard/configurator/_shared.tsx` — lines 84 & 238 responsive fix + reusable pattern (WS-2)
- `app/dashboard/configurator/integration/IntegrationClient.tsx` — only if C5 → Option A/B requires clarifying/relabeling the `outbound_base_url` presentation (WS-1, C5-dependent)
- `app/dashboard/configurator/docs/DocsClient.tsx` — content-auth documentation (WS-3)
- `BACKLOG.md` — log any WS-3 gaps and the responsive standing-pattern reference
- `docs/b2b-pivot-status.md` — Live Status update on merge

Do **not** touch or delete: `questionnaire/`, `topics/`, `content/`, `visualization/`, `domain/` section implementations or their API routes / DB tables / wizard step columns — these are hidden, not removed.

---

## 12. Questions for the BA to Resolve in the Requirement Doc

1. **Deep-link to a hidden section:** if a partner reaches `?section=topics` (or Topics/etc.) directly via URL, what happens? Redirect to the first visible section? 404 within the surface? A neutral "not part of your current setup" state? Spec it — don't leave it undefined.
2. **First-incomplete default & canonical order** after C1–C4 (and maybe C5) are hidden — what's the landing section when a partner opens the Configurator? (Currently defaults to `questionnaire`, which will be hidden.)
3. **Group-heading rendering** — confirm the generic "render heading only if ≥1 visible item" approach so the C5 outcome needs no second change.
4. **Go-Live gate** — final `GO_LIVE_REQUIRED_STEPS` (pending Section 8), plus the `integration` completion-check definition if included. Ensure the server gate and the nav's button-disabled state agree (they share `checkStepComplete`).
5. **WS-2 approach** — className-migration vs CSS-module/style-block for breakpoint tiers; the exact ceiling (1800 vs 2000px); the `clamp()` ranges for padding. Confirm no regression to `ConfiguratorSurface`'s padding-cancel.
6. **WS-3 gaps** — which candidate gaps (Section 10) are real, which are doc-only, which need CEO escalation.
7. **C6 keyword** — confirm the CEO "defer" recommendation (Section 7) or escalate if the BA sees a threat-model reason to build it now.

**Section 11 (Open Questions) of the Requirement Doc must be empty before any C5-dependent code is written.** The C1–C4 hides, WS-2, and WS-3 may proceed once their (non-C5) questions are closed and CEO approves the spec.

---

## 13. Sequencing & Governance

- CEO → BA (this brief) → BA writes full 12-section Requirement Doc → CEO review/approve → Dev.
- **Escalate Section 8 (C5) to Arun now**, in parallel with the BA starting the non-blocked slices.
- After this lands and is QA-signed-off (all three gates, incl. live browser UI functional testing on the deployed app), a **`/design-review` pass** should follow for final visual polish on the reduced, responsive surface — that pass commits locally and holds pushes for Arun's approval. Do not fold design-review polish into this brief.

— CEO (for Arun), 2026-07-18
