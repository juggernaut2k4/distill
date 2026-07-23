/**
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §0a). Shared constant-time passcode check for
 * the /demo/[slug] Meeting tab's Save action and, per the 2026-07-23 CEO amendment, the Learn with AI
 * dispatch action too — same shared secret (`DEMO_MEETING_PASSCODE`), same fail-closed posture.
 * Edge-runtime-safe (no Node `crypto.timingSafeEqual`), mirroring lib/test-harness/basic-auth.ts.
 */

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = new TextEncoder().encode(a)
  const bBuf = new TextEncoder().encode(b)
  const maxLen = Math.max(aBuf.length, bBuf.length, 1)
  let diff = aBuf.length === bBuf.length ? 0 : 1
  for (let i = 0; i < maxLen; i++) {
    const x = i < aBuf.length ? aBuf[i] : 0
    const y = i < bBuf.length ? bBuf[i] : 0
    diff |= x ^ y
  }
  return diff === 0
}

/** Fails closed: an unconfigured DEMO_MEETING_PASSCODE never treats any input as correct. */
export function verifyDemoPasscode(candidate: string): boolean {
  const expected = process.env.DEMO_MEETING_PASSCODE ?? ''
  return expected.length > 0 && timingSafeEqualStrings(candidate, expected)
}
