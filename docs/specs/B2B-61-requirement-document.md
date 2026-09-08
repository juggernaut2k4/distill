# Voice Provider Admin Toggle (Part B — Persisted Admin UI Only) — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-31

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code, every load-bearing claim in
`.claude/agents/clio/feature-briefs/B2B-61-openai-realtime-voice-adapter-and-admin-toggle.md`
that this Part B document depends on was re-checked directly against source, not taken on faith:

- **Global scope, confirmed by direct grep of `supabase/migrations/`.** Every existing config-style
  table in this codebase — `partner_theme_config`, `partner_prompt_config`
  (`supabase/migrations/080_b2b11_prompt_behavior_and_join_greeting.sql`), outbound-config, etc. — is
  `partner_account_id`-scoped with a `UNIQUE` constraint on that column. No global (non-partner-scoped)
  config table exists anywhere in `supabase/migrations/`. `system_voice_config` as proposed genuinely
  is the first of its kind. Confirmed, not assumed.
- **`DemoAccessCard.tsx` as structural precedent, confirmed by direct read**
  (`app/(with-clerk)/dashboard/admin/DemoAccessCard.tsx`): fetch-on-mount `'use client'` component
  (`useEffect` → `loadData()`, lines 62–76), `loadError` boolean state distinct from `data === null`
  loading state (line 179), a `window.confirm(...)`-gated destructive action before a POST that mutates
  a persisted setting (`handleGenerateOrRegenerateClick`, lines 111–119), a disabled-during-mutation
  button with a `"…ing…"` label swap (lines 187–193, 218–223), and a radio-tile selector row
  (`TOPUP_TIERS.map`, lines 280–295) using `border-[#7C3AED] bg-[#7C3AED]/10` for the selected tile and
  a plain `border-[#222222]` otherwise — this exact radio-tile markup is the direct precedent this
  document reuses for the two-provider selector below (§4, §5), closer even than the general
  card-shell precedent. Confirmed.
- **`app/api/admin/demo-access/route.ts` (GET) and `app/api/admin/configurator/theme/route.ts`
  (GET+PATCH), confirmed by direct read.** The theme route is the closer precedent for this feature
  specifically: single file, `requireSuperAdmin()`-equivalent auth gate pattern (theme route uses
  partner-scoped auth; this document uses `requireSuperAdmin()` directly, confirmed present and
  exported from `lib/internal-admin/auth.ts` lines 137–150), Zod `PatchSchema` validation
  (`z.object({...})`, `theme/route.ts` lines 22–31), `NextResponse.json({ error, details },{status:400})`
  on validation failure. This document's new route mirrors that GET+PATCH-in-one-file shape rather than
  `demo-access`'s split GET/`regenerate`-POST-in-a-subfolder shape, because this feature is a plain
  single-resource read/write, not a reveal-once-secret — confirmed as the better-fitting precedent.
- **The exact parent server component that resolves and passes `humeConfigId`, traced directly (the
  CEO brief explicitly left this untraced).** `app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx`
  is the parent. It calls `getPartnerSession(ref)`, then `getThemeConfig(session.partnerAccountId)`
  (line 71) and `resolveLiveSessionRender(session)` (line 72, from `lib/partner/live-render.ts`) as two
  independent, parallel-composable calls — `getThemeConfig` is not nested inside
  `resolveLiveSessionRender`. `resolveLiveSessionRender`'s return type `LiveRenderResult`
  (`lib/partner/live-render.ts` lines 289–306) already carries `humeConfigId: string | null` inside both
  its `'template'` and `'inline'` branches. `page.tsx` then passes `humeConfigId={result.humeConfigId}`
  into `<PartnerRenderClient>` at two separate call sites — inline mode (lines 81–87) and template mode
  (lines 90–96). Confirmed: this is a plain prop drilled from `page.tsx`, not from inside
  `resolveLiveSessionRender` itself.
- **Package precedent check:** `package.json` currently has no `hume`-named dependency at all (only
  `@anthropic-ai/sdk`) — the exact Hume package name is itself still an open confirm-at-build-time item
  per `CLAUDE.md`'s own approved-library note. This document does not depend on that resolution; noted
  only so the developer isn't surprised `hume` isn't literally in `package.json` yet.

Nothing in the CEO brief's Part B resolved answers was found to be inaccurate. The verification above
changes one thing from the brief's phrasing: the brief says "read server-side in whatever parent server
component currently resolves and passes `humeConfigId`" — confirmed that component is `page.tsx`
itself, and the read should be composed there the same way `getThemeConfig` already is (a sibling call,
not a change to `resolveLiveSessionRender`'s own signature/type union, which is unnecessary and would
touch more surface for no benefit).

---

## 1. Purpose

Tonight's incident (Hume TTS quota exhaustion, confirmed via Hume's own dashboard, not a code bug)
showed that Clio's live-voice architecture has exactly one provider and no way to change that except a
code deploy — the prior `NEXT_PUBLIC_VOICE_PROVIDER` env var was retired along with ElevenLabs on
2026-07-13 and no longer exists in current code. This feature exists so Arun, as super-admin, can
switch which voice provider new live sessions use — immediately, from the admin UI, without a redeploy
— the moment a provider-side outage or degradation is discovered.

This document specifies only the admin-facing toggle and its persistence (Part B of B2B-61). It does
not specify the OpenAI Realtime adapter itself (Part A, cleared for direct build per the CEO brief's
Governance Call, out of scope here).

What failure looks like without this: exactly what happened tonight — a provider-side outage degrades
or breaks every live session platform-wide, with no operator-level recourse except an engineer cutting
a code change and redeploying, which is slow and puts the fix behind CLAUDE.md's own deploy-approval
gate at the worst possible time (mid-incident).

