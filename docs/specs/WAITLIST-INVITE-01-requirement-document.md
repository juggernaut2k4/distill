# WAITLIST-INVITE-01 — One-Click Waitlist Invite Email
# Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-09-06

Source Feature Brief: `.claude/agents/clio/feature-briefs/WAITLIST-INVITE-01-one-click-waitlist-invite-email.md`
Prior art read in full: `lib/internal-admin/direct-partner-invites.ts`, `lib/internal-admin/invite-tokens.ts`,
`lib/internal-admin/auth.ts`, `app/api/admin/partner-invites/route.ts`, `app/api/admin/waitlist/route.ts`,
`app/api/admin/waitlist/[id]/route.ts`, `lib/partner/waitlist.ts`,
`app/(with-clerk)/dashboard/admin/waitlist/WaitlistClient.tsx` + `page.tsx`,
`supabase/migrations/116_b2b80_sales_partner_leads.sql`, `118_waitlist01_signups.sql`,
`119_demo_passcode01_public_buyer_passcodes.sql`, `lib/delivery/email.ts` (`sendInternalStaffInviteEmail`,
`sendPartnerTeamInviteEmail`), `app/api/partner-invite/accept/route.ts`, `lib/partner/signup.ts`.

**Confirmed invite TTL, read directly from `lib/internal-admin/invite-tokens.ts`'s `inviteExpiresAt()`:
7 days from issuance** (`Date.now() + 7 * 24 * 60 * 60 * 1000`) — the Feature Brief's assumption was
correct; this document uses the confirmed value, not an assumption, throughout.

---

## 1. Purpose

Today, converting a waitlist signup into an activated partner account requires an admin to leave
`/dashboard/admin/waitlist`, open the separate `/dashboard/admin/partner-invites` tool, generate a link,
and manually copy/paste/send it themselves. That hop is friction on the single workflow this whole
feature exists to serve: turning waitlist interest into a signed-up partner. This document collapses
that into one click, from the exact screen an admin is already looking at the lead on.

**What failure looks like without this document:** waitlist signups keep piling up as inert rows an
admin has to remember to go convert manually elsewhere, with no record on the waitlist page itself of
who has already been invited — increasing the odds someone is invited twice, or never invited at all
because the extra hop got skipped.

## 2. User Story

As a super-admin reviewing `/dashboard/admin/waitlist`,
I want to click a single "Invite" button on a waitlist row,
So that the person is issued a partner invite and emailed the link immediately, with no separate tool
and no copy/paste.

As a waitlist signup who receives the invite email,
I want to click "Accept your invite" and land on the existing sign-up flow,
So that I get a working partner account exactly as anyone else who receives a Clio invite does.

## 3. Trigger / Entry Point

- **Page:** `/dashboard/admin/waitlist` (existing, unchanged route) — super-admin only
  (`requireSuperAdmin()`, enforced both at the page level via `page.tsx`'s existing gate and at the API
  level).
- **New action:** clicking the "Invite" button on a waitlist row that has no invite yet.
- **New API route this triggers:** `POST /api/admin/waitlist/[id]/invite`, `id` = the `waitlist_signups`
  row's UUID from the path. No request body.
- **State required:** admin must be an active Clerk-authenticated `super_admin`
  (`internal_admin_users.role = 'super_admin'`) — identical gate to every other route on this page.
