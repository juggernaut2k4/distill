# Feature Brief: B2B-61 — OpenAI Realtime voice adapter (alternate provider) + admin toggle

From: CEO (Arun)
To: Business Analyst Agent (Part B only) / Developer Agent (Part A — direct build, see Governance Call)
Priority: P1
Date: 2026-07-31

**Numbering note:** highest ID in `docs/b2b-pivot-status.md` and `.claude/agents/clio/feature-briefs/`
is B2B-60 (2026-07-30). This brief is **B2B-61**.

---

## What Arun Said (verbatim)

> "build this toggle in admin dashboard so i can toggle and save the change. proceed building with
> ceo agent."

Context this instruction sits inside (same night, same conversation): Hume's live voice connection
failed three times in a row on a real call; root cause confirmed via Hume's own dashboard as TTS
quota exhaustion, not a code bug. During the investigation Arun asked about alternate voice providers.
A feasibility pass researched OpenAI's Realtime API (`gpt-realtime-2.1`) as a second/alternate
provider alongside Hume (not a replacement). Arun reviewed that research and approved two coupled
pieces: (1) build the OpenAI Realtime adapter, (2) build a persisted, UI-based admin toggle to switch
between providers — explicitly not just an env var.

## Independent verification of the feasibility claims (done directly against live code, not taken on faith)

I read `lib/voice/adapter.ts`, `lib/voice/hume-adapter.ts`, `lib/voice/deepgram-adapter.ts`,
`lib/voice/index.ts`, `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`,
`app/api/hume-token/route.ts`, and `lib/voice/hume-native/prompt-template.ts` +
`lib/voice/hume-native/config-provisioner.ts`. Findings:

1. **`VoiceSessionAdapter` is a real, already-shipped interface** (`lib/voice/adapter.ts`) — 10 methods
   (`injectContext`, `endSession`, `setVolume`, `setMicMuted`, `getInputVolume`, `getOutputVolume`,
   `sendFeedback`, `getId`, `isOpen`, `onSpeakVerified`). `HumeAdapter` is the real, production
   implementation. `DeepgramAdapter` (`lib/voice/deepgram-adapter.ts`) is a genuine but inert stub —
   every method just `console.log`s and returns a placeholder, confirming the interface has a real
   second-implementation precedent to build against, not just a paper contract. **Confirmed.**
2. **The tool-call handler pattern is provider-agnostic today.** `PartnerRenderClient.tsx` builds
   `tools` as a plain object literal keyed by tool name (`show_visual`, `advance_tab`, `end_session`,
   lines ~214–246), passed into `HumeAdapter.create()`'s config. Nothing about that map is
   Hume-specific — it is reusable by a new adapter with zero changes. **Confirmed.**
3. **`/api/hume-token/route.ts` is a clean structural twin to build a new token route against** —
   OAuth2 client-credentials exchange, `NO_CACHE` headers, typed error responses, no session/business
   logic in the route itself. **Confirmed real, confirmed simple enough to mirror.**
4. **The three tool JSON Schemas genuinely do not exist locally today.** I read
   `lib/voice/hume-native/config-provisioner.ts` directly: Hume's config only ever references these
   tools by opaque Hume-hosted `{id, version}` pairs (`advance_tab` → `4f15c0c2-...`, `show_visual` →
   `65a3d139-...`, `end_session` → `6fc0bfde-...`, lines ~294–298) — the actual parameter schemas live
   entirely on Hume's own dashboard, never in this repo. **Confirmed** — this is real new code, not a
   port: OpenAI Realtime's `tools` array needs each tool's full JSON Schema defined locally for the
   first time.
5. **The audio pipeline is the real novel work, not an adaptation.** `HumeAdapter` consumes
   self-contained decodable audio chunks over its WebSocket (`openConnection()`/`startMicCapture()` in
   `hume-adapter.ts`) — no manual PCM buffer assembly. OpenAI Realtime streams raw PCM16 @ 24kHz,
   which needs manual capture (mic → PCM16 encode → base64 chunks out) and playback (base64 chunks in
   → buffered PCM16 → `AudioContext` scheduling) built from scratch. **Confirmed highest-risk, most
   novel piece**, and the research being "thin on exact codec details" is a real gap, not a documented
   spec I can rubber-stamp — see the spike requirement below.
