import Link from 'next/link'
import { DEMO_TOPICS } from './_content'
import {
  pageStyle,
  navStyle,
  brandStyle,
  brandMarkStyle,
  containerStyle,
  eyebrowStyle,
  heroTitleStyle,
  heroSubtitleStyle,
  pillRowStyle,
  pillStyle,
  cardGridStyle,
  demoCardStyle,
  demoCardBodyStyle,
  demoLabelStyle,
  cardTitleStyle,
  cardMetaStyle,
  COLORS,
  thumbnailStyle,
} from './_styles'

/**
 * "Learn with AI" demo catalog — public, unauthenticated list page at test.hello-clio.com/demo.
 * Styled in the idiom of a course-catalog product (dark navy/purple, pill badges, card grid) using
 * only original "Learn with AI" branding — no third-party logo/wordmark.
 */
export const metadata = {
  title: 'Learn with AI — Demo Courses',
}

const GRADIENTS = [
  'linear-gradient(135deg, #8b5cf6 0%, #3b2f7a 55%, #1a1436 100%)',
  'linear-gradient(135deg, #ec4899 0%, #6d28d9 55%, #1a1436 100%)',
]

export default function DemoCatalogPage() {
  return (
    <div style={pageStyle}>
      <nav style={navStyle}>
        <Link href="/demo" style={brandStyle}>
          <span style={brandMarkStyle} aria-hidden="true" />
          Learn with AI
        </Link>
      </nav>

      <div style={containerStyle}>
        <div style={{ padding: '0 clamp(16px, 4vw, 48px)' }}>
          <div style={eyebrowStyle}>Demo Courses</div>
          <h1 style={heroTitleStyle}>Two ways AI helps you learn faster</h1>
          <p style={heroSubtitleStyle}>
            A quick look at what a Learn with AI course feels like — one non-technical, one deep
            and code-first. Pick a demo below to see the full course page.
          </p>
          <div style={pillRowStyle}>
            <span style={pillStyle}>2 demo courses</span>
            <span style={pillStyle}>No sign-in required</span>
          </div>

          <div style={cardGridStyle}>
            {DEMO_TOPICS.map((topic, i) => (
              <Link key={topic.slug} href={`/demo/${topic.slug}`} style={demoCardStyle}>
                <div style={thumbnailStyle(GRADIENTS[i % GRADIENTS.length])}>
                  <svg width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.14)" />
                    <path d="M10 8.5L16 12L10 15.5V8.5Z" fill="#ffffff" />
                  </svg>
                </div>
                <div style={demoCardBodyStyle}>
                  <span style={demoLabelStyle}>
                    {topic.demoLabel} — {topic.category}
                  </span>
                  <h2 style={cardTitleStyle}>{topic.title}</h2>
                  <p style={{ fontSize: 13.5, color: COLORS.textSecondary, margin: 0, lineHeight: 1.55 }}>
                    {topic.subtitle}
                  </p>
                  <div style={cardMetaStyle}>
                    <span>{topic.durationLabel}</span>
                    <span>·</span>
                    <span>{topic.level}</span>
                    <span>·</span>
                    <span>★ {topic.rating.toFixed(1)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
