// app/dashboard/configurator/developer/content.ts
//
// Hand-transcribed from the live route files cited in
// docs/specs/B2B-07-requirement-document.md's header, verified against them
// directly (not from any other spec doc, which can drift). Update this file
// whenever any of those four routes' request/response contract changes — a
// stale reference here is worse than none, matching this repo's existing
// docs/reference-vendor-api-integrations.md convention.
//
// This is hand-authored reference content, never populated by an AI/LLM API
// call (Requirement Doc Section 4.A, standing repo rule against speculative
// model output on undefined-content screens).

export type PlaygroundEndpointId = 'sessions_create' | 'sessions_get' | 'usage' | 'wallet'

export interface EndpointDoc {
  id: PlaygroundEndpointId
  method: 'GET' | 'POST'
  path: string // display path, e.g. '/api/partner/v1/sessions/:clio_session_ref'
  purpose: string
  rateLimit: string
  requestFields?: { field: string; type: string; required: string; notes: string }[]
  queryParams?: { param: string; type: string; default: string; notes: string }[]
  pathParam?: { name: string; type: string; notes: string }
  exampleRequestBody?: object // undefined for GET endpoints with no body
  exampleResponse: object
  responseNotes: string[] // rendered as a bullet list under the example response
  otherResponses: { status: string; meaning: string }[]
  playgroundDisabled: boolean
  playgroundDisabledReason?: string
}

