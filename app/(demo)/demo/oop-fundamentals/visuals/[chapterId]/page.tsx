import { notFound } from 'next/navigation'
import VisualPageShell from '../_shell'
import WhyOopVisual from '../_visuals/WhyOopVisual'
import ClassesAndObjectsVisual from '../_visuals/ClassesAndObjectsVisual'
import EncapsulationVisual from '../_visuals/EncapsulationVisual'
import AbstractionVisual from '../_visuals/AbstractionVisual'
import InheritanceVisual from '../_visuals/InheritanceVisual'
import PolymorphismVisual from '../_visuals/PolymorphismVisual'
import OopInTheRealWorldVisual from '../_visuals/OopInTheRealWorldVisual'

const VISUALS: Record<string, { title: string; subtitle: string; Component: () => JSX.Element }> = {
  'why-oop': {
    title: 'Why Object-Oriented Programming?',
    subtitle: 'Structuring code around data and the behavior that belongs to it.',
    Component: WhyOopVisual,
  },
  'classes-and-objects': {
    title: 'Classes and Objects',
    subtitle: 'A class is a blueprint; an object is a specific instance.',
    Component: ClassesAndObjectsVisual,
  },
  encapsulation: {
    title: 'Encapsulation',
    subtitle: 'Bundling data with the methods that control how it can change.',
    Component: EncapsulationVisual,
  },
  abstraction: {
    title: 'Abstraction',
    subtitle: 'Expose what an object does, hide how it does it.',
    Component: AbstractionVisual,
  },
  inheritance: {
    title: 'Inheritance',
    subtitle: 'Reuse and extend a base class to model an "is-a" relationship.',
    Component: InheritanceVisual,
  },
  polymorphism: {
    title: 'Polymorphism',
    subtitle: 'The same method call, correct behavior per type.',
    Component: PolymorphismVisual,
  },
  'oop-in-the-real-world': {
    title: 'OOP in the Real World',
    subtitle: 'The four pillars together, and where you’ll see them.',
    Component: OopInTheRealWorldVisual,
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
