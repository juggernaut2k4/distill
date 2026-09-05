# Homepage Waitlist (narrowed scope) — Requirement Document
Version: 1.0
Status: APPROVED (CEO Agent, 2026-09-05 — matches the Feature Brief's CEO Decision on
/partner-inquiry consolidation exactly; all 12 sections complete, Section 11 empty; scope is
appropriately narrow, no over-build)
Author: Business Analyst Agent
Date: 2026-09-05

Source: `.claude/agents/clio/feature-briefs/WAITLIST-01-homepage-waitlist-narrower-scope.md`
(replaces the earlier combined WAITLIST-01 entry in `BACKLOG.md` lines 287-295, which bundled the
$10 demo-passcode flow — that flow is explicitly out of scope here and tracked separately as
`DEMO-PASSCODE-01`, see Section 10).

---

## 0. Headline finding — every "open question" the brief flagged has a direct precedent already shipped in this codebase

B2B-80 (`docs/specs/B2B-80-requirement-document.md`, migration `116_b2b80_sales_partner_leads.sql`,
`lib/partner/sales-partner-leads.ts`, `app/api/partner-inquiry/route.ts`,
`app/(with-clerk)/dashboard/admin/sales-partner-leads/`) is a near-exact structural twin of this
feature: a public unauthenticated lead-capture form → Supabase insert → Resend admin-notification
email → `requireSuperAdmin()`-gated admin list page. This spec follows that precedent file-for-file
(schema shape, admin-auth gate, Resend call-site pattern, `DashboardShell` usage) and only
diverges where the brief's requirements genuinely differ (duplicate-email handling is a hard
block here, not a 24h soft window; there is a delete action, which B2B-80's page doesn't have —
modeled instead on `DELETE /api/admin/partner-keys/[id]/route.ts`'s auth/404/200 shape).

---

## 1. Purpose

Clio's homepage currently has no low-commitment way for an interested buyer to raise their hand.
The only conversion path today is `/partner-inquiry`, a higher-touch "talk to us" form that asks
for a message and implies a sales conversation — a heavier ask than many visitors are ready for.
Arun wants a fast, one-glance "join the waitlist" motion as the primary homepage conversion point
so Clio can go to market and start building a list of interested buyers *before* pricing and
paid-signup mechanics are decided. Without this, every visitor who isn't ready for a sales call
today simply leaves with no way to signal interest, and Arun has no growing list of leads to work
from when pricing is ready.

## 2. User Story

As a **prospective buyer/partner visiting the Clio homepage**,
I want to **quickly leave my name and email to join a waitlist**,
So that **I'm notified when Clio is ready for me, without committing to a sales call right now**.

As **Arun (site owner/admin)**,
I want to **be emailed the instant someone joins the waitlist, and see/manage every entry in an
admin page**,
So that **I can track interest and follow up personally, without touching the database directly**.

## 3. Trigger / Entry Point

**Public waitlist form:**
- Lives in a new homepage section, `<section id="waitlist">`, added to
  `app/(with-clerk)/(marketing)/page.tsx` directly before `<BottomCTA />` (i.e. as the last
  content section before the closing purple-gradient CTA band — see Section 4 for exact
  placement rationale).
- Triggered by: (a) scrolling to it naturally, or (b) clicking "Get started" in `MarketingNav`,
  or the Hero/BottomCTA primary buttons, all three of which become anchor links to `#waitlist`
  (see Section 4 for exact before/after).
