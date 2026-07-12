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
import Timeline from './renderers/Timeline'
import ConceptMap from './renderers/ConceptMap'
import TwoByTwoMatrix from './renderers/TwoByTwoMatrix'
import FrameworkCard from './renderers/FrameworkCard'
import StatCallout from './renderers/StatCallout'
import ActionPlan from './renderers/ActionPlan'
import Funnel from './renderers/Funnel'
import FlowchartRenderer from './renderers/Flowchart'
import Hierarchy from './renderers/Hierarchy'
import GenericTemplate from './renderers/GenericTemplate'
import ChevronProcess from './renderers/ChevronProcess'
import NarrativeCard from './renderers/NarrativeCard'
import DefinitionTriptych from './renderers/DefinitionTriptych'
import HorizontalDecision from './renderers/HorizontalDecision'
import AnswerSpotlight from './renderers/AnswerSpotlight'
import HorizontalTree from './renderers/HorizontalTree'
import SessionOverview from './renderers/SessionOverview'
import SessionSummary from './renderers/SessionSummary'
import Heatmap from './renderers/Heatmap'
import Overlay from './renderers/Overlay'
import type { StyleOverrides } from '@/lib/templates/styleOverrideSlots'

export interface TemplateRendererProps {
  section: TemplateSection
  isActive: boolean
  onReady?: () => void
  /**
   * TMPL-01 (requirement doc Section 6) — the row's currently-applied
   * style_overrides, read at render time. Only ever populated by the one
   * caller that shows the fix loop's output (the admin Template Library
   * preview) and only ever consumed by Heatmap/Overlay — every other
   * renderer ignores this prop entirely, matching the fix loop's scoping to
   * those 2 templates only (Section 4.1/12). Optional and untouched by every
   * existing call site (SessionStack, KBSessionPreview), so this is additive,
   * not a behavior change for live sessions.
   */
  styleOverrides?: StyleOverrides
  /**
   * TMPL-07 (requirement doc Section 4.5) — per-template title/subtitle
   * header on/off, read at render time. Only ever populated by the admin
   * Template Library preview (TemplateApprovalClient.tsx) and only ever
   * consumed by the 7 templates in HEADER_TOGGLE_TEMPLATE_NAMES — every other
   * renderer ignores this prop entirely. Optional and untouched by every
   * existing call site (SessionStack, any walkthrough/preview caller), so
   * this is additive, not a behavior change for live sessions (Section 4.6).
   */
  headerEnabled?: boolean
}

export default function TemplateRenderer({ section, isActive, onReady, styleOverrides, headerEnabled }: TemplateRendererProps) {
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
    case 'Timeline':
      return <Timeline data={section.data} isActive={isActive} onReady={onReady} />
    case 'ConceptMap':
      return <ConceptMap data={section.data} isActive={isActive} onReady={onReady} headerEnabled={headerEnabled} />
    case 'TwoByTwoMatrix':
      return <TwoByTwoMatrix data={section.data} isActive={isActive} onReady={onReady} />
    case 'FrameworkCard':
      return <FrameworkCard data={section.data} isActive={isActive} onReady={onReady} headerEnabled={headerEnabled} />
    case 'StatCallout':
      return <StatCallout data={section.data} isActive={isActive} onReady={onReady} headerEnabled={headerEnabled} meta={section.meta} />
    case 'ActionPlan':
      return <ActionPlan data={section.data} isActive={isActive} onReady={onReady} headerEnabled={headerEnabled} />
    case 'Funnel':
      return <Funnel data={section.data} isActive={isActive} onReady={onReady} />
    case 'Flowchart':
      return <FlowchartRenderer data={section.data} isActive={isActive} onReady={onReady} />
    case 'Hierarchy':
      return <HorizontalTree data={section.data} isActive={isActive} onReady={onReady} />
    case 'QuoteCallout':
      return <GenericTemplate section={section} isActive={isActive} onReady={onReady} headerEnabled={headerEnabled} />
    case 'ChevronProcess':
      return <ChevronProcess data={section.data} isActive={isActive} onReady={onReady} />
    case 'NarrativeCard':
      return <NarrativeCard data={section.data} isActive={isActive} onReady={onReady} headerEnabled={headerEnabled} />
    case 'DefinitionTriptych':
      return <DefinitionTriptych data={section.data} isActive={isActive} onReady={onReady} />
    case 'HorizontalDecision':
      return <HorizontalDecision data={section.data} isActive={isActive} onReady={onReady} />
    case 'AnswerSpotlight':
      return <AnswerSpotlight data={section.data} isActive={isActive} onReady={onReady} headerEnabled={headerEnabled} meta={section.meta} />
    case 'Heatmap':
      return <Heatmap data={section.data} isActive={isActive} onReady={onReady} styleOverrides={styleOverrides} />
    case 'Overlay':
      return <Overlay data={section.data} isActive={isActive} onReady={onReady} styleOverrides={styleOverrides} />
    case 'SessionOverview':
      return <SessionOverview data={section.data} isActive={isActive} onReady={onReady} />
    case 'SessionSummary':
      return <SessionSummary data={section.data} isActive={isActive} onReady={onReady} />
  }
}
