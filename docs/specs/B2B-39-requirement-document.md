# Per-Reseller Demo Passcodes + Demo Billing — Requirement Document
Version: 1.0
Status: DRAFT — one design decision (§Flagged Decision below, resolving Open Item 3) deviates from
the CEO brief's own recommended default and should get explicit CEO re-review before development
starts, even though Section 11 is empty per governance convention (see note there).
Author: Business Analyst Agent
Date: 2026-07-27

---

## Flagged Decision — Read First (resolves CEO brief Open Item 3, differs from its recommended default)

The CEO brief (`.claude/agents/clio/feature-briefs/B2B-39-per-reseller-demo-passcodes-and-demo-billing.md`,
Open Item 3) recommended that once a passcode resolves to a `partner_account_id`, the dispatch route
look up **that account's own real API key** and use it to authenticate the outbound call to
`POST /api/partner/v1/sessions`.

I verified this against the live route (`app/api/partner/v1/sessions/route.ts:200-249`) and it
creates a direct violation of this same brief's own Known Constraint ("must not reuse or share
`partner_wallets.trial_minutes_used` / `test_minutes_balance` for demo minutes... a reseller using
the demo tool must not burn their real API trial minutes, and vice versa"):

- That route's B2B-08 trial/test-block gate fires unconditionally whenever `auth.mode === 'test'` —
  i.e. whenever a **test-mode** API key authenticates the call — and directly reads/writes
  `trial_minutes_used`/`test_minutes_balance` **on whatever account that key resolves to**
  (`lib/partner/live-render.ts:558-571` consumes the same columns again at session end). If the
  dispatch route authenticates as a reseller's own real test-mode key, every demo dispatch
  automatically consumes that reseller's real trial minutes — exactly the outcome the brief
  prohibits.
- Using a **live**-mode key instead would fall through to the live-mode funding guardrail
  (`balance_usd`, real card-on-file requirement, real per-minute debit via `applyWalletDecrement`) —
  charging demo usage against a reseller's real production wallet. Also prohibited by the same
  constraint, and additionally would make every reseller's demo passcode require a funded live
  account before it could ever work, contradicting "the passcode is what identifies which account to
  bill for that demo session" (a *demo*-specific, free/tiered billing surface).