- No auth state required — fully public, no Clerk session involved at any point (mirrors
  `/partner-inquiry`'s explicit "never touches Clerk" rule).

**Admin waitlist page:**
- Route: `/dashboard/admin/waitlist` (new page, inside the existing `(with-clerk)` admin tree,
  sibling to `/dashboard/admin/sales-partner-leads`).
- Triggered by: an admin navigating there directly, or via a new "Waitlist" link on
  `/dashboard/admin` (the admin index — see Section 4.D for the exact addition).
- State required: signed in via Clerk AND `requireSuperAdmin()` resolves successfully (same gate
  as `sales-partner-leads`) — internal staff (non-super-admin) get the same `notFound()` treatment
  as that page, since the brief names Arun specifically ("admin should follow a different url").

## 4. Screen / Flow Description

### 4.A — Homepage nav/CTA rewiring (exact before/after)

**`components/marketing/MarketingNav.tsx`:**
- **Remove entirely:** the `<Link href="/sign-in">Log in</Link>` block (lines 35-40 today).
  Admin still reaches `/dashboard/admin` via `/sign-in` directly by typing the URL — not linked
  publicly anywhere, per the brief.
- **Change:** the "Get started" link's `href` from `/partner-inquiry` to `#waitlist`. Label text
  ("Get started") and the `ArrowRight` icon stay exactly as-is. Since `#waitlist` is an in-page
  anchor and `MarketingNav` renders on every page (not just `/`), wrap the href logic so it points
  to `/#waitlist` when not already on the homepage and `#waitlist` when already there — concretely:
  `href="/#waitlist"` always (Next.js resolves `/#waitlist` correctly whether you're already on
  `/` or navigating from elsewhere, and a same-page navigation to `/#waitlist` still scrolls).
- Resulting right-action cluster: exactly one link — "Get started" → `/#waitlist`.

**`Hero` component (`app/(with-clerk)/(marketing)/page.tsx`):**
- The primary CTA button currently wraps `<Link href="/partner-inquiry"><Button size="lg">Talk to
  us<ArrowRight/></Button></Link>`. Change to `<Link href="/#waitlist"><Button size="lg">Join the
  waitlist<ArrowRight/></Button></Link>`. Icon unchanged.
- The secondary text link ("See the difference ↓", `href="#difference"`) is unchanged — it's
  unrelated to the CTA/waitlist decision, it points at `DifferenceSection`.

**`BottomCTA` component:**
- Change `<Link href="/partner-inquiry"><Button size="lg">Contact us<ArrowRight/></Button></Link>`
  to `<Link href="/#waitlist"><Button size="lg">Join the waitlist<ArrowRight/></Button></Link>`.
  Headline/subheadline text in `BottomCTA` stays unchanged — it already reads generically enough
  ("What does real understanding do to retention?") to work as a waitlist nudge without a copy
  rewrite.

**`/partner-inquiry` demotion (the CEO Decision, mechanically):**
- Not deleted, not unlinked entirely. Exactly one link to it remains, placed as a small secondary
  text link directly under the new waitlist form's submit button (inside the new `WaitlistSection`
  component — see 4.B), reading: **"Want to talk to us directly instead? Contact us →"** as a
  single inline text link (no button styling), `href="/partner-inquiry"`, styled
  `text-sm text-[#475569] hover:text-white transition-colors` (i.e. Clio's standard muted
  secondary-link treatment used elsewhere on this page, e.g. `MarketingNav`'s old "Log in" link
  style before removal, and `HowItWorks`'s… no — concretely matching the existing "See the
  difference ↓" secondary-link classes in `Hero`, adjusted from `text-base` to `text-sm` to read as
  clearly subordinate to the waitlist form above it).
- This is the *only* remaining `/partner-inquiry` reference anywhere in nav/hero/bottom-CTA. The
  route, page, and API remain fully functional and untouched otherwise.

### 4.B — New homepage waitlist section (full design)

