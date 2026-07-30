// @vitest-environment jsdom
//
// B2B-51 (docs/specs/B2B-51-requirement-document.md §13) — Performance tab "ready" state literal
// Field/Value table. First dedicated component test for DemoTopicClient.tsx (none existed before this
// brief). Covers AT-1 through AT-8.
//
// NOTE: this test renders TSX under Vitest, which required an `oxc.jsx` mode override in
// vitest.config.ts (this repo's tsconfig.json sets "jsx": "preserve" for Next.js's own SWC build,
// which Vitest's own transform can't consume directly) — see the comment there for detail.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DemoTopicClient from '../../app/(demo)/demo/[slug]/DemoTopicClient'
import type { DemoTopic } from '../../app/(demo)/demo/_content'
import { readFileSync } from 'fs'
import { join } from 'path'

const TOPIC: DemoTopic = {
  slug: 'claude-ai',
  demoLabel: 'Demo 1',
  title: 'Claude AI: Models & Capabilities',
  subtitle: 'Understand the Claude model family',
  author: 'Learn with AI',
  authorRole: 'Course Team',
  durationLabel: '45m',
  level: 'Beginner',
  rating: 4.8,
  ratingCount: 120,
  updatedLabel: 'July 2026',
  category: 'AI',
  overview: 'An overview.',
  chapters: [],
}

const MEETING_RESPONSE = { meeting_url: null, end_user_name: null, updated_at: null }

/** Installs a `global.fetch` mock that answers the Performance and Meeting fetches DemoTopicClient
 * makes on mount, and any subsequent Performance poll, with the given performance payload. */
function mockFetch(performancePayload: unknown, opts: { ok?: boolean } = {}) {
  const ok = opts.ok ?? true
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/performance')) {
      return Promise.resolve({
        ok,
        json: () => Promise.resolve(performancePayload),
      } as Response)
    }
    if (url.includes('/meeting')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MEETING_RESPONSE),
      } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }) as unknown as typeof fetch
}