6. **This can be built as a fully isolated, parallel path.** `HumeAdapter` is constructed directly in
   `PartnerRenderClient.tsx` (not through `lib/voice/index.ts`'s factory — that factory only handles
   the `'deepgram'` case and is explicitly unused today per its own comment). A new adapter and a
   provider-selection branch at the `HumeAdapter.create(...)` call site touches nothing inside
   `HumeAdapter` itself. **Confirmed — no risk to the working Hume path from this build.**

Verdict: the research holds up under direct re-verification. Nothing here was rubber-stamped.

## The Problem Being Solved

Hume is currently the sole live voice provider (per this file's own retired-vendor list, ElevenLabs
was fully removed 2026-07-13 in favor of Hume). Tonight's incident showed a single-provider
architecture has no fallback when the vendor's own account/quota fails mid-operation, and today
swapping providers would require a code deploy (there was a prior env-var toggle,
`NEXT_PUBLIC_VOICE_PROVIDER`, but it no longer appears live in current code — ElevenLabs' removal
retired it; confirmed by grep, only stale references remain in old worktrees/tests). Arun wants (a) a
real second provider so a Hume-side outage is survivable, and (b) the ability to switch providers
himself, immediately, without a redeploy.

## What Success Looks Like

- A partner session can run its full live-voice experience (tool-calling for page navigation,
  bidirectional audio, interruption/barge-in, session end) on OpenAI Realtime with zero change to
  `PartnerRenderClient.tsx`'s content-rendering, page-advance, or error-boundary logic — only the
  adapter underneath changes.
- Arun opens `/dashboard/admin`, sees the current active voice provider, flips a toggle, saves, and
  the **next** session started after that save uses the new provider — no deploy, no env var edit.
- Hume remains the default and the safe fallback; nothing about today's working Hume path is touched
  or put at risk.

## Known Constraints (from Arun / from standing project rules)

- Hume stays primary/default — this is an alternate provider, not a replacement (explicit from Arun).
- The toggle must **persist** a saved choice, not just flip client-side state (explicit from Arun:
  "toggle and save the change").
- `hume` (current) remains the sole approved voice SDK per `CLAUDE.md`'s approved-library list — this
  brief requires adding the official OpenAI SDK path for Realtime to that list (technical/vendor
  addition, documented here, not requiring a separate BA gate per `CLAUDE.md`'s existing pattern of
  vendor approvals being logged as pivot items land).
- No B2C resurrection, no unrelated scope creep into other admin pages.

---

## Governance Call — why this brief splits into two build tracks

Per `CLAUDE.md`'s division of labor: **technical decisions** (library choice, config, schema, error
handling) carry full CEO/Orchestrator autonomy; **product-shape decisions** (new screens, what an
admin sees, what persists where) require the BA gate. This feature has both, cleanly separable:

### Part A — OpenAI Realtime adapter: technical, approved for DIRECT BUILD, no BA gate

Nothing about the adapter itself is a product/UX decision. It implements an existing interface
(`VoiceSessionAdapter`) against an existing, unchanged consumption pattern (the name-keyed tools map),
producing **zero visible change** to any screen — the partner-facing render UI, its status states
(`connecting`/`listening`/`speaking`/`error`/`ended`), and its content are all already provider-agnostic
and stay byte-for-byte the same. This is squarely "technical decision: full autonomy" per `CLAUDE.md`,
consistent with how B2B-60 was routed as a direct-build brief.

**Cleared to build directly**, in this order (spike gates the rest — see below):