New component `WaitlistSection`, added to `app/(with-clerk)/(marketing)/page.tsx` (co-located in
the same file as the other section components — `Hero`, `PillarsSection`, etc. — following this
file's existing convention of one file per page with named section functions), rendered as:

```tsx
<main>
  <MarketingNav />
  <Hero />
  <ManifestoLine />
  <DifferenceSection />
  <PillarsSection />
  <HowItWorks />
  <Testimonials />
  <WaitlistSection />   {/* new — inserted here, directly before BottomCTA */}
  <BottomCTA />
</main>
```

Rationale for placement: it's the natural last full-content beat before the page's existing
closing purple-gradient CTA band, and every homepage CTA (nav, hero, bottom) now points at it —
placing it near the end keeps a visitor who scrolls the whole page landing on it right before the
final CTA reinforces the same action, rather than competing with it.

**Section wrapper markup/style** (matching this page's existing section conventions exactly —
`py-16 md:py-28` vertical rhythm, alternating `#080808`/`#0a0a0a` background per this page's
existing alternation pattern — the section before it, `Testimonials`, is `#0a0a0a`, so this one is
`#080808` to keep the alternation going into `BottomCTA`'s gradient):

```
<section id="waitlist" className="py-16 md:py-28 bg-[#080808]">
  <div className="max-w-2xl mx-auto px-4 md:px-6">
    ...heading, form, states...
  </div>
</section>
```

**Heading block** (centered, matching `Testimonials`'/`PillarsSection`'s heading pattern):
- Eyebrow-less (this page's sections don't all use a `Badge` eyebrow above H2 — `Testimonials`
  and `HowItWorks` don't; follow that lighter pattern here too, not `Hero`'s badge).
- H2: `text-3xl md:text-5xl font-bold text-white text-center mb-4`, text: **"Be first to know when Clio's ready for you."**
- Subhead: `text-base md:text-xl text-[#475569] text-center mb-10 md:mb-12`, text: **"Join the waitlist — we'll reach out the moment we're ready to bring on new partners."**

**Form card** — reuses `Card` (`components/ui/Card`, `bg-[#111111] border-[#222222] rounded-xl`),
padded `p-6 md:p-9`, max-width matches the section's `max-w-2xl` container so it reads as one
centered card, not full-bleed.

**States** (idle / submitting / success / error / duplicate — a client component,
`components/marketing/WaitlistForm.tsx`, imported into `WaitlistSection`):

**State: idle (default form)**
- Two fields, stacked vertically, `gap-5` (same field spacing as `partner-inquiry`'s form):
  1. Label "Your name", `<input name="name" type="text" autoComplete="name">`, placeholder "Jane Doe"
  2. Label "Email", `<input name="email" type="email" autoComplete="email">`, placeholder "jane@company.com"
- Both inputs styled identically to `partner-inquiry`'s `Field` component:
  `w-full bg-[#1A1A1A] border rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#475569]
  focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/30 focus:border-[#7C3AED] transition-colors`,
  border `border-[#EF4444]` when that field has a client-side validation error, else `border-[#333333]`.
- Inline field-level error text under each invalid field: `mt-1 text-xs text-[#EF4444]`
  ("Your name is required" / "Enter a valid email address").
- Honeypot field: identical hidden-input pattern to `partner-inquiry`'s (`name="website"`,
  visually hidden via `absolute -left-[9999px] w-px h-px opacity-0`, `tabIndex={-1}`,
  `aria-hidden="true"`).
- Submit button: `<Button type="submit" size="lg" className="w-full gap-2">Join the waitlist
  <ArrowRight size={18} /></Button>`.
- Directly under the submit button: the `/partner-inquiry` secondary link from Section 4.A.

**State: submitting**
- Button becomes disabled, label swaps to `<Loader2 className="w-4 h-4 animate-spin" />Joining...`
  (byte-identical pattern to `partner-inquiry`'s submitting state). Fields remain visible but the
  form is inert during this state (no explicit `disabled` needed on inputs since there's nothing
  else to click before the button resolves).

**State: success**
- Replaces the entire form card content (same swap pattern as `partner-inquiry`'s success state —
  it doesn't reset-and-show-form, it replaces):
  - `CheckCircle2` icon in a green circle badge (`w-12 h-12 rounded-full bg-green-950/50
    border border-green-800/30`, icon `text-[#10B981]`)
  - H3: `text-2xl font-bold text-white`, text: **"You're on the list."**
  - Body: `text-sm text-[#94A3B8] leading-relaxed mt-2`, text: **"We'll email you the moment
    Clio's ready to bring on new partners."**
  - No further action needed — no "back to homepage" link (unlike `partner-inquiry`'s success
    state) since the visitor is already on the homepage; the section simply stays in this
    confirmed state if they scroll back to it.

**State: duplicate-email error**
- Per Section 4.B's brief guidance ("friendly response, not a 500") and this BA's schema decision
  (Section 6 — a **hard unique constraint** on email, unlike B2B-80's 24h soft window, since a
  waitlist is a one-time membership list, not a rate-limited inquiry channel): the API returns 200
  with a `duplicate` flag rather than an error status. The form treats this as its own success-like
  state, not an error:
  - Same visual treatment as the success state (green check, same card swap) but with copy:
    H3: **"You're already on the list."**
    Body: **"We've got your email — we'll be in touch when Clio's ready."**
  - This is deliberately reassuring, not punitive — the brief's own guidance is "friendly response."

**State: generic error** (network failure, 500, validation rejected server-side despite
client-side checks passing e.g. race condition)
- Form stays visible (not replaced), inline error banner appears above the submit button:
  `mt-4 text-sm text-[#EF4444]`, text: **"Something went wrong. Please try again."** — identical
  pattern/copy to `partner-inquiry`'s error state.
- Button returns to enabled idle state so the visitor can retry immediately.

### 4.C — Wireframe references

See Section 5 for the four wireframes (idle, submitting, success/duplicate, error).

### 4.D — Admin waitlist page (`/dashboard/admin/waitlist`)

Modeled directly on `/dashboard/admin/sales-partner-leads/` (`page.tsx` +
`SalesPartnerLeadsClient.tsx`), with one structural difference: waitlist entries have no status
lifecycle (no contacted/invited/declined) and no expand-for-detail need (only name + email +
timestamp — nothing to hide behind a chevron), so rows render flat with a delete action, not
expand/collapse.

**`app/(with-clerk)/dashboard/admin/waitlist/page.tsx`** (server component, byte-identical gate
pattern to `sales-partner-leads/page.tsx`):
```
- currentUser() → redirect('/sign-in') if null
- requireSuperAdmin() → notFound() if admin.error
- <DashboardShell user={{email}} activeNav="/dashboard/admin/waitlist"><WaitlistClient /></DashboardShell>
```

**`WaitlistClient.tsx`** (client component):
- Header block (same pattern as `SalesPartnerLeadsClient`): "← Back to Admin" link
  (`href="/dashboard/admin"`), `Users` icon + H1 "Waitlist" (`text-white text-2xl font-bold`),
  subtext `text-[#94A3B8] text-sm`: **"People who joined the homepage waitlist."**
- List container: `bg-[#111111] border border-[#222222] rounded-xl p-4 md:p-6` (same as
  `sales-partner-leads`).
- Loading state: "Loading waitlist…" (`text-[#94A3B8] text-sm py-4`).
- Load-error state: "Couldn't load the waitlist. Try refreshing." (`text-[#EF4444] text-sm py-4`).
- Empty state: "No one has joined the waitlist yet." (`text-[#475569] text-sm py-4`).
- Row (flat, no expand): `px-3 py-3 rounded-lg bg-[#0A0A0A] border border-[#1A1A1A]`, flex row
  (`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3`):
  - Name: `text-white text-sm font-medium min-w-0 truncate sm:w-48`
  - Email: `text-[#94A3B8] text-sm min-w-0 truncate flex-1`
  - Relative timestamp ("today" / "1 day ago" / "N days ago" — reuses the exact
    `formatRelative()` helper from `SalesPartnerLeadsClient.tsx`): `text-[#475569] text-xs
    whitespace-nowrap`
  - Delete button, right-aligned: icon-only `Trash2` (lucide-react, already an approved-library
    icon set) button, `text-[#475569] hover:text-[#EF4444] transition-colors`, `aria-label="Delete
    entry"`.
- **Delete confirmation UX**: since neither `sales-partner-leads` nor `partner-keys` uses a modal
  dialog for destructive actions (partner-keys revokes are one-click; sales-partner-leads has no
  delete at all), and this action is a true permanent delete (not a revoke/soft-status change like
  those two), this BA resolves the gap with an **inline two-step confirm** (no modal component
  exists in this codebase to reuse, and adding one is out of scope for this narrow spec): clicking
  the trash icon replaces it in-place with two small text buttons — "Confirm delete"
  (`text-[#EF4444] text-xs font-semibold`) and "Cancel" (`text-[#475569] text-xs`) — for that row
  only. Clicking elsewhere does not auto-cancel (kept simple — no outside-click listener needed);
  clicking "Cancel" reverts to the trash icon. Clicking "Confirm delete" fires the DELETE call,
  shows an inline `Loader2` spinner in place of the buttons while in flight, then removes the row
  from the list on success or shows a row-level error text (`text-[#EF4444] text-xs mt-2`,
  "Couldn't delete this entry. Try again.") on failure, reverting to the trash icon so the admin
  can retry.

## 5. Visual Examples

**Homepage waitlist section — idle:**
```
┌───────────────────────────────────────────────────────┐
│         Be first to know when Clio's ready for you.    │
│   Join the waitlist — we'll reach out the moment       │
│         we're ready to bring on new partners.          │
│                                                         │
│   ┌─────────────────────────────────────────────────┐ │
│   │  Your name                                        │ │
│   │  [ Jane Doe                                    ]  │ │
│   │                                                     │ │
│   │  Email                                             │ │
│   │  [ jane@company.com                            ]  │ │
│   │                                                     │ │
│   │  [ PRIMARY BUTTON: "Join the waitlist →" ]         │ │
│   │                                                     │ │
│   │  Want to talk to us directly instead? Contact us → │ │
│   └─────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

**Submitting:**
```
┌─────────────────────────────────────────────────┐
│  Your name   [ Jane Doe            ] (disabled)   │
│  Email       [ jane@company.com    ] (disabled)   │
│  [ ⟳ Joining...                          ]         │
└─────────────────────────────────────────────────┘
```

**Success / duplicate (same layout, copy differs per Section 4.B):**
```
┌─────────────────────────────────────────────────┐
│   ✓  You're on the list.                          │
│      We'll email you the moment Clio's ready       │
│      to bring on new partners.                     │
└─────────────────────────────────────────────────┘
```

**Error (form retained):**
```
┌─────────────────────────────────────────────────┐
│  Your name   [ Jane Doe                        ]  │
│  Email       [ jane@company.com                ]  │
│  Something went wrong. Please try again.           │
│  [ PRIMARY BUTTON: "Join the waitlist →" ]         │
└─────────────────────────────────────────────────┘
```

**Admin waitlist page (`/dashboard/admin/waitlist`):**
```
┌───────────────────────────────────────────────────────────┐
│  ← Back to Admin                                            │
│  👥 Waitlist                                                 │
│  People who joined the homepage waitlist.                    │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Jane Doe      jane@company.com        2 days ago  🗑️  │ │
│  │ John Smith    john@acme.com           today       🗑️  │ │
│  └───────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

**Admin row — delete confirm state (row 1 mid-delete):**
```
│ Jane Doe      jane@company.com        2 days ago  [Confirm delete] [Cancel] │
```

## 6. Data Requirements

### 6.1 — New Supabase table: `waitlist_signups`

New migration `supabase/migrations/118_waitlist01_signups.sql`:

```sql
-- WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §6.1) — public homepage waitlist.
-- Structurally modeled on 116_b2b80_sales_partner_leads.sql, with a hard UNIQUE constraint on
-- email instead of B2B-80's 24h soft duplicate window — a waitlist is a one-time membership list,
-- not a rate-limited inquiry channel, so the same email joining twice should always resolve to
-- "you're already on the list," not a second row.

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  submitted_ip  TEXT,   -- best-effort abuse-review signal only, never displayed in the admin UI
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_waitlist_signups_created_at ON waitlist_signups(created_at DESC);

ALTER TABLE waitlist_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on waitlist_signups"
  ON waitlist_signups FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE waitlist_signups IS
  'WAITLIST-01: public homepage waitlist submissions (name + email only, no PII beyond that per
  standing privacy rule). No end-user Supabase session ever reads/writes this table — the public
  POST /api/waitlist route uses the admin client server-side, since submitters have no Clerk
  session at all, mirroring sales_partner_leads.';
```

- **Read from:** `waitlist_signups` — full table (id, name, email, created_at), by
  `listWaitlistSignups()` for the admin GET route.
- **Written to:** `waitlist_signups` (insert) by `submitWaitlistSignup()`, on every valid public
  submission that doesn't hit the unique-email constraint. `submitted_ip` captured the same way as
  `sales_partner_leads.submitted_ip` (from `x-forwarded-for`).
- **Deleted from:** `waitlist_signups` (hard delete, single row by id) by
  `deleteWaitlistSignup(id)`, called only from the admin DELETE route.
- **No `localStorage`/`sessionStorage` use anywhere in this feature.**

### 6.2 — New lib module: `lib/partner/waitlist.ts`

Mirrors `lib/partner/sales-partner-leads.ts`'s structure:

```ts
export type SubmitWaitlistResult =
  | { ok: true }
  | { ok: false; code: 'duplicate_email' }
  | { ok: false; code: 'internal_error' }

export async function submitWaitlistSignup(input: {
  name: string
  email: string
  submittedIp?: string
}): Promise<SubmitWaitlistResult>
// Attempts insert directly (relying on the UNIQUE constraint rather than a pre-check-then-insert
// race, unlike sales_partner_leads' 24h window check — a hard unique constraint makes the
// pre-check redundant and race-prone; catch the unique-violation Postgres error code 23505 and
// map it to { ok: false, code: 'duplicate_email' }). On success, fires
// sendNewWaitlistSignupEmail() to every getActiveSuperAdminEmails() address (reusing that exact
// existing helper from lib/partner/sales-partner-leads.ts — no duplicate super-admin-email lookup
// logic), synchronously, Resend-failure-tolerant (caught and logged, never blocks the 200).

export interface WaitlistSignup {
  id: string
  name: string
  email: string
  created_at: string
}
export async function listWaitlistSignups(): Promise<WaitlistSignup[]>
export async function deleteWaitlistSignup(id: string): Promise<{ success: boolean; found: boolean }>
```

### 6.3 — API routes

**`POST /api/waitlist`** (public, unauthenticated — new file `app/api/waitlist/route.ts`,
structural twin of `app/api/partner-inquiry/route.ts`):
- Zod schema:
  ```ts
  const WaitlistSchema = z.object({
    name: z.string().trim().min(1, 'Your name is required').max(200),
    email: z.string().trim().email('Enter a valid email address').max(320),
    website: z.string().max(200).optional(), // honeypot, same as partner-inquiry
  })
  ```
- 422 with `{ error: 'Validation failed', details: parsed.error.flatten() }` on Zod failure.
- Honeypot filled → `200 { success: true }`, no row written, no signal given (identical to
  `partner-inquiry`).
- `submittedIp` extracted from `x-forwarded-for` the same way.
- On `duplicate_email` → `200 { duplicate: true }` (200, not an error status — the friendly
  "already on the list" case is a normal, expected outcome for the client to render as its own
  state, not an error branch).
- On `internal_error` → `500 { error: { code: 'internal_error', message: 'Something went wrong.
  Please try again.' } }`.
- On success → `200 { success: true }`.

**`GET /api/admin/waitlist`** (new file `app/api/admin/waitlist/route.ts`, byte-identical shape to
`app/api/admin/sales-partner-leads/route.ts`):
```ts
export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const signups = await listWaitlistSignups()
  return NextResponse.json({ signups })
}
```

**`DELETE /api/admin/waitlist/[id]`** (new file `app/api/admin/waitlist/[id]/route.ts`, modeled on
`app/api/admin/partner-keys/[id]/route.ts`'s auth/404/200 shape, adapted to `requireSuperAdmin()`
instead of raw Clerk `auth()` since this is an internal-admin route, not a partner-scoped one):
```ts
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error
  const result = await deleteWaitlistSignup(params.id)
  if (!result.found) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Entry not found.' } }, { status: 404 })
  }
  if (!result.success) {
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to delete entry.' } }, { status: 500 })
  }
  return NextResponse.json({ success: true }, { status: 200 })
}
```

### 6.4 — Resend email notification

New function in `lib/delivery/email.ts`, `sendNewWaitlistSignupEmail(toEmail, name, email)`,
following this file's exact established pattern (placeholder-guard check, `logEmailResult()` call,
try/catch returning `EmailResult`, same dark-theme HTML template structure as
`sendLowBalanceAlertEmail`/`sendDemoLowBalanceAlertEmail` — CLIO wordmark, H1, body paragraph, one
purple CTA button):

```ts
export async function sendNewWaitlistSignupEmail(
  toEmail: string,
  name: string,
  signupEmail: string
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendNewWaitlistSignupEmail', { toEmail, name, signupEmail })
    return { success: true, messageId: 'mock-waitlist-signup-id' }
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  // subject: `New waitlist signup — ${name}`
  // html: same table/CLIO-header/H1/body/button template as sendLowBalanceAlertEmail, body copy:
  //   "${name} (${signupEmail}) just joined the Clio waitlist."
  // CTA button: "View waitlist →" → `${appUrl}/dashboard/admin/waitlist`
  // text fallback: `${name} (${signupEmail}) just joined the Clio waitlist. View at ${appUrl}/dashboard/admin/waitlist`
  // ...same try/catch/logEmailResult wiring as every other function in this file
}
```

- Call site: `submitWaitlistSignup()` in `lib/partner/waitlist.ts`, immediately after a successful
  insert, sent to every `getActiveSuperAdminEmails()` address (imported from
  `lib/partner/sales-partner-leads.ts` — that function is already generic, not
  sales-partner-lead-specific, so it's reused as-is, not duplicated).
- Failure-tolerant: wrapped in `.catch()` per-recipient exactly like
  `submitSalesPartnerLead()` does, so a Resend outage never blocks the visitor's 200 response or
  the DB insert.

### 6.5 — Env vars

No new env vars. Reuses `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`,
`NEXT_PUBLIC_APP_URL` — all already documented in `.env.local.example`.

## 7. Success Criteria (Acceptance Tests)

✓ Given the homepage, when it loads, then `MarketingNav` shows no "Log in" link and its "Get
  started" link points to `/#waitlist`.

✓ Given the homepage, when a visitor clicks the Hero primary button, the BottomCTA button, or nav
  "Get started," then the page scrolls to the waitlist section (`#waitlist`).

✓ Given the waitlist form, when a visitor submits a valid name and a new (never-seen) email, then
  the form shows the submitting state, then the success state ("You're on the list."), a row is
  inserted into `waitlist_signups`, and `sendNewWaitlistSignupEmail` fires to every active
  super-admin email.

✓ Given the waitlist form, when a visitor submits an email that already exists in
  `waitlist_signups`, then the API returns `200 { duplicate: true }`, the form shows "You're
  already on the list," and no second row is inserted (no unique-constraint violation surfaced to
  the user).

✓ Given the waitlist form, when a visitor submits with an empty name or an invalid email format,
  then client-side validation blocks submission and shows the corresponding inline field error,
  with no network request sent.

✓ Given the waitlist form, when the honeypot (`website`) field is non-empty (bot fill), then the
  API returns `200 { success: true }` with no row written and no visible difference to the caller.

✓ Given the waitlist form, when the `POST /api/waitlist` call fails (network error or 500), then
  the form shows the generic error state with the retry-enabled button, and the fields retain
  their entered values.

✓ Given `/dashboard/admin/waitlist`, when a signed-in super-admin visits it, then they see every
  `waitlist_signups` row (name, email, relative timestamp), newest first.

✓ Given `/dashboard/admin/waitlist`, when a signed-in non-super-admin (internal_staff or no
  `internal_admin_users` row) visits it, then they receive a 404 (via `notFound()`), matching
  `sales-partner-leads`'s existing gate behavior.

✓ Given `/dashboard/admin/waitlist`, when a signed-out visitor requests it directly, then they are
  redirected to `/sign-in`.

✓ Given an admin waitlist row, when the admin clicks the trash icon then "Confirm delete," then a
  `DELETE /api/admin/waitlist/[id]` call fires, the row is removed from Supabase and from the
  visible list on success.

✓ Given an admin waitlist row, when the admin clicks the trash icon then "Cancel," then no delete
  request fires and the row reverts to its normal display.

✓ Given `DELETE /api/admin/waitlist/[id]` with an id that doesn't exist (already deleted, e.g. a
  double-click race), then the route returns 404 and the client shows the row-level retry error
  (since the row it tried to delete is already gone from its local state's perspective, this
  presents identically to any other delete failure — no special-cased UI needed).

✓ Given a mobile viewport (< 640px), when viewing the homepage waitlist section, then the form
  card, heading, and buttons render full-width with no horizontal scroll and no fixed pixel-width
  caps (fluid Tailwind + the section's existing `px-4 md:px-6` / `max-w-2xl` pattern).

✓ Given a mobile viewport, when viewing `/dashboard/admin/waitlist`, then each row stacks
  name/email/timestamp/delete responsively (`flex-col sm:flex-row`, matching
  `SalesPartnerLeadsClient`'s existing responsive row pattern) with no horizontal scroll.

## 8. Error States

| Input/call | Failure | User sees |
|---|---|---|
| Name field | empty on submit | Inline "Your name is required" under the field, submit blocked client-side |
| Email field | empty or invalid format on submit | Inline "Enter a valid email address" under the field, submit blocked client-side |
| `POST /api/waitlist` | Zod validation fails server-side (should be rare given client checks) | Generic error banner: "Something went wrong. Please try again." |
| `POST /api/waitlist` | Duplicate email (unique constraint) | Friendly "You're already on the list" success-styled state — not treated as an error |
| `POST /api/waitlist` | Supabase insert fails for any other reason | 500, generic error banner shown, form retained with values intact so the visitor can retry without retyping |
| `POST /api/waitlist` | Resend send fails after successful insert | Silently logged server-side only (`console.error`); visitor still sees success — the DB insert already succeeded, which is the source of truth, not the notification |
| `GET /api/admin/waitlist` | Fails to load (network/500) | "Couldn't load the waitlist. Try refreshing." |
| `DELETE /api/admin/waitlist/[id]` | Network/500 failure | Row-level error text: "Couldn't delete this entry. Try again.", trash icon restored for retry |
| `DELETE /api/admin/waitlist/[id]` | 404 (already deleted) | Same row-level retry error text (no distinct copy — see acceptance test above) |
| Admin page | `requireSuperAdmin()` fails (internal_staff or no row) | `notFound()` → Next.js 404 page, same as `sales-partner-leads` |
| Admin page | No Clerk session at all | `redirect('/sign-in')` |

## 9. Edge Cases

- **Same email submitted twice in quick succession (double-click / slow network retry):** the
  UNIQUE constraint at the DB level is the actual source of truth (not a client-side debounce), so
  even a double-fired request resolves to one row + a `duplicate` response on the second — no race
  condition produces two rows.
- **Email with different casing** (`Jane@Company.com` vs `jane@company.com`): treated as distinct
  rows under a plain `UNIQUE` constraint (Postgres text comparison is case-sensitive by default).
  This BA's decision: **do not** normalize to lowercase before the uniqueness check or storage —
  matches `sales_partner_leads.email`'s own existing behavior (that table also has no case
  normalization), so this stays consistent with established codebase precedent rather than
  introducing a new normalization rule unilaterally.
- **Visitor on `/partner-inquiry` directly (not via homepage):** unaffected — that page and its API
  are completely untouched by this spec, still fully functional as a standalone route.
  `MarketingNav` still renders on `/partner-inquiry` (it's used site-wide) with the same rewired
  "Get started" → `/#waitlist` link, meaning a visitor already on the inquiry page can still reach
  the waitlist via nav.
  This is not a UX gap the CEO Decision needs to close further per Section 4.A of the brief.
- **Visitor with JavaScript disabled:** out of scope — this is a client-component form like
  `partner-inquiry`'s, which already has this same characteristic; no server-rendered fallback is
  built.
- **Admin deletes the last entry in the list:** list re-renders to the standard empty state ("No
  one has joined the waitlist yet.").
- **Very long name or email at the max length (200/320 chars):** `truncate` classes on both list
  fields prevent layout breakage; full value still stored and available via future export/inspect
  tooling (not built in this spec — no such tooling requested).
- **Mobile viewport for both new screens:** covered explicitly in Section 7's acceptance criteria;
  implementation uses the same fluid Tailwind classes and `clamp()`-free but percentage/breakpoint-driven
  layout already used by `SalesPartnerLeadsClient.tsx` and `partner-inquiry/page.tsx` — no new
  pixel-width caps introduced anywhere in this feature.

## 10. Out of Scope

- The $10 demo-passcode purchase flow, Stripe checkout for it, passcode generation/email, or any
  pricing/signup-fee mechanics. Tracked separately: log a new `DEMO-PASSCODE-01` entry in
  `BACKLOG.md`, clearly marked not-started, once this spec is approved and dispatched — that is the
  orchestrator's job, not this BA's, per the Feature Brief's explicit instruction.
- Any change to `/partner-inquiry`'s own form, copy, fields, or API route — it is demoted in
  prominence only, exactly as described in Section 4.A, nothing about the route itself changes.
- Exporting waitlist entries (CSV/etc.) — not requested.
- Editing a waitlist entry after submission — not requested; only view (list) and delete.
- Any bulk-delete / select-multiple UX — the brief and CEO Decision describe single-entry delete
  only ("admin can also delete waitlist members," no bulk language).
- Rate-limiting or CAPTCHA on the public waitlist endpoint beyond the existing honeypot pattern —
  matches `/partner-inquiry`'s own current scope; no request for anything stronger.
- Any change to `internal_admin_users`, `requireSuperAdmin()`, or the admin auth model itself —
  reused exactly as-is.
- A modal/dialog component system — the inline two-step confirm (Section 4.D) is a deliberate
  scope-minimal choice, not a placeholder for a future modal; introducing a reusable modal
  component is out of scope for this spec.
- Waitlist position/count display to the visitor (e.g. "You're #47") — not requested, not built.

## 11. Open Questions

None.

## 12. Dependencies

- `lib/internal-admin/auth.ts`'s `requireSuperAdmin()` — must exist and behave as documented
  above (it already does; no changes needed).
- `lib/partner/sales-partner-leads.ts`'s `getActiveSuperAdminEmails()` — reused as-is, no changes
  needed.
- `lib/delivery/email.ts`'s existing Resend client/placeholder-guard setup — reused as-is.
- `components/dashboard/DashboardShell` — reused as-is for the admin page shell.
- `components/ui/Button`, `components/ui/Card` — reused as-is.
- Migration `118_waitlist01_signups.sql` must run before any of the API routes or admin page are
  deployed (standard migration-then-deploy ordering, same as every prior migration in this repo).
- No dependency on any in-progress or not-yet-built Feature Brief.

## Files Changed

**New files:**
- `supabase/migrations/118_waitlist01_signups.sql` — `waitlist_signups` table + RLS policy.
- `lib/partner/waitlist.ts` — `submitWaitlistSignup()`, `listWaitlistSignups()`,
  `deleteWaitlistSignup()`.
- `app/api/waitlist/route.ts` — `POST /api/waitlist` (public submit).
- `app/api/admin/waitlist/route.ts` — `GET /api/admin/waitlist` (admin list).
- `app/api/admin/waitlist/[id]/route.ts` — `DELETE /api/admin/waitlist/[id]` (admin delete).
- `app/(with-clerk)/dashboard/admin/waitlist/page.tsx` — admin page server component
  (auth gate + `DashboardShell`).
- `app/(with-clerk)/dashboard/admin/waitlist/WaitlistClient.tsx` — admin page client component
  (list + delete UI).
- `components/marketing/WaitlistForm.tsx` — the client-side waitlist form (idle/submitting/
  success/duplicate/error states).

**Modified files:**
- `components/marketing/MarketingNav.tsx` — remove "Log in" link; repoint "Get started" to
  `/#waitlist`.
- `app/(with-clerk)/(marketing)/page.tsx` — add `WaitlistSection` component (renders
  `WaitlistForm` inside the section markup described in Section 4.B) between `Testimonials` and
  `BottomCTA`; repoint `Hero`'s and `BottomCTA`'s primary CTA `href`s from `/partner-inquiry` to
  `/#waitlist`; add the `/partner-inquiry` secondary link under the new form per Section 4.A.
- `lib/delivery/email.ts` — add `sendNewWaitlistSignupEmail()`.
- `app/(with-clerk)/dashboard/admin/page.tsx` (the admin index) — add a "Waitlist" nav entry
  pointing to `/dashboard/admin/waitlist`, matching however the existing "Sales-partner leads"
  entry is rendered there (same list-item/card pattern, not inspected line-by-line in this spec
  since it's a trivial one-line addition following an existing established pattern on that page —
  the developer should locate the existing `/dashboard/admin/sales-partner-leads` entry on that
  index page and add a sibling entry for `/dashboard/admin/waitlist` in the same format).
- `BACKLOG.md` — update the WAITLIST-01 entry to reflect this narrowed-scope spec superseding the
  combined entry, and log the new `DEMO-PASSCODE-01` stub per Section 10 (orchestrator's task,
  noted here for completeness of the file-change picture).