export const ENDPOINTS: EndpointDoc[] = [
  {
    id: 'sessions_create',
    method: 'POST',
    path: '/api/partner/v1/sessions',
    purpose:
      'Starts a new Clio session — dispatches a real meeting bot into the given URL and provisions the live voice/visual experience.',
    rateLimit: '60 requests/minute per partner account.',
    requestFields: [
      { field: 'meeting_url', type: 'string (URL)', required: 'Yes', notes: 'Must be a valid URL.' },
      { field: 'partner_topic_ref', type: 'string', required: 'No*', notes: '1–512 printable-ASCII chars.' },
      { field: 'content_ref', type: 'string (UUID)', required: 'No*', notes: '' },
      { field: 'partner_end_user_ref', type: 'string', required: 'No', notes: '1–256 printable-ASCII chars.' },
      {
        field: 'partner_reference',
        type: 'string',
        required: 'No',
        notes: '1–256 printable-ASCII chars. Echoed on every usage webhook for this session.',
      },
    ],
    exampleRequestBody: {
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      partner_topic_ref: 'onboarding-101',
      partner_reference: 'acct_492',
    },
    exampleResponse: { clio_session_ref: 'uuid', status: 'bot_active', render_url: 'string' },
    responseNotes: [
      '* At least one of partner_topic_ref or content_ref is required.',
      '401/403/429 use { error: { code, message, request_id } }.',
      '402/500 use { error: { code, message } } — no request_id.',
      '422 uses { error: "Validation failed", details } — error is a plain string here, not an object.',
    ],
    otherResponses: [
      { status: '401', meaning: 'invalid_api_key / revoked_api_key' },
      { status: '402', meaning: 'trial_exhausted (test-mode keys only, once the free 20-minute allowance is used up)' },
      { status: '403', meaning: 'account_suspended' },
      { status: '422', meaning: 'validation failure' },
      { status: '429', meaning: 'rate limit exceeded, Retry-After header present' },
    ],
    // Enabled 2026-07-16 per Arun's direct confirmation: a test-mode dispatch
    // from this Playground is meant to behave exactly like any other
    // test-mode API call — a real bot, bounded by B2B-08's existing trial
    // gate (free 20-minute allowance, then a paid test block). No separate
    // Playground-specific safeguard is needed; B2B-08's 402 trial_exhausted
    // response is the intended limit.
    playgroundDisabled: false,
  },
  {
    id: 'sessions_get',
    method: 'GET',
    path: '/api/partner/v1/sessions/:clio_session_ref',
    purpose: 'Reads the current status of a session you previously created.',
    rateLimit: '300 requests/minute per partner account.',
    pathParam: { name: 'clio_session_ref', type: 'UUID', notes: 'Required.' },
    exampleResponse: { clio_session_ref: 'uuid', status: 'bot_active', created_at: 'ISO 8601', ended_at: null },
    responseNotes: ['Never includes provider_bot_id, provider_name, or meeting_url — internal-only fields.'],
    otherResponses: [
      { status: '401/403', meaning: 'same as sessions_create' },
      { status: '404', meaning: 'not_found — identical whether the ref does not exist or belongs to a different partner' },
    ],
    playgroundDisabled: false,
  },
  {
    id: 'usage',
    method: 'GET',
    path: '/api/partner/v1/usage',
    purpose: "Reads your account's own billable usage history — one row per metered event.",
    rateLimit: '300 requests/minute per partner account.',
    queryParams: [
      { param: 'from', type: 'ISO 8601 string', default: '30 days ago', notes: '' },
      { param: 'to', type: 'ISO 8601 string', default: 'now', notes: '' },
      {
        param: 'event_type',
        type: '"usage.voice_minute" | "usage.llm_generation_call" | "session.completed"',
        default: '(all types)',
        notes: 'session.completed always returns an empty events array.',
      },
      { param: 'cursor', type: 'opaque base64 string', default: '(first page)', notes: 'From the previous response next_cursor.' },
    ],
    exampleResponse: {
      events: [
        { event_id: 'uuid', event_type: 'usage.voice_minute', quantity: 2.0, unit: 'minutes', test_mode: false, delivery_status: 'delivered' },
      ],
      next_cursor: null,
    },
    responseNotes: ['Always filtered to test_mode = false.', 'Page size 100.'],
    otherResponses: [
      { status: '401/403', meaning: 'same as sessions_create' },
      { status: '422', meaning: 'invalid event_type (string-error shape, same as sessions_create)' },
      { status: '429', meaning: 'rate limit exceeded' },
    ],
    playgroundDisabled: false,
  },
  {
    id: 'wallet',
    method: 'GET',
    path: '/api/partner/v1/wallet',
    purpose: 'Reads your current prepaid balance, per-event-type burn rate, and projected days-until-exhausted.',
    rateLimit: '300 requests/minute per partner account.',
    exampleResponse: {
      balance_usd: 42.315,
      reference_topup_amount_usd: 100.0,
      low_balance_alert_active: false,
      burn_rate_by_event_type: [{ event_type: 'voice_minute', unit: 'minute', rate_usd: 0.015, rate_basis: 'cogs_placeholder_2026_05_no_margin' }],
      avg_daily_burn_usd: 1.203,
      projected_days_remaining: 35.2,
      days_remaining_null_reason: null,
      next_billing_date: '2026-08-13T00:00:00Z',
      updated_at: '2026-07-13T19:00:00Z',
    },
    responseNotes: [
      'burn_rate_by_event_type always lists all 8 current event types; rate_usd: null means no rate configured yet.',
      'No explicit 4xx handling beyond auth — a DB read failure surfaces as a generic, unstructured 500.',
    ],
    otherResponses: [{ status: '401/403', meaning: 'same as usage' }],
    playgroundDisabled: false,
  },
]

export const WEBHOOK_DOC = {
  path: 'POST {your outbound_base_url}/webhooks/usage',
  payloadFields: [
    'event_id',
    'event_type',
    'clio_session_ref',
    'partner_reference',
    'quantity',
    'unit',
    'generation_type',
    'occurred_at',
    'dispatched_at',
    'test_mode',
  ],
  signatureHeader: 'Clio-Signature: t=<unix_timestamp>,v1=<hex_hmac>',
  verificationRecipe: 'HMAC-SHA256(signing_secret, `${t}.${raw_body}`), constant-time compare, reject if |now - t| > 300s.',
  retrySchedule: '1m, 5m, 30m, 2h, 6h (5 attempts total, then marked exhausted).',
  knownGap: 'No transcript, action-item, glitch, or psychology data in this payload today — usage/billing fields only.',
}
