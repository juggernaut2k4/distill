/**
 * RFC 5545 compliant .ics calendar event generation.
 * No external dependencies — builds the iCalendar string manually.
 */

export interface CalendarEvent {
  uid: string
  title: string
  description: string
  startAt: Date
  durationMinutes: number
  organizer: string
  organizerEmail: string
}

/**
 * Formats a Date to an ICS timestamp string: YYYYMMDDTHHmmssZ (UTC).
 */
function toICSTimestamp(date: Date): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

/**
 * Escapes special characters in ICS text fields per RFC 5545.
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Builds a single VEVENT block from a CalendarEvent.
 */
function buildVEVENT(event: CalendarEvent): string {
  const now = toICSTimestamp(new Date())
  const dtStart = toICSTimestamp(event.startAt)
  const endAt = new Date(event.startAt.getTime() + event.durationMinutes * 60 * 1000)
  const dtEnd = toICSTimestamp(endAt)

  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}@hello-clio.com`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICSText(event.title)}`,
    `DESCRIPTION:${escapeICSText(event.description)}`,
    `ORGANIZER;CN=${escapeICSText(event.organizer)}:mailto:${event.organizerEmail}`,
    'END:VEVENT',
  ].join('\r\n')
}

/**
 * Generates a single-event .ics file content string.
 * @param event - The calendar event to generate
 * @returns RFC 5545 compliant .ics string
 */
export function generateICS(event: CalendarEvent): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clio//Clio AI//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    buildVEVENT(event),
    'END:VCALENDAR',
  ].join('\r\n')
}

/**
 * Generates a single .ics file containing multiple VEVENT blocks.
 * @param events - Array of calendar events
 * @returns RFC 5545 compliant .ics string with all events
 */
export function generateMultiEventICS(events: CalendarEvent[]): string {
  const vevents = events.map(buildVEVENT).join('\r\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clio//Clio AI//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    vevents,
    'END:VCALENDAR',
  ].join('\r\n')
}
