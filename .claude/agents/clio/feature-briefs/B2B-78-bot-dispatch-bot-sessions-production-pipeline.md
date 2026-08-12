# Feature Brief: B2B-78 — Production Session Pipeline: `bot-dispatch` + `bot-sessions`

From: CEO Agent (on behalf of Arun)
To: Business Analyst Agent
Priority: P0 — this is the production sales-partner-facing API surface the business runs on
Date: 2026-08-11
Status: **SPEC-WRITING ONLY. Arun has explicitly said "don't build it."** No code, no schema, no
API is authorized from this brief. The BA's deliverable is a complete Requirement Document. Nothing
proceeds to a developer agent until Arun has approved that document through the normal CEO review
gate.

**Numbering note:** this is B2B-78, following B2B-77 (application role model) in this same brief
batch. Both come from the same brainstorm session.

**Naming note (2026-08-11, resolved after this brief was first drafted):** the brainstorm session
this brief is based on used the word "reseller" throughout for the account type that pays Clio and
manages clients. Arun has confirmed (see B2B-77 Section 0) that this is the already-shipped
"sales-partner" entity from B2B-26/28 (`partner_accounts.account_kind = 'channel_partner'`), not a
new concept — only the name was wrong. **This brief now uses "sales-partner" for all human-facing/
narrative references.** Per B2B-26's own already-established convention (code/wire identifiers may
keep "reseller"/"channel" as an internal token even where UI copy says "sales-partner"), the literal
field names below (`reseller_id`, `reseller_unique_id`) are preserved as specified in the source
brainstorm doc — whether to rename them at the wire level is called out explicitly as an open
question for the BA in Section 6, not decided unilaterally here.

**Source of truth for this brief:** `docs/2026-08-10-voice-language-brainstorm.md`, everything under
"Production `bot-dispatch` API" through "`bot-sessions` field review, continued" — decisions D6
through D9, D14, and D19 through D23. Read that material in full; this brief organizes and gates it,
it does not restate every word. Read every "reseller" in that source doc as "sales-partner," per the
naming note above.

**Dependency:** read B2B-77 (application role model) first, specifically Section 0's resolved
terminology table and Section 7's open questions (especially the `internal_staff` rename migration)
before finalizing this brief's own schema decisions.

---

## 1. What Arun Said / How This Design Was Reached

This was reasoned through live, not handed down as a single instruction — I'm summarizing the
actual path since the "why" matters for the BA to build the right thing rather than just the literal
final words. **Read "reseller" throughout this section as "sales-partner"** (see naming note above;
quoted fragments preserve the original wording).

- Arun wants a real production replacement for today's `widget-sessions` model: a sales-partner
  calling `POST /api/partner/v1/widget-sessions` directly, authenticated by one account-wide API
  key.
- The design went through two rejected shapes before landing on the current one:
  1. **Rejected: a passcode-based relay (`bot-dispatch` fetches a credential on the sales-partner's
     behalf).** Killed by a real constraint — API keys are stored one-way hashed
     (`hashApiKey()` → `key_hash`), so a passcode can never be used to "look up" and hand back a raw
     key that was never stored in reversible form.
  2. **Rejected (briefly): no `bot-dispatch` at all, sales-partner calls `bot-sessions` directly
     with a per-client key.** This was the landing point for one session, then reopened the next
     day (D14) into the actual final shape below, once Arun decided the flow should be a genuine
     multi-step session lifecycle, not one call.
- **Final decision (D14): `bot-dispatch` is stage 1 — identity + reservation only.** Takes
  `end_user_name` + the sales-partner's passcode (a passcode is generated per sales-partner↔client
  pairing, separate from and alongside a per-client API key), resolves passcode → billing account
  (which sales-partner, which client), returns a `session_id`. That `session_id` is the umbrella
  key every subsequent call in the session's lifecycle references (content submission, status,
  ending, insights) — not just the next call.
- **`bot-sessions` is stage 2** (the production name for `widget-sessions`) — takes the `session_id`
  plus content, voice/language, and everything else `widget-sessions` already validates today, and
  returns `render_url`. **Auth on stage 2+ is still the existing key-based mechanism in full** —
  `session_id` alone is never sufficient credential (D14, "still open" now resolved by this
  statement).
