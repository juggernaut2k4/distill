# Feature Brief: TMPL-05 — Overlay's Canvas Doesn't Fill the Available Screen
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-12

## What Happened
Arun submitted feedback on `Overlay` via TMPL-01's automated fix loop: "increase the size of canvas
as I see lot of white space below the canvas in the screen... the containers overlaps on the
canvas... we need margins and spacing for all containers... font has to be minimum readable size."
The fix loop correctly identified this as out of scope for its narrow style-override slot allowlist
(zone colors, callout width/height, panel border width only — no canvas-size or general-spacing slot
exists) and terminated immediately with a clear reason, exactly as TMPL-01 was designed to do. This is
not a bug in TMPL-01 — it's a real design issue that needs an actual code change to the renderer,
the same category of work TMPL-02 already did for the rest of the library.

## Confirmed Directly Against the Current Code
- `components/templates/renderers/Overlay.tsx`: the base panel is a hardcoded
  `PANEL_W = 700, PANEL_H = 420` — a fixed-size box centered inside a much larger `flex-1` container
  that fills the actual screen/slide. On any viewport wider than ~700px plus its surrounding
  callouts, this leaves substantial unused space around the panel — exactly what Arun is describing
  as "white space below the canvas."
- `zone_label` (the small pill label inside each `Marker`, line ~115) is still `text-xs` (12px) — TMPL-02
  deliberately classified this as a short-UI-label exception (like a badge), but it may be exactly
  what reads as "too small" given it's the smallest text anywhere in this template.
- TMPL-02's own build report explicitly scoped `Overlay` to "D only — callout_detail → text-sm — no
  dimension change" — it never touched `PANEL_W`/`PANEL_H` or the overall layout, only one font
  field. This gap was not a miss; TMPL-02 was correctly scoped to font-size/overflow bugs only, not a
  "make better use of available space" redesign.

## The Problem Being Solved
Overlay's fixed-pixel canvas doesn't scale to the actual screen it renders in, leaving it looking
small and surrounded by unused space relative to the rest of the template library, and its smallest
text may still be uncomfortably small. This is exactly the kind of visual polish issue TMPL-02
addressed for the rest of the library — Overlay needs the same treatment specifically for its
canvas-utilization and remaining small-text issue.

## What Success Looks Like
- Overlay's canvas (the base panel + its zones/callouts) makes meaningfully better use of the
  available screen space rather than sitting as a small fixed box with a lot of surrounding empty
  area — BA should propose concrete numbers (e.g. larger `PANEL_W`/`PANEL_H`, or a responsive/
  percentage-based sizing approach) and justify the choice the same way TMPL-02 did, by actually
  rendering the template and measuring, not guessing.
- `zone_label` and any other genuinely-too-small text specific to this template is reconsidered — BA
  should decide whether TMPL-02's "short label" exception classification still holds for this field
  once the canvas is bigger, or whether it should also move to the `text-sm` floor.
- No regression to TMPL-01's automated fix loop, its slot allowlist, or `Heatmap`'s own layout — this
  is scoped to `Overlay` only, though BA should note in Section 10 (Out of Scope) whether a similar
  canvas-utilization check across the other 26 templates is worth a future, separate pass (do not
  expand this brief's own scope to cover them now).

## Known Constraints (do not expand scope)
- This is a renderer-level code/CSS change to `Overlay.tsx` only — not a change to
  `lib/templates/styleOverrideSlots.ts`'s slot allowlist, `lib/templates/fix-generator.ts`, or any
  other part of TMPL-01's mechanism. (A future phase could consider adding new slots like
  `panel-width`/`panel-height` to let Arun's automated-fix-loop feedback address this kind of thing
  directly — flag this as a possible follow-up in Section 12, don't build it now.)
- Do not touch `containerBudgets.ts`'s character budgets — if a larger canvas changes what fits
  comfortably, prefer layout/sizing changes over touching budget numbers, consistent with TMPL-02's
  own established principle.
- Do not touch any other template's renderer file.

## Process
Actually render `Overlay` (reuse whatever harness/method TMPL-02's BA pass already built and
validated, or the admin review tool if credentials allow it this time) at both a realistic desktop
session-slide size and mobile width, with the panel at its current 700×420 and with a candidate
larger size, to concretely justify the recommended dimensions — don't guess. Write the full
12-section Requirement Document to
`.claude/agents/clio/requirement-docs/TMPL-05-overlay-canvas-utilization.md`. Section 11 must be
empty. Suggested id: `TMPL-05-overlay-canvas-utilization`.
