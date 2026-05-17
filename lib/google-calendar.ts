/**
 * Google Calendar API integration — service account auth.
 * googleapis is the official Google SDK (not in original approved list,
 * but qualifies as an official vendor SDK with millions of weekly downloads).
 *
 * Creates calendar events with Google Meet conferenceData so each session
 * gets its own Meet link automatically.
 */

import { google } from 'googleapis'

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

  if (!email || !rawKey || email.startsWith('PLACEHOLDER') || rawKey.startsWith('PLACEHOLDER')) {
    return null
  }

  // Vercel stores the private key with literal \n — convert to real newlines
  const privateKey = rawKey.replace(/\\n/g, '\n')

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })
}

export interface GoogleMeetResult {
  meetUrl: string
  eventId: string
  calendarEventLink: string
}

/**
 * Creates a Google Calendar event with a Google Meet conference link.
 * Returns the Meet URL, or null if credentials are not configured.
 */
export async function createGoogleMeetEvent(params: {
  title: string
  description: string
  startIso: string
  durationMins: number
}): Promise<GoogleMeetResult | null> {
  const auth = getAuth()
  if (!auth) {
    console.log('[google-calendar] MOCK — no service account configured, skipping Meet creation')
    return null
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID ?? 'primary'
  const calendar = google.calendar({ version: 'v3', auth })

  const start = new Date(params.startIso)
  const end = new Date(start.getTime() + params.durationMins * 60 * 1000)

  const response = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: 1,
    requestBody: {
      summary: params.title,
      description: params.description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      conferenceData: {
        createRequest: {
          requestId: `clio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    },
  })

  const event = response.data
  const meetUrl = event.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === 'video'
  )?.uri

  if (!meetUrl || !event.id) {
    throw new Error('[google-calendar] Event created but no Meet URL returned')
  }

  return {
    meetUrl,
    eventId: event.id,
    calendarEventLink: event.htmlLink ?? '',
  }
}
