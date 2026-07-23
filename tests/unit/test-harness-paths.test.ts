import { describe, it, expect } from 'vitest'
import { isTestHarnessAuthoringPath, isDemoPath } from '@/lib/test-harness/paths'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md AT-1). Covers the exact path-matching logic
 * `middleware.ts` uses both for the Basic-Auth gate on `test.hello-clio.com` and for the
 * defense-in-depth block on every other host — critically, this must NEVER match
 * `/test-harness-render/*`, which is a deliberately public route.
 */
describe('isTestHarnessAuthoringPath', () => {
  it('matches the topics list root', () => {
    expect(isTestHarnessAuthoringPath('/test-harness')).toBe(true)
  })

  it('matches nested authoring page routes', () => {
    expect(isTestHarnessAuthoringPath('/test-harness/topics/abc-123')).toBe(true)
    expect(isTestHarnessAuthoringPath('/test-harness/topics/abc-123/payload')).toBe(true)
  })

  it('matches the authoring API routes', () => {
    expect(isTestHarnessAuthoringPath('/api/test-harness/topics')).toBe(true)
    expect(isTestHarnessAuthoringPath('/api/test-harness/screens/abc-123')).toBe(true)
    expect(isTestHarnessAuthoringPath('/api/test-harness/dispatch/abc-123')).toBe(true)
  })

  it('does NOT match the public render route, even though it shares the /test-harness prefix', () => {
    expect(isTestHarnessAuthoringPath('/test-harness-render/abc-123')).toBe(false)
    expect(isTestHarnessAuthoringPath('/test-harness-render')).toBe(false)
  })

  it('does not match unrelated paths', () => {
    expect(isTestHarnessAuthoringPath('/dashboard')).toBe(false)
    expect(isTestHarnessAuthoringPath('/')).toBe(false)
    expect(isTestHarnessAuthoringPath('/api/partner/v1/sessions')).toBe(false)
  })
})

/**
 * "Learn with AI" demo catalog isolation — public/no-auth, but must still be scoped to
 * test.hello-clio.com only via the defense-in-depth 404 in middleware.ts, since it's in the
 * global isPublicRoute list (which makes it Clerk-reachable on every host by default).
 */
describe('isDemoPath', () => {
  it('matches the catalog root and nested topic routes', () => {
    expect(isDemoPath('/demo')).toBe(true)
    expect(isDemoPath('/demo/claude-ai')).toBe(true)
    expect(isDemoPath('/demo/oop-fundamentals')).toBe(true)
  })

  it('does not match unrelated paths, including other test-harness paths', () => {
    expect(isDemoPath('/')).toBe(false)
    expect(isDemoPath('/dashboard')).toBe(false)
    expect(isDemoPath('/test-harness')).toBe(false)
    expect(isDemoPath('/demonstration')).toBe(false)
  })

  it('matches the B2B-33 meeting-URL/dispatch API routes', () => {
    expect(isDemoPath('/api/demo/claude-ai/meeting')).toBe(true)
    expect(isDemoPath('/api/demo/oop-fundamentals/dispatch')).toBe(true)
  })

  it('does not match unrelated API paths, including the real partner sessions endpoint', () => {
    expect(isDemoPath('/api/partner/v1/sessions')).toBe(false)
    expect(isDemoPath('/api/test-harness/topics')).toBe(false)
  })
})
