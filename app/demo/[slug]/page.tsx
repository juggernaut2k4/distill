import { notFound } from 'next/navigation'
import { DEMO_TOPICS, getDemoTopicBySlug } from '../_content'
import DemoTopicClient from './DemoTopicClient'

export function generateStaticParams() {
  return DEMO_TOPICS.map((topic) => ({ slug: topic.slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const topic = getDemoTopicBySlug(params.slug)
  return { title: topic ? `${topic.title} — Learn with AI` : 'Learn with AI' }
}

export default function DemoTopicPage({ params }: { params: { slug: string } }) {
  const topic = getDemoTopicBySlug(params.slug)
  if (!topic) notFound()
  return <DemoTopicClient topic={topic} />
}
