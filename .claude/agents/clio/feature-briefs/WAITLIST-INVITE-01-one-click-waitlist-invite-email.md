# Feature Brief: One-click email invite from the waitlist admin page

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-09-06

## What Arun Said
"Let's say I invite them through email. Build that out so I can click a button from my dashboard to
invite them then they can signup." — said in the context of `/dashboard/admin/waitlist`, right after
WAITLIST-01 (homepage waitlist) and DEMO-PASSCODE-01 shipped, when Arun asked what happens after
someone joins the waitlist and learned there is currently no automatic path from a waitlist lead to
a real registered partner account (today: admin must manually generate an invite via the existing
`/dashboard/admin/partner-invites` tool and share the link themselves).

## The Problem Being Solved
Converting a waitlist signup into an activated partner account today requires an admin to leave the
waitlist page, go to a separate tool, generate a link, and manually copy/paste/send it. That's
friction on the one workflow this whole feature exists to enable: turning interest into signed-up
partners. Arun wants this collapsed into a single action from where he's already looking at the
lead — the waitlist page.

## What Success Looks Like
- Admin opens `/dashboard/admin/waitlist`, sees a row for a person who joined the waitlist.
- Admin clicks a per-row "Invite" action.
- The system generates a direct-partner invite (reusing the existing, already-shipped
  `direct_partner_invites` mechanism used by `/dashboard/admin/partner-invites`) AND emails the
  invite link directly to that person's waitlist email address — no manual copy/paste step.
