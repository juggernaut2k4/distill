# Paid ($10) Demo-Passcode Flow — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-09-05

---

## 1. Purpose

Today, a visitor who is already convinced enough about Clio to want proof has exactly one path: join
the just-shipped waitlist and wait for Arun to reach out. There is no way for a high-intent visitor to
get a real, interactive look at Clio right now, and no way to monetize or filter for seriousness among
that audience. Without this feature, every convinced visitor is funneled into the same low-friction,
low-commitment waitlist as a merely-curious one — Arun has no signal to separate the two, and no
revenue from the segment that would pay to see more.

This feature sells a real interactive demo session (not a static page — the existing Widget Demo
mechanics) for a flat $10, gates it behind a passcode usable exactly twice with no expiry, emails the
passcode immediately on payment, and gives Arun a full audit trail of who redeemed it and when.

## 2. User Story

As a **high-intent website visitor**,
I want to pay a small, one-time fee to unlock a real interactive AI teaching session with Clio,
so that I can evaluate the product myself instead of waiting on a waitlist or taking someone else's
word for it.

As **Arun (admin)**,
I want every $10 demo purchase to generate a two-use passcode, emailed instantly, with every
redemption logged (who and when),
so that I can see real usage of this paid demo channel without doing anything manually.

There is no reseller/partner-facing story change — this flow is a wholly public, unauthenticated
surface layered onto the existing `/demo/[slug]` Widget Demo tab; no `channel_partner` or `partner`
account is created, billed, or otherwise touched by a public buyer's purchase or redemption.

## 3. Trigger / Entry Point

**New homepage CTA** (public, unauthenticated):
- Lives in `app/(with-clerk)/(marketing)/page.tsx`, as a small, secondary section placed immediately
  after the just-shipped `WaitlistSection` (`id="waitlist"`) and before `BottomCTA` — mirrors that
  section's own placement pattern (a `<section>` between two existing named sections), but visually
  subordinate (smaller heading, no full-bleed background treatment) so it never competes with the
  waitlist for primary attention, per Known Constraint 4.
- Triggered by a button click ("See the demo for $10") that calls
  `POST /api/public-demo-passcode/checkout` and redirects the browser to the returned Stripe Checkout
  URL (`window.location.href`) — no page navigation before that; the click handler lives in a new
  client component, `components/marketing/PublicDemoPasscodeCTA.tsx`.
- No login/onboarding state required — fully public, same as the waitlist section next to it.

**Stripe Checkout** (external, hosted by Stripe):
- `mode: 'payment'`, a single pre-created Stripe Price (`STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID`), $10
  flat. Stripe's own hosted email-collection field on the Checkout page captures the buyer's email
  (`customer_creation: 'always'`, mirroring `createTestBlockCheckoutSession`'s existing pattern) — no
  custom pre-payment form is built.
- On success, redirects to `${appUrl}/?public_demo_passcode=success` (the homepage, so the CTA section
  is visible again with a confirmation line — see §4.A State C). On cancel, redirects to
  `${appUrl}/?public_demo_passcode=cancelled`.

**Stripe webhook** (`checkout.session.completed`, `session.metadata?.purpose === 'public_demo_passcode'`):
- Generates the passcode, inserts the `public_demo_passcodes` row, and sends the passcode-delivery
  email — see §6.3–§6.5. This, not the success-URL redirect, is the actual point of passcode issuance
  (the redirect is just where the buyer's browser lands; the buyer's real confirmation is the email,
  which per Known Constraint arrives "immediately" via the webhook, independent of whether the browser
  is still open — see §9 "buyer closes tab mid-checkout").

**Redemption entry point** (existing, extended): the Widget Demo tab's existing passcode prompt on
`/demo/[slug]` (any topic in the public catalog — `app/(demo)/demo/_content.ts`'s `DEMO_TOPICS`,
currently `claude-ai` and `oop-fundamentals`, buyer's free choice, per Known Constraint 1). No new UI —
see §4.B for the precise (lack of) visual difference.

**New/changed API routes:**

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `app/api/public-demo-passcode/checkout/route.ts` | POST | none (public) | Creates the $10 Stripe Checkout session |
| `app/api/webhooks/stripe/route.ts` | (existing route, new branch) | Stripe signature | Issues the passcode + sends email on `checkout.session.completed` |
| `app/api/demo/[slug]/widget-dispatch/route.ts` | POST | passcode (existing) | **Changed** — now also resolves the new public-buyer passcode model |
| `app/api/admin/public-demo-passcodes/route.ts` | GET | `requireSuperAdmin()` | Lists issued passcodes + redemption log for the admin page |

## 4. Screen / Flow Description

### 4.A Homepage — new "Already convinced?" CTA section

New component `components/marketing/PublicDemoPasscodeCTA.tsx`, rendered from a new
`PublicDemoPasscodeSection()` function in `app/(with-clerk)/(marketing)/page.tsx`, placed directly
after `<WaitlistSection />` and before `<BottomCTA />`. Uses the same `#080808`/`#0a0a0a` alternation
discipline the surrounding sections already follow (`WaitlistSection` is `#080808`, so this section
uses `#0a0a0a` to keep the visual rhythm), and the same `Card` component the waitlist form sits inside.
Deliberately smaller type scale than `WaitlistSection`'s `text-3xl md:text-5xl` heading — this section
uses `text-xl md:text-2xl` — and no icon/illustration, so it reads as a secondary, single-purpose
strip, not a second hero moment, per Known Constraint 4.

**State A — default (no query param):**
```
┌─────────────────────────────────────────────────────┐
│  Already convinced? See the demo for $10.             │
│                                                       │
│  A real, live 15-minute session with Clio — not a     │
│  recording. Your passcode works twice and never       │
│  expires.                                             │
│                                                       │
│  [PRIMARY BUTTON: "See the demo — $10"]                │
└─────────────────────────────────────────────────────┘
```
Exact copy — heading: `"Already convinced? See the demo for $10."`; body:
`"A real, live session with Clio — not a recording. Your passcode works twice and never expires."`;
button: `"See the demo — $10"`. The **"works twice and never expires" callout is inline in this body
copy**, visible before any payment step, satisfying Known Constraint 4's explicit pre-payment
disclosure requirement — it is not a separate line or tooltip, it is baked into the one sentence of
body copy so it cannot be missed or omitted by accident.

**Clicking "See the demo — $10"** disables the button (label changes to `"Redirecting…"`) and calls
`POST /api/public-demo-passcode/checkout` with an empty body. On success
(`{ checkout_url: string }`), `window.location.href = data.checkout_url`. On failure, the button
re-enables and a red inline line appears below it: `"Couldn't start checkout. Try again."`

**State B — returned from Stripe with `?public_demo_passcode=cancelled`:** identical to State A — no
message shown, matching this codebase's existing silent-cancel convention (§4.C precedent in
`docs/specs/B2B-39-requirement-document.md`, same pattern this spec's own webhook/checkout code
otherwise follows). The query param is stripped from the URL via `router.replace` on mount so a page
refresh doesn't re-show any transient state (there is none to re-show, but this keeps the URL clean).

**State C — returned from Stripe with `?public_demo_passcode=success`:** State A's card, with a green
confirmation line inserted between the body copy and the button:
```
┌─────────────────────────────────────────────────────┐
│  Already convinced? See the demo for $10.             │
│                                                       │
│  A real, live session with Clio — not a recording.     │
│  Your passcode works twice and never expires.          │
│                                                       │
│  ✓ Check your email for your passcode.                 │
│                                                       │
│  [PRIMARY BUTTON: "See the demo — $10"]                │
└─────────────────────────────────────────────────────┘
```
Exact copy: `"✓ Check your email for your passcode."` The button remains active and unchanged — a
buyer is free to purchase a second passcode for a different session if they want (no purchase-limiting
logic anywhere in this spec; out of scope, see §10). Query param stripped the same way as State B.

### 4.B Widget Demo tab — passcode prompt (extended, not rebuilt)

**No visual difference whatsoever.** The existing passcode input, "Start widget session" button, and
error-message rendering in `DemoTopicClient.tsx`'s `'Widget Demo'` tab (lines ~780–836 of that file,
the `widgetShowPasscode` block) are **completely unchanged** — same input, same placeholder
`"Passcode"`, same button label, same `Enter`-to-submit handler, same generic
`"Incorrect passcode."` error text on failure. A public buyer's passcode and a reseller/admin's own
demo-billing passcode (from `docs/specs/B2B-39-requirement-document.md`) are typed into the exact same
field; the server alone tells them apart (§6.6). This is explicitly confirmed here per the CEO brief's
own instruction to state plainly when there is no UI difference — there is none.