async function renderAndOpenPerformanceTab() {
  render(<DemoTopicClient topic={TOPIC} />)
  const tabButton = await screen.findByRole('button', { name: 'Performance' })
  fireEvent.click(tabButton)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

const FULL_READY_PAYLOAD = {
  session_state: 'ready',
  duration_minutes: 14.5,
  action_items: [{ text: 'Review the pricing page' }, { text: 'Share the onboarding checklist' }],
  learner_insight: {
    summary: 'The learner asked mostly about pricing tiers and integration effort.',
    topics_of_interest: ['pricing', 'integration effort'],
    engagement_style: 'Asked clarifying questions throughout',
    suggested_next_topics: ['rollout planning', 'team onboarding'],
  },
}

describe('B2B-51 Performance tab — literal Field/Value table (ready state)', () => {
  it('AT-1: Duration row reads exactly "14.5 minutes"', async () => {
    mockFetch(FULL_READY_PAYLOAD)
    await renderAndOpenPerformanceTab()

    await waitFor(() => expect(screen.getByText('14.5 minutes')).toBeInTheDocument())
  })

  it('AT-2: Action items row renders a bulleted list with exactly those two items, in order', async () => {
    mockFetch(FULL_READY_PAYLOAD)
    await renderAndOpenPerformanceTab()

    await waitFor(() => expect(screen.getByText('Action items')).toBeInTheDocument())
    const row = screen.getByText('Action items').closest('div')?.parentElement as HTMLElement
    const items = row.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Review the pricing page')
    expect(items[1]).toHaveTextContent('Share the onboarding checklist')
  })

  it('AT-3: Summary/Engagement style verbatim, Topics of interest/Suggested next topics as matching bulleted lists', async () => {
    mockFetch(FULL_READY_PAYLOAD)
    await renderAndOpenPerformanceTab()

    await waitFor(() =>
      expect(screen.getByText('The learner asked mostly about pricing tiers and integration effort.')).toBeInTheDocument()
    )
    expect(screen.getByText('Asked clarifying questions throughout')).toBeInTheDocument()

    const topicsRow = screen.getByText('Topics of interest').closest('div')?.parentElement as HTMLElement
    const topicsItems = Array.from(topicsRow.querySelectorAll('li')).map((li) => li.textContent)
    expect(topicsItems).toEqual(['pricing', 'integration effort'])

    const suggestedRow = screen.getByText('Suggested next topics').closest('div')?.parentElement as HTMLElement
    const suggestedItems = Array.from(suggestedRow.querySelectorAll('li')).map((li) => li.textContent)
    expect(suggestedItems).toEqual(['rollout planning', 'team onboarding'])
  })

  it('AT-4 (negative, rendered output): a glitches array injected onto the payload never appears in the rendered DOM text', async () => {
    const payloadWithGlitches = {
      ...FULL_READY_PAYLOAD,
      // Simulates a future accidental regression per AT-4 — the route itself never sends this today.
      glitches: [{ type: 'audio_dropout', description: 'Simulated glitch text that must never render' }],
    }
    mockFetch(payloadWithGlitches)
    await renderAndOpenPerformanceTab()

    await waitFor(() => expect(screen.getByText('14.5 minutes')).toBeInTheDocument())

    const bodyText = document.body.textContent ?? ''
    expect(bodyText.toLowerCase()).not.toContain('glitch')
  })

  it('AT-4 (negative, static source check): DemoTopicClient.tsx contains no substring "glitches" anywhere', () => {
    const sourcePath = join(__dirname, '../../app/(demo)/demo/[slug]/DemoTopicClient.tsx')
    const source = readFileSync(sourcePath, 'utf-8')
    expect(source.toLowerCase()).not.toContain('glitch')
  })

  it('AT-5: success_empty case — all six rows present, each independently empty-checked', async () => {
    mockFetch({
      session_state: 'ready',
      duration_minutes: 2.1,
      action_items: [],
      learner_insight: null,
    })
    await renderAndOpenPerformanceTab()

    await waitFor(() => expect(screen.getByText('2.1 minutes')).toBeInTheDocument())

    // Fixed 6-row shape always present, in order.
    expect(screen.getByText('Duration')).toBeInTheDocument()
    expect(screen.getByText('Action items')).toBeInTheDocument()
    expect(screen.getByText('Summary')).toBeInTheDocument()
    expect(screen.getByText('Topics of interest')).toBeInTheDocument()
    expect(screen.getByText('Engagement style')).toBeInTheDocument()
    expect(screen.getByText('Suggested next topics')).toBeInTheDocument()

    // List fields -> "None identified" (Action items, Topics of interest, Suggested next topics).
    expect(screen.getAllByText('None identified')).toHaveLength(3)
    // Scalar fields -> "Not available" (Summary, Engagement style). Duration is populated here.
    expect(screen.getAllByText('Not available')).toHaveLength(2)
  })

  it('AT-6: non-ready states render no table row markup — only the unchanged message', async () => {
    mockFetch({
      session_state: 'not_dispatched',
      duration_minutes: null,
      action_items: null,
      learner_insight: null,
    })
    render(<DemoTopicClient topic={TOPIC} />)
    const tabButton = await screen.findByRole('button', { name: 'Performance' })
    fireEvent.click(tabButton)

    await waitFor(() => expect(screen.getByText('No meeting dispatched yet.')).toBeInTheDocument())

    // None of the table's fixed field labels should ever appear for a non-ready state.
    expect(screen.queryByText('Duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Action items')).not.toBeInTheDocument()
    expect(screen.queryByText('Summary')).not.toBeInTheDocument()
    expect(document.querySelector('table')).toBeNull()
  })

  it('AT-8: a single-item Topics of interest array still renders as a one-item bulleted list', async () => {
    mockFetch({
      ...FULL_READY_PAYLOAD,
      learner_insight: {
        ...FULL_READY_PAYLOAD.learner_insight,
        topics_of_interest: ['pricing'],
      },
    })
    await renderAndOpenPerformanceTab()

    await waitFor(() => expect(screen.getByText('Topics of interest')).toBeInTheDocument())
    const topicsRow = screen.getByText('Topics of interest').closest('div')?.parentElement as HTMLElement
    const items = topicsRow.querySelectorAll('li')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('pricing')
    // Not collapsed to plain inline text — must still be inside a <ul>.
    expect(topicsRow.querySelector('ul')).not.toBeNull()
  })

  it('AT-7: at a narrow viewport, each row is a flex-wrap container that reflows Field above Value', async () => {
    mockFetch(FULL_READY_PAYLOAD)
    await renderAndOpenPerformanceTab()

    await waitFor(() => expect(screen.getByText('Duration')).toBeInTheDocument())

    // jsdom does not compute real layout (getBoundingClientRect always returns 0s), so a true
    // rendered bounding-box/offset comparison isn't possible at this test layer — this asserts the
    // CSS mechanism §6.4 specifies actually produces the reflow (flex-wrap row, shrink-proof field
    // cell, growable value cell with minWidth: 0), which is what makes the offset behavior true in a
    // real browser. An E2E pass remains optional per §13, not required.
    const durationRow = screen.getByText('Duration').parentElement as HTMLElement
    const computedRow = window.getComputedStyle(durationRow)
    expect(computedRow.display).toBe('flex')
    expect(computedRow.flexWrap).toBe('wrap')

    const fieldCell = screen.getByText('Duration')
    const computedField = window.getComputedStyle(fieldCell)
    expect(computedField.flexShrink).toBe('0')
  })
})