- The row visibly reflects that an invite has gone out (so admin never double-invites the same
  person by accident, and can see it's been done at a glance on a future visit/refresh).
- The invitee receives an email, clicks the link, and lands on the existing, unmodified
  `/partner-invite/accept` flow, which creates their partner account exactly as it does for every
  other invite source today.

## Known Constraints
- Must reuse the existing invite mechanism (`lib/internal-admin/direct-partner-invites.ts`,
  `direct_partner_invites` table, `/partner-invite/accept`) — not a parallel signup system.
- Must NOT modify or regress `/dashboard/admin/partner-invites` (the existing manual-invite admin
  page) or the sales-partner-lead invite flow (`sales_partner_leads` → `direct_partner_invites` via
  `source_lead_id`). Build additively.
- Must NOT touch `/partner-invite/accept` or `lib/partner/signup.ts`'s account-creation logic — only
  confirm the token this flow produces is consumable by that existing code path unchanged.
- Only approved libraries already in this codebase for these exact purposes: Supabase, Resend,
  Clerk (admin auth via `requireSuperAdmin()`, already used on this page's existing API routes).
- All new/changed API inputs Zod-validated. No hardcoded secrets.
- Responsive/mobile-friendly standing rule applies to whatever you touch on the waitlist admin page
  (fluid Tailwind + `clamp()`, matching the existing `WaitlistClient.tsx` patterns already on that
  page — no hardcoded pixel-width caps).
- `npx tsc --noEmit` must be clean.

## Product-shape decisions made now (CEO authority — treat these as settled, not open questions)

These resolve the ambiguities flagged in `BACKLOG.md`'s `WAITLIST-INVITE-01` entry. Write them into
the spec as decided; do not re-open them in Section 11.

1. **Schema — how an invite tracks a waitlist source.** Add a new nullable column
   `source_waitlist_id UUID REFERENCES waitlist_signups(id)` to `direct_partner_invites`, alongside
   the existing `source_lead_id UUID REFERENCES sales_partner_leads(id)` (added in migration
   `116_b2b80_sales_partner_leads.sql`). Do not touch, widen, or drop the existing FK — this is
   strictly additive, a new migration file (next number after `119_demo_passcode01_public_buyer_passcodes.sql`,
   i.e. `120_...`). A row will have exactly one of `source_lead_id` / `source_waitlist_id` set (or
   neither, for a manually-generated invite with no source) — no new discriminator column needed,
   since the two FKs are mutually exclusive by construction (only one call site sets each one).

2. **`target_account_kind` for waitlist invites.** Always `'partner'` (direct partner account) — a
   waitlist signup is a prospective ordinary partner, never a channel partner. Do not expose a
   selector for this on the waitlist page.

3. **New endpoint, not a reuse of the existing partner-invites route.** Build a new route,
   `POST /api/admin/waitlist/[id]/invite`, rather than extending
   `POST /api/admin/partner-invites`. Reasoning: that existing route has no email-sending step at
   all today and is shared by the unrelated partner-invites and sales-partner-leads UIs — bolting
   email-sending onto it risks changing its behavior for those callers. The new route internally
   calls the same `issueDirectPartnerInvite()` function (passing the waitlist row's id as the new
   `sourceWaitlistId` parameter — extend that function's signature, mirroring how `sourceLeadId`
   already works) and then sends the invite email. Auth: `requireSuperAdmin()`, same as every other
   admin route on this page.

4. **New email template.** Add `sendWaitlistInviteEmail(toEmail: string, name: string, acceptUrl: string): Promise<EmailResult>`
   to `lib/delivery/email.ts`, following the exact structural pattern of `sendInternalStaffInviteEmail`
   / `sendPartnerTeamInviteEmail` immediately above it in that file (same dark-void HTML skeleton,
   `#7C3AED` CTA button, `isPlaceholder`/mock guard, `logEmailResult`, try/catch returning
   `EmailResult`). Copy: welcoming, references that they joined the Clio waitlist, invites them to
   set up their partner account, one CTA "Accept your invite →", and a plain-text fallback. Match
   the same expiry note pattern (`invite_token_expires_at`'s actual configured TTL — confirm the
   real value from `lib/internal-admin/invite-tokens.ts`'s `inviteExpiresAt()` rather than assuming
   7 days).

5. **"Already invited" UI treatment.** `GET /api/admin/waitlist` must additionally report, per row,
   whether an invite has already been issued for it (i.e. whether a `direct_partner_invites` row
   exists with `source_waitlist_id` = this row's id) and that invite's computed status
   (pending/accepted/expired/revoked, reusing `computedStatus()`'s existing logic) plus
   `created_at`. In `WaitlistClient.tsx`, a row with no invite yet shows the "Invite" button; a row
   with an invite shows a small status badge instead (e.g. "Invited · 2 days ago" for pending,
   "Signed up" for accepted, "Invite expired" for expired, "Invite revoked" for revoked) — no
   re-invite action in this iteration (if that's ever needed, it's a separate follow-up, not part of
   this spec). Style the badge consistently with this page's existing dark-surface, muted-text
   conventions (see `WaitlistClient.tsx`'s existing `text-[#475569]` / `text-[#94A3B8]` usage) —
   don't invent a new visual language for a one-word status label.

6. **Row-level request/response shape.** The "Invite" button posts to
   `/api/admin/waitlist/[id]/invite` with no body (the row's id is in the path; email/name come from
   the `waitlist_signups` row server-side, never trusted from the client). On success, the UI should
   optimistically flip that row to its "invited" state without requiring a full reload (re-fetch is
   also acceptable — pick whichever is simpler and consistent with this file's existing patterns,
   e.g. its delete flow's local state update).

## Questions for BA

None outstanding — all product-shape ambiguity is resolved above. Your job is to turn this into the
full 12-section requirement document: precise schema (migration SQL), exact API contract (Zod
schemas, request/response JSON shapes, status codes, error cases — including what happens if the
waitlist row's email address happens to already have a `partner_accounts` row, if that's even
checkable at this layer, and what happens if invite creation succeeds but the email send fails),
exact UI wireframe/copy for the badge states and button states (loading/error), and acceptance
tests + edge cases (double-click race on the Invite button, invite already issued then page
refreshed, expired invite still shows "expired" not "pending", mobile layout of the new badge next
to the existing name/email/timestamp row). Confirm the actual invite TTL value from
`lib/internal-admin/invite-tokens.ts` before writing it into the spec or the email copy. Leave
Section 11 (Open Questions) empty.