The only behavioral difference a public buyer might notice, and only in a genuine edge case: if they
try to redeem a passcode that has already been used twice, they see the same generic
`"Incorrect passcode."` message a wrong-passcode entry would show (§8, §9 — a deliberate,
documented decision, not an oversight).

### 4.C Admin — new "Public demo passcodes" page

New route `/dashboard/admin/public-demo-passcodes`, modeled directly on
`/dashboard/admin/waitlist` (`WaitlistClient.tsx` — flat list, no bells and whistles, per Known
Constraint 7's explicit instruction). Two files:
`app/(with-clerk)/dashboard/admin/public-demo-passcodes/page.tsx` (byte-identical gate pattern to
`waitlist/page.tsx` — `currentUser()` → redirect if absent, `requireSuperAdmin()` → `notFound()` if not
admin, wraps `PublicDemoPasscodesClient` in `DashboardShell` with
`activeNav="/dashboard/admin/public-demo-passcodes"`) and
`app/(with-clerk)/dashboard/admin/public-demo-passcodes/PublicDemoPasscodesClient.tsx` ('use client').
Linked from the admin index (`app/(with-clerk)/dashboard/admin/page.tsx`'s nav-card array, which
`waitlist` is already registered in at line 42) with a new entry:
`{ href: '/dashboard/admin/public-demo-passcodes', icon: Ticket, title: 'Public demo passcodes',
description: 'Every $10 demo purchase and passcode redemption.' }` (`Ticket` — a `lucide-react` icon
not otherwise used on this page, chosen for a purchase/access-code connotation consistent with the
`Users` icon `waitlist` already uses for its own semantic fit).

On load, `GET /api/admin/public-demo-passcodes` returns:
```json
{
  "passcodes": [
    { "id": "…", "buyer_email": "jane@acme.com", "purchased_at": "2026-09-05T14:03:00Z",
      "uses_remaining": 1, "uses_total": 2 }
  ],
  "redemptions": [
    { "id": "…", "buyer_email": "jane@acme.com", "redeemed_name": "Jane", "slug": "claude-ai",
      "redeemed_at": "2026-09-05T14:22:00Z" }
  ]
}
```
Two stacked flat lists inside the page, each in its own `bg-[#111111] border border-[#222222]
rounded-xl p-4 md:p-6` panel (mirrors `WaitlistClient.tsx`'s own single-panel styling, repeated
twice), most-recent-first:

```
┌─────────────────────────────────────────────────────┐
│  ← Back to Admin                                      │
│  🎫 Public demo passcodes                              │
│  Every $10 demo purchase and passcode redemption.       │
│                                                       │
│  Passcodes issued                                     │
│  ┌───────────────────────────────────────────────┐   │
│  │ jane@acme.com   Sep 5, 2026   1 / 2 uses left   │   │
│  │ bob@corp.io      Sep 4, 2026   0 / 2 uses left   │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  Redemptions                                          │
│  ┌───────────────────────────────────────────────┐   │
│  │ Jane (jane@acme.com)   claude-ai   Sep 5, 2:22pm │   │
│  │ Bob (bob@corp.io)      oop-fundamentals  Sep 4…  │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```
No delete action on either list (unlike `WaitlistClient.tsx`'s per-row delete) — deleting a passcode
or redemption record is not requested anywhere in the CEO brief and would only remove Arun's own audit
trail, the opposite of this feature's purpose; explicitly out of scope (§10). Empty-state copy per
list: `"No demo passcodes purchased yet."` / `"No redemptions yet."` — same `text-[#475569] text-sm
py-4` treatment `WaitlistClient.tsx` uses for its own empty state. Loading/error states identical in
wording and styling to `WaitlistClient.tsx`'s (`"Loading…"` / `"Couldn't load — try refreshing."`
pattern), applied independently to each of the two lists (a failure loading one does not block
rendering the other — both come from the same single `GET` call in this design, so in practice they
succeed or fail together, but the two `loading`/`error` UI states are kept structurally independent in
the component in case a future change splits them into separate calls).

## 5. Visual Examples

Wireframes are inline in Section 4 above — one per distinct screen state (homepage CTA default state,
success-return state, admin page). Per the standing responsive/mobile-friendly-by-default rule: the
new homepage CTA section uses the same `max-w-2xl mx-auto px-4 md:px-6` fluid container
`WaitlistSection` already uses (matching its immediate neighbor exactly, not inventing a new
breakpoint scheme); the admin page uses the same `max-w-6xl mx-auto` fluid container
`WaitlistClient.tsx` already uses, and both list panels stack full-width on narrow viewports with no
fixed pixel-width caps, identical to that file's existing row-stacking behavior. The Widget Demo tab's
passcode prompt is untouched (§4.B), so it inherits whatever responsive behavior it already has —
no new responsive work is needed there since no markup changes.

## 6. Data Requirements

### 6.1 New table — `public_demo_passcodes`

```sql
CREATE TABLE IF NOT EXISTS public_demo_passcodes (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passcode_hash               TEXT NOT NULL UNIQUE,   -- SHA-256 hex digest, only form ever persisted
  passcode_prefix             TEXT NOT NULL,           -- first 4 chars, display-safe only (admin diagnostics)
  buyer_email                 TEXT NOT NULL,           -- from Stripe Checkout's own email collection
  uses_remaining              SMALLINT NOT NULL DEFAULT 2 CHECK (uses_remaining >= 0),
  stripe_checkout_session_id  TEXT NOT NULL UNIQUE,    -- webhook idempotency key for this table
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_public_demo_passcodes_created_at ON public_demo_passcodes(created_at DESC);

ALTER TABLE public_demo_passcodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on public_demo_passcodes"
  ON public_demo_passcodes FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public_demo_passcodes IS
  'DEMO-PASSCODE-01: a wholly separate, lightweight passcode model for public $10 demo buyers —
  exactly-2-uses, no expiry, no partner_account_id, no minutes balance. Deliberately NOT an extension
  of demo_passcodes (B2B-39), which is minutes-balance-based and rooted in partner_accounts. Resolved
  at dispatch time by lib/demo/public-buyer-passcode.ts, tried only after the B2B-39 reseller passcode
  model fails to match (app/api/demo/[slug]/widget-dispatch/route.ts).';
```
No `revoked_at`/regeneration concept exists for this table — a public buyer's passcode is never
regenerated (no dashboard, no owning account to regenerate it from); it simply lives until its two
uses are spent, then stays in the table forever as a spent record (never deleted — the admin list is
the permanent audit trail, per §10).

### 6.2 New table — `public_demo_passcode_redemptions`

```sql
CREATE TABLE IF NOT EXISTS public_demo_passcode_redemptions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passcode_id       UUID NOT NULL REFERENCES public_demo_passcodes(id) ON DELETE CASCADE,
  redeemed_name     TEXT NOT NULL,     -- the name typed into the Widget Demo tab's existing "Name" field
  slug              TEXT NOT NULL,     -- app/demo/_content.ts slug (not a DB FK — mirrors demo_dispatches.slug's own precedent)
  clio_session_ref  UUID REFERENCES partner_sessions(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_public_demo_passcode_redemptions_passcode ON public_demo_passcode_redemptions(passcode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_demo_passcode_redemptions_created_at ON public_demo_passcode_redemptions(created_at DESC);

ALTER TABLE public_demo_passcode_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on public_demo_passcode_redemptions"
  ON public_demo_passcode_redemptions FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public_demo_passcode_redemptions IS
  'DEMO-PASSCODE-01: one row per successful public-buyer widget-demo redemption — who (redeemed_name,
  correlated to the owning passcode''s buyer_email via passcode_id) and when. Written by
  app/api/demo/[slug]/widget-dispatch/route.ts immediately after a successful dispatch. ON DELETE
  SET NULL on clio_session_ref (not CASCADE) — unlike demo_dispatches, this row is Arun''s permanent
  audit record and must survive even if the underlying partner_sessions row is ever cleaned up.';
```
`ON DELETE SET NULL` (not `CASCADE`, deliberately diverging from `demo_dispatches`'s own precedent in
§6.6 of `docs/specs/B2B-39-requirement-document.md`): that table is described there as "internal-only
... no dashboard reads it," whereas this table's entire purpose is to be Arun's durable, admin-visible
audit trail (Known Constraint 7) — it must outlive the session row it references, not disappear with
it.

Migration file: `supabase/migrations/119_demo_passcode01_public_buyer_passcodes.sql`, containing both
tables above. Highest existing migration at spec-writing time is `118_waitlist01_signups.sql` — `119`
is confirmed free; re-verify against the actual repo state at build time in case a parallel feature
also claims `119` (same coordination note `docs/specs/B2B-39-requirement-document.md` §12 uses for its
own numbering).

### 6.3 New file — `lib/demo/public-buyer-passcode.ts`

Deliberately its own file, never merged into `lib/demo/passcode-accounts.ts` (Known Constraint 2 — the
two models must stay structurally separate; a public buyer's table has no `partner_account_id` at all,
so a shared function signature would need to fake one). Mirrors that file's hashing/generation
*discipline* only (format, SHA-256-hash-at-rest, plaintext-shown-once), not its code:

```ts
export interface GeneratedPublicDemoPasscode {
  passcode: string        // plaintext, e.g. "XK7P-4QRT9M" — returned to the caller exactly once
  passcodeHash: string    // SHA-256 hex digest of the passcode WITH hyphen stripped — only persisted form
  passcodePrefix: string  // first 4 chars, display-safe only
}

/** Same 31-symbol alphabet / 10-char / XXXX-XXXXXX format as lib/demo/passcode-accounts.ts's
 *  generateDemoPasscode() — mirrors that file's format discipline, not its code. */
export function generatePublicDemoPasscode(): GeneratedPublicDemoPasscode { /* crypto.randomInt-based, per B2B-39's own format */ }

/** Same normalization as hashDemoPasscode() — strips whitespace/hyphens, uppercases, SHA-256 hex. */
export function hashPublicDemoPasscode(candidate: string): string { /* … */ }

export interface ResolvedPublicDemoPasscode {
  id: string
  buyerEmail: string
  usesRemaining: number
}

/**
 * Read-only lookup: `public_demo_passcodes WHERE passcode_hash = hashPublicDemoPasscode(candidate)
 * AND uses_remaining > 0`. Returns null both for "no such passcode" and "passcode exists but is
 * already fully spent" — deliberately indistinguishable to the caller, matching this feature's own
 * fail-closed, non-leaking error posture (§8). Used only by the widget-dispatch route, as the SECOND
 * resolution attempt after resolveDemoPasscodeToAccount() (the B2B-39 reseller model) returns null.
 */
export async function resolvePublicDemoPasscode(candidate: string): Promise<ResolvedPublicDemoPasscode | null> { /* … */ }

/**
 * Atomically decrements uses_remaining by 1, floored at 0 by the WHERE clause (never goes negative):
 * `UPDATE public_demo_passcodes SET uses_remaining = uses_remaining - 1 WHERE id = $1 AND
 * uses_remaining > 0 RETURNING uses_remaining`. Returns the new uses_remaining, or null if the row
 * was already at 0 (a race — see §9). Called ONLY after a successful upstream widget-session dispatch
 * (§6.6 step 3) — a passcode's use is spent by a session that actually happened, not merely by
 * passing the auth check.
 */
export async function consumePublicDemoPasscodeUse(passcodeId: string): Promise<number | null> { /* … */ }
```

### 6.4 New Stripe function — `lib/stripe.ts`

New exported function `createPublicDemoPasscodeCheckoutSession(buyerEmailHint?: string, successUrl?:
string, cancelUrl?: string): Promise<string>`, added alongside the existing checkout-session
functions, following `createPlanSubscriptionCheckout()`'s pattern (a real, pre-created Stripe Price
resolved from an env var — **not** `createTestBlockCheckoutSession`'s ad-hoc `price_data` pattern),
per Known Constraint 6's explicit "price ID must come from an env var, never inlined" requirement:

```ts
export async function createPublicDemoPasscodeCheckoutSession(
  successUrl?: string,
  cancelUrl?: string
): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const resolvedSuccess = successUrl ?? `${appUrl}/?public_demo_passcode=success`
  const resolvedCancel = cancelUrl ?? `${appUrl}/?public_demo_passcode=cancelled`

  const priceId = process.env.STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID
  const priceIdIsPlaceholder = !priceId || priceId.startsWith('PLACEHOLDER_')

  if (isPlaceholder || !stripeClient || priceIdIsPlaceholder) {
    console.log('[MOCK] createPublicDemoPasscodeCheckoutSession')
    return `${appUrl}/?mock_public_demo_passcode=1`
  }

  const session = await stripeClient.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_creation: 'always',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { purpose: 'public_demo_passcode' },
    success_url: resolvedSuccess,
    cancel_url: resolvedCancel,
  })

  if (!session.url) throw new Error('Stripe did not return a checkout URL for the public demo passcode session.')
  return session.url
}
```
New env var: `STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID=PLACEHOLDER_STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID` in
`.env.local.example`, following the exact `STRIPE_PLAN_STARTER_MONTHLY_PRICE_ID`-style naming
convention already used by `lib/billing/plan-tiers.ts`'s two tiers. Test mode now (Arun creates the
real test-mode Price himself and sets the env var); flipping to a live-mode Price ID later is purely an
env-var value swap — no code change, satisfying Known Constraint 6's "do not hardcode anything that
would block that switch."