## 2. User Story

As the super-admin (Arun),
I want to see which live voice provider is currently active platform-wide, change it, and save that
change,
So that I can react to a provider-side outage or degradation myself, immediately, without needing an
engineer to redeploy.

(Single user type — `internal_staff`-role admins are explicitly denied, see §3 and §8. No other user
type has any interaction with this feature.)

## 3. Trigger / Entry Point

- **Route:** `/dashboard/admin` (existing super-admin home page,
  `app/(with-clerk)/dashboard/admin/page.tsx`). No new route is created.
- **Trigger:** the card mounts and fetches its state (`GET /api/admin/voice-config`) automatically when
  `/dashboard/admin` loads — identical fetch-on-mount pattern to `DemoAccessCard`. A save is triggered
  only by an explicit click on the card's "Save changes" button, gated by a `window.confirm(...)` step
  (§4, §7).
- **Required state:** `/dashboard/admin`'s own server component (`page.tsx`) already calls
  `requireSuperAdmin()` server-side before rendering anything on the page (existing behavior, unchanged
  by this document) — a `role: 'internal_staff'` or unauthenticated caller never reaches a page where
  this card could render. The new API route (§6) independently re-enforces
  `requireSuperAdmin()` itself, exactly like every other route under `app/api/admin/`, so it is not
  reachable by direct API call from a non-super-admin session either.

## 4. Screen / Flow Description

