# Content Library Index
_Reference content for Clio session generation. Load the relevant file before generating script + visualization._

**Rule:** Before generating content for any topic, check this index. If the topic is listed with status APPROVED, load the file as context. Do not regenerate approved content from scratch.

**Methodology:** See `CONTENT-METHODOLOGY.md` for the full 6-section structure, audience calibration rules, and script derivation rules that all content in this library follows.

---

| Topic ID | Session Title | Audience | Status | File |
|----------|--------------|----------|--------|------|
| anthropic-claude-for-work-s1 | Introducing Claude for Work — Why It Matters for a Technology Leader in Financial Services | VP of Technology, Financial Services, intermediate AI maturity | APPROVED 2026-06-23 | [anthropic-claude-for-work-s1.md](anthropic-claude-for-work-s1.md) |

---

## How to use this index

### When generating content for a session

1. Identify the `topic_id` for the session being generated
2. Search this table for that `topic_id`
3. If found with status **APPROVED**: load the `.md` file as context, extract the relevant subtopic section, derive script and visualization from it
4. If not found, or status is **DRAFT**: generate fresh content using the methodology in `CONTENT-METHODOLOGY.md`, then add a row here and save the file to `docs/content/[topic-id].md`

### Status values

| Status | Meaning |
|--------|---------|
| APPROVED [date] | Reviewed and approved by Arun. Use as-is. Derive all scripts and visualizations from this file. |
| DRAFT | Generated but not yet reviewed by Arun. Do not use as canonical reference until approved. |
| SUPERSEDED [date] | Replaced by a newer version. Do not use. |

### Adding a new entry

When a new content article is approved by Arun, add a row to the table above with:
- `topic_id` matching `topic_content_cache.topic_id`
- Full session title
- Audience description (role, industry, AI maturity)
- Status: APPROVED [date]
- Link to the file

---

_INDEX.md v1.0 | Last updated 2026-06-23_