Buyer email is read from `session.customer_details?.email` at webhook time (Stripe's own hosted
Checkout email-collection field, populated automatically because `customer_creation: 'always'` forces
Stripe to require and capture it) — not `session.customer_email` (only populated if the caller
pre-fills it, which this flow deliberately does not, since the buyer has no prior account/session to
pre-fill it from).

### 6.5 New Stripe webhook branch — `app/api/webhooks/stripe/route.ts`

New branch inside the existing `case 'checkout.session.completed':` block, added after the
`demo_topup_purchase` branch and before the `plan_subscription` branch (grouping with the other two
one-time-`payment`-mode branches, ahead of the `subscription`-mode ones), following the exact
idempotency-check-before-acting structure every other branch in that switch already uses — modeled on
`test_block_purchase`'s structure per Known Constraint 6, but writing to the two new tables above
instead of `wallet_ledger`/`partner_wallets` (this buyer has no partner account, so neither table is
touched at all — a stronger form of the same "does not write to wallet_ledger" instruction Known
Constraint 6 gives):

```ts
// ── DEMO-PASSCODE-01 — public $10 demo-passcode purchase (mode: "payment") ─────────
if (session.metadata?.purpose === 'public_demo_passcode') {
  const buyerEmail = session.customer_details?.email
  if (!buyerEmail) {
    console.warn('[stripe-webhook] public_demo_passcode checkout.session.completed missing buyer email:', session.id)
    break
  }

  // Idempotency — mirrors walletLedgerAlreadyRecorded()'s role, but this feature has no
  // wallet_ledger row to check; the natural idempotency key here is the UNIQUE
  // stripe_checkout_session_id column on public_demo_passcodes itself.
  const { data: existing } = await supabase
    .from('public_demo_passcodes')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .maybeSingle()
  if (existing) break

  const generated = generatePublicDemoPasscode()
  const { error: insertError } = await supabase.from('public_demo_passcodes').insert({
    passcode_hash: generated.passcodeHash,
    passcode_prefix: generated.passcodePrefix,
    buyer_email: buyerEmail,
    stripe_checkout_session_id: session.id,
  })
  if (insertError) {
    console.error('[stripe-webhook] Failed to insert public_demo_passcodes row:', insertError.message)
    break
  }

  await sendPublicDemoPasscodeEmail(buyerEmail, generated.passcode).catch((err) =>
    console.error('[stripe-webhook] sendPublicDemoPasscodeEmail failed:', err)
  )

  console.log(`[stripe-webhook] DEMO-PASSCODE-01 public demo passcode issued for ${buyerEmail}`)
  break
}
```
`walletLedgerAlreadyRecorded()`'s `entryType` union is untouched — this branch never touches
`wallet_ledger`, so no new `entry_type` value is needed there (unlike B2B-39's `demo_topup_purchase`
addition).

