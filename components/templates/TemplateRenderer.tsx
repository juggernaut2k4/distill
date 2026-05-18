'use client'

import type { TemplateSection } from '@/lib/templates/types'
import TopicHero from './renderers/TopicHero'
import ConceptDefinition from './renderers/ConceptDefinition'
import ComparisonTable from './renderers/ComparisonTable'
import StepFlow from './renderers/StepFlow'
import ProsCons from './renderers/ProsCons'
import CaseStudy from './renderers/CaseStudy'
import KeyTakeaway from './renderers/KeyTakeaway'
import QuestionAnswer from './renderers/QuestionAnswer'
import GenericTemplate from './renderers/GenericTemplate'

export interface TemplateRendererProps {
  section: TemplateSection
  isActive: boolean
  onReady?: () => void
}

/**
 * Routes a TemplateSection to its correct renderer component.
 * Falls back to GenericTemplate for types without a dedicated renderer.
 */
export default function TemplateRenderer({ section, isActive, onReady }: TemplateRendererProps) {
  switch (section.type) {
    case 'TopicHero':
      return <TopicHero data={section.data} isActive={isActive} onReady={onReady} />

    case 'ConceptDefinition':
      return <ConceptDefinition data={section.data} isActive={isActive} onReady={onReady} />

    case 'ComparisonTable':
      return <ComparisonTable data={section.data} isActive={isActive} onReady={onReady} />

    case 'StepFlow':
      return <StepFlow data={section.data} isActive={isActive} onReady={onReady} />

    case 'ProsCons':
      return <ProsCons data={section.data} isActive={isActive} onReady={onReady} />

    case 'CaseStudy':
      return <CaseStudy data={section.data} isActive={isActive} onReady={onReady} />

    case 'KeyTakeaway':
      return <KeyTakeaway data={section.data} isActive={isActive} onReady={onReady} />

    case 'QuestionAnswer':
      return <QuestionAnswer data={section.data} isActive={isActive} onReady={onReady} />

    // All remaining types use GenericTemplate until dedicated renderers are built
    case 'TwoByTwoMatrix':
    case 'FrameworkCard':
    case 'StatCallout':
    case 'Timeline':
    case 'ConceptMap':
    case 'QuoteCallout':
    case 'ActionPlan':
    case 'Funnel':
      return <GenericTemplate section={section} isActive={isActive} onReady={onReady} />
  }
}