**Resolution:** the dispatch route's outbound authentication to `/api/partner/v1/sessions` is **left
completely unchanged** — it continues to always use the fixed `DEMO_PARTNER_API_KEY`, authenticated as
the "Clio Internal — Public Demo" account, exactly as it does today. That account's own
`test_minutes_balance` is kept perpetually funded by a small internal auto-top-up safety valve (§6.3)
so it can never again run dry mid-testing (the actual bug that surfaced this feature). **Billing
identity** — which passcode-holder's account actually gets charged for a given demo session — is
tracked through a wholly new, separate mechanism (§6.1-6.5): a `demo_dispatches` attribution row
written at dispatch time, consumed by a new Inngest listener at session end that decrements the
resolved account's own `demo_minutes_balance`. This never touches the real partner-facing session API
contract, never requires a reseller to have a real API key minted before their demo access works
(avoiding the exact structural risk the brief's own Open Item 3 text raised), and — as a direct
side benefit — makes the flagged B2B-38 cross-reference trivial to resolve (§12).

This is presented here as a fully resolved, concrete design (not left in Section 11) per this task's
instruction to resolve every ambiguity with a specific decision, using the CEO brief's own default
unless a genuine problem is found. A genuine problem was found; the alternative above is the
resolution. **CEO should re-review this one point specifically** before development starts on §6.1-6.5
and §6.9.

---

## 1. Purpose

Every "Learn with AI" demo dispatch today bills against one single shared account ("Clio Internal —
Public Demo"), authenticated with one fixed env-var passcode (`DEMO_MEETING_PASSCODE`). That
account's B2B-08 20-minute free trial ran out mid-testing on 2026-07-27, blocking further work, and
because the passcode carries no identity at all, there was no way to tell which reseller (or the
admin) had been dispatching. Without this feature, every future exhaustion repeats the same block,
demo usage can never be attributed to anyone, and there is no path for a reseller to fund their own
continued demo access.

This feature gives every sales-partner (reseller) account and the admin their own individually
identifying, individually billable demo passcode — resolved server-side at dispatch time to a real
`partner_accounts.id` — backed by a new, structurally separate demo-minutes balance with a 20-minute
free allowance, a near-exhaustion reminder, and a self-serve tiered top-up purchase flow. Direct
(`account_kind='partner'`) accounts get none of this; the feature does not exist for them.

## 2. User Story

As a **reseller (sales-partner, `account_kind='channel_partner'`)**,
I want my own private demo passcode that I can hand to a prospect (or use myself) to trigger the
"Learn with AI" demo, billed to my own account,
so that my demo usage is never blocked by someone else's usage and I can see/fund my own balance.

As **Arun (admin)**,
I want my own demo passcode (replacing the old single shared env-var secret) with the same
regenerate/top-up capability every reseller gets,
so that I can keep demoing Clio without manually editing Vercel environment variables, and so my own
usage is tracked the same way a reseller's is.

As a **reseller or admin nearing the end of their demo-minutes balance**,
I want a reminder before I run out,
so that I'm not blocked mid-demo the way tonight's shared-account exhaustion blocked testing.

There is no end-user (demo visitor) facing story change — a visitor to `/demo/[slug]` still just
types a passcode into the existing "Learn with AI" gate; the only thing that changes for them is
*whose* passcode it is, which is invisible to them.

## 3. Trigger / Entry Point

**New dashboard screens** (all require an existing authenticated session — no new sign-up flow):

| Screen | Route | Auth |
|---|---|---|
| Reseller demo-access card | `/dashboard/channel-partner/settings` (new card on existing page) | Clerk session + `getChannelPartnerAccountForClerkUser` (existing pattern) |
| Admin demo-access card | `/dashboard/admin/sales-partners` (new card on existing page) | Clerk session + `requireSuperAdmin()` (existing pattern) |

**New/changed API routes** (all POST/GET, JSON):

- `GET /api/channel-partner/demo-access` — reseller's own passcode existence + demo-minutes balance
- `POST /api/channel-partner/demo-access/regenerate` — generate-or-regenerate, returns plaintext once
- `POST /api/channel-partner/billing/demo-topup` — creates a tiered Stripe Checkout session
- `GET /api/admin/demo-access` — admin's own (sentinel account) equivalent of the above
- `POST /api/admin/demo-access/regenerate` — admin equivalent
- `POST /api/admin/billing/demo-topup` — admin equivalent
- `app/api/demo/[slug]/dispatch/route.ts` — **changed**, not new: passcode check + auth (§6.6, §6.9)

**Unchanged entry point:** the public `/demo/[slug]` page's "Learn with AI" passcode prompt is
visually and behaviorally identical — same input, same submit action. Only the server-side meaning
of "correct passcode" changes (from one global secret to a per-account lookup).

## 4. Screen / Flow Description

### 4.A Reseller — `/dashboard/channel-partner/settings` — new "Demo access" card

Placed as a third card on the existing Settings page, below the existing "Company info" and "Payment"
cards (`app/dashboard/channel-partner/settings/SettingsClient.tsx`), same `Card`/`COLORS` components,
same inline-style convention already used on that file. New client component,
`app/dashboard/channel-partner/settings/DemoAccessClient.tsx`, rendered inside the existing
`SettingsClient` (or as a sibling `<DemoAccessCard />` imported into `page.tsx` — developer's call,
either satisfies this spec, since both are part of the same page/data-flow).

On load, `GET /api/channel-partner/demo-access` returns:
```json
{ "has_passcode": true, "generated_at": "2026-07-20T14:03:00Z",
  "demo_minutes_balance": 12.5, "demo_reference_topup_minutes": 20 }
```

**State A — no passcode yet** (`has_passcode: false` — true for every existing reseller account until
they first visit this card, per §6.4's lazy-generation design):
```
┌─────────────────────────────────────────────────────┐
│  Demo access                                         │
│                                                       │
│  You don't have a demo passcode yet. Generate one to │
│  let anyone use your passcode to trigger the "Learn   │
│  with AI" demo — billed to your own account.          │
│                                                       │
│  [PRIMARY BUTTON: "Generate passcode"]                │
└─────────────────────────────────────────────────────┘
```

**State B — has an active passcode** (`has_passcode: true`):
```
┌─────────────────────────────────────────────────────┐
│  Demo access                                         │
│                                                       │
│  ✓ Passcode active — generated Jul 20, 2026           │
│                                                       │
│  Demo minutes remaining: 12.5 / 20                    │
│  [progress bar, purple fill, same visual language as  │
│   an existing balance/progress element on this page]  │
│                                                       │
│  [SECONDARY BUTTON: "Regenerate passcode"]            │
│  [SECONDARY BUTTON: "Buy more demo minutes"]          │
└─────────────────────────────────────────────────────┘
```
Exact copy for the balance line: `Demo minutes remaining: {demo_minutes_balance.toFixed(1)} /
{demo_reference_topup_minutes}` (the denominator is the last-funded amount, matching the low-balance
alert's own reference point — see §6.2). If `demo_reference_topup_minutes` is null (should not happen
post-registration-grant, but defensively), show `Demo minutes remaining:
{demo_minutes_balance.toFixed(1)}` with no denominator.

**Clicking "Generate passcode" or "Regenerate passcode"** — both call the same
`POST /api/channel-partner/demo-access/regenerate` (no request body). "Regenerate" first shows a
native browser `window.confirm("This immediately invalidates your current passcode for new demo
sessions. Any demo session already running is not affected. Continue?")` — only proceeds on OK
(mirrors this project's existing convention of using `window.confirm` for irreversible actions where
no dedicated confirm-modal component yet exists in this file's pattern; if the developer's environment
already has a shared confirm-modal component in scope, that is an acceptable literal-equivalent
substitution — the requirement is an explicit confirm step before regeneration, not the specific
browser API). "Generate" (first-time, State A) skips the confirm — there is nothing to invalidate.

**Reveal modal** — on a successful `regenerate` call (response `{ "passcode": "XK7P-4QRT9M",
"generated_at": "..." }`), a modal overlay appears (dark backdrop `rgba(0,0,0,0.6)`, centered card,
`Card` component styling, `z-index` above all page content):
```
┌───────────────────────────────────────────────┐
│  Your demo passcode                            │
│                                                 │
│  Save this now — it will never be shown again.  │
│                                                 │
│  ┌───────────────────────────────────────┐     │
│  │  XK7P-4QRT9M                [Copy]     │     │
│  └───────────────────────────────────────┘     │
│                                                 │
│  ☐ I've saved this passcode                     │
│                                                 │
│  [PRIMARY BUTTON: "Done" — disabled until       │
│   checkbox is checked]                          │
└───────────────────────────────────────────────┘
```
"Copy" copies the plaintext to the clipboard (`navigator.clipboard.writeText`) and shows a 1.5s
"Copied" flash on the button label, mirroring `SettingsClient.tsx`'s existing `savedFlash` timeout
pattern. The modal has no close/X/backdrop-click dismissal — the checkbox + "Done" button is the
*only* way to dismiss it (mirrors the CEO brief's own suggested forced-acknowledgment pattern). After
"Done", the modal closes and the card re-fetches (`GET .../demo-access`) to show State B with the
fresh `generated_at`.

### 4.B Admin — `/dashboard/admin/sales-partners` — new "Your demo access" card

Placed above the existing sales-partner roster table in `SalesPartnersClient.tsx`, using that file's
own Tailwind-class convention (`bg-[#111111] border border-[#222222] rounded-xl`, not the
inline-style `Card` component the reseller pages use — matching the file it's added to, not
cross-importing a different convention).
```
┌─────────────────────────────────────────────────────┐
│  Your demo access                                     │
│  (Clio Internal — Public Demo account)                 │
│                                                       │
│  ✓ Passcode active — generated Jul 13, 2026            │
│  Demo minutes remaining: 340.0 / 500                  │
│                                                       │
│  [Regenerate passcode]  [Buy more demo minutes]        │
└─────────────────────────────────────────────────────┘
```
Same three states (no-passcode / active / reveal-modal), same copy, same confirm-before-regenerate,
same forced-acknowledgment reveal modal, sourced from `GET/POST /api/admin/demo-access[/regenerate]`
instead of the `/api/channel-partner/*` routes. Component: new
`app/dashboard/admin/sales-partners/DemoAccessCard.tsx` ('use client'), imported into
`SalesPartnersClient.tsx`.

**Admin bootstrap (State A → first-ever generation):** identical UI/flow to a reseller's first
generation — see §6.4 for how the underlying `partner_account_id`/20-minute-grant is resolved for the
admin case specifically (always the fixed "Clio Internal — Public Demo" row).

### 4.C Both — "Buy more demo minutes" flow

Clicking "Buy more demo minutes" (either dashboard) opens a modal (same visual chrome as the reveal
modal, different content) listing the 7 tiers as a vertical list of selectable rows:
```
┌───────────────────────────────────────────────┐
│  Buy demo minutes                              │
│  Provisional pricing — subject to change.       │
│                                                 │
│  ○ 15 min  — $0.50                             │
│  ○ 30 min  — $0.75                             │
│  ○ 1 hour  — $1.25                             │
│  ○ 2 hours — $1.80                             │
│  ○ 3 hours — $2.50                             │
│  ○ 5 hours — $4.00                             │
│  ○ 10 hours — $7.50                            │
│                                                 │
│  [PRIMARY BUTTON: "Continue to checkout"        │
│   — disabled until a tier is selected]          │
│  [text link: "Cancel"]                          │
└───────────────────────────────────────────────┘
```
Radio-button rows (single-select). "Continue to checkout" calls
`POST .../billing/demo-topup` with `{ tier: "hr2", success_url:
"<origin>/dashboard/channel-partner/settings?demo_topup=success", cancel_url:
"<origin>/dashboard/channel-partner/settings?demo_topup=cancelled" }` (admin equivalent uses the
admin route + `/dashboard/admin/sales-partners?demo_topup=...`), then `window.location.href =
data.checkout_url` (identical redirect pattern to `SettingsClient.tsx`'s existing `handleAddCard`).
On return (`?demo_topup=success`), the page shows a small green confirmation line above the Demo
access card — `"Demo minutes added."` — and re-fetches the balance (mirrors the existing
`card_verified=1` return-handling pattern in `SettingsClient.tsx`, simplified since there's no
uncertain-confirmation state to handle here — the webhook credits before Stripe redirects back in the
common case, and if the webhook hasn't landed yet the balance simply doesn't reflect it until the next
refresh, same known-lag behavior every other Stripe-webhook-funded balance in this codebase already
has). On `?demo_topup=cancelled`, no message — identical to how `cancel_url` returns are handled
elsewhere in this codebase (silently, just back to the page).

## 5. Visual Examples

Wireframes are inline in Section 4 above (one per distinct state: no-passcode, active-passcode,
reveal-modal, buy-minutes-modal) — both the reseller and admin variants share identical wireframes
except for the one-line account-identity subtitle admin's card adds ("Clio Internal — Public Demo
account"). Per the standing responsive/mobile-friendly-by-default rule: every card, modal, and button
described above uses fluid widths (`max-width` with `%`/`clamp()`, never a fixed `px` cap that bites
before ~1800-2000px), and the reveal/buy-minutes modals are full-width with side margins on narrow
viewports (`width: min(92vw, 420px)`) rather than a fixed modal width — this applies uniformly to
both new cards and both new modals, on both dashboards, since this spec touches both those screens for
the first time under this feature and both are therefore in scope for the standing responsive bar.

## 6. Data Requirements

### 6.1 New table — `demo_passcodes`

```sql
CREATE TABLE IF NOT EXISTS demo_passcodes (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id      UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  passcode_hash           TEXT NOT NULL,   -- SHA-256 hex digest, only form ever persisted
  passcode_prefix         TEXT NOT NULL,   -- first 4 chars (before the hyphen), display-safe only —
                                            -- NOT sufficient to guess the remaining 6-char/31-symbol
                                            -- suffix; used only for admin-facing diagnostics (e.g.
                                            -- "which passcode did this dispatch use"), never shown to
                                            -- the account owner as a "your passcode starts with..." UI
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at              TIMESTAMPTZ,     -- set (not deleted) on regeneration — audit trail, mirrors
                                            -- this codebase's existing soft-invalidation convention
  created_by_clerk_user_id TEXT            -- who clicked Generate/Regenerate; NULL for a row created
                                            -- by anything other than a direct button click (none exist
                                            -- in this design — every row is user-initiated per §6.4 —
                                            -- kept nullable defensively, not because a NULL case exists
                                            -- in this spec's own flows)
);

-- At most one ACTIVE passcode per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_passcodes_active_per_account
  ON demo_passcodes(partner_account_id) WHERE revoked_at IS NULL;

-- Global hash uniqueness — dispatch-time resolution is a single indexed lookup with no account
-- context yet (the visitor only typed a passcode, not an account).
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_passcodes_hash ON demo_passcodes(passcode_hash);

ALTER TABLE demo_passcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on demo_passcodes"
  ON demo_passcodes FOR ALL USING (auth.role() = 'service_role');
```
"Currently active passcode for account X" query: `SELECT * FROM demo_passcodes WHERE
partner_account_id = $1 AND revoked_at IS NULL` (at most one row, by the partial unique index).
Dispatch-time resolution query: `SELECT partner_account_id FROM demo_passcodes WHERE passcode_hash =
$1 AND revoked_at IS NULL` (single indexed lookup, no join needed).

### 6.2 New balance dimension — additive columns on `partner_wallets` (not a new table)

```sql
ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS demo_minutes_balance NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE partner_wallets ADD CONSTRAINT partner_wallets_demo_minutes_balance_nonneg CHECK (demo_minutes_balance >= 0);

ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS demo_reference_topup_minutes NUMERIC(10,2);
ALTER TABLE partner_wallets ADD COLUMN IF NOT EXISTS demo_low_balance_alert_fired_at TIMESTAMPTZ;
```
**Why co-located on `partner_wallets` rather than a new table:** it mirrors `test_minutes_balance`'s
own shape exactly (same table, same numeric type/constraint pattern) and every account that will ever
have demo minutes already has (or will lazily get, via the same `ON CONFLICT DO NOTHING` insert
pattern `consume_trial_and_test_minutes`/`credit_test_minutes_balance` already use) a `partner_wallets`
row keyed 1:1 by `partner_account_id` — so this avoids an extra join on every read with no
countervailing benefit. "Structurally separate" (the Known Constraint) is satisfied by these being
their own columns with their own RPCs and their own arithmetic, touched by zero existing
trial/test-minutes code path — not by living in a physically different table.

`demo_reference_topup_minutes` mirrors `reference_topup_amount_usd`'s role: set to the size of the
most recent credit (the 20-minute registration grant, or a paid top-up's tier size — never
cumulative), used as the 80%-consumed threshold's denominator. `demo_low_balance_alert_fired_at`
mirrors `low_balance_alert_fired_at`'s compare-and-set race-safe single-fire-per-cycle role.

### 6.3 New RPCs

```sql
CREATE OR REPLACE FUNCTION credit_demo_minutes_balance(p_partner_account_id UUID, p_minutes NUMERIC)
RETURNS NUMERIC AS $$
DECLARE new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id, demo_minutes_balance, demo_reference_topup_minutes, demo_low_balance_alert_fired_at)
    VALUES (p_partner_account_id, p_minutes, p_minutes, NULL)
    ON CONFLICT (partner_account_id) DO UPDATE SET
      demo_minutes_balance = partner_wallets.demo_minutes_balance + p_minutes,
      demo_reference_topup_minutes = p_minutes,      -- always the size of THIS credit, not cumulative
      demo_low_balance_alert_fired_at = NULL,         -- re-arm on every new credit
      updated_at = NOW()
    RETURNING demo_minutes_balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION consume_demo_minutes(p_partner_account_id UUID, p_minutes NUMERIC)
RETURNS NUMERIC AS $$
DECLARE new_balance NUMERIC;
BEGIN
  INSERT INTO partner_wallets (partner_account_id) VALUES (p_partner_account_id) ON CONFLICT (partner_account_id) DO NOTHING;
  UPDATE partner_wallets SET demo_minutes_balance = GREATEST(0, demo_minutes_balance - p_minutes), updated_at = NOW()
    WHERE partner_account_id = p_partner_account_id
    RETURNING demo_minutes_balance INTO new_balance;
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;
```
Note: unlike `consume_trial_and_test_minutes`, `consume_demo_minutes` does not floor-and-continue past
zero into a second bucket — there is only one bucket. A demo session is never blocked *mid-session* for
running out (§6.9/§8 — the real dispatch always goes through on the fixed internal account regardless
of the resolved account's own demo-minutes balance); running the balance to 0 only affects the
low-balance alert and the visible balance figure, never blocks a future dispatch outright, matching
this brief's explicit non-goal (no dispatch-time hard-block is described anywhere in the CEO brief —
only a *reminder*). This is stated explicitly here since it is a real, deliberate behavioral choice,
not an oversight: **demo passcodes never hard-block a dispatch on low/zero balance** — see §9 Edge
Case for the "runs negative" scenario and §7 AT-9.

**Internal auto-top-up safety valve** (resolves the precipitating bug, keeps the fixed internal
account's *real* B2B-08 `test_minutes_balance* funded — unrelated to the new demo-minutes columns
above, this is the existing B2B-08 RPC called with a new internal caller):
in `app/api/demo/[slug]/dispatch/route.ts`, immediately before the outbound `fetch` call, read
`partner_wallets.trial_minutes_used`/`test_minutes_balance` for `process.env.DEMO_PARTNER_ACCOUNT_ID`;
if `Math.max(0, 20 - trialMinutesUsed) + testMinutesBalance < 30`, call `supabase.rpc('credit_test_minutes_balance',
{ p_partner_account_id: DEMO_PARTNER_ACCOUNT_ID, p_minutes: 500 })` (fire-and-forget style — log and
proceed on error, never block the dispatch on this check failing). The 30-minute floor is chosen
because it comfortably exceeds any single demo topic's `expected_duration_minutes` (verified against
`app/demo/_content.ts` at spec-writing time — no topic exceeds it), so no in-progress demo can ever
straddle exhaustion mid-session; 500 minutes (~8.3 hours) per top-up keeps this check cheap (rarely
triggers) without needing a cron job.

### 6.4 Passcode generation mechanics (Open Item 1 — format)

Confirming the CEO brief's recommended default as-is: 10 characters from a 31-symbol unambiguous
alphanumeric alphabet — uppercase `A-Z` minus `{O, I, L}` (23 letters) plus digits `0-9` minus `{0,
1}` (8 digits) = 31 symbols — generated via `crypto.randomInt(0, 31)` per character (uniform, no
modulo-bias risk, unlike `randomBytes`+`%`). Displayed/typed as `XXXX-XXXXXX` (hyphen after the 4th
character, purely cosmetic — the hyphen is stripped before hashing/comparison, so a visitor typing it
with or without the hyphen both work). Entropy: 31^10 ≈ 8.2×10^14 — far more than adequate now that a
passcode doubles as a billing identifier, while staying short enough to hand-type.

New file `lib/demo/passcode-accounts.ts` (kept separate from the existing `lib/demo/passcode.ts` —
see §10 for why the two must never be merged):
```ts
export interface GeneratedDemoPasscode {
  passcode: string        // plaintext, e.g. "XK7P-4QRT9M" — shown to the caller exactly once
  passcodeHash: string    // SHA-256 hex digest of the passcode WITH hyphen stripped — the only persisted form
  passcodePrefix: string  // first 4 chars, display-safe
}
export function generateDemoPasscode(): GeneratedDemoPasscode { /* crypto.randomInt-based, per above */ }
export function hashDemoPasscode(candidate: string): string {
  // Strips whitespace and any hyphens, uppercases, then SHA-256 hex — so a visitor's hand-typed
  // input in any of "XK7P4QRT9M" / "xk7p-4qrt9m" / "XK7P 4QRT9M" forms all resolve identically.
}
export async function resolveDemoPasscodeToAccount(candidate: string): Promise<string | null> {
  // Single indexed lookup: demo_passcodes WHERE passcode_hash = hashDemoPasscode(candidate) AND revoked_at IS NULL
  // Returns partner_account_id or null. Used ONLY by the dispatch route (§6.9) — never by the
  // Meeting-tab Save action, which keeps using the existing lib/demo/passcode.ts mechanism unchanged.
}
```

**Registration-time 20-minute grant, generation-time passcode — deliberately decoupled (resolves
Questions 3, 4, 8):**

The CEO brief's own words ("every reseller who registers gets a passcode... the passcode is shown
exactly once, at generation") assume generation and the visible reveal happen at the same moment. I
verified this is not always mechanically possible: `createOrClaimPartnerAccount()`
(`lib/partner/signup.ts:47-136`, the sole provisioning chokepoint for every `channel_partner` account)
is reached from **two** call sites — the Clerk `user.created` **webhook**
(`app/api/webhooks/clerk/route.ts:123-130`, no browser present, nothing to reveal a secret to) and the
authenticated `POST /api/partner-signup/claim` route (`app/api/partner-signup/claim/route.ts`, which
*does* have a live browser session on the other end). Auto-generating the passcode inside
`createOrClaimPartnerAccount()` itself would mean it is genuinely unrecoverable/never-shown for every
reseller who signs up via the webhook path (the more common one — Clerk's own `<SignUp>` component
flow) — a silent violation of the write-once-*and*-shown guarantee, not a design that honors it.

**Resolution:** the **20-free-minute grant** is provisioned automatically and immediately at
registration (matches Arun's literal words for the allowance) — added to
`createOrClaimPartnerAccount()`'s existing `if (resolvedAccountKind === 'channel_partner')` block
(the same block that already auto-provisions the "Self (direct sessions)" client,
`lib/partner/signup.ts:103-119`), calling `credit_demo_minutes_balance(account.id, 20)`,
best-effort/non-blocking, same convention as that existing block. The **passcode itself** is generated
lazily, on the reseller's **first visit** to the Settings page's Demo access card (§4.A State A) — a
direct, user-initiated button click on a page they are actively looking at, which is the only point in
either provisioning path that is guaranteed to have a live browser to reveal the plaintext to. This
unifies first-ever generation and regeneration into one code path (`POST
/api/channel-partner/demo-access/regenerate` handles both — "generate" is simply "regenerate when no
active passcode exists yet"), eliminating a second, divergent generation code path. Every existing
reseller account (pre-dating this feature) naturally lands in State A on their first visit post-ship,
which is correct and requires no backfill migration.

**Admin bootstrap:** admin has no "registration" event. `partner_account_id =
'30d40f51-5d6e-49e9-bdda-519b7d70e13a'` ("Clio Internal — Public Demo", per Open Item 2's confirmed
default below) is hardcoded as the target for both admin API routes — there is no discovery step. The
20-minute grant analog for admin is a **one-time data migration statement** in this feature's own
migration file: `SELECT credit_demo_minutes_balance('30d40f51-5d6e-49e9-bdda-519b7d70e13a'::uuid,
20);` — run once, at deploy time, not from application code (mirrors migration 093's own pattern of a
one-off `INSERT ... ON CONFLICT DO NOTHING` for that same account). Admin's passcode is generated the
same lazy, first-click way as a reseller's, on the admin's first visit to the new
`/dashboard/admin/sales-partners` card.

### 6.5 Open Item 2 — admin passcode modeling (confirming CEO's recommended default)

Confirmed as specified: reuse `partner_accounts.id = '30d40f51-5d6e-49e9-bdda-519b7d70e13a'` ("Clio
Internal — Public Demo") as the target account for every admin API route and the one-time migration
grant above. One unified `demo_passcodes` table, non-nullable `partner_account_id` FK for every row
including admin's — no nullable-FK-plus-sentinel-flag design, per the brief's own reasoning, which I
independently verified holds (that account already has a resolvable `partner_admin_users` row linking
Arun's Clerk id, needed for `getPartnerAdminEmails()` to find a recipient for the low-balance email —
confirmed via migration 093's header comment referencing this same prerequisite for its API key).

### 6.6 New attribution table — `demo_dispatches`

```sql
CREATE TABLE IF NOT EXISTS demo_dispatches (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clio_session_ref          UUID NOT NULL UNIQUE REFERENCES partner_sessions(id) ON DELETE CASCADE,
  billed_partner_account_id UUID NOT NULL REFERENCES partner_accounts(id),      -- resolved from the passcode
  demo_passcode_id          UUID NOT NULL REFERENCES demo_passcodes(id),        -- which passcode row was used, for audit
  slug                      TEXT NOT NULL,                                      -- app/demo/_content.ts slug (not a DB FK — mirrors demo_meeting_urls.slug's own precedent)
  demo_minutes_consumed     NUMERIC(10,2),                                      -- filled in at session end
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demo_dispatches_billed_account ON demo_dispatches(billed_partner_account_id, created_at DESC);

ALTER TABLE demo_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on demo_dispatches"
  ON demo_dispatches FOR ALL USING (auth.role() = 'service_role');
```
Written by the dispatch route immediately after a successful `201`/`bot_active` response from
`/api/partner/v1/sessions` (so `clio_session_ref` is known). `ON DELETE CASCADE` on
`clio_session_ref` (not `RESTRICT`) — if a `partner_sessions` row is ever deleted, its attribution
record is meaningless and should go with it (no other table in this codebase treats
`partner_sessions` as append-only-forever; matching the least-surprising default).

### 6.7 New Inngest function — `inngest/demo-dispatch-minutes-consumer.ts`

Listens to the **existing**, already-fired-for-every-session event `clio/partner-session.ended`
(payload `{ partnerSessionId }`, emitted by `emitPartnerSessionEndedEvent()` from all four real
completion paths per B2B-37 — see that file's own doc comment for the full list). This is a pure new
listener; nothing about the emitter or the other three existing listeners on any event changes.

```ts
export const demoDispatchMinutesConsumer = inngest.createFunction(
  { id: 'demo-dispatch-minutes-consumer', name: 'Demo Dispatch Minutes Consumer',
    triggers: [{ event: 'clio/partner-session.ended' }], retries: 3 },
  async ({ event, step }) => {
    const { partnerSessionId } = event.data as { partnerSessionId: string }

    const dispatch = await step.run('check-is-demo-dispatch', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase.from('demo_dispatches')
        .select('id, billed_partner_account_id').eq('clio_session_ref', partnerSessionId).maybeSingle()
      return data
    })
    if (!dispatch) return // the common case — every REAL partner session also fires this event

    const durationMinutes = await step.run('compute-duration', async () => {
      const supabase = createSupabaseAdminClient()
      const { data } = await supabase.from('partner_sessions')
        .select('created_at, ended_at').eq('id', partnerSessionId).maybeSingle()
      if (!data?.ended_at) return 0
      return Math.max(0, (new Date(data.ended_at).getTime() - new Date(data.created_at).getTime()) / 60000)
    })

    if (durationMinutes > 0) {
      await step.run('consume-and-alert', async () => {
        const supabase = createSupabaseAdminClient()
        const { data: newBalance, error } = await supabase.rpc('consume_demo_minutes', {
          p_partner_account_id: dispatch.billed_partner_account_id, p_minutes: durationMinutes,
        })
        if (error) { console.error('[demo-dispatch-minutes-consumer] consume_demo_minutes failed:', error.message); return }
        await checkDemoLowBalanceAndAlert(dispatch.billed_partner_account_id, Number(newBalance))
      })
      await step.run('record-consumed', async () => {
        const supabase = createSupabaseAdminClient()
        await supabase.from('demo_dispatches').update({ demo_minutes_consumed: durationMinutes }).eq('id', dispatch.id)
      })
    }
  },
)
```
**Duration precision note (deliberate, documented tradeoff):** this reconstructs duration from
`partner_sessions.created_at`/`ended_at` wall-clock timestamps rather than the exact
`billed_duration_source` figure the real billing path computes (which isn't stored as a standalone
column, only fed directly into `recordBillableEvent()`'s `quantity` param at call time). For internal
demo-minutes tracking this is acceptable precision (differs by at most a few seconds of
dispatch/webhook latency); it is explicitly not used for any real revenue calculation.

### 6.8 New sibling functions — low-balance alert for demo minutes

`lib/partner/webhooks.ts` — new `checkDemoLowBalanceAndAlert(partnerAccountId, newBalanceMinutes)`,
a sibling of `checkLowBalanceAndAlert()` (not a parameterized shared function — the two compare
different columns, different units (USD vs. minutes), and call different email templates; this
codebase's own convention already prefers small sibling duplicates over parameterizing across
dimensions this different, e.g. `consume_trial_and_test_minutes` existing alongside
`decrement_wallet_balance` rather than one unified function). Identical race-safe mechanics:
```ts
async function checkDemoLowBalanceAndAlert(partnerAccountId: string, newBalanceMinutes: number): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const { data: wallet } = await supabase.from('partner_wallets')
    .select('demo_reference_topup_minutes').eq('partner_account_id', partnerAccountId).maybeSingle()
  const referenceMinutes = wallet?.demo_reference_topup_minutes ? Number(wallet.demo_reference_topup_minutes) : 0
  if (!referenceMinutes) return
  if (newBalanceMinutes > referenceMinutes * 0.2) return
  const { data: won } = await supabase.from('partner_wallets')
    .update({ demo_low_balance_alert_fired_at: new Date().toISOString() })
    .eq('partner_account_id', partnerAccountId).is('demo_low_balance_alert_fired_at', null).select('id').maybeSingle()
  if (!won) return
  const [{ data: account }, emails] = await Promise.all([
    supabase.from('partner_accounts').select('name').eq('id', partnerAccountId).maybeSingle(),
    getPartnerAdminEmails(partnerAccountId),
  ])
  await Promise.all(emails.map((email) =>
    sendDemoLowBalanceAlertEmail(email, account?.name ?? 'your Clio account', newBalanceMinutes, referenceMinutes)
      .catch((err) => console.error('[partner/webhooks] sendDemoLowBalanceAlertEmail failed:', err))))
}
```
No webhook-dispatch-log branch (unlike the real wallet's alert) — demo accounts have no outbound
partner webhook subscription surface; email-only is correct here, not a parity gap.

`lib/delivery/email.ts` — new `sendDemoLowBalanceAlertEmail(toEmail, partnerName, balanceMinutes,
referenceMinutes)`, byte-for-byte the same HTML/text template structure as
`sendLowBalanceAlertEmail()` (same dark theme, same CLIO wordmark, same purple CTA button), with copy
substituted: subject `"Clio demo minutes running low — {partnerName}"`, body `"{partnerName}'s Clio
demo-minutes balance is {balanceMinutes.toFixed(1)} minutes, which has crossed 20% of your last top-up
of {referenceMinutes} minutes."`, CTA link `${appUrl}/dashboard/channel-partner/settings` for a
reseller-shaped account or `${appUrl}/dashboard/admin/sales-partners` for the admin sentinel account
(the function takes an explicit `dashboardPath` param rather than inferring `account_kind` itself, to
keep the email function free of a DB lookup — the caller, which already has `account_kind` available
or can trivially check `partnerAccountId === DEMO_PARTNER_ACCOUNT_ID`, passes it in).

### 6.9 Dispatch route changes — `app/api/demo/[slug]/dispatch/route.ts`

1. Passcode check (replaces the single `verifyDemoPasscode()` call): `const billedAccountId = await
   resolveDemoPasscodeToAccount(parsed.data.passcode); if (!billedAccountId) return 401
   incorrect_passcode` (same error shape/code as today — visitor-facing behavior is unchanged; only
   the server-side resolution mechanism changed).
2. Auto-top-up safety valve (§6.3) runs next, unconditionally, on the fixed
   `DEMO_PARTNER_ACCOUNT_ID` — unrelated to which passcode was entered.
3. Outbound call to `/api/partner/v1/sessions` is **unchanged**: still authenticated with
   `DEMO_PARTNER_API_KEY`, still the fixed internal account. (This is the Flagged Decision above.)
4. On a successful `201`/`bot_active` response, insert the `demo_dispatches` row: `{
   clio_session_ref: upstreamBody.clio_session_ref, billed_partner_account_id: billedAccountId,
   demo_passcode_id: <id from the resolve step — resolveDemoPasscodeToAccount should return the row id
   alongside partner_account_id>, slug: params.slug }`. Best-effort — log and proceed on insert failure
   (never blocks the visitor from getting their already-successful dispatch response; worst case is a
   demo session that isn't attributed to anyone's balance, an acceptable, non-blocking failure mode
   matching this file's existing fire-and-forget conventions elsewhere).

## 7. Success Criteria (Acceptance Tests)

✓ AT-1: Given a `channel_partner` account visits Settings for the first time, when they click
"Generate passcode", then a `demo_passcodes` row is created for their `partner_account_id`, the
plaintext passcode is returned exactly once in the API response, and a subsequent `GET
/api/channel-partner/demo-access` never includes the plaintext anywhere in its response.

✓ AT-2: Given an account with an active passcode, when they click "Regenerate" and confirm, then the
old `demo_passcodes` row gets `revoked_at` set (not deleted), a new row is created and becomes the
sole active row (partial-unique-index enforced), and a demo dispatch attempted with the OLD passcode
immediately returns `401 incorrect_passcode`.

✓ AT-3: Given a demo bot session was already dispatched and is actively running when its passcode is
regenerated, then that in-progress session is completely unaffected — no code path re-checks the
passcode after initial dispatch (verified: the passcode is checked once, in step 1 of `POST
.../dispatch`, and never referenced again by any session-lifecycle code).

✓ AT-4: Given a reseller's passcode resolves to `partner_account_id = X` at dispatch time, when the
resulting session runs for `N` minutes and ends, then `partner_wallets.demo_minutes_balance` for
account `X` decreases by `N` (via `consume_demo_minutes`), and neither `trial_minutes_used` nor
`test_minutes_balance` for account `X` change at all (regression-checkable: those two columns for
account `X` are read before and after the test and must be byte-identical).

✓ AT-5: Given the fixed "Clio Internal — Public Demo" account's `trial_minutes_used`/
`test_minutes_balance` combine to less than 30 available minutes, when any demo dispatch (any
passcode) is attempted, then the auto-top-up safety valve credits 500 minutes to that account via
`credit_test_minutes_balance` before the outbound call, and the dispatch succeeds instead of returning
`trial_exhausted`.

✓ AT-6: Given a brand-new `channel_partner` account is provisioned (either the webhook path or
`/api/partner-signup/claim`), then `partner_wallets.demo_minutes_balance = 20` and
`demo_reference_topup_minutes = 20` for that account immediately, with no passcode row created yet
(`has_passcode: false` from `GET /api/channel-partner/demo-access`).

✓ AT-7: Given an account's `demo_minutes_balance` drops to ≤20% of `demo_reference_topup_minutes` for
the first time in a depletion cycle, then exactly one `sendDemoLowBalanceAlertEmail` call fires (race
tested with two concurrent session-end events); given a second session end later further depletes the
balance in the same cycle, no second email fires; given a top-up (paid or, in a re-test scenario, a
fresh grant) then lands, `demo_low_balance_alert_fired_at` resets to `NULL` and a subsequent
re-depletion below threshold fires exactly one more email.

✓ AT-8: Given each of the 7 top-up tiers, when `POST .../billing/demo-topup` is called with that
tier's key, then a Stripe Checkout session is created with the tier's exact price (§6 pricing table)
in `payment` mode, and given its `checkout.session.completed` webhook fires, then
`demo_minutes_balance` increases by exactly that tier's minutes and `demo_reference_topup_minutes` is
set to that tier's minutes (not added cumulatively to the prior reference value).

✓ AT-9: Given an account's `demo_minutes_balance` is already at 0, when a new demo dispatch using that
account's passcode is attempted, then the dispatch still succeeds (no hard block) — confirming the
deliberate no-hard-block design decision in §6.3.

✓ AT-10: Given a direct (`account_kind='partner'`) account (not the admin sentinel, not a
`channel_partner`), then: (a) no `demo_passcodes` row can exist for it (nothing in this feature's code
paths ever creates one for that `account_kind`), (b) neither `/dashboard/channel-partner/settings` nor
`/dashboard/admin/sales-partners` demo-access UI is reachable/relevant to it, and (c) a direct call to
any of the six new API routes on behalf of that account's id is rejected — `requirePartnerAdmin`/
`getChannelPartnerAccountForClerkUser`-style checks on the reseller routes already 403/404 a non-
`channel_partner` caller by construction (they resolve the account from the Clerk session's own
membership, which for a direct-partner user never yields a `channel_partner` row); the admin routes
are `requireSuperAdmin()`-gated and hardcoded to the one sentinel account id, so no `account_id`
parameter exists for a caller to redirect elsewhere in the first place.

## 8. Error States

- **Regenerate/generate API fails** (any Supabase error): `500 { error: { code: 'internal_error',
  message: "Couldn't generate a passcode. Try again." } }`; client shows a red inline error below the
  button, button re-enables, no modal opens.
- **Copy-to-clipboard fails** (`navigator.clipboard` unavailable/denied): the plaintext remains
  selectable/visible in the modal's text field regardless (it's a real `<input readOnly>`, not just
  styled text) — the visitor can select-and-copy manually; the "Copy" button shows no flash and logs a
  console warning only, never blocks the "I've saved this" flow.
- **Demo top-up checkout-session creation fails** (Stripe error, mirrors `createTestBlockCheckoutSession`'s
  own guard): `502 { error: { code: 'stripe_error', message: 'Failed to create checkout session.' }
  }`; modal shows an inline red error, stays open so the visitor can retry tier selection.
- **`consume_demo_minutes` RPC fails** at session end: logged
  (`console.error('[demo-dispatch-minutes-consumer] consume_demo_minutes failed:', ...)`), function
  step does not retry indefinitely (the `retries: 3` Inngest-level retry already covers transient
  failures) — a persistent failure means that one session's minutes are never deducted, a silent,
  accepted, non-blocking gap matching every other "non-fatal, logged" convention already used
  throughout `lib/partner/webhooks.ts` and `live-render.ts` for billing-adjacent side effects.
- **Auto-top-up safety valve RPC fails**: logged, dispatch proceeds anyway — worst case is the exact
  pre-existing `trial_exhausted` failure mode from before this feature, not a new regression.
- **`demo_dispatches` insert fails** after a successful real dispatch: logged, the visitor still gets
  their working demo (the bot still joined) — only the billing attribution for that one session is
  lost, non-blocking per §6.9 point 4.
- **A visitor enters an incorrect/revoked passcode**: identical to today — `401 { error: { code:
  'incorrect_passcode', message: 'Incorrect passcode.' } }`, generic message (does not distinguish
  "never existed" from "revoked" from "wrong account" — same fail-closed, non-leaking posture the
  existing `verifyDemoPasscode()` already has).

## 9. Edge Cases

- **Two devices click "Regenerate" for the same account within the same second**: the partial unique
  index (`idx_demo_passcodes_active_per_account`) means the second `INSERT` after the first's
  `UPDATE ... revoked_at` would still succeed only if the first transaction's revoke committed first;
  implementation must revoke-then-insert as two statements in the same request handler (not a single
  atomic RPC in this spec's design — acceptable, since this is a rare, low-stakes double-click race
  with no data-loss consequence: worst case, the loser's request gets a unique-violation error and the
  client shows the generic error state above, user just clicks Regenerate again).
- **Demo minutes balance runs negative-looking in the UI** (should never happen — `consume_demo_minutes`
  floors at 0 via `GREATEST(0, ...)` — but if it somehow did, the progress bar in §4.A clamps its fill
  percentage to `Math.max(0, Math.min(100, ...))` defensively).
- **Admin visits their own demo-access card before the one-time migration grant has run** (deploy
  ordering edge case): `demo_minutes_balance` reads as `0`/`demo_reference_topup_minutes` as `null`
  until the migration runs — card shows State A (no passcode) correctly regardless, since passcode
  existence and balance are independent reads; no crash, just a temporarily-zero balance display until
  migration completion, which is a one-time deploy-time event, not a recurring runtime state.
- **A reseller with zero demo dispatches ever** never triggers the Inngest consumer at all — no row in
  `demo_dispatches`, balance stays at 20 (or whatever they've topped up) indefinitely. Correct, no
  special-case needed.
- **Mobile viewport** (per standing responsive rule): the reveal modal and buy-minutes modal both use
  `width: min(92vw, 420px)` (§5) so neither overflows a phone screen; the Settings page's new card
  stacks full-width below the existing two cards exactly as `Card` components already do on that page
  today (no new stacking behavior introduced).
- **A reseller who never regenerates** keeps the exact same passcode indefinitely — no forced
  rotation/expiry exists anywhere in this spec, matching the CEO brief's silence on any such
  requirement (regeneration is entirely voluntary/user-initiated).

## 10. Out of Scope

- The Meeting tab's existing "Save meeting URL" action (`lib/demo/passcode.ts`'s `verifyDemoPasscode()`
  / the single `DEMO_MEETING_PASSCODE` env var) is **completely untouched** by this feature and
  continues to gate content-authoring access exactly as it does today. This is a deliberate scope
  boundary, not an oversight: conflating the two would mean every reseller's own demo-billing passcode
  also unlocks editing the meeting URL for every demo topic — a real security/scope expansion never
  requested and explicitly dangerous. The two passcode systems (`lib/demo/passcode.ts` vs. the new
  `lib/demo/passcode-accounts.ts`) must remain permanently separate files/mechanisms.
- No forced passcode rotation, expiry, or complexity requirements beyond the fixed 10-character format.
- No admin ability to view or regenerate a *reseller's* passcode on the reseller's behalf from the
  admin dashboard — each account only ever manages its own passcode. (Not requested; would also
  conflict with the "no view-current-passcode capability for anyone, including the account owner"
  constraint in an even stronger way for a non-owner.)
- No change to `client_id` / `owning_channel_partner_id` semantics, B2B-34's session schema, or any
  other part of the real, partner-facing `POST /api/partner/v1/sessions` contract.
- No refund/proration logic for demo top-up purchases.
- No usage-history/audit UI for `demo_dispatches` — it exists purely as an internal attribution
  mechanism for this feature's own billing math; no dashboard reads it directly (mirrors B2B-38's own
  "logging table, no dashboard yet" posture for its adjacent new table).
- Final, non-provisional pricing for the 7 top-up tiers — explicitly deferred to the still-open F-02
  backlog item once real COGS data lands, per the CEO brief's own explicit provisional-pricing
  authorization.
- Coordinating this feature's `POST /api/partner/v1/sessions` outbound payload change for B2B-38's
  future mandatory `reseller_id` field beyond the one-line note in §12 below — the actual code change
  is B2B-38's (or a small follow-up's) responsibility once B2B-38 ships, not built here.

## 11. Open Questions

None. Every ambiguity identified in the CEO brief (Open Items 1-3, Questions 1-9) is resolved above
with a concrete decision. Open Item 3 specifically deviates from the CEO brief's own recommended
default for a substantive, verified technical reason — see the Flagged Decision section at the top of
this document, which the CEO Agent should review explicitly before development starts, even though
this section itself is empty per this project's governance convention (an unresolved *question* is
different from a resolved decision the CEO should still sanity-check).

## 12. Dependencies

- **B2B-38 (session traceability IDs)** — not a build blocker (this feature's dispatch route
  authentication is unchanged per the Flagged Decision, so it has no hard sequencing dependency on
  B2B-38 landing first or after). The one required follow-up once B2B-38 ships: the dispatch route's
  outbound request body to `/api/partner/v1/sessions` must add `reseller_id:
  process.env.DEMO_PARTNER_ACCOUNT_ID` — a one-line addition, always the same fixed value regardless of
  which passcode was entered (since the outbound call always authenticates as the fixed internal
  account, per this doc's central design decision). This resolves the CEO brief's own flagged
  cross-reference concern: there is no real sequencing hazard between the two features, in either ship
  order, because B2B-39 never changes who the outbound call authenticates as.
- **Migration numbering**: highest existing migration at spec-writing time is `098`. This feature's
  migration (`demo_passcodes`, `demo_dispatches`, `partner_wallets` additive columns, two new RPCs, one
  `wallet_ledger.entry_type` CHECK-constraint addition for `'demo_topup_purchase'`, one new nullable
  `wallet_ledger.resulting_demo_minutes_balance` column, and the one-time admin 20-minute-grant data
  statement) should be `099_b2b39_demo_passcodes_and_billing.sql` — **confirm against the actual repo
  state at build time**, since B2B-38 (developed in parallel, per this session's other active BA/CEO
  agents) may also claim `099`; whichever of the two lands first in `main` keeps `099`, the other
  becomes `100`. No other coordination is needed between the two migrations — they touch disjoint
  tables/columns.
- **Stripe**: no new product/price objects need to be pre-created in the Stripe dashboard — the demo
  top-up checkout function uses ad-hoc `price_data` line items (mirroring
  `createTestBlockCheckoutSession`'s own pattern), not pre-created Stripe Price IDs, so no env-var
  additions are required for this feature to function end-to-end, including in a placeholder/mock
  Stripe environment (the existing `isPlaceholder`/mock-URL guard pattern in `lib/stripe.ts` covers it
  automatically once the new function is added following that file's existing convention).
- **`lib/partner/webhooks.ts` and `lib/delivery/email.ts` changes** (new sibling functions) must land
  in the same PR/deploy as the Inngest consumer — the consumer calls
  `checkDemoLowBalanceAndAlert()` directly.
- **No dependency on B2B-31/32/33's "showcase" tooling** — confirmed distinct, per the CEO brief's own
  explicit warning not to confuse `app/dashboard/channel-partner/showcase` (private content-authoring
  preview tool) with this feature's new Demo access card, which lives on the separate `settings` route.