### 6.6 Widget-dispatch route changes — `app/api/demo/[slug]/widget-dispatch/route.ts`

Exact control-flow change (replaces the current single `resolveDemoPasscodeToAccount()` call and its
immediately-following `if (!resolved)` check):

```ts
import { resolveDemoPasscodeToAccount } from '@/lib/demo/passcode-accounts'
import { resolvePublicDemoPasscode, consumePublicDemoPasscodeUse } from '@/lib/demo/public-buyer-passcode'

// Step 1 — try the existing B2B-39 reseller/admin passcode model FIRST (unchanged priority/behavior
// for every existing caller of this route).
const resolvedReseller = await resolveDemoPasscodeToAccount(parsed.data.passcode)
let billedAccountId: string | null = null
let publicPasscode: Awaited<ReturnType<typeof resolvePublicDemoPasscode>> = null

if (resolvedReseller) {
  billedAccountId = resolvedReseller.partnerAccountId
} else {
  // Step 2 — falls through to the new public-buyer model only when the reseller model doesn't match.
  publicPasscode = await resolvePublicDemoPasscode(parsed.data.passcode)
  if (!publicPasscode) {
    return NextResponse.json({ error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }, { status: 401 })
  }
}
```

**Duplicate-dispatch guard** — per Known Constraint 5, skipped entirely for the public-buyer path.
Concretely: the existing guard block (the `latestWidgetRows` query and its `session_already_active`
409 response) is wrapped in `if (billedAccountId) { … }` and simply does not run when `billedAccountId`
is null (i.e., a public-buyer passcode resolved instead). **Documented mechanical consequence**: that
guard is actually a per-slug lock scoped to the fixed internal `DEMO_PARTNER_ACCOUNT_ID` (every
dispatch through this route — reseller-billed or public-buyer-billed — creates its `partner_sessions`
row under that same fixed account; see that route's own code), not a per-billed-account lock. Skipping
it for the public path means a public buyer's dispatch on a given slug is never blocked by an
already-active session on that same slug (whether that active session belongs to a reseller's own
test, the admin, or another public buyer) — and conversely, `GET /api/demo/[slug]/widget-status`
(which always reports only the single most-recently-created row per slug) may briefly show a different
buyer's/operator's session as "active" to whoever next queries it on that slug, for exactly as long as
two sessions overlap. This is the CEO's own explicit, literal instruction (Known Constraint 5), applied
without inventing an additional lock the brief did not ask for; it is called out here in the Edge Cases
section (§9) as a known, accepted, low-probability trade-off rather than left as a silent side effect.

**Minutes billing** — per Known Constraint 5, skipped entirely for the public path: `demo_dispatches`
is never inserted for a public-buyer dispatch (that table's `billed_partner_account_id` column is
`NOT NULL` and FK-constrained to `partner_accounts`, so a public buyer — who has no
`partner_accounts` row — structurally cannot have a row there; inserting one is simply never attempted).
The `demo_dispatches` insert block (§6.9 point 4 of `docs/specs/B2B-39-requirement-document.md`) is
wrapped in the same `if (billedAccountId) { … }` condition as the duplicate-dispatch guard.

**Public-buyer-only steps**, added after a successful `201`/`widget_active` upstream response, in the
`else` branch (`publicPasscode` is non-null):
```ts
} else if (publicPasscode) {
  const newUsesRemaining = await consumePublicDemoPasscodeUse(publicPasscode.id)
  if (newUsesRemaining === null) {
    // Race — see §9. The dispatch already succeeded; log and proceed, never retroactively fail a
    // response the buyer already received a working session for.
    console.error('[demo/widget-dispatch] consumePublicDemoPasscodeUse found uses_remaining already 0 (race) for passcode', publicPasscode.id)
  }
  const { error: redemptionError } = await supabase.from('public_demo_passcode_redemptions').insert({
    passcode_id: publicPasscode.id,
    redeemed_name: parsed.data.end_user_name,
    slug: params.slug,
    clio_session_ref: upstreamBody.clio_session_ref,
  })
  if (redemptionError) {
    console.error('[demo/widget-dispatch] Failed to insert public_demo_passcode_redemptions row (non-blocking):', redemptionError.message)
  }
}
```
Both the consume-use call and the redemption-log insert are **best-effort, non-blocking** — matching
this route's own existing convention for the `demo_dispatches` insert (log and proceed, never fail an
already-successful dispatch response over a secondary bookkeeping write). The consume-use step
deliberately happens only *after* a successful upstream dispatch (not at the initial auth-check step)
— a use is spent by a session that actually happened, consistent with "usable twice" describing real
demo sessions, not merely correct-passcode entries; see §9 for the resulting, accepted race window.

