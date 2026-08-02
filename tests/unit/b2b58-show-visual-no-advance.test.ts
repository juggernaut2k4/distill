import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { assembleHumeNativePrompt, PROMPT_TEMPLATE_VERSION } from '@/lib/voice/hume-native/prompt-template'

/**
 * B2B-58 — page visibly ran one section ahead of Clio's narration in inline content-delivery
 * mode because `show_visual`'s tool-call handler was wired identically to `advance_tab`'s (both
 * called `advanceOnTransition`, force-advancing the page before Clio had said anything about the
 * new section).
 *
 * Two-part fix, both required together:
 *  1. app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx —
 *     `inlineTools.show_visual` becomes a page-position no-op (returns a confirmation string
 *     only, never calls `advanceOnTransition`). `inlineTools.advance_tab` is untouched.
 *  2. lib/voice/hume-native/prompt-template.ts — rule 5's "(or show_visual for the next
 *     section...)" alternative is removed, since after (1) that instruction would be wrong and
 *     could stall a session if Clio kept calling show_visual expecting it to advance.
 *
 * PartnerRenderClient.tsx is a client component with browser/WebRTC/Hume dependencies (mic
 * capture, WebSocket connection) that isn't practically unit-testable via direct import/render.
 * Following this codebase's existing convention for this exact situation (see
 * tests/unit/rtv05-display-gate.test.ts's "grep-checkable guarantee" pattern for
 * WalkthroughClient.tsx, the sibling client component), this suite asserts against the raw source
 * text of the specific tool-handler blocks instead.
 *
 * NOT covered here (explicitly out of scope for a unit suite, per the CEO brief): live-session
 * voice verification that the page now visually tracks narration in real time. That requires a
 * real or demo live session and is the Orchestrator's responsibility before this ships.
 */

const clientSrcRaw = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'
  ),
  'utf8'
)
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const clientSrc = stripComments(clientSrcRaw)

// Isolate the `inlineTools` object literal's `show_visual` and `advance_tab` blocks specifically
// (as opposed to `templateTools`'s same-named handlers, which take an explicit `section_index`
// param and are a different, unaffected code path — confirmed out of scope by the CEO brief).
const inlineToolsStartRaw = clientSrcRaw.indexOf('const inlineTools = {')
const templateToolsStartRaw = clientSrcRaw.indexOf('const templateTools = {')

const showVisualStartRaw = clientSrcRaw.indexOf('show_visual: async () => {', inlineToolsStartRaw)
const advanceTabStartRaw = clientSrcRaw.indexOf('advance_tab: async () => {', inlineToolsStartRaw)
const inlineShowVisualBlock = stripComments(
  clientSrcRaw.slice(showVisualStartRaw, advanceTabStartRaw)
)
const endSessionStartRaw = clientSrcRaw.indexOf('end_session: async () => {', advanceTabStartRaw)
const inlineAdvanceTabBlock = stripComments(
  clientSrcRaw.slice(advanceTabStartRaw, endSessionStartRaw)
)

describe('B2B-58 — inlineTools.show_visual is a page-position no-op', () => {
  it('landmarks used to isolate the inline tool-handler blocks are all found, in the expected order', () => {
    expect(inlineToolsStartRaw).toBeGreaterThan(-1)
    expect(showVisualStartRaw).toBeGreaterThan(inlineToolsStartRaw)
    expect(advanceTabStartRaw).toBeGreaterThan(showVisualStartRaw)
    expect(endSessionStartRaw).toBeGreaterThan(advanceTabStartRaw)
    expect(templateToolsStartRaw).toBeGreaterThan(endSessionStartRaw)
  })

  it('inline show_visual never calls advanceOnTransition', () => {
    expect(inlineShowVisualBlock).not.toMatch(/advanceOnTransition/)
  })

  it('inline show_visual returns a confirmation string and does not reference the page-index ref or transitionMarker', () => {
    expect(inlineShowVisualBlock).toMatch(/return\s+'Visual is showing\.'/)
    expect(inlineShowVisualBlock).not.toMatch(/activeIndexRef/)
    expect(inlineShowVisualBlock).not.toMatch(/transitionMarker/)
  })
})

describe('B2B-58 — inlineTools.advance_tab is unchanged (still the only inline advance path)', () => {
  it('inline advance_tab still calls advanceOnTransition via the page transitionMarker', () => {
    // 2026-08-02 — B2B items 6/7 introduced `const idx = activeIndexRef.current` above this line
    // (for the new verification gate check) and the marker lookup now reads from `idx`.
    expect(inlineAdvanceTabBlock).toMatch(/const marker = inlinePages!\[idx\]\?\.transitionMarker/)
    expect(inlineAdvanceTabBlock).toMatch(/if \(marker\) advanceOnTransition\(marker\)/)
    expect(inlineAdvanceTabBlock).toMatch(/return 'Advanced\.'/)
  })
})

describe('B2B-58 — templateTools (legacy non-inline path) is untouched', () => {
  it('templateTools.show_visual still resolves an explicit section index and calls goToSection directly (unaffected, out of scope)', () => {
    const templateToolsBlock = stripComments(clientSrcRaw.slice(templateToolsStartRaw))
    expect(templateToolsBlock).toMatch(/show_visual: async \(params: Record<string, unknown>\) => \{/)
    expect(templateToolsBlock).toMatch(/const idx = resolveSectionIndex\(params\)/)
    expect(templateToolsBlock).toMatch(/goToSection\(idx\)/)
  })
})

describe('B2B-58 — prompt-template.ts rule 5 no longer offers show_visual as an alternate advance', () => {
  it('HUME_NATIVE_PROMPT_TEMPLATE does not contain the removed "(or show_visual for the next section...)" alternative', () => {
    const assembled = assembleHumeNativePrompt({
      profileContext: 'Executive in fintech.',
      intentContext: '',
      sessionContent: 'Section 1 content here.',
      sessionContentMode: 'inline',
    })
    expect(assembled).not.toMatch(/or show_visual for the next section/)
  })

  it('rule 5 now states advance_tab is the only tool that advances a section, and show_visual does not', () => {
    const assembled = assembleHumeNativePrompt({
      profileContext: 'Executive in fintech.',
      intentContext: '',
      sessionContent: 'Section 1 content here.',
      sessionContentMode: 'inline',
    })
    expect(assembled).toMatch(
      /call the\s+advance_tab tool and move on\. advance_tab is the only tool that advances\s+to the next section — show_visual does not\./
    )
  })

  it('PROMPT_TEMPLATE_VERSION is now v15 (B2B-58 bumped v10->v11; B2B-62 bumped v11->v12; B2B-66 bumped v13->v14; the 2026-08-02 meta-narration fix has since bumped v14->v15)', () => {
    expect(PROMPT_TEMPLATE_VERSION).toBe('v15')
  })
})
