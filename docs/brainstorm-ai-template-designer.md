# Brainstorm: AI-Supported Template Designer

Status: REQUIREMENTS GATHERING — no code changes yet, not a spec.
Started: 2026-07-12
Participants: Arun (product owner), Orchestrator

This document exists to capture Arun's raw requirements before any CEO/BA/build work starts, per
his standing process: (1) document requirements, (2) orchestrator asks clarifying questions, (3)
document Arun's answers, (4) orchestrator restates understanding, (5) only then proceed to
CEO → BA → build → review → test → deploy. Matches the precedent set by
`docs/brainstorm-realtime-transcript-driven-visualization.md`, which became the RTV-01..05 series.

Context: today's `template_library` review tool (`/dashboard/admin/templates`, built across
RTV-04 and TMPL-01..07) lets Arun approve/reject template designs and request LLM-driven style
fixes within a narrow slot allowlist (colors, dimensions — Heatmap/Overlay only). This brainstorm
is about something much bigger: a full visual designer for building and customizing templates
themselves, not just approving/tweaking the 27 that already exist.

---

## 1. Arun's Requirements (as stated, restructured for clarity — not yet reworded/interpreted)

1. **A visual designer tool for templates.** Not just review/approval (today's tool) — an actual
   editor where templates are built and modified.

2. **Modify existing templates.** User can open any of the current templates and change it.

3. **Add new templates.** User can create a brand-new template type from scratch, not just edit
   the existing 27.

4. **Quick CSS color configuration**, per template, in a user-friendly screen — no code editing.

5. **Background configuration** — per template.

6. **Font property configuration** — per template.

7. **Arrow/connector configuration** — for templates with directional flow (flowcharts, decision
   trees, etc.).

8. **Motion graphics configuration** — animation behavior per template.

9. **Margin and spacing configuration** — per template, quickly adjustable.

10. **AI fills the template with sample data so the user can see how it actually looks, then
    approve.** (Distinct from #16 below — this is a quick visual check during design, not the
    final publish-with-real-content step.)

11. **AI-recommended skeleton generation.** Ask AI to propose the initial skeleton/structure of a
    new template, which the user then refines by hand.

12. **Arbitrary new template types on request** — e.g. "create a Venn diagram," "create a Gantt
    chart." Not limited to the current library's shapes.

13. **AI builds the skeleton using the user's existing project design system**, so new templates
    stay visually consistent with everything else rather than looking bolted-on.

14. **Three levels of design properties** (this is the core structural idea of the whole system):
    - **a. Application level** — global CSS defaults that apply everywhere: rounded corners,
      default color palette, overall theme, etc.
    - **b. Template level** — properties specific to one template type: its title, subtitle,
      motion-graphics behavior, etc.
    - **c. Component level** — properties for each individual container/element inside a
      template, editable on its own.

15. **Ship this as a real, available tool** — not a one-off internal script or prototype.

16. **Final "publish" step goes through AI**, one of two ways:
    - AI generates realistic sample information to fill the template for preview, **or**
    - user gives a sample title/topic and AI tries to fill the template with real-feeling content
      so the user can see the actual rendered result before approving.

17. **Iteration loop.** If a published/previewed template needs changes, user can send it back
    into the designer and modify it again — this is not a one-way pipeline.

18. **Data-shape-aware template recommendation.** User can say what kind of information they want
    to display (e.g. "comparison table"). Based on the actual size/shape of that data, AI evaluates
    whether the chosen template is genuinely the best fit, or whether a different template in the
    library would present that same data better.

19. **Accessibility/readability-driven template selection.** AI's recommendation is not just
    "does the data type match" — it also weighs accessibility and readability for the end viewer.

20. **Free-text template discovery.** User can describe, in their own words, what they want to
    show (rather than picking from a known list of template types). AI reads that description and,
    if no existing template matches, adds a new matching entry to the selection list.
    - **Example given:** user says "I need to show high, medium, low for these features" without
      knowing the word "heatmap" exists as a template — AI recognizes this maps to a Heatmap
      template and surfaces/adds it to the list for them.

21. **Same-family color variants surfaced to the user.** When a template (e.g. Heatmap) could use
    a lighter/darker variant of the same color family rather than an entirely different color, that
    variant option should be presented to the user — informed by the user's already-chosen colors
    or the project/template's existing design system.

22. **Core intent: AI assists, user stays in control.** The point of AI involvement throughout is
    speed of customization, not replacing the user's judgment — more control for the user, not less.

23. **A "preference meter."** Track, over time, how well the AI has learned the user's taste in
    color, font, and other CSS properties — a visible confidence/profile-completeness indicator.

24. **Meter-triggered proactive generation.** Once that meter is "full" (AI is confident it has
    profiled the user's expectations), AI can proactively offer to generate an entire template (or
    other design assets) autonomously, since it already understands what the user likes.

25. **Human override always available, even post-generation.** Even after AI produces a
    "complete" template using its profiled understanding, the user must still be able to give
    additional feedback and modify it further. A confident AI generation is never treated as final
    or a one-way door.

26. **Explicit confidence signal, separate from the preference meter.** The system needs its own
    signal for "AI believes it understood this specific request" vs. "this needs more human
    feedback before it can be trusted" — distinct from item 23's longer-running taste profile; this
    is a per-request/per-generation confidence check.

---

## 2. Open Questions (orchestrator → Arun, not yet answered)

1. **Internal tool vs. customer-facing.** Is this designer meant to stay something only you (or an
   internal admin team) use to build/tune Clio's own templates faster — or could it eventually
   become something Clio's customers use themselves (e.g. to customize their own branded template
   library)? This materially changes scope: an internal tool can assume one "user" (you) with one
   design system (Clio's own brand); a customer-facing version needs per-tenant design systems,
   permissions, and a much higher bar on guardrails against a customer breaking their own templates.

*(Orchestrator's working assumption until answered: internal-only for now, with an eye toward
possibly opening it up later — flagged, not committed to either way.)*

---

## 3. Not Yet Done

- No CEO Feature Brief written.
- No BA Requirement Document written.
- No code, schema, or UI changes made.
- No analysis/recommendation from the orchestrator yet — Arun asked for the requirements to be
  captured first; analysis follows once he's ready to continue this conversation.