The `session.metadata`-shaped `end_user_name` value used for `redeemed_name` is exactly the value
already typed into the Widget Demo tab's existing "Name" field (`widgetNameInput` in
`DemoTopicClient.tsx`, sent as `end_user_name` in the existing request body) — no new field, per Known
Constraint 3's explicit instruction not to add a redundant name/email re-entry step. `buyer_email` for
admin-page correlation is read via a join from `public_demo_passcode_redemptions.passcode_id` →
`public_demo_passcodes.buyer_email` (§4.C, §6.7) — never re-collected at redemption time.

### 6.7 New file — `lib/delivery/email.ts` addition — `sendPublicDemoPasscodeEmail`

Byte-for-byte the same HTML/text template structure as `sendNewWaitlistSignupEmail()`/
`sendDemoLowBalanceAlertEmail()` (dark theme, CLIO wordmark, one purple CTA button), per the pattern
every transactional email in this file already follows:

```ts
/**
 * DEMO-PASSCODE-01. Sent to a $10 demo-passcode buyer immediately on successful Stripe checkout, via
 * the checkout.session.completed webhook branch (§6.5). Contains the plaintext passcode — the only
 * place it is ever shown; it is never persisted or displayed anywhere else, including the admin page
 * (§4.C shows only passcode_prefix-free buyer/usage metadata, never the plaintext or even the prefix).
 */
export async function sendPublicDemoPasscodeEmail(
  toEmail: string,
  passcode: string
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendPublicDemoPasscodeEmail', { toEmail, passcode })
    return { success: true, messageId: 'mock-public-demo-passcode-id' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: 'Your Clio demo passcode',
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">Here's your demo passcode.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 24px;">
        Thanks for your purchase. This passcode works twice and never expires — use it whenever you're
        ready.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:24px;text-align:center;margin:0 0 32px;">
        <span style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:0.05em;font-family:monospace;">${passcode}</span>
      </div>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">
        Pick any course at the link below, open the "Widget Demo" tab, enter your name and this
        passcode, and start your session.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;text-align:center;">
        <a href="${appUrl}/demo" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">See the demo →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`,
      text: `Here's your demo passcode: ${passcode}\n\nThis passcode works twice and never expires. Pick any course at ${appUrl}/demo, open the "Widget Demo" tab, enter your name and this passcode, and start your session.`,
    })

    logEmailResult('sendPublicDemoPasscodeEmail', toEmail, result)
    if (result.error) return { success: false, error: result.error.message }
    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendPublicDemoPasscodeEmail] EXCEPTION to=${toEmail}:`, message)
    return { success: false, error: message }
  }
}
```
Links to `/demo` (the public catalog index, letting the buyer pick any topic), not a specific slug —
matching Known Constraint 1's "any one of the existing public demo topics (buyer's choice)."