- **`bot_id` (D20)** replaces `elevenlabs_agent_id` specifically so the field name never reveals
  Clio's underlying voice vendor to a sales-partner — via three layers of indirection (real hidden
  ElevenLabs agent ID → Clio's own catalog agent names, organized by language → the sales-partner's
  own custom alias, resolved per-sales-partner). Arun's stated general principle behind this (D20):
  sales-partner-facing field/API names should never reveal which third-party vendors power Clio
  internally.
- **Full field-by-field review of the `bot-sessions` request body was done** (D8, D9, D19, D23) —
  every field's purpose, optionality, and documentation obligation is already decided; see Section 5.

---

## 2. The Problem Being Solved

Today's real production API (`widget-sessions`) is a single call, authenticated by one API key per
whole sales-partner account, with no first-class concept of "reserve a session for a specific
end-user, then fill in content afterward." Arun wants: (a) per-sales-partner-per-client-scoped
credentials instead of one account-wide key, so activity is attributable at the client level
automatically; (b) a two-stage lifecycle so a `session_id` can exist before content is known,
matching how a real integration (e.g. a button on a client's LMS page) actually wants to work —
reserve the moment a learner clicks, fill in what they're learning a moment later; and (c) a
vendor-hiding field design so the white-label promise (sales-partner never sees "ElevenLabs"
anywhere) holds at the API level, not just the UI level.

---

## 3. What Success Looks Like

- A sales-partner can call `POST .../bot-dispatch` with an end-user's name and their own
  per-sales-partner-client passcode, and get back a `session_id` before any content is decided.
- The same sales-partner, moments later, calls `POST .../bot-sessions` with that `session_id`,
  their per-client API key, and the session's content/voice/language, and gets back a working
  `render_url` — identical in effect to what `widget-sessions` produces today.
- A sales-partner who names their own alias "english_bot" gets the voice they configured for that
  alias in their dashboard, with zero visibility into what vendor or real agent ID sits behind it.
- A sales-partner who never follows up after `bot-dispatch` (never calls `bot-sessions`) does not
  leave an unbounded, uncleaned reservation behind.
- The sales-partner-facing API docs page fully explains every field in both calls, including the
  ones that are easy to misuse (per D9, D21, D23 below).

---

## 4. Known Constraints (binding — do not relax)

- **C1 — Two-stage lifecycle, not one call.** `bot-dispatch` (identity + reservation) and
  `bot-sessions` (content + delivery) are separate endpoints, linked by `session_id`. Do not
  collapse them back into one call.
- **C2 — `session_id` is never itself a credential.** Every call after `bot-dispatch` still requires
  the sales-partner's real API key. A leaked or guessed `session_id` alone must not be enough to act
  on a session.
- **C3 — `bot_id` never reveals the underlying voice vendor.** Three-layer indirection is mandatory,
  not optional (D20) — real agent ID (hidden) → Clio catalog name (sales-partner sees after enabling
  a language) → sales-partner's own alias (what the sales-partner actually sends). Validation must
  be scoped per-sales-partner, not against one global list (unlike the current demo's `bot_id`
  validation, which the demo's simpler model can get away with and production cannot).
- **C4 — `content_to_explain` stays capped at 5000 chars; bulk content goes in `content_pages`
  (D23).** Do not raise this limit to solve the long-content problem — chunking across
  `content_pages` is the intended and sufficient mechanism, and it must be documented as such.
- **C5 — `partner_reference` is not a duplicate-session guard in production (D9).** Only
  `reseller_unique_id` provides real idempotent-replay protection (field name preserved as-is per
  the naming note; see Section 6 Q4 on whether to rename it). The docs must say this explicitly so
  sales-partners don't build on a wrong assumption from having seen the demo's different internal
  reuse of `partner_reference`.
- **C6 — Passcodes and per-client API keys are both sales-partner-self-service, both scoped to
  exactly one sales-partner↔client pairing.** The sales-partner mints as many of each as they need;
  Clio does not assign or ration them.
- **C7 — Documentation is not optional polish here — it is a stated deliverable (D21).** For every
  ID-shaped field, the sales-partner docs must either give explicit construction guidance or
  explicitly say "use your own pattern," with a worked example either way.

---

## 5. Full Field Reference the BA Must Specify Against

Everything below is already decided (source: D6, D8, D9, D19, D20, D23) — the BA's job is to turn
this into exact request/response schemas, migrations, and documentation copy, not to re-decide it.
Field names below are preserved exactly as specified in the source brainstorm doc; whether any
should be renamed for the sales-partner terminology is Section 6 Q4, not pre-decided here.

**`bot-dispatch` request:** `end_user_name`, sales-partner's passcode (delivery mechanism — header
vs. body — is not yet decided; see Open Questions).
**`bot-dispatch` response:** `session_id` at minimum — full shape is an open question (Section 6).

**`bot-sessions` request fields:**

| Field | Status | Notes |
|---|---|---|
| `session_id` | **New** | Links to the `bot-dispatch` reservation |
| `content_pages` | Existing, unchanged | Content pages to teach; chunking mechanism per C4/D23 |
| `content_source_id` | Existing, unchanged | Which registered content source these URLs belong to |
| `content_to_explain` / `content_title` / `content_subtitle` | Existing, unchanged | Short overview/title/subtitle; 5000-char cap stays (C4) |
| `expected_duration_minutes` | Existing, unchanged | Feeds the wallet/balance check |
| `content_id` | Existing, unchanged | Sales-partner's own topic/content label, not a Clio lookup key |
| `end_user_role` / `end_user_industry` | Existing, unchanged | Personalization inputs — must be checked against B2B-77's PII rule (session-time use only, never persisted) |
| `partner_end_user_ref` | Existing, unchanged | Optional, sales-partner's own person-level correlation ID (D8) — Clio never reads or acts on it |
| `partner_reference` | Existing, unchanged | Optional, free-text session tag (D9) — **not** a duplicate guard (C5) |
| `reseller_unique_id` | Existing, unchanged | The real idempotency key (naming: see Section 6 Q4) |
| `language` | Existing | Still open whether sales-partner-facing at all in production (Section 6) |
| `bot_id` | **Renamed** from `elevenlabs_agent_id` | Three-layer resolution, sales-partner-scoped (C3/D20) |
| `reseller_id` / `client_id` | Existing | Still open whether these stay, shrink to optional, or drop (Section 6); naming: see Q4 |

**`bot-sessions` response (D22, decided):**
```json
{
  "session_id": "<same session_id issued by bot-dispatch>",
  "status": "widget_active",
  "render_url": "https://<sales-partner's own domain>/widget-render/<session_id>"
}
```
`session_id` is not reissued. Error responses mirror `widget-sessions`' existing typed
`{ error: { code, message } }` shape — validation failures, content-source/URL rejection, and the
wallet-gate codes (`card_required`, `trial_exhausted`, `funding_required`, `balance_exhausted`).

**What `bot-sessions` does with content before returning `render_url` (unchanged from
`widget-sessions` today — confirmed, not new work):** structural validation of `content_pages`;
content-source ownership check; per-page SSRF/URL safety check (must be `https`, genuinely public
host); server-side transition-marker generation from title/subtitle/`transition_trigger`; resolving
`expected_duration_minutes`; only then the wallet/balance gate runs.

**`render_url`'s domain is the sales-partner's own custom domain, per B2B-79** — this brief should
specify the field, B2B-79 owns how that domain gets registered/verified. Do not duplicate B2B-79's
domain-infrastructure design here; just take its output (a verified domain per sales-partner) as a
given input to this response.

---

## 6. Questions for the BA to Resolve (Section 11 must be empty on delivery — do not guess any of these)

1. **Exact `bot-dispatch` response shape beyond `session_id`.** Not yet defined by Arun. Propose a
   shape, but flag it as a proposal needing sign-off, not a restatement of an existing decision —
   there isn't one yet.
2. **Expiry/cleanup mechanism for unclaimed `bot-dispatch` reservations.** Arun has confirmed this
   is needed ("yes we need expiry and cleanup for sure") but the mechanism itself is undesigned.
   Specify: expiry duration, what state an expired-but-unclaimed `session_id` ends up in, whether
   `bot-sessions` called with an expired `session_id` gets a distinct error code, and the cleanup
   job itself (likely Inngest, per this codebase's existing pattern — confirm against
   `inngest/` conventions already in use).
3. **Whether `end_user_name` needs to be re-sent to `bot-sessions`, or stays tied to `session_id`
   server-side.** Not yet decided. State the tradeoff (repetition vs. an extra server-side lookup)
   and recommend one, clearly marked as a recommendation for CEO/Arun sign-off.
4. **Field-naming consistency now that "sales-partner" is confirmed as the human-facing term.**
   `reseller_id`, `reseller_unique_id` (and any newly-proposed fields) currently keep the word
   "reseller" at the wire level. Per B2B-26's own established convention (UI copy says
   "sales-partner," code/wire identifiers may keep an internal "reseller"/"channel" token without
   necessarily renaming), recommend whether to: (a) keep these field names as-is since they're
   API-contract-level, not UI copy, and renaming a wire field is real API-versioning churn for no
   functional gain, or (b) rename to `sales_partner_id`/`sales_partner_unique_id` for consistency,
   noting that the original reason to avoid the bare `sales_partner` token (collision with B2B-21's
   old internal role value) goes away once B2B-77's rename to `internal_staff` lands. Give a
   recommendation with reasoning; this is a real, if small, product-facing naming decision and
   should not be silently decided either way.