1. **Spike first, mandatory gate before any pipeline rewrite work starts.** Mint a real OpenAI Realtime
   token, open the WebSocket, and confirm — logged, not assumed — the actual audio frame format,
   sample rate, chunking behavior, and event-message shapes actually received. The research was
   explicitly thin here; this is the correct, cheap way to de-risk the highest-novelty part of the
   build before committing to the full capture/playback implementation. Do not skip this step or
   treat OpenAI's documented format as ground truth without confirming it against a live socket.
2. `app/api/openai-realtime-token/route.ts` — structural twin of `app/api/hume-token/route.ts`
   (server-minted, short-lived auth; typed error responses; `NO_CACHE`; secrets from `process.env`
   only — `OPENAI_REALTIME_API_KEY` or equivalent, added to `.env.local.example` as
   `PLACEHOLDER_OPENAI_REALTIME_API_KEY`, never a currently-approved Anthropic key reused for this).
3. Local JSON Schema tool definitions for `show_visual`, `advance_tab`, `end_session` — these must be
   written from scratch (confirmed above they exist nowhere in this repo), matching the same
   parameter/behavior contract Hume's hosted tool definitions already enforce today (cross-check
   against `lib/voice/hume-native/prompt-template.ts`'s BEHAVIORAL RULES for exact call-timing
   semantics — e.g. `advance_tab` is the only tool that advances a page, `end_session` is the only way
   a call ends — the new adapter's tool-calling must preserve these semantics exactly, not
   reinterpret them).