### 6.8 New file — `lib/demo/public-demo-passcodes.ts` (admin read helper)

```ts
export interface PublicDemoPasscodeRow {
  id: string
  buyer_email: string
  purchased_at: string
  uses_remaining: number
  uses_total: 2
}
export interface PublicDemoPasscodeRedemptionRow {
  id: string
  buyer_email: string
  redeemed_name: string
  slug: string
  redeemed_at: string
}
export async function listPublicDemoPasscodesAndRedemptions(): Promise<{
  passcodes: PublicDemoPasscodeRow[]
  redemptions: PublicDemoPasscodeRedemptionRow[]
}> {
  // Two queries against a shared admin client, mirroring listWaitlistSignups()'s own simplicity:
  //  - public_demo_passcodes: select id, buyer_email, created_at, uses_remaining, order by created_at desc
  //  - public_demo_passcode_redemptions joined to public_demo_passcodes for buyer_email:
  //    select id, redeemed_name, slug, created_at, public_demo_passcodes(buyer_email), order by created_at desc
}
```

### 6.9 New API routes

`app/api/public-demo-passcode/checkout/route.ts` (POST, public, no auth, no request body validated
beyond accepting an empty JSON object):
```ts
export async function POST() {
  const checkoutUrl = await createPublicDemoPasscodeCheckoutSession()
  return NextResponse.json({ checkout_url: checkoutUrl })
}
```
Wrapped in a `try/catch` returning `502 { error: { code: 'stripe_error', message: 'Failed to create checkout session.' } }` on thrown error, mirroring the pattern `docs/specs/B2B-39-requirement-document.md` §8 documents for its own demo top-up checkout-creation failure.

`app/api/admin/public-demo-passcodes/route.ts` (GET, `requireSuperAdmin()`-gated, byte-identical
shape to `app/api/admin/waitlist/route.ts`):
```ts
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const { passcodes, redemptions } = await listPublicDemoPasscodesAndRedemptions()
  return NextResponse.json({ passcodes, redemptions })
}
```

## 7. Success Criteria (Acceptance Tests)

✓ AT-1: Given a visitor clicks "See the demo — $10" on the homepage and completes Stripe Checkout test
payment, when the `checkout.session.completed` webhook fires, then exactly one `public_demo_passcodes`
row is created with `uses_remaining = 2`, `buyer_email` equal to the email Stripe Checkout collected,
and the plaintext passcode is sent via `sendPublicDemoPasscodeEmail` — the plaintext is never written
to any table.

✓ AT-2: Given a buyer's passcode with `uses_remaining = 2`, when they redeem it on the Widget Demo tab
for any public demo topic and the session dispatches successfully, then `uses_remaining` becomes 1 and
exactly one `public_demo_passcode_redemptions` row is written with their typed name, the chosen slug,
and the resulting `clio_session_ref`.

✓ AT-3: Given the same passcode now at `uses_remaining = 1`, when redeemed a second time (same or
different topic), then `uses_remaining` becomes 0 and a second `public_demo_passcode_redemptions` row
is written; the passcode continues to exist in the table (never deleted).

✓ AT-4: Given a passcode at `uses_remaining = 0`, when a third redemption is attempted, then
`resolvePublicDemoPasscode()` returns `null`, the widget-dispatch route returns
`401 { error: { code: 'incorrect_passcode' } }` — identical to a wrong passcode — and no dispatch, no
`public_demo_passcode_redemptions` row, and no `uses_remaining` change occurs.

✓ AT-5: Given the Stripe webhook for a `public_demo_passcode` checkout session is redelivered (Stripe
retry), then the `stripe_checkout_session_id` uniqueness check short-circuits before a second passcode
is generated or a second email is sent — exactly one `public_demo_passcodes` row and one email exist
for that Checkout session, regardless of redelivery count.

✓ AT-6: Given a public buyer's passcode resolves at dispatch time, when the resulting session
completes, then no `demo_dispatches` row is ever written for it, and `partner_wallets`/`wallet_ledger`
for every existing `partner_accounts` row are completely unchanged (regression-checkable: read every
account's relevant columns before and after the test, byte-identical) — confirming Known Constraint 5's
"no partner billing/minutes-consumption side effects."

✓ AT-7: Given a reseller's own B2B-39 demo passcode and a public buyer's passcode both exist, when each
is typed into the same Widget Demo tab passcode field, then each resolves correctly to its own model
(`resolveDemoPasscodeToAccount()` vs. `resolvePublicDemoPasscode()`) with no cross-resolution — a
reseller's passcode never matches the public lookup and vice versa (their hash spaces are drawn from
the same alphabet/length but stored in disjoint tables with independent uniqueness constraints, so a
collision is a 31^10-order coincidence, not a design gap).

✓ AT-8: Given the homepage CTA section, then the exact string "usable" concept — the specific copy
"Your passcode works twice and never expires." — is present and visible without any user interaction
(no hover, no click, no scroll-triggered reveal required to see it) before the "See the demo — $10"
button is ever clicked, confirming Known Constraint 4's pre-payment disclosure requirement.

✓ AT-9: Given `STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID` is a `PLACEHOLDER_`-prefixed or missing env var
(the default, pre-Arun-setup state), when the checkout route is called, then it returns a mock
`checkout_url` and logs `[MOCK] createPublicDemoPasscodeCheckoutSession` — the homepage CTA, the
checkout route, and the webhook branch (once manually triggered/tested) all function end-to-end without
any real Stripe Price configured, matching this codebase's standing mock-stub convention for every
other Stripe integration point.