- **Existing, unmodified trigger downstream:** the invitee clicking the emailed link lands on
  `GET`/`POST /api/partner-invite/accept` (unchanged, per the Feature Brief's constraint) — this
  document only confirms the token it consumes is produced identically to every other
  `direct_partner_invites` row.

## 4. Screen / Flow Description

All changes are confined to `WaitlistClient.tsx`'s existing row rendering; the page shell, header, and
delete flow are untouched.

**Row, no invite yet (default state — today's behavior plus one new button):**
Each row currently renders: name, email, relative timestamp, then the delete icon (`Trash2`), inside a
`flex flex-col sm:flex-row` row. This adds one new element between the timestamp and the delete icon:
an "Invite" text button, `text-[#7C3AED] text-xs font-semibold hover:text-[#A855F7] transition-colors
shrink-0 whitespace-nowrap` — plain text, no border/background, matching this file's existing
button-as-text convention (see the "Confirm delete" / "Cancel" buttons already in this file) rather than
inventing a new bordered-button visual language for one action.

**Row, invite in flight (button clicked, request pending):**
The "Invite" button is replaced in place by a `Loader2` spinner (`w-4 h-4 text-[#475569] animate-spin
shrink-0`) — identical treatment to this file's existing `deletingId`-driven spinner swap for the delete
action. The delete icon for that row is also disabled for the duration (prevents deleting a row whose
invite call is still in flight).

**Row, invite issued (any of the four statuses) — no button, a status label instead:**
The "Invite" button's slot is replaced by a plain text label, same classes as the row's existing
timestamp span (`text-[#475569] text-xs whitespace-nowrap`) — deliberately not a colored/pill badge, per
the Feature Brief's explicit instruction not to invent a new visual language for a one-word-ish status
label:
- Pending: `Invited · {relative time since invite created_at}` (reusing the file's existing
  `formatRelative()` helper verbatim — e.g. `Invited · 2 days ago`, `Invited · today`)
- Accepted: `Signed up`
- Expired: `Invite expired`
- Revoked: `Invite revoked`

No re-invite action is offered for any of these four states in this iteration (Feature Brief decision
5) — the delete icon remains available regardless of invite state (deleting the waitlist row does not
touch the `direct_partner_invites` row it produced; see §9).

**Row, invite click failed (network/500 error):**
Same inline-error convention this file already uses for a failed delete
(`rowError?.id === signup.id && <p className="text-[#EF4444] text-xs mt-2">…</p>`) — reused for this
action too, sharing the same `rowError` state slot (a row can only be doing one action at a time in this
UI, so no collision). Message: `"Couldn't send this invite. Try again."` The row falls back to showing
the "Invite" button again (not the loading spinner) so the admin can retry.

**Mobile layout:** the new element sits inside the row's existing `flex flex-col sm:flex-row` wrapper —
on narrow viewports it wraps onto its own line below name/email exactly as the timestamp and delete icon
already do today, with no new breakpoint or fixed width introduced (per the standing responsive rule).
No layout change was needed to the row's container; only one new inline child was added to it.

## 5. Visual Examples

**State 1 — no invite yet:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Jane Doe        jane@example.com        2 days ago   Invite    🗑    │
└──────────────────────────────────────────────────────────────────────┘
```

**State 2 — invite in flight:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Jane Doe        jane@example.com        2 days ago     ⟳       🗑    │
└──────────────────────────────────────────────────────────────────────┘
```
(spinner in place of the button; delete icon dimmed/disabled)

**State 3a — invited, pending:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Jane Doe        jane@example.com        2 days ago  Invited · just  │
│                                                        now       🗑    │
└──────────────────────────────────────────────────────────────────────┘
```

**State 3b — accepted:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Jane Doe        jane@example.com        2 days ago   Signed up  🗑   │
└──────────────────────────────────────────────────────────────────────┘
```

**State 3c — expired:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Jane Doe        jane@example.com        9 days ago  Invite expired 🗑│
└──────────────────────────────────────────────────────────────────────┘
```

**State 3d — revoked (admin revoked it from the other `/dashboard/admin/partner-invites` page):**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Jane Doe        jane@example.com        5 days ago  Invite revoked 🗑│
└──────────────────────────────────────────────────────────────────────┘
```

**State 4 — invite click failed:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  Jane Doe        jane@example.com        2 days ago   Invite    🗑    │
│  Couldn't send this invite. Try again.                                │
└──────────────────────────────────────────────────────────────────────┘
```

**Mobile (state 1, narrow viewport — existing `flex-col` wrap, unchanged pattern):**
```
┌───────────────────────────────┐
│  Jane Doe                     │
│  jane@example.com             │
│  2 days ago   Invite     🗑    │
└───────────────────────────────┘
```

## 6. Data Requirements

### 6.1 Schema — new migration `supabase/migrations/120_waitlistinvite01_source_waitlist_id.sql`

Next available migration number confirmed by listing `supabase/migrations/`: highest existing is
`119_demo_passcode01_public_buyer_passcodes.sql`, so this is `120_...`.

```sql
-- WAITLIST-INVITE-01 (docs/specs/WAITLIST-INVITE-01-requirement-document.md §6.1) — one-click invite
-- from the waitlist admin page, reusing the existing direct_partner_invites mechanism (B2B-28/B2B-80)
-- rather than a parallel invite system. Purely additive: does not touch, widen, or drop
-- source_lead_id (116_b2b80_sales_partner_leads.sql) or any existing column/row.

ALTER TABLE direct_partner_invites
  ADD COLUMN IF NOT EXISTS source_waitlist_id UUID REFERENCES waitlist_signups(id);

-- UNIQUE (not a plain index): closes the double-click/double-request race server-side, the same way
-- WAITLIST-01's own waitlist_signups.email UNIQUE constraint (118_waitlist01_signups.sql) closes the
-- analogous duplicate-signup race with a hard DB constraint rather than a check-then-insert dance. A
-- second concurrent invite attempt for the same waitlist row hits a 23505 unique violation, which
-- issueDirectPartnerInvite() (lib/internal-admin/direct-partner-invites.ts) maps to
-- errorCode: 'duplicate_source_waitlist', and the new route maps to HTTP 409 (§6.2, §9).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_direct_partner_invites_source_waitlist_id
  ON direct_partner_invites(source_waitlist_id)
  WHERE source_waitlist_id IS NOT NULL;

COMMENT ON COLUMN direct_partner_invites.source_waitlist_id IS
  'WAITLIST-INVITE-01: set when an admin clicks "Invite" on a waitlist_signups row from
  /dashboard/admin/waitlist. Mutually exclusive with source_lead_id by construction (only one call
  site sets each column) — a row has at most one of the two set, or neither for a manually-generated
  invite with no source. target_account_kind is always ''partner'' for a waitlist-sourced invite (a
  waitlist signup is a prospective ordinary partner, never a channel partner).';
```

No new table. No change to `waitlist_signups` (migration 118) or to `source_lead_id`/its own behavior
(migration 116).

### 6.2 `issueDirectPartnerInvite()` — extended signature

`lib/internal-admin/direct-partner-invites.ts`. Current signature (unchanged for every existing caller —
`sourceWaitlistId` is a new, optional 5th parameter appended after `sourceLeadId`, so
`app/api/admin/partner-invites/route.ts`'s existing call site needs zero changes):

```ts
export async function issueDirectPartnerInvite(
  label: string | null,
  createdByInternalAdminUserId: string,
  targetAccountKind: 'partner' | 'channel_partner' = 'partner',
  sourceLeadId?: string,
  sourceWaitlistId?: string
): Promise<{
  success: boolean
  acceptUrl: string | null
  error: string | null
  /** New — set only when the insert failed because of the new unique index (§6.1), so callers can
   *  distinguish "already invited" (409) from any other failure (500). Undefined for every existing
   *  caller's failure paths, which never touch source_waitlist_id. */
  errorCode?: 'duplicate_source_waitlist'
  /** New — the newly-created invite row's own id and created_at, so the new route (§6.3) can build
   *  its response without a second read-back query. Both undefined on failure. */
  inviteId?: string
  createdAt?: string
}>
```

Internal changes:
- The `.insert({...})` call adds `source_waitlist_id: sourceWaitlistId ?? null` alongside the existing
  `source_lead_id: sourceLeadId ?? null`.
- The `.select('id')` after insert becomes `.select('id, created_at')`.
- On insert error: if `sourceWaitlistId` was set and `error.code === '23505'`, return
  `{ success: false, acceptUrl: null, error: error.message, errorCode: 'duplicate_source_waitlist' }`.
  Otherwise, unchanged behavior (`error: error?.message ?? 'Failed to create invite.'`, no `errorCode`).
- On success: return `{ success: true, acceptUrl, error: null, inviteId: inserted.id, createdAt:
  inserted.created_at }` (existing `acceptUrl` construction is unchanged).
- The existing `sourceLeadId`-only branch (flipping `sales_partner_leads.status` to `'invited'`) is
  untouched and does not run when only `sourceWaitlistId` is set — the two source params are mutually
  exclusive by caller discipline, exactly as the Feature Brief specifies. This route (§6.3) always calls
  with `sourceLeadId` omitted.

### 6.3 New route — `POST /api/admin/waitlist/[id]/invite`

New file: `app/api/admin/waitlist/[id]/invite/route.ts`.

```ts
const ParamsSchema = z.object({ id: z.string().uuid() })
```

No request body is accepted or parsed — the row's `name`/`email` are read server-side from
`waitlist_signups`, never trusted from the client (Feature Brief decision 6). `requireSuperAdmin()` only
— same auth gate as every other route on this page.

**Handler logic, in order:**
1. `ParamsSchema.safeParse({ id: params.id })` — 400 on failure (malformed id; not a real-world case
   since the id always comes from the page's own fetched rows, but validated per this project's
   "all API inputs Zod-validated" rule).
2. `requireSuperAdmin()` — propagate its 401/403 unchanged.
3. Fetch the waitlist row: `select id, name, email from waitlist_signups where id = :id`. If not found:
   `404 { error: { code: 'not_found', message: 'Entry not found.' } }`.
4. Call `issueDirectPartnerInvite(null, admin.internalAdminUserId, 'partner', undefined, id)`.
   - If `result.errorCode === 'duplicate_source_waitlist'`: `409` (§8/§9 — the double-click/refresh
     race). Response body: `{ error: { code: 'already_invited', message: 'An invite has already been
     issued to this person.' } }`. The client does not need the existing invite's status in this
     response — on receiving 409 it re-fetches the row list (§6.4) to pick up the authoritative badge
     state, rather than trying to reconstruct it from this error.
   - If `result.success === false` for any other reason: `500 { error: { code: 'internal_error',
     message: "Couldn't send this invite. Try again." } }` (logged server-side with the real
     `result.error`, never exposed to the client — matches every other route's discipline in this
     codebase).
5. On success, send the email: `await sendWaitlistInviteEmail(waitlistRow.email, waitlistRow.name,
   result.acceptUrl!)`, wrapped so a rejected promise can't throw past this point (mirrors
   `sendPartnerSignupWelcomeEmail`'s `.catch()` convention in `lib/partner/signup.ts`).
6. Respond `201`:
   ```json
   {
     "success": true,
     "invite": {
       "status": "pending",
       "created_at": "<result.createdAt, ISO 8601>"
     },
     "email_sent": true
   }
   ```
   `email_sent` is `false` (never the request's overall success) if step 5's send failed or threw — the
   invite row was already created successfully in step 4, so this is not an error response (§8's
   "invite creation succeeds, email send fails" case, resolved: 201 either way, `email_sent` is the only
   signal that distinguishes the two outcomes). The UI (§6.5) treats both `email_sent` values identically
   for the badge (flips to "Invited · just now" either way, since a re-invite/resend action doesn't
   exist in this iteration — Feature Brief decision 5), but shows a one-time, non-persisted inline note
   when `email_sent` is `false`: `"Invite created, but the email couldn't be sent. Ask them to reach out
   if they don't receive it."` — using the same inline-message slot the row's error state (§4) already
   has, styled the same way (`text-[#EF4444] text-xs mt-2`) since it is genuinely something the admin
   needs to notice and possibly act on manually, even though the invite itself succeeded.

**Whether the waitlist email already has a `partner_accounts` row (Brief's explicit question):** not
checked at this layer. `partner_accounts`/`partner_admin_users` have no email column to match against
server-side without a separate Clerk lookup, and no existing utility in this codebase performs that
check for any other invite source either (`sales_partner_leads`' own "Invite" flow doesn't check it).
This is unchanged, existing behavior, not new work: if the invitee already administers a partner account
under the email they eventually sign in with, `createOrClaimPartnerAccount`'s existing `alreadyMember`
branch (`lib/partner/signup.ts`, untouched by this document) handles it identically to any other invite
source today — the invite is not marked accepted, and the accept-flow response reports
`alreadyMember: true`.

### 6.4 `GET /api/admin/waitlist` — extended response shape

`app/api/admin/waitlist/route.ts` itself does not change (still just `requireSuperAdmin()` +
`listWaitlistSignups()`); the shape change is entirely inside `listWaitlistSignups()`
(`lib/partner/waitlist.ts`).

**New exported helper in `lib/internal-admin/direct-partner-invites.ts`** (the existing `computedStatus`
helper is reused, not duplicated):

```ts
export interface WaitlistInviteStatus {
  sourceWaitlistId: string
  status: DirectPartnerInviteRow['status'] // 'pending' | 'accepted' | 'revoked' | 'expired'
  createdAt: string
}

export async function getDirectPartnerInvitesBySourceWaitlistIds(
  waitlistIds: string[]
): Promise<WaitlistInviteStatus[]> {
  if (waitlistIds.length === 0) return []
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('direct_partner_invites')
    .select('source_waitlist_id, status, invite_token_expires_at, created_at')
    .in('source_waitlist_id', waitlistIds)

  return (data ?? []).map((row) => ({
    sourceWaitlistId: row.source_waitlist_id as string,
    status: computedStatus(row as { status: string; invite_token_expires_at: string }),
    createdAt: row.created_at as string,
  }))
}
```

**`lib/partner/waitlist.ts`'s `listWaitlistSignups()`** is extended to call this after its existing
query and merge by id (one extra query, batched — not N+1):

```ts
export interface WaitlistSignup {
  id: string
  name: string
  email: string
  created_at: string
  invite: { status: 'pending' | 'accepted' | 'revoked' | 'expired'; created_at: string } | null
}
```

**`GET /api/admin/waitlist` response (extended, additive field only):**
```json
{
  "signups": [
    {
      "id": "3f9c...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "created_at": "2026-09-01T10:00:00.000Z",
      "invite": { "status": "pending", "created_at": "2026-09-04T09:12:00.000Z" }
    },
    {
      "id": "a1b2...",
      "name": "John Smith",
      "email": "john@example.com",
      "created_at": "2026-09-02T14:30:00.000Z",
      "invite": null
    }
  ]
}
```
`invite: null` means no invite has been issued yet — the row shows the "Invite" button (§4). Any
non-null `invite` means the row shows the corresponding status label and no button.

### 6.5 `WaitlistClient.tsx` changes

`WaitlistRow` interface extended to match §6.4's response exactly:
```ts
interface WaitlistRow {
  id: string
  name: string
  email: string
  created_at: string
  invite: { status: 'pending' | 'accepted' | 'revoked' | 'expired'; created_at: string } | null
}
```

New state, alongside the existing `confirmingId`/`deletingId`/`rowError`:
```ts
const [invitingId, setInvitingId] = useState<string | null>(null)
```
(`rowError` is reused as-is for both delete and invite failures/warnings — it already carries `{ id,
message }`, which is all either case needs.)

New handler:
```ts
async function handleInvite(id: string) {
  setInvitingId(id)
  setRowError(null)
  try {
    const res = await fetch(`/api/admin/waitlist/${id}/invite`, { method: 'POST' })
    const data = await res.json().catch(() => null)
    if (res.status === 409) {
      await loadSignups() // authoritative refresh rather than guessing the existing state (§6.3)
      return
    }
    if (!res.ok) throw new Error('failed')
    setSignups((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, invite: { status: 'pending', created_at: data.invite.created_at } } : s
      )
    )
    if (data.email_sent === false) {
      setRowError({ id, message: "Invite created, but the email couldn't be sent. Ask them to reach out if they don't receive it." })
    }
  } catch {
    setRowError({ id, message: "Couldn't send this invite. Try again." })
  } finally {
    setInvitingId(null)
  }
}
```
This is the "optimistic local update, re-fetch only on the 409 race" approach the Feature Brief allows
(decision 6) — chosen over a full re-fetch on every success because it matches this file's existing
delete flow's own local-state-update pattern exactly (`setSignups((prev) => prev.filter(...))`).

### 6.6 New email function — `lib/delivery/email.ts`

Added immediately after `sendPartnerTeamInviteEmail` (the file's most recently added invite-email
function), following its exact structural pattern — same dark-void HTML skeleton, same `#7C3AED` CTA
button, same `isPlaceholder`/mock guard, same `logEmailResult` call, same try/catch returning
`EmailResult`:

```ts
/**
 * WAITLIST-INVITE-01 (docs/specs/WAITLIST-INVITE-01-requirement-document.md §6.6) — one-click invite
 * email sent when a super-admin clicks "Invite" on a waitlist_signups row. Same dark-void/#7C3AED-CTA
 * HTML skeleton as sendInternalStaffInviteEmail/sendPartnerTeamInviteEmail. Non-blocking best-effort
 * send — the underlying direct_partner_invites row is already created and valid regardless of whether
 * this send succeeds (app/api/admin/waitlist/[id]/invite/route.ts §6.3).
 * @param toEmail - the waitlist signup's own email address (waitlist_signups.email)
 * @param name - the waitlist signup's own name (waitlist_signups.name)
 * @param acceptUrl - the full `/partner-invite/accept?token=...` URL
 */
export async function sendWaitlistInviteEmail(
  toEmail: string,
  name: string,
  acceptUrl: string
): Promise<EmailResult> {
  if (isPlaceholder || !resend) {
    console.log('[MOCK] sendWaitlistInviteEmail', { toEmail, name, acceptUrl })
    return { success: true, messageId: 'mock-waitlist-invite-id' }
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: `You're invited to Clio`,
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#080808;color:#ffffff;font-family:Inter,system-ui,sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:40px 24px;">
    <tr><td>
      <p style="color:#7C3AED;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 32px;">CLIO</p>
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;margin:0 0 12px;">You're invited to Clio, ${name}.</h1>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 8px;">
        Thanks for joining the Clio waitlist. You're invited to set up your partner account now.
      </p>
      <p style="color:#94A3B8;font-size:16px;line-height:1.7;margin:0 0 32px;">
        This invite expires in 7 days.
      </p>
      <div style="background:#111111;border:1px solid #222222;border-radius:12px;padding:32px;text-align:center;">
        <a href="${acceptUrl}" style="background:#7C3AED;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">Accept your invite →</a>
      </div>
    </td></tr>
  </table>
</body>
</html>`,
      text: `Thanks for joining the Clio waitlist, ${name}. You're invited to set up your partner account now. This invite expires in 7 days. Accept your invite: ${acceptUrl}`,
    })

    logEmailResult('sendWaitlistInviteEmail', toEmail, result)
    if (result.error) {
      return { success: false, error: result.error.message }
    }

    return { success: true, messageId: result.data?.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[email:sendWaitlistInviteEmail] EXCEPTION to=${toEmail}:`, message)
    return { success: false, error: message }
  }
}
```

### 6.7 Untouched, confirmed unchanged

- `/dashboard/admin/partner-invites` and `app/api/admin/partner-invites/route.ts` — zero behavior
  change; `issueDirectPartnerInvite`'s new 5th parameter is optional and this route's call site never
  passes it, so it always inserts `source_waitlist_id: null` exactly as it inserts today (implicitly,
  via the new `?? null` default).
- The sales-partner-lead invite flow (`sales_partner_leads` → `direct_partner_invites` via
  `source_lead_id`) — untouched; its own branch inside `issueDirectPartnerInvite` is gated on
  `sourceLeadId` being set, which this document's caller never sets.
- `/partner-invite/accept` (`app/api/partner-invite/accept/route.ts`) and
  `lib/partner/signup.ts`'s `createOrClaimPartnerAccount` — zero changes. A waitlist-sourced invite's
  token is a `direct_partner_invites` row indistinguishable, at accept time, from any other
  `target_account_kind = 'partner'` invite — `lookupDirectPartnerInviteByToken` and
  `markDirectPartnerInviteAccepted` don't reference `source_waitlist_id`/`source_lead_id` at all, so
  this flow consumes the new token type unchanged.

## 7. Success Criteria (Acceptance Tests)

✓ Given a waitlist row with no invite yet, when the super-admin clicks "Invite," then a
`direct_partner_invites` row is created with `source_waitlist_id` set to that row's id,
`target_account_kind = 'partner'`, `status = 'pending'`, and `invite_token_expires_at` 7 days out, and
the row's button flips to `Invited · just now` without a full page reload.

✓ Given a successful invite creation, when the email send also succeeds, then the invitee receives an
email at their waitlist `email` address with subject `You're invited to Clio`, containing an "Accept
your invite →" link that resolves via `GET /api/partner-invite/accept?token=...` to `{ valid: true }`.

✓ Given a successful invite creation where the email send fails (e.g. Resend API error), when the
response returns, then the HTTP status is still `201`, `email_sent` is `false`, the row still flips to
the "Invited" state, and the admin sees the inline "couldn't be sent" note once.

✓ Given a waitlist row whose invite has already been issued (any of pending/accepted/expired/revoked),
when the admin loads or refreshes the page, then no "Invite" button is shown for that row — only the
corresponding status label — and there is no way to trigger a second invite for it from this page.

✓ Given two near-simultaneous clicks (or two admins) on the same row's "Invite" button, when both
requests reach the server, then exactly one `direct_partner_invites` row is created (enforced by the
`uidx_direct_partner_invites_source_waitlist_id` unique index) and the losing request receives `409
already_invited`, not a second invite and not a 500.

✓ Given a waitlist signup accepts their invite via the existing, unmodified `/partner-invite/accept`
flow, when `createOrClaimPartnerAccount` succeeds, then `direct_partner_invites.status` becomes
`'accepted'` and the waitlist row's badge (on next load) reads `Signed up`.

✓ Given a `direct_partner_invites` row whose `invite_token_expires_at` has passed and whose `status` is
still `'pending'` in the DB, when the waitlist page loads, then the badge reads `Invite expired`, not
`Invited · N days ago` — `computedStatus()`'s existing lazy expiry check (reused unchanged) is what
produces this, confirmed by the same logic already governing `/dashboard/admin/partner-invites`'s own
list.

✓ Given an admin revokes a waitlist-sourced invite from the existing `/dashboard/admin/partner-invites`
page (unmodified `revokeDirectPartnerInvite`), when the waitlist page is next loaded, then that row's
badge reads `Invite revoked`.

✓ Given the waitlist page is viewed at a mobile viewport width, when a row has either the "Invite"
button or any status badge, then it wraps onto its own line below name/email using the row's existing
`flex-col sm:flex-row` behavior, with no horizontal overflow and no fixed pixel width introduced.

## 8. Error States

| Failure | Response / UI |
|---|---|
| `id` in path is not a valid UUID | `400` — not a real-world case (id always comes from the page's own fetched rows), included only to satisfy this project's Zod-validation rule |
| No Clerk session, or session is not an active super-admin | `401`/`403` from `requireSuperAdmin()`, unchanged shared behavior |
| `id` does not match any `waitlist_signups` row | `404 { error: { code: 'not_found', message: 'Entry not found.' } }` |
| An invite already exists for this waitlist row (double-click, race, or stale UI after a refresh elsewhere) | `409 { error: { code: 'already_invited', message: 'An invite has already been issued to this person.' } }` — client re-fetches the row list to pick up the authoritative badge |
| `issueDirectPartnerInvite` fails for any other DB reason | `500 { error: { code: 'internal_error', message: "Couldn't send this invite. Try again." } }`, real error logged server-side only |
| Invite row created successfully, but `sendWaitlistInviteEmail` fails or throws | `201` (not an error) with `email_sent: false`; badge still flips to "Invited"; one-time inline note shown (§6.3) |
| Network failure / unexpected client-side error calling the new route | Row falls back to the "Invite" button; inline `"Couldn't send this invite. Try again."` shown (§4) |
| `GET /api/admin/waitlist` fails entirely | Unchanged existing behavior — the page's existing `loadError` state and message apply; this document adds no new failure mode to the GET route's own reliability |

## 9. Edge Cases

- **Double-click race on the Invite button.** Closed at the DB layer by
  `uidx_direct_partner_invites_source_waitlist_id` (§6.1) — the losing request gets `409`, mapped by the
  client to a re-fetch rather than a false error (§6.3/§6.5). No client-side debounce is relied on as
  the actual safety mechanism, though the button is also visually replaced by a spinner immediately on
  click (§4), making a true double-click on the same rendered button unlikely in practice.
- **Invite already issued, then the page is refreshed.** `GET /api/admin/waitlist` is the single source
  of truth for invite state (§6.4) — a refresh always shows the authoritative current status, never a
  stale "Invite" button for an already-invited row, because the button's presence is driven entirely by
  `invite === null` in the fetched data, not by any client-only flag.
- **Expired vs. pending — must not be confused.** `computedStatus()` (reused, unchanged) is a read-time
  computation, not a stored flag: a row can sit at `status = 'pending'` in the DB indefinitely, and this
  document's list logic will still surface it as `expired` the moment `invite_token_expires_at` has
  passed, exactly matching `/dashboard/admin/partner-invites`'s own existing list behavior for the same
  underlying row.
- **Mobile layout of the new element next to name/email/timestamp.** Covered in §4/§7 — no new
  breakpoint, no fixed pixel width; relies entirely on the row's existing `flex-col sm:flex-row`
  wrapping, which the button/badge slot into as one more inline child.
- **Deleting a waitlist row that already has an invite.** The existing delete flow
  (`DELETE /api/admin/waitlist/[id]`, unchanged) deletes only the `waitlist_signups` row. The
  `direct_partner_invites` row it produced is **not** deleted or cascaded — `source_waitlist_id`'s FK
  has no `ON DELETE` clause specified, so Postgres defaults to `ON DELETE NO ACTION`, meaning **deleting
  a waitlist row that already has a linked invite will fail with a foreign-key violation today**, not
  silently orphan the invite. This is flagged, not silently accepted: the delete route's existing error
  handling already treats any DB error from the delete as `{ success: false, found: true }` → its
  existing `500 { error: { code: 'internal_error', ... } }` path (unchanged code, already handles any
  delete failure generically) — so the admin sees "Couldn't delete this entry. Try again," which is
  accurate but not maximally informative about *why*. Improving that message to explain the FK
  conflict specifically is out of scope for this document (§10) since it requires touching the existing,
  explicitly-unmodified delete route's error branch; noted here so it isn't mistaken for an unnoticed
  bug later.
- **The invitee already has a `partner_accounts` row under the email they eventually sign in with.**
  Not checked at invite-issue time (§6.3) — resolved identically to any other invite source, by
  `createOrClaimPartnerAccount`'s existing, unmodified `alreadyMember` branch at accept time.
- **A super-admin revokes a waitlist-sourced invite from the other admin page.** Handled — §6.4's join
  reads `status`/`computedStatus()` directly from `direct_partner_invites`, so a revoke made anywhere
  else is reflected on the waitlist page's next load with no additional wiring needed.

## 10. Out of Scope

- Any re-invite/resend action for a row whose invite already exists in any state (Feature Brief decision
  5) — a clean follow-up if ever needed, not part of this document.
- Any change to `/dashboard/admin/partner-invites`, its API route, or the `sales_partner_leads` →
  `direct_partner_invites` flow — confirmed additive-only throughout (§6.7).
- Any change to `/partner-invite/accept` or `lib/partner/signup.ts` — confirmed unmodified throughout
  (§6.7).
- A pre-invite check against Clerk/`partner_accounts` for "does this email already have an account" —
  not built; not built for any other invite source in this codebase today either (§6.3, §9).
- Fixing the foreign-key-conflict delete-error message called out in §9 — flagged, not fixed here.
- A selector for `target_account_kind` on this screen — always `'partner'`, no UI exposed (Feature
  Brief decision 2).
- Any bulk/multi-select "invite all" action — this document is scoped to the existing per-row action
  pattern only.

## 11. Open Questions

None.

## 12. Dependencies

- B2B-28 (shipped) — `direct_partner_invites`, `issueDirectPartnerInvite`,
  `lookupDirectPartnerInviteByToken`, `markDirectPartnerInviteAccepted`, `/partner-invite/accept` — the
  entire mechanism this document reuses unchanged.
- B2B-80 (shipped) — `target_account_kind`/`source_lead_id` precedent this document's
  `source_waitlist_id` column directly mirrors.
- WAITLIST-01 (shipped) — `waitlist_signups` table, `/dashboard/admin/waitlist`, `WaitlistClient.tsx`,
  `lib/partner/waitlist.ts` — the surface this document extends.
- `lib/internal-admin/auth.ts`'s `requireSuperAdmin()` — unchanged, reused as-is.
- `lib/delivery/email.ts`'s existing Resend client/`isPlaceholder`/`logEmailResult`/`FROM` — reused
  as-is by the new `sendWaitlistInviteEmail`.