5. **Whether the `reseller_id`/`client_id` body fields on `bot-sessions` stay, shrink to optional,
   or get dropped**, now that the per-client API key already resolves both identities. This is
   explicitly still open per D19/the brainstorm's own "Still open" list. Give a recommendation with
   reasoning (e.g., precedent: does today's `widget-sessions` do anything useful with a redundant
   cross-check field, or is it dead weight once the key is 1:1 scoped?).
6. **Whether `language` is sales-partner-facing in production at all.** The multi-voice demo work
   (D1–D5, background context in the source doc) proved the mechanism works, but whether real
   sales-partners get to set it via the API — versus it being an internal/admin-only lever — has
   not been decided.
7. **Passcode delivery mechanism on `bot-dispatch`.** Header (`Authorization`-style) vs. body field
   — not specified in the brainstorm. Pick one, consistent with how `bot-sessions`' own API key is
   sent, and justify the choice.
8. **No DB schema exists yet for any of the following — the BA must design all of them from
   scratch, cross-checking against B2B-77's resolved terminology table before finalizing table/
   column names that might collide with existing `partner_accounts`/`channel_partner` structures:**
   - Per-sales-partner-client-scoped passcodes (table, generation, revocation).
   - Per-sales-partner-client-scoped API keys (table, generation, revocation, hashing — reuse
     `hashApiKey()`'s existing pattern, do not invent a new one).
   - The `bot_id`→catalog-agent alias mapping, per sales-partner (D20's layer 3).
   - The agent catalog table itself (D20's layer 2 — Clio's own named agents, organized by
     language).
9. **No design yet for the sales-partner-facing dashboard UI** to manage passcodes, per-client API
   keys, and `bot_id` aliases. This is a real, user-facing screen requiring full wireframe-level
   detail per this project's standing "ambiguous UX = STOP" rule — do not let this ship as an
   afterthought bullet in the API spec. **Coordinate with B2B-79's BA work**: that brief separately
   needs a sales-partner-facing domain-management UI, and both likely belong in the same area of the
   sales-partner's dashboard (a "Developer / Integration Settings" section, or similar) — the BA
   should propose one coherent information architecture across both rather than two independently-
   designed screens that happen to sit next to each other.
10. **Documentation requirements (D21, C7), consolidated action item:** the sales-partner-facing API
    docs page must be written (or its content fully speced for someone else to write) covering, at
    minimum: the passcode/API-key model end to end; `partner_end_user_ref`/`partner_reference`'s
    purpose, optionality, and the explicit non-duplicate-guard callout (D9); the
    `content_to_explain`-vs-`content_pages` chunking pattern (D23); worked examples and ID-format
    guidance for every ID-shaped field (D21); and the content-format requirement so a sales-partner
    knows exactly what shape to send their content in (D6's original action item).

---

## 7. Explicitly Out of Scope

- Any sales-partner-to-client sub-billing (per B2B-77 C3 — do not reintroduce it here).
- Any pre-registered/cached content model — content stays inline, sent by the sales-partner on
  every call (D6, confirmed, not reopened).
- Agent-pool or server-side audio relay revival — out of scope per this codebase's existing removed-
  vendor history; not reintroduced by this brief.
- Tooling to help sales-partners auto-format their own content into the expected shape — explicitly
  logged as a low-priority backlog item (D6), not this brief's scope.
- Domain/DNS/iframe delivery mechanics — owned entirely by B2B-79.

---

## 8. Sequencing Note for the Orchestrator

Depends on B2B-77's Section 7 answers (particularly the `internal_staff` migration) before schema
work can be finalized (Section 6, item 8 above). Feeds B2B-79 one field (`render_url`'s
sales-partner-domain dependency) but does not depend on B2B-79 to be spec'd — the two can proceed in
parallel once B2B-77 lands.