✓ AT-10: Given the admin `/dashboard/admin/public-demo-passcodes` page, when a non-super-admin
(including an unauthenticated visitor) requests `GET /api/admin/public-demo-passcodes` directly, then
`requireSuperAdmin()` rejects it exactly as it already does for `GET /api/admin/waitlist`, and the page
itself 404s for a non-admin Clerk user (matching `WaitlistPage`'s own `notFound()` behavior) rather than
showing an empty or partial view.

## 8. Error States

- **Checkout-session creation fails** (Stripe error): `502 { error: { code: 'stripe_error', message:
  'Failed to create checkout session.' } }`; the homepage CTA button re-enables and shows a red inline
  line, `"Couldn't start checkout. Try again."`, below it — the section itself never disappears or
  breaks.
- **Webhook fires with no `customer_details.email`** (should not happen given
  `customer_creation: 'always'`, but defensively guarded): logged
  (`console.warn('[stripe-webhook] public_demo_passcode checkout.session.completed missing buyer email:', session.id)`),
  no passcode row is created, no email is sent — the buyer's payment still succeeded on Stripe's side
  (a real, if rare, gap requiring Arun to manually follow up via the Stripe dashboard; not silently
  dropped, since the `console.warn` is visible in Vercel runtime logs per the project's existing
  monitoring setup).
- **`public_demo_passcodes` insert fails** (Supabase error) after a successful webhook signature
  verification: logged (`console.error`), the webhook still returns `200` (matching this route's
  documented "always return 200 to prevent Stripe retries on handled errors" header comment) — a
  genuinely lost purchase requiring the same manual Stripe-dashboard follow-up as the missing-email
  case above; not retried automatically, since a retried webhook redelivery would hit the exact same
  Supabase failure mode with no self-healing property.
- **`sendPublicDemoPasscodeEmail` fails** (Resend error) after the passcode row is successfully
  created: logged and caught (`.catch(...)`, never throws into the webhook handler) — the passcode row
  exists and is valid, but the buyer never receives it automatically; this is the one gap this spec
  cannot fully close without a manual "resend passcode" admin action, which is explicitly out of scope
  (§10) — Arun can see the buyer's email and generated timestamp on the admin page and manually
  reach out if this is ever reported.
- **A buyer enters an incorrect, already-exhausted, or reseller-typo'd passcode**: identical
  `401 { error: { code: 'incorrect_passcode', message: 'Incorrect passcode.' } }` in every case — the
  same fail-closed, non-leaking posture `docs/specs/B2B-39-requirement-document.md` §8 already
  documents for its own passcode resolution, applied here identically rather than inventing a new,
  more granular error taxonomy.
- **`consumePublicDemoPasscodeUse` races to 0 between the auth check and the post-dispatch consume
  step** (two devices redeeming the same passcode's last use within the same request window): logged
  (`console.error`), the already-successful dispatch response is not retracted or altered — see §9 for
  the full scenario and why this is an accepted, non-blocking gap.
- **`public_demo_passcode_redemptions` insert fails** after a successful dispatch: logged, non-blocking
  — the buyer still gets their working demo session; only the admin-facing audit log for that one
  redemption is incomplete (the `uses_remaining` decrement still happens independently, so the "usable
  twice" enforcement itself is unaffected by this specific failure mode).

## 9. Edge Cases

- **Buyer tries redeeming a 3rd time**: covered in AT-4/§8 — generic `incorrect_passcode`, no state
  change, no distinguishing signal given (deliberate, matches B2B-39's own non-leaking convention).
- **Webhook redelivery** (Stripe retries `checkout.session.completed` for the same session, a normal
  Stripe behavior on any non-2xx or timeout): covered in AT-5 — the `stripe_checkout_session_id`
  uniqueness check makes this a safe no-op past the first successful processing.
- **Buyer closes the tab mid-checkout** (never reaches the `success_url` redirect): the passcode is
  still issued and emailed — issuance happens entirely in the webhook handler (§6.5), which fires
  based on Stripe's own server-side payment confirmation, completely independent of whether the buyer's
  browser is still open or ever loads the `success_url` page. The buyer simply never sees homepage
  State C (§4.A) — their only confirmation is the email, which per Known Constraint's "usable twice"
  guarantee is sufficient (no dashboard/account exists for them to check back on regardless).
- **Buyer abandons checkout entirely** (clicks "back" or closes the Stripe Checkout page without
  paying): no `checkout.session.completed` event ever fires for that session — nothing is created,
  nothing is emailed, matching normal Stripe behavior with zero special-case code needed.
- **Stripe test-mode vs. eventual live-mode price ID swap**: purely an env-var value change
  (`STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID`) — no code path branches on test vs. live mode explicitly;
  Stripe's own key mode (test vs. live secret key) already governs which mode a given Price ID must
  belong to, and this codebase's existing `isPlaceholder`/`priceIdIsPlaceholder` guards (§6.4) already
  cover "not yet configured" regardless of which mode Arun is about to configure it in.
- **Concurrent public-buyer and reseller/admin sessions on the same demo slug** (§6.6's documented
  mechanical consequence of skipping the duplicate-dispatch guard for the public path): both dispatches
  succeed independently; `GET /api/demo/[slug]/widget-status` reports only the single most-recently
  created `partner_sessions` row for that slug to whichever caller queries it next, so an operator
  mid-test on `claude-ai` could see their own Widget Demo tab briefly report a public buyer's session
  as "active" (or vice versa) if the two genuinely overlap in time on the same slug. Accepted as a
  direct, explicit consequence of Known Constraint 5 — a real but low-probability, low-severity
  overlap (both audiences are demoing the same public content; no cross-contamination of billing,
  passcode identity, or session data occurs, only which session a status poll happens to surface).
- **Race on the last use of a passcode** (two devices submit the same passcode's final redemption
  within the same request window): both could pass the read-only `resolvePublicDemoPasscode()` check
  (since it only requires `uses_remaining > 0`, not `>= 2` for a "first" attempt) before either's
  `consumePublicDemoPasscodeUse()` call runs. Both dispatches would succeed (two real demo sessions
  happen — a minor, accepted cost overrun on Arun's side, not a security issue); the first
  `consumePublicDemoPasscodeUse()` call to reach Postgres decrements `uses_remaining` to 0 and returns
  `0`, the second finds `uses_remaining > 0` already false and returns `null` (logged per §8). Net
  effect: `uses_remaining` never goes negative, both redemptions are still logged (the `redemptions`
  insert is unconditional on the consume-step's outcome), and the passcode correctly reads "0 remaining"
  afterward — only the theoretical "exactly 2, never 3" guarantee has a vanishingly narrow race window,
  accepted as a documented trade-off rather than solved with a heavier locking scheme for a low-stakes,
  low-frequency public-demo feature.
- **Mobile viewport** (standing responsive rule): the homepage CTA section and admin page both inherit
  fluid, capped-`max-width` containers from their immediate neighbors (§5) — no new breakpoint
  behavior is introduced; the Widget Demo tab's passcode prompt is unchanged, so its existing mobile
  behavior (whatever it already is) is untouched by this feature.
- **A buyer purchases a second $10 passcode** (no purchase-limiting logic anywhere): fully supported,
  unremarkable — two independent `public_demo_passcodes` rows, each with its own 2 uses, both correctly
  listed and redeemable. Not a special case requiring any dedup/limit logic (§10 confirms no such limit
  is in scope).

## 10. Out of Scope

- Any change to the just-shipped `WaitlistSection`/`waitlist_signups` flow — this feature is purely
  additive alongside it, per Known Constraint 4 and the explicit "nothing about this competes with or
  degrades the just-shipped waitlist section" success criterion.
- A "resend passcode email" admin action, or any buyer-facing "I lost my passcode" self-service flow —
  not requested; the admin page's buyer-email visibility (§4.C) is the only recourse today, and any
  future self-service recovery flow is a distinct, not-yet-requested feature.
- Any purchase-limiting logic (rate limiting, one-passcode-per-email, CAPTCHA) on the $10 checkout
  route — not requested by the CEO brief; the $10 price point plus Stripe's own fraud tooling are
  treated as sufficient friction for this narrow, low-volume public demo channel, matching this
  codebase's own precedent of relying on Stripe rather than building custom abuse tooling for its other
  one-time-payment flows (`test_block_purchase`, `demo_topup_purchase`).
- Refund/proration/dispute handling for a $10 purchase — no refund logic anywhere in this spec, no
  Stripe `charge.refunded` handler added.
- Deleting or editing an issued `public_demo_passcodes` row from the admin page — the admin page is
  read-only by design (§4.C); this is Arun's audit trail, not a management console.
- Any change to `lib/demo/passcode-accounts.ts`, `demo_passcodes` (B2B-39), or the Meeting tab's
  separate `lib/demo/passcode.ts` gate — all three remain completely untouched, exactly as Known
  Constraint 2 requires. The three passcode systems (`lib/demo/passcode.ts`,
  `lib/demo/passcode-accounts.ts`, and this feature's new `lib/demo/public-buyer-passcode.ts`) must
  remain permanently separate files/mechanisms.
- Extending the Meeting tab (Google Meet bot dispatch) to accept a public-buyer passcode — explicitly
  ruled out by Known Constraint 1; only the Widget Demo tab is in scope.
- A "watch a recording" or any non-interactive fallback experience — explicitly ruled out by Known
  Constraint 1; the Widget Demo mechanics are reused as-is, nothing new is built for "seeing" the demo.
- Analytics/conversion tracking on the new homepage CTA beyond what any other button on the page
  already gets (none is described in this spec; not requested).

## 11. Open Questions

None. Every ambiguity is resolved above using the CEO brief's Known Constraints directly, or — where
the brief left a technical wiring detail unspecified (e.g. exactly how the duplicate-dispatch guard and
minutes-billing skip should be implemented in code, exactly when a passcode's use should be consumed
relative to dispatch success, exactly how the reseller-vs-public passcode resolution should be ordered
and branched) — resolved here with a concrete, documented decision following the "minimum viable,
mirror existing codebase patterns" principle, per this feature's delegated authority. The one place a
genuine new ambiguity was found (the duplicate-dispatch guard's real scope being per-slug rather than
per-billed-account, which Known Constraint 5's instruction to "skip" it has a broader effect than a
literal reading might suggest) is resolved as a literal, faithful implementation of that instruction
and its real consequence is documented explicitly (§6.6, §9) rather than quietly narrowed or expanded
beyond what the CEO actually said.

## 12. Dependencies

- **Migration numbering**: highest existing migration at spec-writing time is
  `118_waitlist01_signups.sql`. This feature's migration should be
  `119_demo_passcode01_public_buyer_passcodes.sql` — confirm against the actual repo state at build
  time, since another feature developed in parallel may also claim `119` (same coordination note
  `docs/specs/B2B-39-requirement-document.md` §12 documents for its own numbering); whichever lands
  first in `main` keeps `119`, the other becomes `120`. No coordination is needed beyond renumbering —
  this feature's two new tables share no columns or constraints with any other in-flight migration.
- **Stripe**: requires Arun to create one real Product + Price ($10, one-time) in the Stripe Dashboard
  and set `STRIPE_PUBLIC_DEMO_PASSCODE_PRICE_ID` — until then, the entire flow runs in mock mode per
  AT-9, functionally complete end-to-end (checkout route, webhook branch logic path, admin page) except
  for an actual charge.
- **`lib/delivery/email.ts` change** (`sendPublicDemoPasscodeEmail`) must land in the same PR/deploy as
  the Stripe webhook branch (§6.5) that calls it — same co-deployment requirement
  `docs/specs/B2B-39-requirement-document.md` §12 notes for its own sibling-function/consumer pair.
- **No dependency on B2B-39** — this feature deliberately builds a wholly separate passcode
  model/table (Known Constraint 2) and only touches the shared `widget-dispatch/route.ts` file, adding
  a fallback branch after B2B-39's existing resolution call rather than modifying it. Either feature
  can ship before or after the other with no sequencing hazard; if B2B-39 has not yet shipped when this
  feature ships, `resolveDemoPasscodeToAccount()` still exists and behaves as documented in this spec's
  own §6.6 regardless.
- **No dependency on WAITLIST-01 code** beyond visual placement (§4.A, "directly after
  `<WaitlistSection />`") — WAITLIST-01 has already shipped (per `BACKLOG.md`), so this is a placement
  fact, not an open sequencing risk.
