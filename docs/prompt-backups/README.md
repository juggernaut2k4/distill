# Prompt file backups

Point-in-time snapshots of the live voice-session prompt files, taken before making further edits,
so the exact prompt text at that moment can be recovered later without digging through git history.

Not compiled — `.txt` extension deliberately, so `tsc`/Next.js never picks these up as source files.

## 2026-08-02-hume-native-prompt-template.ts.bak.txt / 2026-08-02-openai-realtime-persona.ts.bak.txt

Snapshot taken 2026-08-02, immediately after B2B-67 (the meta-narration guard fix on rules 3/5/8c/11,
`PROMPT_TEMPLATE_VERSION` v15) shipped to production, and before any further prompt restructuring
discussed the same day (concatenated-prompt redundancy/contradiction analysis, meeting-structure
alignment, farewell/end_session ordering fix). Corresponds to commit `bda532e` for
`prompt-template.ts` and the then-unchanged `openai-realtime-persona.ts` (last touched `4400d16`,
2026-08-01 round 3).
