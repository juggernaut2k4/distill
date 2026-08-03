# Feature Brief: B2B-72 — Widget demo full-screen launch + widget-render "ended" screen
From: CEO (Arun)
To: Orchestrator / Developer (carve-out — no BA spec gate, see below)
Priority: P1
Date: 2026-08-03

## What Arun Said
Same-night follow-on to B2B-71, verbatim (relayed):
1. "Currently the widget is displayed small in the widget tab. Instead can we give a url. On
   clicking a new window is opened in which the widget is full screen. Mean full viewport."
2. "When closing the call, after closing summary and farewell greeting, can we trigger end session
   button automatically or end session by rendering thanks on the screen so the user can no longer
   talk to the bot."

## The Problem Being Solved
**Part A (demo tooling):** `app/(demo)/demo/[slug]/DemoTopicClient.tsx`'s "Widget Demo" tab embeds
the widget-render URL in a small bordered iframe (`aspectRatio: '16/9'`) inside the tab's content
column. This undersells the actual product — the real widget-render route is built full-viewport —
and makes it harder for Arun to demo/test it convincingly.

**Part B (real, reseller-facing production gap):** Confirmed by direct read of
`app/(with-clerk)/widget-render/[clio_session_ref]/WidgetRenderClient.tsx` — `status` already has an
`'ended'` value in its state union (set by both the `end_session` tool call at line 214 and
`onDisconnect` at line 250), and `endSessionOnce()` (already wired to both paths, plus unmount)
already tears down the adapter and posts to `/api/partner/render/end-session`. But there is
**no rendering branch for `status === 'ended'` at all** — the only status-conditional UI in the
whole component is a small `status === 'error'` toast (line 457). When a session ends, the last
inline page just sits on screen with zero visual confirmation that the interaction is over.

## What Success Looks Like
**Part A:** Widget Demo tab shows a link/button ("Open full-screen ↗" or similar) that opens the
exact same `render_url` via `window.open(url, '_blank', 'noopener,noreferrer')`. No iframe embed in
the demo tab anymore. `WidgetRenderClient.tsx` itself is untouched — it already renders full-viewport
(`h-screen w-screen`) the instant it's the top-level document.

**Part B:** Add a `status === 'ended'` branch to `WidgetRenderClient.tsx` that fully replaces the
on-screen content (not just an overlay on top of still-mounted iframes — the inline `iframe`s should
stop being rendered once ended, both to stop any residual iframe-side interactivity and to make the
closure visually unambiguous) with a full-viewport, full-black-background "session over" screen:

```
Thanks for joining.
This session has ended.
```

Short, warm, no additional buttons/links/CTAs (none were specified — do not invent any). Consistent
with the sparse, confident tone used elsewhere in this component (e.g. the existing warmup/error
treatments).

No new termination mechanism is needed — `endSessionOnce()` / `adapter.endSession()` /
`POST /api/partner/render/end-session` already fires reliably on both the model's own farewell +
`end_session` tool call (confirmed live in Arun's test call, `partner_sessions.status` ended up
`'completed'` with a real `ended_at`) and on disconnect/unmount. This is a pure rendering-branch
addition on top of state that already exists and already updates correctly.

## Known Constraints
- Does not touch `PartnerRenderClient.tsx`, `openai-realtime-prompt-template.ts`, or any part of the
  meeting-bot render path — B2B-70/71 risk-isolation decision stands.
- Does not touch the voice adapters, tool definitions, or the `end_session` prompt rule
  (`lib/voice/widget-prompt-rules.ts` rule 9) — that mechanism already works.
- Part A is internal test-harness tooling only (`(demo)` route), not reseller-facing — no design
  system constraints apply beyond "looks intentional."
- Part B is the real reseller-facing widget-render component — copy must stay short/warm per above,
  no speculative/AI-generated content, no new interactive elements invented.

## Governance note — why this skips the full BA spec
This is being processed under the same carve-out already used tonight for B2B-43/44/45/47/49/50
(confirmed real in `docs/b2b-pivot-status.md`): a narrowly-scoped technical/UI fix to an
already-BA-approved component (B2B-70/71), with the desired behavior specified by Arun himself and
no product ambiguity left to resolve (exact copy is the only open call, and CEO is setting it above).
CEO brief only, Section "Questions for BA": **none**. Eligible for direct build.

## Questions for BA
None — carve-out applies, see governance note above.
