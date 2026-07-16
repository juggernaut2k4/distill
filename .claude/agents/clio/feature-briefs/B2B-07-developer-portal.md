# Feature Brief: B2B-07 — Developer Portal (Documentation + Playground)
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-15

> **RECONSTRUCTED 2026-07-15** — original lost to a concurrent-agent git-stash collision during the
> parallel B2B-06/07/08/09 build spree (see `docs/b2b-pivot-status.md`, Backlog section, "Reconstruct
> lost B2B-06/07/08/09 governance documents"). Rebuilt from `architecture.md` §17 (the full technical
> spec — file layout, `content.ts`'s complete `ENDPOINTS` array and `WEBHOOK_DOC`, `PlaygroundClient.tsx`'s
> `handleSend()` logic, the auth/onboarding gate, and the named `dispatchMeetingBot()` gap — all intact
> and git-committed, never lost), `docs/b2b-pivot-status.md`'s Live Status table (B2B-07 row) and three
> Changelog entries (2026-07-15: "CEO Feature Brief written for B2B-07"; 2026-07-15: "B2B-06 revised to
> v3"; and the Backlog reconstruction note itself), and the shipped commit `2d3b3d0`'s message. Content
> matches the historical record to the best available evidence.
>
> **One gap found during reconstruction, flagged rather than papered over**: this brief's own governance
> record describes `content.ts`, `DeveloperDocsClient.tsx`, and `PlaygroundClient.tsx` as files that
> would exist under `app/dashboard/configurator/developer/`. A direct search of the working tree and
> `git show 2d3b3d0 --stat` found no such directory or files — commit `2d3b3d0` shipped B2B-06/08/09's
> code but not a built Developer Portal UI. `architecture.md` §17 contains the full intended
> implementation inline (this is where the code shown above actually lives today), so nothing about
> *what was decided* is missing — but as far as this reconstruction can verify, the screens described
> below were speced and architected, not yet built. **Independently confirmed by the Orchestrator on
> 2026-07-15/16** via `git log --all --diff-filter=A --name-only | grep -i playgroundclient` (zero hits,
> any branch, ever) and a check of every `.claude/worktrees/agent-*` worktree (not present in any of
> them) — this is a real, confirmed gap, not a reconstruction artifact. Treat "ready for BA dispatch"
> (this brief's own original status per the Live Status table) as still accurate, not superseded by a
> false "done."
>
> Second gap, also flagged: `docs/reference-vendor-api-integrations.md`, `docs/brainstorm-partner-signup-integration.md`,
> and `B2B-06-partner-provisioning.md` v2 — all three cited repeatedly as this brief's own grounding
> sources in `docs/b2b-pivot-status.md`'s Changelog — are absent from the working tree and have zero
> git history (no commit ever added them). This is consistent with the stash-collision story, not
> evidence against it: these read as working documents from the same session that were never
> individually `git add`ed, so a stash collision would erase them without leaving any commit trace,
> the same way it erased the four CEO Feature Briefs and three Requirement Documents `docs/b2b-pivot-status.md`
> names explicitly. Everything below attributed to those three documents is therefore reconstructed
> **secondhand**, via `docs/b2b-pivot-status.md`'s own direct quotations and paraphrase of them (most
> load-bearing: Arun's verbatim line on the auth mechanism, quoted identically across three separate
> Changelog entries dated the same day) — not from having read the source documents themselves.

## Series context
Sixth Feature Brief in the B2B pivot, and the second of four (B2B-06/07/08/09) that surfaced after
the original five-brief sequence (B2B-01 through B2B-05) closed out. Originated from a CEO gap-analysis
dispatch that mapped Arun's original 8-point platform vision against the live codebase and confirmed
two items were not built at all: item 5 (a "documentation/developer" screen showing all APIs and
schemas) and item 6 (a "playground" to paste JSON and test against the live API) — zero OpenAPI spec,
zero `/docs` route, zero playground UI anywhere in the repo, verified by direct code search rather
than assumed from a stale checklist.

This brief's companion technical spec is `architecture.md` §17, produced alongside it and confirmed
intact (`docs/b2b-pivot-status.md`, Backlog section: "**Not lost**: `architecture.md` §§15-18... fully
intact"). It documents the exact file layout, the `content.ts` documentation source of truth (the
complete `ENDPOINTS` array covering all 4 partner-facing routes plus `WEBHOOK_DOC`), the
`PlaygroundClient.tsx` `handleSend()` mechanics, and the auth/onboarding gate — byte-for-byte the same
shape as the existing `app/dashboard/configurator/topics/page.tsx` pattern, no new gate logic invented.

Built in the same working session as B2B-06 (Partner Provisioning), B2B-08 (Testing/Metering), and
B2B-09 (Session delivery + glitch dashboard) — commit `2d3b3d0`'s message notes their shipped code
interleaves in shared files, most notably `app/api/partner/v1/sessions/route.ts`. As confirmed above,
B2B-06/08/09's code shipped in that commit; this brief's own screens did not.

## Authoritative sources
Per `docs/b2b-pivot-status.md`'s own record of what this brief was grounded in when originally written:
`docs/reference-vendor-api-integrations.md`, `docs/brainstorm-partner-signup-integration.md` (both lost,
cited secondhand — see the reconstruction note above), `B2B-06-partner-provisioning.md` v2 (also lost),
`docs/specs/B2B-02-requirement-document.md` (survives), `architecture.md` §3/§7/§10 (the original
partner-API surface this brief documents) and its own companion §17, and the live `app/api/partner/v1/*`
route files — read directly, not from spec text, "since routes can drift from spec."

## What Arun Said
Reconstructed from the sources above that quote or paraphrase him directly:

1. **Original 8-point platform vision, items 5 and 6** (source: the lost `docs/brainstorm-partner-signup-integration.md`,
   cited via `docs/b2b-pivot-status.md`'s Live Status table): a "documentation or developer" option
   showing all of Clio's partner-facing APIs and schemas, and a "playground" where a partner can paste
   JSON and test a request against the live API.
2. **Arun's direct correction on the auth mechanism** (Decision #2 of the same lost brainstorm doc,
   quoted identically and verbatim across three separate `docs/b2b-pivot-status.md` Changelog entries
   dated 2026-07-15 — B2B-06 v2's own text had drifted from this by the time this brief was written):
   *"We need this advanced login now itself. Let's not start with static API."* This is a B2B-06
   decision at its root (OAuth2 Client Credentials is the v1/day-one default, not a fast-follow), but
   it is directly load-bearing here: it determines what this brief's Documentation screen should say
   about auth, and what credential flow the Playground is built against.
3. **The `dispatchMeetingBot()` test-mode gap**, already named as an open item in the same lost
   brainstorm doc before this brief existed — not a new finding, but this brief is the one that turns
   it into a named, hard pre-condition on shipping one specific UI control (the Playground's
   sessions-endpoint Send button), rather than leaving it an implicit risk.

## The Problem Being Solved
A partner integrating with Clio today has no self-serve way to learn the API surface or verify a
request before writing code against it. There is no OpenAPI spec, no docs page, no way to see a real
example request/response for any of the four live `/api/partner/v1/*` routes, and no way to try a call
without guessing at field names and shapes from internal spec documents the partner never sees. This
directly undercuts B2B-06's self-serve signup motion — a partner can create an account and get a
credential with nothing built to tell them what to do with it — and is exactly the gap Arun named as
items 5 and 6 of his original vision for the platform.

## What Success Looks Like
A BA spec exists that, once built, means:

1. **`/dashboard/configurator/developer`** — a Documentation screen, gated identically to every other
   Configurator screen (Clerk auth → partner-account resolution → onboarding-completion check, same
   shape as `app/dashboard/configurator/topics/page.tsx`). Renders hand-authored reference content from
   a shared `content.ts` constants file — not AI-generated, per this repo's standing rule against
   populating undefined screens with speculative model output, and per `architecture.md` §17.2's own
   convention that this file is "hand-transcribed from the live route files... verified against them
   directly." Covers all four partner-facing endpoints (`POST /sessions`, `GET /sessions/:clio_session_ref`,
   `GET /usage`, `GET /wallet`) — method, path, purpose, rate limit, request fields, example request/response,
   response notes, and the full set of non-2xx status codes with meaning — plus the outbound usage
   webhook contract (payload fields, `Clio-Signature` header format, the exact HMAC verification recipe,
   retry schedule, and the known gap that transcript/action-item/glitch/psychology data isn't in this
   payload today).
2. **`/dashboard/configurator/developer/playground`** — an interactive screen, same gate shape, where a
   partner pastes their own API key and a JSON body/path-param/query-param value and sends a real
   request to the real API (not a mock) using their own `test`-mode credential. Three of the four
   endpoints (`sessions_get`, `usage`, `wallet`) are fully live. The fourth, `sessions_create`, ships
   with its Send control disabled — see Known Constraints below — while its documented request/response
   shape on the Documentation screen remains accurate and complete.
3. **The auth section is written as an interim, labeled state**: "current mechanism, subject to
   change," describing the static API key mechanism that is actually live today, not the OAuth2
   mechanism Arun named as the v1 default (B2B-06 v3). This labeling language must actually appear as
   on-screen copy, not only as internal reasoning in the spec — flagged explicitly per the CEO review
   process this brief describes below.
4. **No content on this screen for anything outside the partner-API-key-authenticated surface** —
   domain-config endpoints (`/api/admin/configurator/domain*`) are excluded, verified by direct code
   read to be gated by `requirePartnerAdmin()` (a Clerk session check), not the partner API key.

## Known Constraints
- **Hard safety pre-condition on the Playground's `sessions_create` Send control.** It must not ship
  enabled until `dispatchMeetingBot()` (`lib/partner/session-init.ts`) is confirmed to skip a real bot
  dispatch for test-mode requests. Confirmed by direct code read (both at original spec-writing time and
  re-confirmed during this reconstruction): `dispatchMeetingBot()` calls `provider.createBot()` with no
  `test_mode` parameter and no conditional branch at all. B2B-08's own trial gate
  (`app/api/partner/v1/sessions/route.ts`, lines 75-126) does **not** fully satisfy this pre-condition —
  it only blocks dispatch once a test-mode account's free-minute allowance is fully exhausted, not for
  every test-mode request generally. Until a real `test_mode` branch lands in `dispatchMeetingBot()`
  itself (or an equivalent confirmed guard), this endpoint must ship **documented, not testable**:
  `content.ts`'s `ENDPOINTS` entry sets `playgroundDisabled: true` with a `playgroundDisabledReason`
  string explaining why in plain language, and the Send button must have no `onClick` wired in that
  state at all — an `if (endpoint.playgroundDisabled) return` check in `handleSend()` is defense-in-depth,
  not the only gate. The other three endpoints (`sessions_get`, `usage`, `wallet`) are pure reads and
  can ship fully live with no such gate.
- **Dependency on B2B-06's OAuth2 mechanism — now cleared.** B2B-06 v3 shipped OAuth2 Client Credentials
  (`POST /api/partner/v1/oauth/token`, confirmed present in commit `2d3b3d0`). This dependency is no
  longer a blocker as of this reconstruction — the auth documentation can now describe the live OAuth2
  mechanism as primary rather than "interim, subject to change," with the static key as the secondary
  internal-operator recovery path B2B-06 v3 demoted it to.
- **No new npm dependency.** Explicit constraint against Monaco, CodeMirror, Swagger UI, or any
  OpenAPI-spec renderer — unjustified for a 4-endpoint surface and would introduce a second visual
  language alongside the existing Configurator design system. The JSON body editor is a plain
  `<textarea>`; path/query param inputs are plain `<input>`; endpoint reference cards are hand-rolled,
  reusing existing Configurator components.
- **No credential persistence.** The Playground's `apiKey` value is held in `useState` only — never
  written to `localStorage` or `sessionStorage` — cleared by React's normal unmount behavior on
  navigation or reload, no explicit clear logic required.
- **No new Clio-owned API route.** The Playground calls the four already-live `/api/partner/v1/*`
  routes directly from the browser using the partner's own credential; this brief adds no backend
  surface of its own.
- **No schema change.** Per `architecture.md` §17's own header note: no migration, no new table, no
  column changes.

## Questions for BA
All resolved before dispatch; documented here so the reasoning is visible rather than silently settled.

1. **Should this brief block entirely on B2B-06's OAuth2 landing first?** Resolved: no, and now moot —
   B2B-06 v3 shipped. The auth documentation should describe the live OAuth2 mechanism directly.
2. **Do domain-config endpoints belong on the Documentation screen?** Resolved: no. Verified by direct
   code read that `/api/admin/configurator/domain*` is gated by `requirePartnerAdmin()` (a Clerk-session
   check), not the partner API key — it is not part of the surface this screen documents.
3. **Should the Playground hit a mocked/simulated backend or the real API?** Resolved: the real API,
   using the partner's own `test`-mode credential. Justified by the existing `mode: 'test'/'live'`
   distinction already used elsewhere for billing exclusion (`partner_api_keys.mode`,
   `partner_sessions.test_mode`) — this gives a partner real validation errors and real response shapes
   instead of a simulation that could silently drift from actual API behavior.
4. **Should a JSON-editor or OpenAPI-renderer package be added to make the Playground/Documentation
   screens richer?** Resolved: no. See Known Constraints — a plain textarea and hand-rolled endpoint
   cards are sufficient for a 4-endpoint surface; a dedicated package would be an unjustified new
   dependency for this scope.

Zero open questions block BA dispatch or, now, actual build.

## What's explicitly out of scope
- **Credential generation.** Issuing API keys or OAuth2 client credentials lives entirely in B2B-06's
  own Configurator screen. This brief links to that screen; it does not duplicate credential-generation
  UI of its own.
- **Fixing the `dispatchMeetingBot()` test-mode gap.** Named as a hard pre-condition on one UI control
  (above), not resolved by this brief. That fix belongs to `lib/partner/session-init.ts` itself, or an
  equivalent confirmed guard, as a separate piece of work.
- **New backend routes.** The Playground calls Clio's four existing live routes directly; no new API
  surface is built here.
- **Schema or migration changes.** None — this is a documentation and testing UI over already-live data
  and routes.

## Approval note
Reviewed against `docs/reference-vendor-api-integrations.md`, `docs/brainstorm-partner-signup-integration.md`,
and `B2B-06-partner-provisioning.md` v2 (all three now lost — reviewed at the time this brief was
originally written, before the stash collision), `docs/specs/B2B-02-requirement-document.md`,
`architecture.md` §3/§7/§10 and this brief's own companion §17, and the live `app/api/partner/v1/*`
route files read directly rather than assumed from spec text.

This brief's own grounding work is what caught a real document-drift bug in a sibling brief: while
verifying the auth section against `docs/brainstorm-partner-signup-integration.md`'s Decision #2 (Arun's
"We need this advanced login now itself" correction), the CEO Agent found that `B2B-06-partner-provisioning.md`
v2's own written text still framed OAuth2 Client Credentials as an unscoped fast-follow — a document
that had gone stale on its own auth-mechanism section despite being dated the same day as the correction
it failed to reflect. That finding was not resolved unilaterally inside this brief (issuing credentials
is B2B-06's job, not this one's) — it was named explicitly and routed to a B2B-06 v3 revision, which
followed and shipped.

Zero open questions block BA dispatch. **As of this reconstruction, the spec is fully approved and its
one named dependency (B2B-06 OAuth2) is cleared — the only remaining gap is that the screens themselves
were never actually built.** I will review the eventual build against this brief and specifically
verify: (a) the auth documentation correctly describes the live OAuth2 mechanism, not a stale "interim"
framing; (b) the `sessions_create` Playground control ships genuinely disabled, with no path for a
partner to trigger a real bot dispatch from this screen before the underlying `dispatchMeetingBot()` gap
is fixed; (c) no AI-generated content appears on either screen; and (d) no new npm dependency was
introduced for the JSON editor or endpoint reference cards.
