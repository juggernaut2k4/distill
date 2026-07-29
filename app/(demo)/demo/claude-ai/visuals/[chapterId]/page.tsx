import { notFound } from 'next/navigation'
import VisualPageShell from '../_shell'
import WhatIsClaudeVisual from '../_visuals/WhatIsClaudeVisual'
import ModelFamilyVisual from '../_visuals/ModelFamilyVisual'
import ModesOfInteractionVisual from '../_visuals/ModesOfInteractionVisual'
import ChoosingModelVisual from '../_visuals/ChoosingModelVisual'
import DifferentiatorsVisual from '../_visuals/DifferentiatorsVisual'

const VISUALS: Record<string, { title: string; subtitle: string; Component: () => JSX.Element }> = {
  'what-is-claude': {
    title: 'What Is Claude?',
    subtitle: 'A constitutional AI, trained to critique and improve its own answers.',
    Component: WhatIsClaudeVisual,
  },
  'model-family': {
    title: 'The Claude Model Family',
    subtitle: 'Four models, four different tradeoffs between capability, speed, and cost.',
    Component: ModelFamilyVisual,
  },
  'modes-of-interaction': {
    title: 'Modes of Interaction',
    subtitle: 'Four ways to work with the same underlying models.',
    Component: ModesOfInteractionVisual,
  },
  'choosing-the-right-model': {
    title: 'Choosing the Right Model for the Job',
    subtitle: 'Four models, each optimized for a different job.',
    Component: ChoosingModelVisual,
  },
  'what-makes-claude-different': {
    title: 'What Makes Claude Different',
    subtitle: 'Four things that consistently set Claude apart.',
    Component: DifferentiatorsVisual,
  },
}

export function generateStaticParams() {
  return Object.keys(VISUALS).map((chapterId) => ({ chapterId }))
}

export function generateMetadata({ params }: { params: { chapterId: string } }) {
  const visual = VISUALS[params.chapterId]
  return { title: visual ? `${visual.title} — Learn with AI` : 'Learn with AI' }
}

export default function VisualPage({ params }: { params: { chapterId: string } }) {
  const visual = VISUALS[params.chapterId]
  if (!visual) notFound()
  const { title, subtitle, Component } = visual
  return (
    <VisualPageShell title={title} subtitle={subtitle}>
      <Component />
    </VisualPageShell>
  )
}
