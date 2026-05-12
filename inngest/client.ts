import { Inngest } from 'inngest'

const eventKey = process.env.INNGEST_EVENT_KEY ?? 'development'
const isPlaceholder = !process.env.INNGEST_EVENT_KEY ||
  process.env.INNGEST_EVENT_KEY.startsWith('PLACEHOLDER_')

if (isPlaceholder) {
  console.log('[MOCK] Inngest client initialized in mock mode — events will be logged but not sent')
}

/**
 * Inngest client for Clio.
 * Initialized with INNGEST_EVENT_KEY env var.
 * Falls back to 'development' key in mock mode — functions still register locally.
 */
export const inngest = new Inngest({
  id: 'clio',
  eventKey,
})
