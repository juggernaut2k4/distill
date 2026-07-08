# SESSION-END-01 — One-Time Hume Tools API Setup

This is the one manual step required for `SESSION-END-01` (explicit
`end_session` tool-call signal for Hume-native sessions) to actually work in
production. Everything else in the feature ships with the code. This step
cannot be done by an engineer without the real, non-placeholder
`HUME_API_KEY` (the sandbox this feature was built in only has a
`PLACEHOLDER_` value), so it's written up here for whoever holds that key —
either Arun runs these two `curl` commands directly, or hands the key to the
implementing engineer for this one-time step only. See spec Section 12 for
the full rationale.

There is no Hume *dashboard* action required — both steps below are plain
authenticated REST API calls, the same mechanism `lib/voice/hume-native/config-provisioner.ts`
already uses for every Config operation.

## Step 1 — Create the `end_session` tool

```bash
curl -X POST https://api.hume.ai/v0/evi/tools \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "end_session",
    "parameters": "{\"type\":\"object\",\"properties\":{}}",
    "description": "End the coaching session now. This is the primary, authoritative signal that the session is over; call it explicitly rather than relying on your spoken words alone."
  }'
```

This returns a JSON body containing the new tool's `id` and `version`, e.g.:

```json
{
  "tool_type": "USER_DEFINED",
  "id": "REPLACE_ME",
  "version": 0,
  "version_type": "FIXED",
  "name": "end_session",
  "created_on": 1234567890123,
  "modified_on": 1234567890123,
  "fallback_content": null,
  "description": "End the coaching session now. This is the primary, authoritative signal that the session is over; call it explicitly rather than relying on your spoken words alone.",
  "parameters": "{\"type\":\"object\",\"properties\":{}}"
}
```

**Save the `id` and `version` from this response** — you need them for Step 3
below (and for the follow-up code edit noted at the bottom of this doc).

## Step 2 — Attach it to the base Hume-native config

Replace `$NEXT_PUBLIC_HUME_CONFIG_ID` with the actual value of that env var
(the same base config `config-provisioner.ts` already clones from), and
`TOOL_ID` / `TOOL_VERSION` with the values returned by Step 1.

First, fetch the existing base config to see its current `tools` array (so
you don't drop the existing `advance_tab` / `show_visual` / third custom tool
entries when you POST the new version):

```bash
curl -X GET "https://api.hume.ai/v0/evi/configs/$NEXT_PUBLIC_HUME_CONFIG_ID" \
  -H "X-Hume-Api-Key: $HUME_API_KEY"
```

Note the `id`/`version` pairs under `configs_page[0].tools`. Then create a
new version of the config with the new `end_session` tool appended to that
same list (do not remove the existing entries):

```bash
curl -X POST "https://api.hume.ai/v0/evi/configs/$NEXT_PUBLIC_HUME_CONFIG_ID" \
  -H "X-Hume-Api-Key: $HUME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "evi_version": "3",
    "tools": [
      { "id": "EXISTING_ADVANCE_TAB_TOOL_ID", "version": 1 },
      { "id": "EXISTING_SHOW_VISUAL_TOOL_ID", "version": 1 },
      { "id": "EXISTING_THIRD_TOOL_ID", "version": 1 },
      { "id": "TOOL_ID", "version": "TOOL_VERSION" }
    ]
  }'
```

(Fill in the three existing tool ids/versions from the GET response above —
do not guess them; the known ones referenced elsewhere in this codebase are
`advance_tab` = `4f15c0c2-9af1-421c-8040-ad34b6345234` and `show_visual` =
`65a3d139-2f7b-4e26-9fce-caeb7fa78e05`, both at `version: 1`, plus a third
tool, id `6fc0bfde-1f63-44a1-b752-3507b5b5d30d`, believed to be
`defer_question` — but confirm all three against the live GET response
before POSTing, since config versions can drift.)

Once this lands, `config-provisioner.ts`'s already-shipped dynamic `tools`
reconstruction (no code change needed there for the normal path) automatically
carries `end_session` into every future Hume-native session clone.

## Follow-up code edit (mechanical, not a design decision)

`lib/voice/hume-native/config-provisioner.ts` has a **fallback** `tools`
array that is only used if the live `GET` of the base config ever returns a
malformed/missing `tools` field (defense-in-depth, not the normal path). It
has a `TODO(SESSION-END-01)` comment marking where to paste the real
`{id, version}` for `end_session` once Step 1 above has been run — search for
`REPLACE_WITH_END_SESSION_TOOL_ID` in that file.

## Verifying it worked

After both steps:
1. `GET https://api.hume.ai/v0/evi/configs/$NEXT_PUBLIC_HUME_CONFIG_ID` should
   show `end_session` in the `tools` array of the latest version.
2. Start a fresh Hume-native session and let it run to its natural end. Check
   the browser console (or server logs, if forwarded) for
   `[Walkthrough/Hume] end_session called` — this confirms the tool call
   arrived and fired the real teardown path, rather than the demoted
   `FAREWELL_PHRASES` fallback (which would instead log
   `Farewell fallback timer elapsed with no end_session tool call — tearing
   down via demoted fallback`).