4. `lib/voice/openai-realtime-adapter.ts` implementing `VoiceSessionAdapter` in full — the audio
   pipeline (manual PCM16 capture/encode outbound, manual PCM16 buffer/schedule playback inbound) is
   the substantial new code confirmed above; everything else (mute, volume, feedback, session id,
   `onSpeakVerified` semantics matching Hume's own "real, verified, speaking-capable connection" bar)
   must satisfy the same interface contract Hume's adapter already does, including the
   billing-critical `onSpeakVerified` never firing on a merely-attempted connection.
5. Wire the provider branch at the `HumeAdapter.create(...)` call site in `PartnerRenderClient.tsx` —
   this is the one line of change to that file: construct whichever adapter the session's resolved
   `provider` says to use (see Part B's data-flow decision below), assign to the same `adapterRef`,
   everything downstream (tool map, status states, error boundary) is unchanged.
6. Add `@anthropic-ai`-style vendor approval to `CLAUDE.md`'s approved-library list for the official
   OpenAI SDK path used for Realtime (confirm exact package/import path during build — do not assume
   the general `openai` npm package's shape without checking its Realtime-specific API surface first;
   log the exact package name here once confirmed, mirroring how `hume`'s exact package name was
   flagged for confirmation in the existing approved list).
7. Update `docs/b2b-pivot-status.md` Live Status the instant this lands, same as every other item.

Real-work estimate (unchanged from the research, independently re-derived as still reasonable given
what's now confirmed): 4–6 focused days including live-call test rounds — this codebase's own history
(LIVE-01, B2B-48, B2B-52) shows voice features reliably need multiple live-call iteration passes.

### Part B — Admin toggle UI: product-shape, routed to BA (lightweight, tightly-scoped spec)

This is a new admin-facing control — what an admin sees, where it lives, what it persists to. Per
`CLAUDE.md`'s gate, this needs a BA Requirement Document before any UI file is touched, even though
it is small. I am pre-resolving the open questions below myself (sound technical/product judgment,
consistent with tonight's pattern of resolving what I can and flagging only genuine ambiguity) so the
BA's spec can be tight and fast rather than open-ended — **the BA should still write the full
document (wireframe/example, states, acceptance tests, edge cases) confirming and detailing these,
not skip the gate because the answers are given here.**

**My resolved answers, for the BA to build the spec around:**

1. **Scope: global, not per-partner.** Every existing config table in this codebase
   (`partner_theme_config`, `partner_prompt_config`, outbound-config, etc.) is
   `partner_account_id`-scoped — there is no precedent global setting today. Arun's own phrasing ("so
   I can toggle") reads as a single system-wide admin control, not per-reseller, and a global toggle
   is the correct read: partner sessions today have no per-partner voice-provider concept anywhere in
   the schema or the render path, and introducing one would be new, unrequested scope. This is the
   first global (non-partner-scoped) setting in the codebase — worth the BA/spec explicitly noting as
   a precedent-setting pattern, not a defect.
2. **Where it lives:** `/dashboard/admin` (the super-admin home page,
   `app/(with-clerk)/dashboard/admin/page.tsx`), as a new card composed the same way
   `DemoAccessCard` already is on that exact page — "admin's own settings," same
   `bg-[#111111] border border-[#222222] rounded-xl` convention, same `requireSuperAdmin()` gate, same
   fetch-on-mount-then-PATCH client component shape as `DemoAccessCard.tsx` uses against
   `/api/admin/demo-access`. Not a new dedicated settings page — this one control does not warrant one,
   and the direct precedent (`DemoAccessCard`'s own relocation history per its own file comment: moved
   to the admin home page specifically because "this card is the admin's own settings") applies
   exactly.
3. **Where it persists:** new table, matching this codebase's own established shape for singleton/
   config tables (`updated_at` trigger, RLS service-role-only) but *without* partner scoping since this
   is global — e.g. `system_voice_config` with a single row, `active_provider TEXT NOT NULL DEFAULT
   'hume' CHECK (active_provider IN ('hume', 'openai_realtime'))`. BA should confirm this exact
   shape/name in the spec, not treat it as locked, but the pattern (new dedicated table, not a
   miscellaneous key-value blob) should hold — it matches every other config table in this codebase's
   migration history and keeps the CHECK constraint doing real validation.
4. **How the session read happens:** **not** a new client-side API call. `PartnerRenderClient.tsx`
   already receives `humeConfigId` as a prop from its parent server component at render time — the
   provider selection should be read server-side the same way, in whatever server component currently
   resolves and passes that prop, and passed down as a new `provider` prop. This matches the existing
   pattern exactly and avoids adding a new fetch/round-trip to session start. BA spec should confirm
   the exact parent file/line this wires into (I have not traced that specific call site tonight — BA
   should verify before writing the final data-flow section, not assume from this brief alone).

**Open items genuinely left for the BA to fully specify (not resolved here):**

- Exact card copy/states (loading, error, success-saved confirmation) — should mirror
  `DemoAccessCard`'s existing state-handling shape (`loadError`, optimistic vs. confirmed save, etc.)
  but needs its own acceptance criteria written out, not inherited by reference alone.
- Whether flipping the toggle needs any confirmation step (e.g. `DemoAccessCard`'s
  `window.confirm(...)` pattern before regenerating a passcode) given this affects live production
  voice sessions — I lean toward "yes, a lightweight confirm," but this is a real UX call the BA
  should make explicit with reasoning, not silently inherit.
- Whether the card should show anything about session-in-progress impact (e.g. "already-connected
  sessions are unaffected, only new sessions after save use the new provider") — likely yes, given the
  billing/session-integrity sensitivity of voice provider swaps, but needs to be a documented,
  intentional line in the spec, not assumed silently.

### What is NOT part of this brief

- No changes to Hume's own code path, config, or prompt template beyond the one provider-branch line
  in `PartnerRenderClient.tsx`.
- No per-partner provider selection (see resolved answer #1).
- No automatic failover (Hume fails → auto-switch to OpenAI mid-call) — this is a manual admin toggle
  only, per Arun's explicit ask. If Arun wants automatic failover later, that is new scope requiring
  its own brief.

---

## Dispatch

- **Part A (adapter):** cleared for direct build by a Developer/Engineer agent, spike-first as
  specified above. No further BA/CEO gate needed before code starts, consistent with `CLAUDE.md`'s
  technical-decision autonomy and the B2B-60 precedent for direct-build briefs.
- **Part B (admin toggle UI):** routed to a Business Analyst agent now for a full Requirement Document
  scoped tightly to this brief's resolved answers above. No UI code is written until that spec is
  written and I've approved it (Section 11 empty), per the standing gate.