The card is titled **"Live voice provider"**, placed on `/dashboard/admin` directly below
`DemoAccessCard` (same page, new card, own `bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6`
container — copy of `DemoAccessCard`'s own outer wrapper convention, not a new visual style).

**State 1 — Initial load.** On mount, before the `GET /api/admin/voice-config` response returns:
- Heading: `"Live voice provider"` — white, `text-base font-semibold`.
- Subheading, directly under the heading: `"Controls which voice AI powers new live sessions across
  all partners."` — `text-[#475569] text-xs` (same treatment as `DemoAccessCard`'s own parenthetical
  subheading line).
- Body: `"Checking…"` — `text-[#94A3B8] text-sm` (identical string and styling to `DemoAccessCard`'s
  own loading state, line 179).
- No buttons, no options are rendered yet.

**State 2 — Load error.** If the GET request fails or returns non-200:
- Heading and subheading unchanged from State 1.
- Body replaces `"Checking…"` with: `"Couldn't load voice provider settings. Try refreshing the page."`
  — `text-[#EF4444] text-sm` (same styling and phrasing convention as `DemoAccessCard`'s own load-error
  line 177: `"Couldn't load demo access. Try refreshing the page."`).
- No retry button is offered (matches `DemoAccessCard`'s own load-error state exactly — refresh is the
  only recovery path, consistent with this codebase's existing convention for this failure mode).
- No options are rendered as interactive.

**State 3 — Loaded, no pending change.** Once the GET response resolves successfully:
- Heading and subheading as above.
- Two selectable option tiles, laid out `flex flex-col gap-2` on narrow viewports and `sm:flex-row
  sm:gap-3` at `sm:` and above (each tile `sm:flex-1` so they split width evenly side-by-side once
  stacked layout is no longer needed) — see §9 for the responsive reasoning in full:
  - **Tile 1 — "Hume EVI (default)"**. If `active_provider === 'hume'`: tile styled
    `border-[#7C3AED] bg-[#7C3AED]/10` (selected/active — exact reuse of `DemoAccessCard`'s own
    `TOPUP_TIERS` selected-tile styling, lines 284–286) with a small `"ACTIVE"` badge (`text-[10px]
    uppercase tracking-wide text-[#7C3AED]`) in the tile's corner. If not currently active but
    selectable: plain `border-[#222222]` tile, clickable.
  - **Tile 2 — "OpenAI Realtime"**. Two sub-states depending on the build-time
    `OPENAI_REALTIME_ADAPTER_AVAILABLE` flag (§6, §11 decision):
    - If `false` (Part A not yet shipped — the default, and the state at the time this document is
      written): tile rendered with `opacity-40 cursor-not-allowed pointer-events-none` (same disabled
      visual language as this codebase's existing `disabled:opacity-40 disabled:cursor-not-allowed`
      button convention), a small caption under the label reading `"Coming soon — adapter in
      development."` (`text-[#475569] text-[11px]`), and no click handler at all — it cannot be
      selected, tapped, or focused.
    - If `true` (Part A has shipped and flipped the flag): tile behaves exactly like Tile 1 — clickable,
      shows `border-[#7C3AED] bg-[#7C3AED]/10` + `"ACTIVE"` badge if it is the currently saved
      `active_provider`, plain `border-[#222222]` otherwise.
- Below the two tiles, a static informational line, always shown regardless of selection state:
  `"Sessions already in progress keep using their original provider — only sessions started after you
  save switch to the new one."` — `text-[#94A3B8] text-xs`.
- No "Save changes" button is rendered in this state (nothing is pending).

**State 4 — Pending change (an admin has clicked a different, enabled tile).**
- Clicking an enabled tile that is **not** the currently-saved `active_provider` sets a local
  `pendingSelection` value — this does **not** fire any network request. The clicked tile now shows the
  `border-[#7C3AED] bg-[#7C3AED]/10` "selected" styling with a `"SELECTED"` badge instead of `"ACTIVE"`;
  the tile matching the still-actually-saved `active_provider` drops its `"ACTIVE"` badge and shows a
  plain caption `"Currently active"` (`text-[#94A3B8] text-[11px]`) so the admin can see both the
  current and pending state simultaneously.
- A **"Save changes"** button appears below the informational line — solid purple
  (`bg-[#7C3AED] text-white text-sm font-semibold rounded-lg px-4 py-2.5`), full width on mobile
  (`w-full`) and auto width from `sm:` up (`sm:w-auto`).
- Clicking a tile a second time (returning the selection to the currently-saved value) clears
  `pendingSelection` and the Save button disappears again — returns to State 3.

**State 5 — Saving in progress.** Triggered only after the admin clicks "Save changes" **and** confirms
the `window.confirm(...)` dialog (§7):
- Both tiles become non-interactive (`pointer-events-none`, no visual disabled styling needed beyond
  losing hover/click — they are not conceptually "disabled," just momentarily locked).
- The Save button becomes disabled and its label changes to `"Saving…"` — identical
  disabled/label-swap convention to `DemoAccessCard`'s own `"Generating…"` / `"Regenerating…"` buttons.

**State 6 — Save success.**
- The PATCH response's `active_provider` becomes the new source of truth: the tile matching it now
  shows `"ACTIVE"`, the other tile loses `"SELECTED"`/`"Currently active"` captions and returns to its
  plain unselected (or disabled, if it's the still-unavailable OpenAI tile) state.
- `pendingSelection` is cleared — the Save button disappears (back to State 3's layout, now reflecting
  the new value).
- A success line appears above the two tiles: `"Saved — new sessions will now use {ProviderLabel}."`
  where `{ProviderLabel}` is `"Hume EVI"` or `"OpenAI Realtime"` — `text-[#10B981] text-xs` (same
  success-green convention as `DemoAccessCard`'s own `topupMessage` line, `text-[#10B981] text-xs`,
  line 175). This message clears automatically after 4 seconds (a local `setTimeout`, not tied to a
  URL query param — this feature has no redirect flow to hook a `demo_topup`-style param into, unlike
  `DemoAccessCard`'s billing-return case).

**State 7 — Save error.**
- If the PATCH request fails (network error, non-200 response) or is rejected by the server: the
  displayed `active_provider` (and which tile shows `"ACTIVE"`) does **not** change — this is the
  explicit, reasoned non-optimistic design (§11, resolves the CEO's open question directly).
  `pendingSelection` is preserved exactly as the admin left it (the tile they clicked stays visually
  `"SELECTED"`), so they do not have to re-select before retrying.
- An inline error line appears below the two tiles, above the Save button: `"Couldn't save — try
  again."` — `text-[#EF4444] text-xs` (same convention as `DemoAccessCard`'s own `regenerateError`
  line).
- The Save button returns to its enabled, clickable `"Save changes"` state — clicking it again re-opens
  the `window.confirm(...)` step and retries.

## 5. Visual Examples

**State 1 — Initial load**
```
┌───────────────────────────────────────────────────────────┐
│  Live voice provider                                       │
│  Controls which voice AI powers new live sessions           │
│  across all partners.                                        │
│                                                                │
│  Checking…                                                    │
└───────────────────────────────────────────────────────────┘
```

**State 2 — Load error**
```
┌───────────────────────────────────────────────────────────┐
│  Live voice provider                                       │
│  Controls which voice AI powers new live sessions           │
│  across all partners.                                        │
│                                                                │
│  Couldn't load voice provider settings. Try refreshing        │
│  the page.                                                     │
└───────────────────────────────────────────────────────────┘
```

**State 3 — Loaded, no pending change (Hume active, OpenAI not yet available)**
```
┌───────────────────────────────────────────────────────────┐
│  Live voice provider                                       │
│  Controls which voice AI powers new live sessions           │
│  across all partners.                                        │
│                                                                │
│  ┌─────────────────────────┐  ┌─────────────────────────┐   │
│  │ Hume EVI (default)      │  │ OpenAI Realtime          │   │
│  │ ACTIVE                  │  │ Coming soon — adapter    │   │
│  │ (purple border/tint)    │  │ in development.          │   │
│  │                          │  │ (greyed, not clickable)  │   │
│  └─────────────────────────┘  └─────────────────────────┘   │
│                                                                │
│  Sessions already in progress keep using their original       │
│  provider — only sessions started after you save switch       │
│  to the new one.                                               │
└───────────────────────────────────────────────────────────┘
```

**State 4 — Pending change (OpenAI now available; admin selected it, not yet saved)**
```
┌───────────────────────────────────────────────────────────┐
│  Live voice provider                                       │
│  ...                                                          │
│  ┌─────────────────────────┐  ┌─────────────────────────┐   │
│  │ Hume EVI (default)      │  │ OpenAI Realtime          │   │
│  │ Currently active        │  │ SELECTED                 │   │
│  │ (plain border)          │  │ (purple border/tint)     │   │
│  └─────────────────────────┘  └─────────────────────────┘   │
│                                                                │
│  Sessions already in progress keep using their original       │
│  provider — only sessions started after you save switch       │
│  to the new one.                                               │
│                                                                │
│  [ Save changes ]                                              │
└───────────────────────────────────────────────────────────┘
```

**State 5 — Saving**
```
│  [ Saving… ]   (disabled; both tiles locked, non-interactive) │
```

**State 6 — Save success**
```
┌───────────────────────────────────────────────────────────┐
│  Live voice provider                                       │
│  ...                                                          │
│  Saved — new sessions will now use OpenAI Realtime.           │
│                                                                │
│  ┌─────────────────────────┐  ┌─────────────────────────┐   │
│  │ Hume EVI (default)      │  │ OpenAI Realtime          │   │
│  │ (plain border)          │  │ ACTIVE                    │   │
│  └─────────────────────────┘  └─────────────────────────┘   │
│                                                                │
│  Sessions already in progress keep using their original       │
│  provider — only sessions started after you save switch       │
│  to the new one.                                               │
└───────────────────────────────────────────────────────────┘
```
(Success line above fades out automatically after 4 seconds — no user action needed.)

**State 7 — Save error**
```
┌───────────────────────────────────────────────────────────┐
│  Live voice provider                                       │
│  ...                                                          │
│  ┌─────────────────────────┐  ┌─────────────────────────┐   │
│  │ Hume EVI (default)      │  │ OpenAI Realtime          │   │
│  │ Currently active        │  │ SELECTED                 │   │
│  └─────────────────────────┘  └─────────────────────────┘   │
│                                                                │
│  Sessions already in progress keep using their original       │
│  provider — only sessions started after you save switch       │
│  to the new one.                                               │
│                                                                │
│  Couldn't save — try again.                                    │
│  [ Save changes ]                                              │
└───────────────────────────────────────────────────────────┘
```

**Confirm dialog (native `window.confirm`, triggered by "Save changes" before any PATCH fires):**
```
This changes the voice provider for new live sessions immediately
after saving. Sessions already in progress are not affected.
Continue?
                                          [ Cancel ]  [ OK ]
```

## 6. Data Requirements

### New table — `system_voice_config`

New migration file `supabase/migrations/104_b2b61_system_voice_config.sql` (104 is the next available
number as of this writing — `103_fix_end_reason_check_regression.sql` is current highest in
`supabase/migrations/`; the developer must reverify this is still unclaimed at build time, since other
in-flight branches in this session may have since taken it).

```sql
-- =============================================================================
-- B2B-61 — System Voice Provider Config (Part B: persisted admin toggle)
-- Requirement Doc: docs/specs/B2B-61-requirement-document.md
-- Feature Brief: .claude/agents/clio/feature-briefs/B2B-61-openai-realtime-voice-adapter-and-admin-toggle.md
--
-- The FIRST global (non-partner_account_id-scoped) config table in this
-- codebase (confirmed by grep of every existing migration — see Requirement
-- Doc §0). Single row, fixed id, controls which live-voice provider new
-- partner sessions use platform-wide. Read server-side by
-- app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx at session
-- render time (via a new getActiveVoiceProvider() helper — see §6 below);
-- written only via PATCH /api/admin/voice-config (requireSuperAdmin-gated).
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_voice_config (
  id                UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  active_provider   TEXT NOT NULL DEFAULT 'hume' CHECK (active_provider IN ('hume', 'openai_realtime')),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton enforcement at the DB level, not just by application convention:
-- the only permitted primary key value is the fixed constant above, so a
-- second row can never be inserted regardless of what application code does.
ALTER TABLE system_voice_config
  ADD CONSTRAINT system_voice_config_singleton_id
  CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE TRIGGER update_system_voice_config_updated_at
  BEFORE UPDATE ON system_voice_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE system_voice_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on system_voice_config"
  ON system_voice_config FOR ALL
  USING (auth.role() = 'service_role');

-- Seed the single row so GET never has to special-case "no row yet."
INSERT INTO system_voice_config (id, active_provider)
VALUES ('00000000-0000-0000-0000-000000000001', 'hume')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE system_voice_config IS 'B2B-61: the first GLOBAL (non-partner-scoped) config table in this codebase — a single row controlling which live-voice provider new partner sessions use platform-wide. Not partner_account_id-scoped by design (Requirement Doc §0, §6). Written only via PATCH /api/admin/voice-config (requireSuperAdmin-gated).';
COMMENT ON COLUMN system_voice_config.active_provider IS 'B2B-61: hume (default, current sole live provider) or openai_realtime. The openai_realtime value is additionally gated at the API layer by OPENAI_REALTIME_ADAPTER_AVAILABLE (lib/voice/provider-availability.ts) until Part A''s adapter ships — the CHECK constraint alone intentionally allows it so the schema does not need a future migration when that flag flips.';
```

`update_updated_at_column()` is the same existing trigger function already used by every other
config-table migration (e.g. `080_b2b11_prompt_behavior_and_join_greeting.sql` line 49) — reused
unmodified, not redefined.

### New availability flag — `lib/voice/provider-availability.ts` (new file)

```ts
/**
 * B2B-61 Part B. Gates whether the "OpenAI Realtime" option in the admin
 * voice-provider toggle (system_voice_config) is selectable at all — both in
 * the UI (app/(with-clerk)/dashboard/admin/VoiceProviderCard.tsx) and,
 * defense-in-depth, in the PATCH /api/admin/voice-config route itself.
 *
 * Owned by Part A (the OpenAI Realtime adapter build, tracked separately in
 * the B2B-61 feature brief) — flip to `true` only once
 * lib/voice/openai-realtime-adapter.ts is live-call verified end-to-end
 * (per the feature brief's own spike-first requirement). This file has no
 * other purpose and should not accumulate unrelated flags.
 */
export const OPENAI_REALTIME_ADAPTER_AVAILABLE = false
```

### Reads

- `GET /api/admin/voice-config` — `requireSuperAdmin()`-gated (mirrors every other route under
  `app/api/admin/`). Selects the single `system_voice_config` row. Response:
  ```json
  { "active_provider": "hume", "updated_at": "2026-07-31T00:00:00.000Z", "openai_realtime_available": false }
  ```
  `openai_realtime_available` is simply `OPENAI_REALTIME_ADAPTER_AVAILABLE`, included so the card never
  needs a second request or a hardcoded client-side copy of the flag.
- **Server-side session-time read** — new function `getActiveVoiceProvider(): Promise<'hume' |
  'openai_realtime'>` in a new file `lib/voice/provider-config.ts`, using
  `createSupabaseAdminClient()` (existing, `lib/supabase.ts`) to select the single
  `system_voice_config` row. Called from
  `app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx`, as a sibling call alongside the
  existing `getThemeConfig(session.partnerAccountId)` (line 71) — **not** inside
  `resolveLiveSessionRender()`, and not a new field on `LiveRenderResult` (§0's re-verification found no
  reason to touch that type/function; it already composes cleanly with a second, independent
  server-side call exactly the way `getThemeConfig` already does). The resolved value is passed as a
  new prop into `<PartnerRenderClient>` at both existing call sites (inline mode, `page.tsx` lines
  81–87; template mode, lines 90–96) — e.g. `voiceProvider={provider}`.
  **Consuming that new prop inside `PartnerRenderClient.tsx` to actually construct the right adapter
  is Part A's/the developer's responsibility (per the CEO brief's own scope split) — this document
  specifies only that the value is read server-side at this exact call site and handed down as a prop;
  it does not specify `PartnerRenderClientProps`'s new field name, adapter-construction branching, or
  any change inside `PartnerRenderClient.tsx` itself.**

### Writes

- `PATCH /api/admin/voice-config` — `requireSuperAdmin()`-gated. Zod-validated body:
  ```ts
  const PatchSchema = z.object({ active_provider: z.enum(['hume', 'openai_realtime']) })
  ```
  (mirrors `theme/route.ts`'s own `PatchSchema` convention, lines 22–31). Validation failure → `400`
  with `{ error: 'Validation failed', details: parsed.error.flatten() }` (identical shape to
  `theme/route.ts` line 37).
  **Defense-in-depth gate:** if the validated `active_provider === 'openai_realtime'` AND
  `OPENAI_REALTIME_ADAPTER_AVAILABLE === false`, the route returns `400` with
  `{ error: 'OpenAI Realtime is not yet available.' }` **without writing to the table** — this exists
  because the UI disabling the tile is not itself a security boundary; a direct API call must be
  rejected the same way (§9, §11).
  On success: upserts (`UPDATE ... WHERE id = '00000000-0000-0000-0000-000000000001'`) the single row's
  `active_provider`, returns `{ "active_provider": "...", "updated_at": "..." }` (`200`).
  On unexpected DB failure: `500` with a generic `{ error: 'Failed to save.' }` — never leaks DB error
  detail into the response, consistent with `CLAUDE.md`'s "never expose secrets/internals in error
  messages" rule.

### New client component

`app/(with-clerk)/dashboard/admin/VoiceProviderCard.tsx` (new file, named to match `DemoAccessCard.tsx`'s
own naming convention) — `'use client'`, fetch-on-mount via `useEffect`, holds `data`, `loadError`,
`pendingSelection`, `saving`, `saveError`, `saveSuccessMessage` local state (mirrors `DemoAccessCard`'s
own state shape: `data`, `loadError`, `regenerating`, `regenerateError`). Imported and rendered in
`app/(with-clerk)/dashboard/admin/page.tsx` directly below the existing `<DemoAccessCard />` line (page.tsx
line 60) — one new `<VoiceProviderCard />` line added, nothing else on that page changes.

## 7. Success Criteria (Acceptance Tests)

✓ Given a super-admin loads `/dashboard/admin`, when the page and card mount, then the card briefly
shows "Checking…" and then resolves to show the currently-saved provider's tile marked `"ACTIVE"`.

✓ Given `OPENAI_REALTIME_ADAPTER_AVAILABLE` is `false` (the default), when the card loads, then the
"OpenAI Realtime" tile renders visually disabled with the "Coming soon — adapter in development."
caption and cannot be clicked, focused, or selected by any means.

✓ Given the admin clicks an enabled tile that differs from the currently-saved provider, when the click
registers, then a "Save changes" button appears, the clicked tile shows "SELECTED", and no network
request has been made yet.

✓ Given the admin clicks "Save changes" and confirms the `window.confirm(...)` dialog, when the PATCH
request succeeds, then the button shows "Saving…" during the request, the newly-active tile shows
"ACTIVE" after it resolves, a green "Saved — new sessions will now use {ProviderLabel}." message
appears and clears after 4 seconds, and the "Save changes" button disappears.

✓ Given the admin clicks "Save changes" and then clicks "Cancel" on the `window.confirm(...)` dialog,
when they cancel, then no PATCH request is sent, the pending selection and "Save changes" button remain
exactly as before the click.

✓ Given the PATCH request fails (network error or non-2xx response), when the failure is received, then
the displayed "ACTIVE" tile does not change from its last-saved value, the admin's pending selection is
preserved, a red "Couldn't save — try again." message appears, and "Save changes" remains clickable to
retry.

✓ Given the initial `GET /api/admin/voice-config` request fails, when the card mounts, then it shows
"Couldn't load voice provider settings. Try refreshing the page." and renders no interactive tiles.

✓ Given a caller without a `super_admin`-role session (no session, or an `internal_staff`-role session),
when they call `GET` or `PATCH /api/admin/voice-config` directly, then the request is rejected (`401` no
session / `403` non-super-admin role, matching `requireSuperAdmin()`'s existing behavior) and no data is
returned or changed.

✓ Given `OPENAI_REALTIME_ADAPTER_AVAILABLE` is `false`, when a `PATCH` request is sent directly (bypassing
the UI) with `{ "active_provider": "openai_realtime" }` by an authenticated super-admin, then the route
returns `400` and the `system_voice_config` row is left unchanged.

✓ Given an admin has successfully saved a new `active_provider` value, when any new `/partner-render/...`
session subsequently renders, then `getActiveVoiceProvider()` (called from `page.tsx`) reads and returns
that new value from `system_voice_config` (verified at the data layer — full adapter-selection behavior
inside `PartnerRenderClient.tsx` is Part A's scope and is not asserted here).

## 8. Error States

- **GET fails on mount** → State 2 (§4): red load-error text, no interactive tiles, no automatic retry
  (matches `DemoAccessCard`'s own convention — a manual page refresh is the recovery path).
- **PATCH fails after confirm** → State 7 (§4): non-optimistic by design — the displayed active provider
  never changes until a `200` is actually received; pending selection and Save button remain so the
  admin can retry without re-selecting.
- **PATCH rejected because `openai_realtime` is not yet available** → same visual treatment as a generic
  save error (`"Couldn't save — try again."`) is deliberately *not* used here: this is a distinct,
  no-retry-will-help error, but the CEO brief's own resolved UI decision already prevents the UI from
  ever sending this request in the first place (disabled tile), so this path is only reachable via a
  direct API call, not through the card itself — no dedicated UI copy is needed for a state the UI
  cannot produce. Documented here as a defense-in-depth API behavior, not a UI state.
- **Unauthenticated / wrong-role caller hits the API directly** → standard `requireSuperAdmin()` `401`/`403`
  JSON error envelope, identical to every other `app/api/admin/*` route; no card-specific handling
  needed since the card itself is never reachable by such a caller (`page.tsx`'s own server-side gate).
- **No "slow network" loading state beyond "Checking…"/"Saving…"** — this is a low-traffic, single-row
  read/write with no expected latency profile worth a distinct "still loading" treatment; the existing
  two labels cover it, matching `DemoAccessCard`'s own choice not to add a separate slow-network state.

## 9. Edge Cases

- **Two admins save near-simultaneously.** Reasoned decision: no optimistic locking (no `expected
  updated_at` sent with the PATCH). This is a single global setting behind `requireSuperAdmin()` — in
  practice reachable only by Arun and any future super-admins, a low-concurrency surface where
  last-write-wins is acceptable and consistent with this table's own `updated_at` trigger giving a clear
  audit trail of which write actually landed. Adding compare-and-swap semantics here would be
  over-engineering for the actual concurrency risk; flagged explicitly here as a conscious choice, not
  an oversight.
- **No-op save attempt.** Clicking the tile that is already `"ACTIVE"` does nothing (§4 State 3→4
  transition only fires for a tile that differs from the current value) — there is never a "Save
  changes" button visible for a selection identical to the already-saved value, so a true no-op PATCH
  can never be sent from the UI.
- **OpenAI Realtime pre-launch (the current, default state).** Fully specified in §4 State 3 and §6 —
  disabled tile, `openai_realtime_available: false` from the API, PATCH-level rejection as
  defense-in-depth. This is the expected day-one state of this feature and must render correctly before
  Part A ships anything. Note that `OPENAI_REALTIME_ADAPTER_AVAILABLE` deliberately lives outside
  `system_voice_config`'s own `CHECK` constraint (§6) — flipping it later requires only a one-line code
  change, not a migration, keeping Part A's eventual ship step decoupled from this document's schema.
- **Another admin changes the value in a different tab/session while this card is open.** No realtime
  sync (no polling, no websocket) — the open tab keeps showing whatever it last fetched or saved until
  the page is reloaded. This mirrors `DemoAccessCard`'s own behavior (also no cross-tab sync) and is an
  intentional non-goal for a low-traffic internal control, not an oversight.
- **Mobile / narrow viewport.** The two tiles stack vertically (`flex-col`, full width each) below the
  `sm:` breakpoint and sit side-by-side (`sm:flex-row`, each `sm:flex-1`) at `sm:` and above; the Save
  button is full-width (`w-full`) below `sm:` and auto-width (`sm:w-auto`) above — standard Tailwind
  responsive utilities, no hardcoded pixel-width caps anywhere in this card. `clamp()` is not used for
  this card's typography because nothing in it needs interpolated scaling: every text size reuses this
  codebase's existing fixed Tailwind type scale (`text-xs`/`text-sm`/`text-base`), matching
  `DemoAccessCard` sitting immediately above it on the same page — introducing `clamp()`-based sizing
  here in isolation would visually diverge from that sibling card for no benefit. The standing
  responsive rule's actual target (no hardcoded pixel-width layout caps) is fully satisfied; this is a
  deliberate, reasoned scope call on the `clamp()` half of that rule, not a silent skip.
- **First-time load before migration 104 has ever run in an environment** — not applicable in practice
  since the migration's own `INSERT ... ON CONFLICT DO NOTHING` seeds the row at migration time, so
  `GET` never encounters a genuinely missing row in any environment where the migration has been
  applied. If a developer environment somehow has the table but not the seed row, `GET`'s `.maybeSingle()`
  read would return `null` — treat this identically to State 2 (load error) rather than crash; noted for
  completeness even though normal deployment flow prevents it.

## 10. Out of Scope

- The OpenAI Realtime adapter itself (`lib/voice/openai-realtime-adapter.ts`), its token route, its tool
  JSON Schemas, and the audio pipeline — all Part A, direct-build, not gated by this document.
- Any change to `PartnerRenderClient.tsx`'s internals beyond receiving the new `voiceProvider`-equivalent
  prop described in §6 — constructing the correct adapter from that prop is Part A's/the developer's
  responsibility, not specified here.
- Per-partner voice provider selection — explicitly resolved as out of scope in the CEO brief; this
  toggle is global only.
- Automatic failover (Hume fails mid-call → auto-switch) — manual admin toggle only, per the CEO brief.
- A new dedicated settings page — this is one card on the existing `/dashboard/admin` page, not a new
  route.
- Real-time / cross-tab sync of the card's displayed state when changed elsewhere.
- Any UI or route for the OpenAI Realtime spike itself (the CEO brief's Part A step 1) — that is a
  throwaway diagnostic step, not a persisted feature.
- Editing or viewing `system_voice_config`'s `updated_at` or change history anywhere in the UI beyond
  what's implicit in the current `active_provider` display — no audit-log screen is part of this
  document.

## 11. Open Questions

None. All three items the CEO brief explicitly left open for the BA to resolve have been decided, with
reasoning, in this document:

1. **Confirmation step before save** — resolved **yes**, a `window.confirm(...)` step, mirroring
   `DemoAccessCard`'s own regenerate-passcode confirm pattern exactly (§4 State 4→5 transition, §5's
   confirm-dialog wireframe). Reasoning: this setting affects live production voice sessions
   platform-wide the instant it's saved — the same risk class `DemoAccessCard`'s own confirm step exists
   to guard against (invalidating a live passcode), so reusing the identical interaction pattern is both
   consistent and proportionate, not over-cautious for a single-admin low-frequency control.
2. **In-flight-session-unaffected messaging** — resolved **yes**, stated twice: as a persistent
   informational line on the card itself (§4 State 3 onward) and again inside the confirm-dialog copy
   itself (§5) — both times using the same wording so the admin isn't reading two different claims.
   Reasoning: given the billing/session-integrity sensitivity the CEO brief itself flagged, this should
   be unmissable at the exact moment of the action, not just documented once and easy to skip past.
3. **Pre-launch selectability of the OpenAI Realtime option** — resolved: **not selectable** until Part A
   ships, gated by a single new boolean flag (`OPENAI_REALTIME_ADAPTER_AVAILABLE`,
   `lib/voice/provider-availability.ts`), enforced both in the UI (disabled tile, §4 State 3) and,
   defense-in-depth, at the API layer (§6, §8) so a stale/bypassed UI can never actually select an
   adapter that doesn't exist yet and break live sessions. Reasoning: allowing selection of a
   non-functional provider is exactly the kind of production-risk this whole feature exists to reduce,
   not introduce.

Additionally resolved beyond the three the CEO brief flagged, since answering them was necessary to
make the above concrete rather than "figure it out" during build (per this project's standing rule
against vague specs):
- Optimistic-vs-confirmed save UI (§7's "what if PATCH fails after an optimistic toast" worry) —
  resolved non-optimistic (§4 State 6/7, §8), eliminating the failure mode described in the brief by
  construction rather than by handling it after the fact.
- Near-simultaneous saves by two admins — resolved last-write-wins, no optimistic locking (§9), with
  reasoning for why that's sufficient given the actual concurrency profile of a `requireSuperAdmin()`-only
  control.
- Exact table name/shape — confirmed the CEO brief's tentative `system_voice_config` shape is sound as
  proposed; refined only by adding the fixed-id singleton `CHECK` constraint as DB-level defense-in-depth
  (§6) and explicit column comments matching this codebase's own documentation convention.
- Exact parent file/line for the server-side provider read — traced and named precisely (§0, §6): the
  session-render parent is `app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx` lines 81–96, as
  a sibling call to the existing `getThemeConfig` call at line 71 — not `app/(with-clerk)/dashboard/admin
  /page.tsx` (that file only hosts the admin toggle's own card, unrelated to session render).

Nothing in this document requires escalation to Arun beyond the CEO's own review/approval of this spec.

## 12. Dependencies

- `requireSuperAdmin()` — `lib/internal-admin/auth.ts` lines 137–150. Already exists, reused unmodified.
- `createSupabaseAdminClient()` — `lib/supabase.ts`. Already exists, reused unmodified.
- `update_updated_at_column()` trigger function — already exists in the DB (used by every prior
  config-table migration); this document's migration reuses it, does not redefine it.
- Migration `104_b2b61_system_voice_config.sql` must be applied before `GET`/`PATCH
  /api/admin/voice-config` or `getActiveVoiceProvider()` can function. (Migration number to be
  reverified as still unclaimed at build time — see §6.)
- `app/(with-clerk)/dashboard/admin/page.tsx` — existing file, requires exactly one new import + one new
  `<VoiceProviderCard />` line, directly below the existing `<DemoAccessCard />` (page.tsx line 60).
  Nothing else on that page changes.
- `app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx` — existing file, requires one new sibling
  call (`getActiveVoiceProvider()`) alongside the existing `getThemeConfig` call, and one new prop passed
  into `<PartnerRenderClient>` at both of its existing call sites (lines 81–87, 90–96).
- **Not a dependency of this document, but a dependency this document creates for Part A:**
  `OPENAI_REALTIME_ADAPTER_AVAILABLE` (`lib/voice/provider-availability.ts`) must be flipped to `true` by
  Part A's developer once `lib/voice/openai-realtime-adapter.ts` is live-call verified — until then, this
  entire Part B feature ships and functions fully correctly with only `'hume'` ever selectable, which is
  the correct and complete state for this document to leave the system in on its own.
- `PartnerRenderClientProps` gaining a new provider-related field and any adapter-construction branching
  inside `PartnerRenderClient.tsx` is Part A's/the developer's scope per the CEO brief's own split — not
  a blocking dependency of this document (§6, §10): this toggle's persistence and admin UI work and are
  fully testable (§7's data-layer acceptance test) independent of whether Part A has wired the
  consumption side yet.

## 13. Test Plan

- **Unit:** `PatchSchema` validation (valid `'hume'`/`'openai_realtime'` values accepted structurally;
  any other string rejected); the `OPENAI_REALTIME_ADAPTER_AVAILABLE === false` rejection branch inside
  the PATCH route handler, independent of Zod validation; `getActiveVoiceProvider()`'s fallback behavior
  if the row is somehow missing (§9's edge case — should not throw, should degrade to `'hume'` as the
  documented default rather than fail session render entirely, matching `humeConfigId`'s own
  fail-open-to-`null` posture elsewhere in `resolveLiveSessionRender`).
- **Integration:** `GET /api/admin/voice-config` — `401` with no Clerk session, `403` for an
  `internal_staff`-role session, `200` with the correct shape for a `super_admin` session, including
  correct `openai_realtime_available` reflecting the current flag value. `PATCH
  /api/admin/voice-config` — same auth matrix; `400` on malformed body; `400` + unchanged row when
  attempting `'openai_realtime'` while unavailable; `200` + persisted row update (verified by a
  follow-up `GET` or direct row read) on a valid, available-provider change.
- **E2E (Playwright):** load `/dashboard/admin` as a super-admin, verify the card resolves out of
  "Checking…" to show `'hume'` as `"ACTIVE"` and the OpenAI tile disabled with its "Coming soon" caption;
  click-through of a mocked-available second provider (test-only flag override, if the test harness
  supports it) exercising select → Save changes → confirm-dialog accept → success-message flow; a
  mocked PATCH-failure run verifying the active tile does not change and the retry path works; mobile
  viewport (375px) render verifying the two tiles stack vertically with no horizontal page scroll.

---

## 14. CEO Addendum (2026-07-31) — one technical correction to §12, spec otherwise approved as-is

Re-verified directly against source before approval: `page.tsx` lines 71-72 (`getThemeConfig` /
`resolveLiveSessionRender`) confirmed as independent sibling calls, not nested — the proposed third
sibling call composes cleanly, as claimed. `DemoAccessCard.tsx` confirmed line-for-line: `window.confirm`
gate at lines 111-119, `loadError`/`data===null` state split at lines 44-45/177/179, `"…ing…"` disabled-
button label swap at 187-193/218-223, and the `TOPUP_TIERS` radio-tile markup at lines 280-295 with
exactly the `border-[#7C3AED] bg-[#7C3AED]/10` / `border-[#222222]` styling cited. `theme/route.ts`'s
`PatchSchema` shape and 400-response envelope confirmed at the cited lines. `requireSuperAdmin()`
confirmed at `lib/internal-admin/auth.ts` lines 137-150. Migration 103 confirmed as current highest, 104
free. Grep of every migration confirms no prior global (non-`partner_account_id`-scoped) *config* table —
the singleton `CHECK (id = <fixed-uuid>)` + fixed-PK pattern is sound and, combined with the `UNIQUE`-by-
construction primary key, mathematically guarantees 0-or-1 rows. None of this needed correction.

**The one gap:** §12 claims this document's work is "fully testable... independent of whether Part A has
wired the consumption side yet" and that `PartnerRenderClientProps` gaining the new field is entirely
Part A's/the developer's scope. That's not quite right. `PartnerRenderClient.tsx`'s exported
`PartnerRenderClientProps` (lines 82-87) is a closed TypeScript interface with exactly four fields today
(`clioSessionRef`, `humeConfigId`, `sections?`, `inlinePages?`) — no index signature, nothing permissive.
§6 directs the developer to pass `voiceProvider={provider}` into `<PartnerRenderClient>` at both call
sites in `page.tsx`. Doing that without the field existing on the interface is a straight `tsc --noEmit`
failure (`Property 'voiceProvider' does not exist on type 'IntrinsicAttributes & PartnerRenderClientProps'`)
— i.e. Part B cannot actually land green on its own under this document's own §12 framing, which
contradicts CLAUDE.md's "zero TypeScript errors" merge gate.

This is a technical/build-sequencing question, not a product-shape one, so per CLAUDE.md's own autonomy
boundary (technical decisions: full CEO/Orchestrator autonomy) I'm resolving it directly here rather than
bouncing the document back to the BA for a full revision pass:

**Resolution:** Part B's developer adds `voiceProvider: 'hume' | 'openai_realtime'` to the exported
`PartnerRenderClientProps` interface in `PartnerRenderClient.tsx` as a type-only addition — declared and
destructured (or destructured-and-ignored with an eslint-disable-unused-vars comment if lint requires),
but **not consumed** to construct or branch any adapter. That construction/branching logic remains
entirely Part A's scope, unchanged from §10/§12's framing otherwise. This is the smallest possible touch
to a file Part A is concurrently editing (Part A's own scope in that file is the `HumeAdapter.create(...)`
call-site branch, a different region of the file from the top-of-file props interface), so collision risk
between the two concurrent builds is low, but the Orchestrator should still sequence the two PRs (or have
Part B's developer coordinate directly with `dev-b2b61-parta`) rather than landing both blind against a
possibly-stale base.

Everything else in this document holds up under direct re-verification.

## 15. CEO Verdict

**APPROVED — dev-ready**, contingent only on the §14 addendum above being carried into the build (a
one-field type addition, not a spec rewrite). Section 11 is empty and correctly so; nothing here needs to
go back to the BA. Dispatch a Developer agent for Part B now. No escalation to Arun needed.
