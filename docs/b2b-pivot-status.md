# B2B Pivot — Orchestration Plan & Live Status

_Last updated: 2026-07-13 | Source of truth for B2B pivot execution status and approach_

**Related docs:**
- `docs/brainstorm-b2b-platform-pivot.md` — full requirements, Q&A, objective-impact analysis, decisions
- `docs/brainstorm-ai-template-designer.md` — merged in as the spec basis for the Designer (B2B-03 below)
- `CORE_OBJECTIVES.md` — **deleted 2026-07-13** (stale B2C content); superseded by B2B-01 once that Feature Brief lands, until then see `docs/brainstorm-b2b-platform-pivot.md` §3 for the current objective-impact analysis

This file has two parts that update at different rates: the **Orchestration Approach** (stable —
only edit if the approach itself changes) and **Live Status** (update the instant any item changes
state, per Arun's standing instruction — do not batch).

---

## How to read this

- **Status vocabulary** (matches `BACKLOG.md` convention): `Not started` | `In progress` |
  `CEO brief done` | `BA spec needed` | `Approved, build ready` | `Blocked` | `Done`
- **IDs**: `B2B-01`..`B2B-05` for the five Feature Briefs, `INFRA-*` for the Mia Digital LLC
  migration track. Referenced in commits/PRs the same way `TMPL-XX`/`RTV-XX`/`SESS-XX` are elsewhere
  in this repo.

---

## Orchestration Approach

**Governance:** No code for user-facing features without an approved spec. Chain is
Arun → CEO Agent (Feature Brief) → BA Agent (12-section Requirement Document, Section 11 Open
Questions must be empty) → CEO approval → build. This applies per-brief, not once for the whole
pivot — the pivot is split into 5 sequenced Feature Briefs (below) rather than one giant brief,
so each stays independently reviewable.

**CEO Agent usage — known caveat:** the CEO Agent has previously only acted substantively on Arun's
own direct messages, not on instructions the Orchestrator relays on his behalf. Each brief dispatch
below will be checked for genuine engagement; a thin/rubber-stamped response gets flagged to Arun
immediately rather than treated as "handled."

**Sequencing (dependency graph):**
```
B2B-01 Core Objectives rewrite
   └─▶ B2B-02 Partner API & multi-tenant architecture
          ├─▶ B2B-03 Designer/Configurator
          ├─▶ B2B-04 Billing/metering  (also needs Foundation item F-02 resolved)
          └─▶ B2B-05 Domain/white-label infra

INFRA-* (Mia Digital LLC migration) — parallel, non-blocking, land before production cutover
```

**Due diligence / anti-staleness mechanisms:**
1. Session-level tasks (`TaskCreate`/`TaskUpdate`) mirror the table below in real time during active
   work — this file is the durable, cross-session record; session tasks are the in-the-moment view.
2. This file is updated the instant any item's status changes — not batched to end of session.
3. Checkpoint reported to Arun after each Feature Brief lands, not silently chained through all five.
4. Foundation open questions (F-01, F-02) are hard blockers on the BA gate by design — a spec cannot
   proceed with open questions, so these cannot silently rot.

---

## Live Status

### Foundation (blocking items — must close before dependent briefs proceed)

| ID | Item | Status | Blocks | Detail |
|----|------|--------|--------|--------|
| F-01 | Ledger storage model confirmation | In progress | B2B-04 (indirectly, via B2B-02) | Opaque-reference usage ledger on Clio's side vs. true zero-storage with live round-trips to partner API. See brainstorm doc §7.3, §8. |
| F-02 | Real COGS numbers (voice-minute cost, per-LLM-call cost) | Partially resolved, **now partly stale** | B2B-04 | Historical B2C-era per-minute COGS recovered from deleted `DECISIONS.md` (dated 2026-05-18, needs revalidation regardless of vendor swap — 2 months old): Recall.ai $0.0108/min, ~~ElevenLabs Conversational AI $0.08/min~~ (**dead — ElevenLabs removed 2026-07-13, see V-01 below, need a fresh Hume EVI per-minute rate**), Claude Sonnet ~$0.0002/min (amortized via caching), infra (Supabase/Vercel/Resend) ~$0.004/min. Old total (~$0.095/min) is no longer valid until Hume's rate replaces ElevenLabs's in the blend, and Recall.ai's rate is itself pending on V-02 (Attendee evaluation). Still missing: per-LLM-call cost for a single topic/content/prerequisite generation event. Also recovered a reusable pattern: the old `topic_content_cache` cached generated sections per topic with type-based TTLs (14d/21d/30d/60d depending on content type) — directly applicable to the pivot's "generate once per partner+topic, reuse across sessions" design (brainstorm doc §7 Q3). |

### Vendor Decisions (voice/meeting-bot stack)

| ID | Item | Status | Notes |
|----|------|--------|-------|
| V-01 | ElevenLabs → Hume EVI (voice provider) | **Done** (code removal complete, not yet committed) | Direct, unconditional owner instruction 2026-07-13 — not a toggle, full code removal. Hume is now the sole voice provider, no branching logic anywhere. 7 files deleted (`lib/voice/elevenlabs-adapter.ts`, `lib/elevenlabs-pool.ts`, `lib/voice/relay-handler.ts`, `server.ts`, `tsconfig.server.json`, `lib/tts.ts`, `app/api/tts/route.ts`), 36 modified, `@11labs/client`/`elevenlabs`/`ws`/`@types/ws` deps removed. `tsc --noEmit` clean, `npm run build` clean, 266/267 tests pass (1 pre-existing unrelated failure, confirmed via revert-and-retest). **Relay-mode removal confirmed safe** — Arun confirmed `MEETING_BOT_AUDIO_MODE` is not set in Vercel, so deleting the ElevenLabs-only server-side relay path (`server.ts` etc., no Hume equivalent ever existed) has no production impact. **Two follow-ups still open, not blocking**: (1) `.env.local.example` needs a manual pass by Arun to remove `ELEVENLABS_*` entries — both the agent and Orchestrator hit a permission block trying to edit it; keep `ELEVENLABS_CUSTOM_LLM_SECRET` despite the name, it's actually a generic admin secret, renaming risks breaking prod auth. (2) A **pre-existing latent bug** was surfaced (not caused by this change, deliberately not fixed to avoid altering live session timing as a side effect): the transcript-tracking ref used for silence-detection was only ever updated in the now-deleted ElevenLabs branch, meaning the silence clock may never have gone stale for Hume sessions — worth a separate investigation into whether auto-end-call/silence-detection has been firing correctly in practice. Nothing committed — sitting in the working tree pending Arun's review. |
| V-02 | Recall.ai → Attendee (meeting-bot provider) | **Under evaluation, not decided** | Owner is considering swapping the Google-Meet-bot-join vendor from Recall.ai to Attendee (open-source, self-hostable). Orchestrator's open questions (asked, awaiting answers): (1) hosting model — self-host Attendee (new infra/maintenance burden) or a managed option if one exists; (2) does Attendee support real-time bidirectional audio streaming (not just async recording/transcription) — this is the one non-negotiable capability, since Hume's live conversational voice needs to speak and listen during the call, same as Recall.ai's real-time media websocket API provides today; (3) meeting-platform breadth (Zoom/Meet/Teams) relevant given partner platforms may vary; (4) cost model shift from per-minute vendor fee to infra-hosting-plus-maintenance if self-hosted — directly affects F-02's Recall.ai $0.0108/min line; (5) how much existing code assumes Recall.ai's specific bot-lifecycle/webhook/transcript shape and would need an abstraction layer; (6) maturity/reliability tradeoff given Capgemini/Pluralsight-scale partners will have their own reliability expectations. **Do not remove or modify Recall.ai code until this is explicitly decided** — unlike V-01, this is not yet authorized. |

### Feature Briefs (CEO → BA → Build pipeline)

| ID | Feature Brief | Status | Blocked By | Notes |
|----|----------------|--------|-------------|-------|
| B2B-01 | Core Objectives rewrite (supersedes `CORE_OBJECTIVES.md`) | Not started | — | Must state B2C-killed as a hard premise. Full impact analysis already done in brainstorm doc §3. |
| B2B-02 | Partner API & multi-tenant architecture | Not started | B2B-01 | Partner-level API keys, content/profile push-pull contract, usage ledger + signed webhooks, sub-tenant hierarchy (Capgemini → Hartford). |
| B2B-03 | Designer/Configurator | Not started | B2B-02 | Merges `docs/brainstorm-ai-template-designer.md`'s 26 requirements with the Type 2 partner Designer (Questionnaire/Topics/Content toggles, 3-level app/template/component visualization config). |
| B2B-04 | Billing/metering | Not started | B2B-02, F-02 | Unified credit wallet (Option B — decided), metered burn rates, enterprise tiers (self-serve/mid-market/enterprise), admin page. |
| B2B-05 | Domain/white-label infra | Not started | B2B-02 | Subdomain-first + custom-domain upgrade via Vercel Domains API, Host-header tenant resolution middleware, onboarding wizard. |

### Infra Migration to Mia Digital LLC (parallel track)

| ID | Item | Status | Notes |
|----|------|--------|-------|
| INFRA-01 | GitHub repo transfer | Not started | Built-in transfer preserves history/issues. |
| INFRA-02 | Vercel team + project | Not started | Depends on INFRA-01 (import repo into new team). |
| INFRA-03 | Clerk application | Not started | Scoped to partner-admin auth only, no consumer sign-up. |
| INFRA-04 | Supabase project | Not started | Fresh migrations, no data carryover (B2C retiring). |
| INFRA-05 | Stripe business account | Not started | Business verification (EIN, bank account) — slowest step, plan for 1-3 business days. |
| INFRA-06 | Cloudflare account-to-account transfer (`hello-clio.com`) | Not started | Domain confirmed registered via Cloudflare; account-to-account transfer, not a registrar transfer. Arun confirmed OK to proceed (member-add rejected as insufficient — full transfer needed). |
| INFRA-07 | Brand/domain final decision | In progress | Leaning `hello-clio` — domain already owned, brand-fit concern resolved (not customer-facing), trademark risk assessed as moderate not blocking (Themis Solutions' CLIO mark is narrowly scoped to legal practice management; crowded field of other coexisting CLIO marks). Recommended: confirm with a trademark attorney in parallel with LLC formation, not a hard gate. |

---

## Changelog

- **2026-07-13**: File created. Orchestration approach captured. B2B-01..05 and INFRA-01..07 scaffolded from `docs/brainstorm-b2b-platform-pivot.md`. F-01/F-02 marked in progress (session tasks #1 opened to resolve). Archive branch `archive/b2c-legacy` created and pushed to `origin` prior to this work starting.
- **2026-07-13 (later same day)**: Removed 10 stale B2C-era root docs (`TASKS.md`, `brief.md`, `CORE_OBJECTIVES.md`, `CLAUDE_CODE_BUILD_PROMPT.md`, `test-report.md`, `STORIES.md`, `PROJECT.md`, `architecture.md`, `research-findings.md`, `DECISIONS.md`), extracting COGS data from `DECISIONS.md` into F-02 first. Rewrote project `CLAUDE.md` to drop the old B2C agent roster/design system. Updated stale memory pointers. Added V-01 (ElevenLabs → Hume, decided, removal dispatched to background agent) and V-02 (Recall.ai → Attendee, under evaluation, not decided — do not touch Recall code).
- **2026-07-13 (later still)**: V-01 marked **Done** — ElevenLabs removal complete (7 files deleted, 36 modified, clean build/typecheck, tests passing), relay-mode deletion confirmed safe by Arun (`MEETING_BOT_AUDIO_MODE` not set in Vercel). Two non-blocking follow-ups open: manual `.env.local.example` cleanup (permission-blocked for both agent and Orchestrator), and a pre-existing latent silence-detection bug surfaced but deliberately not fixed as part of this task. V-02 (Attendee) researched: real-time bidirectional audio confirmed supported (the one non-negotiable capability), hosted/cloud option confirmed in use (no self-hosting), pricing ($0.50/hr, volume discount to $0.35/hr) looks cheaper than Recall.ai's old $0.0108/min rate, platform coverage (Zoom/Meet/Teams) matches. Still open: code-coupling audit (how tightly existing code depends on Recall.ai's specific API shape) before V-02 can move from "under evaluation" to "decided."
