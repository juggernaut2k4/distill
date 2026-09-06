// app/dashboard/configurator/api/content.ts
//
// Hand-transcribed from the live route files cited in each entry's comment,
// verified against them directly (not from any other spec doc, which can
// drift). Update this file whenever any of these routes' request/response
// contract changes — a stale reference here is worse than none, matching
// this repo's existing docs/reference-vendor-api-integrations.md convention.
//
// This is hand-authored reference content, never populated by an AI/LLM API
// call (Requirement Doc Section 4.A, standing repo rule against speculative
// model output on undefined-content screens). Only fields that actually
// exist in the live request/response schema are documented here — a field
// discussed but not yet built (e.g. end_user_domain, considered during a
// 2026-08-10 planning conversation but never added to
// lib/partner/widget-session-schema.ts) must not appear until it ships.

export type PlaygroundEndpointId =
  | 'oauth_token'
  | 'content_sources_create'
  | 'sessions_create'
  | 'sessions_get'
  | 'widget_sessions_create'
  | 'bot_dispatch'
  | 'bot_sessions_create'
  | 'usage'
  | 'wallet'

export type EndpointCategory = 'Auth' | 'Content' | 'Sessions' | 'Reporting'

export interface EndpointDoc {
  id: PlaygroundEndpointId
  category: EndpointCategory
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
  /** oauth_token is how you GET a credential — it takes no Authorization header itself. */
  noAuthRequired?: boolean
  /** Defaults to true (visible) when omitted. Set false to hide from the ApiClient.tsx nav/docs
   *  surface without deleting the entry — PlaygroundClient.tsx still reads the full, unfiltered
   *  ENDPOINTS array and depends on every id (including hidden ones) continuing to resolve. */
  partnerVisible?: boolean
}

export const ENDPOINTS: EndpointDoc[] = [
  {
    id: 'oauth_token',
    category: 'Auth',
    method: 'POST',
    path: '/api/partner/v1/oauth/token',
    purpose:
      'Exchanges your client_id/client_secret for a short-lived access token (RFC 6749 §4.4 Client Credentials grant). A static API key works too, sent the same way as the token below — this endpoint only matters if you specifically want OAuth2.',
    rateLimit: '300 requests/minute per partner account.',
    requestFields: [
      { field: 'grant_type', type: 'string', required: 'Yes', notes: 'Always "client_credentials".' },
      { field: 'client_id', type: 'string', required: 'Yes', notes: '' },
      { field: 'client_secret', type: 'string', required: 'Yes', notes: '' },
    ],
    exampleRequestBody: { grant_type: 'client_credentials', client_id: 'clio_oauth_...', client_secret: 'secret_...' },
    exampleResponse: { access_token: 'string', token_type: 'Bearer', expires_in: 3600 },
    responseNotes: [
      'Also accepts application/x-www-form-urlencoded, the RFC-standard body shape for this grant type — JSON is a fallback for callers that prefer it.',
      'Tokens expire after 1 hour — re-authenticate for a new one.',
      'Uses the RFC 6749 §5.2 error shape { error, error_description } — the one route in this API that does not use the usual { error: { code, message, request_id } } envelope.',
    ],
    otherResponses: [{ status: '400', meaning: 'invalid_request / invalid_client / invalid_grant' }],
    playgroundDisabled: false,
    noAuthRequired: true,
  },
  {
    id: 'content_sources_create',
    category: 'Content',
    method: 'POST',
    path: '/api/partner/v1/content-sources',
    purpose:
      'Registers how Clio should authenticate when it fetches your content page URLs. Register once, reuse the returned content_source_id on every session.',
    rateLimit: '300 requests/minute per partner account (reads rate-limit class).',
    requestFields: [
      { field: 'auth_type', type: '"none" | "static_bearer" | "oauth2_client_credentials"', required: 'Yes', notes: '' },
      { field: 'label', type: 'string', required: 'No', notes: 'Your own name for this source.' },
      { field: 'token', type: 'string', required: 'static_bearer only', notes: 'Encrypted at rest, never returned again.' },
      { field: 'header_name', type: 'string', required: 'No', notes: 'static_bearer only. Default "Authorization".' },
      { field: 'header_scheme', type: 'string', required: 'No', notes: 'static_bearer only. Default "Bearer" — use "" for a raw header value.' },
      { field: 'token_url', type: 'string (URL)', required: 'oauth2_client_credentials only', notes: 'Your own token endpoint.' },
      { field: 'client_id', type: 'string', required: 'oauth2_client_credentials only', notes: '' },
      { field: 'client_secret', type: 'string', required: 'oauth2_client_credentials only', notes: 'Encrypted at rest, never returned again.' },
      { field: 'scope', type: 'string', required: 'No', notes: 'oauth2_client_credentials only.' },
      { field: 'audience', type: 'string', required: 'No', notes: 'oauth2_client_credentials only.' },
    ],
    exampleRequestBody: {
      auth_type: 'static_bearer',
      label: 'My content API',
      token: 'sk_live_...',
      header_name: 'Authorization',
      header_scheme: 'Bearer',
    },
    exampleResponse: { content_source_id: 'uuid' },
    responseNotes: [
      'auth_type: "none" needs no other fields — for content that is fully public.',
      '"mtls" (client certificate) and "presigned_url" are documented for the future but rejected today with content_source_auth_type_not_supported.',
      'The plaintext token/client_secret you send is never returned again in any response.',
    ],
    otherResponses: [{ status: '422', meaning: 'validation failure, or auth_type not yet supported' }],
    playgroundDisabled: false,
  },
  {
    id: 'sessions_create',
    category: 'Sessions',
    method: 'POST',
    path: '/api/partner/v1/sessions',
    purpose:
      'Starts a new Clio session — dispatches a real meeting bot into the given URL and provisions the live voice/visual experience.',
    rateLimit: '60 requests/minute per partner account.',
    requestFields: [
      { field: 'meeting_url', type: 'string (URL)', required: 'Yes', notes: 'Must be a valid URL.' },
      { field: 'content_pages', type: 'array', required: 'Yes*', notes: 'Inline content pages — see below.' },
      { field: 'content_source_id', type: 'string (UUID)', required: 'Yes*', notes: 'Required together with content_pages.' },
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
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        { url: 'https://content.partner.example.com/1.html', media_type: 'html', transition_trigger: 'after page one' },
      ],
      end_user_name: 'Jordan Lee',
      partner_reference: 'acct_492',
    },
    exampleResponse: { clio_session_ref: 'uuid', status: 'bot_active', render_url: 'string' },
    responseNotes: [
      '* content_pages and content_source_id must both be present — Clio only supports inline content delivery for new sessions.',
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
    playgroundDisabled: false,
  },
  {
    id: 'sessions_get',
    category: 'Sessions',
    method: 'GET',
    path: '/api/partner/v1/sessions/:clio_session_ref',
    purpose: 'Reads the current status of a session you previously created (meeting-bot or widget).',
    rateLimit: '300 requests/minute per partner account.',
    pathParam: { name: 'clio_session_ref', type: 'UUID', notes: 'Required.' },
    exampleResponse: { clio_session_ref: 'uuid', status: 'bot_active', created_at: 'ISO 8601', ended_at: null },
    responseNotes: ['Never includes provider_bot_id, provider_name, or meeting_url — internal-only fields.'],
    otherResponses: [
      { status: '401/403', meaning: 'same as sessions_create' },
      { status: '404', meaning: 'not_found — identical whether the ref does not exist or belongs to a different partner' },
    ],
    playgroundDisabled: false,
    // API-ONBOARD-02 (2026-09-06, Arun's direct instruction): hidden from the partner-facing
    // ApiClient.tsx docs/nav surface for now. Not deleted — PlaygroundClient.tsx's live route
    // still defaults to and resolves this id from the unfiltered ENDPOINTS array.
    partnerVisible: false,
  },
  {
    id: 'widget_sessions_create',
    category: 'Sessions',
    method: 'POST',
    path: '/api/partner/v1/widget-sessions',
    purpose:
      'Starts a standalone session for one end user — no meeting required. Returns a render_url you open directly to join the live session, embeddable anywhere.',
    rateLimit: '60 requests/minute per partner account (widget_sessions_create rate-limit class).',
    requestFields: [
      { field: 'content_pages', type: 'array', required: 'Yes', notes: 'One or more pages — see below.' },
      { field: 'content_source_id', type: 'string (UUID)', required: 'Yes', notes: 'Registered via content-sources.' },
      { field: 'content_title', type: 'string', required: 'No', notes: 'Session-level title.' },
      { field: 'content_subtitle', type: 'string', required: 'No', notes: 'Session-level subtitle.' },
      { field: 'content_to_explain', type: 'string', required: 'No', notes: 'Overall narration guidance, up to 5000 chars.' },
      { field: 'expected_duration_minutes', type: 'integer', required: 'No', notes: 'Default 30. Used for the wallet/billing gate.' },
      { field: 'end_user_name', type: 'string', required: 'Yes', notes: '' },
      { field: 'end_user_role', type: 'string', required: 'No', notes: '' },
      { field: 'end_user_industry', type: 'string', required: 'No', notes: '' },
      { field: 'language', type: 'string', required: 'No', notes: 'Spoken delivery language.' },
      { field: 'reseller_id', type: 'string (UUID)', required: 'Yes', notes: 'Must match the account resolved from your API key.' },
      { field: 'client_id', type: 'string (UUID)', required: 'Channel-partner accounts only', notes: 'Must already be registered to your account.' },
      { field: 'partner_end_user_ref', type: 'string', required: 'No', notes: '1–256 printable-ASCII chars. Powers the optional profile-pull callback.' },
      { field: 'partner_reference', type: 'string', required: 'No', notes: '1–256 printable-ASCII chars. Echoed on every usage webhook.' },
      { field: 'reseller_unique_id', type: 'string', required: 'No', notes: 'Idempotency key — a retry with the same value returns the original session.' },
    ],
    exampleRequestBody: {
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        {
          url: 'https://content.partner.example.com/module-1.html',
          media_type: 'html',
          title: 'Module 1',
          subtitle: 'Getting started',
          transition_trigger: 'after module 1',
          content_text: 'The actual narration material for this page.',
        },
      ],
      end_user_name: 'Jordan Lee',
      reseller_id: '22222222-2222-2222-2222-222222222222',
      partner_reference: 'acct_492',
    },
    exampleResponse: { clio_session_ref: 'uuid', status: 'widget_active', render_url: 'string', reseller_unique_id: 'string (only if sent)' },
    responseNotes: [
      'content_pages items also accept media_type: "image" instead of "html".',
      'client_id is required for channel-partner (reseller) accounts and rejected as unnecessary for direct partner accounts.',
      '409 session_already_active only applies to the demo-only dispatch route, not this one — a real production call always creates a new session.',
    ],
    otherResponses: [
      { status: '401', meaning: 'invalid_api_key / revoked_api_key' },
      { status: '402', meaning: 'card_required / trial_exhausted / funding_required / balance_exhausted' },
      { status: '403', meaning: 'account_suspended' },
      { status: '422', meaning: 'validation failure, invalid_reseller_id, client_id_required, invalid_client_id, content_source_not_found, or content_source_url_rejected' },
      { status: '429', meaning: 'rate limit exceeded, Retry-After header present' },
    ],
    playgroundDisabled: false,
  },
  {
    id: 'bot_dispatch',
    category: 'Sessions',
    method: 'POST',
    path: '/api/partner/v1/bot-dispatch',
    purpose:
      'Sales-partner accounts only. Reserves a session the instant your end user initiates something (e.g. a button click), before you have necessarily assembled what content to teach — call bot-sessions moments later with the returned session_id to actually start the session. Authenticated with a passcode, not your API key.',
    rateLimit: 'No dedicated rate limit — call it once per real end-user action, not in a retry loop.',
    requestFields: [
      { field: 'end_user_name', type: 'string', required: 'Yes', notes: '' },
      {
        field: 'passcode',
        type: 'string',
        required: 'Yes',
        notes: 'Generated per client in Developer settings > Passcodes — a different, lighter-weight credential from your API key. It identifies which client this dispatch is for; it cannot itself create or act on a session.',
      },
    ],
    exampleRequestBody: { end_user_name: 'Jordan Lee', passcode: 'XK7P-4QRT9M' },
    exampleResponse: { session_id: 'uuid', status: 'reserved', expires_at: 'ISO 8601' },
    responseNotes: [
      'session_id is Clio-issued — you never construct one yourself. Send it, unchanged, as the session_id field on your next bot-sessions call.',
      'The reservation expires (expires_at, ~15 minutes out) if bot-sessions never claims it — call bot-dispatch again to get a fresh one.',
    ],
    otherResponses: [
      { status: '401', meaning: 'invalid_passcode — not recognized, revoked, or malformed' },
      { status: '422', meaning: 'validation failure' },
    ],
    playgroundDisabled: false,
    // The passcode is a body field, not an Authorization header — this endpoint has no Bearer
    // auth at all (same reasoning as oauth_token's own noAuthRequired above).
    noAuthRequired: true,
  },
  {
    id: 'bot_sessions_create',
    category: 'Sessions',
    method: 'POST',
    path: '/api/partner/v1/bot-sessions',
    purpose:
      'Sales-partner accounts only. Stage 2 of the bot-dispatch flow — claims the reservation from bot-dispatch and starts the actual live session, with the same content/wallet-gate behavior as widget-sessions above. Authenticated with your own per-client API key (Developer settings > API Keys), not a whole-account key.',
    rateLimit: '60 requests/minute per partner account (same class as widget-sessions).',
    requestFields: [
      {
        field: 'session_id',
        type: 'string (UUID)',
        required: 'Yes',
        notes: 'From bot-dispatch\'s response — Clio-issued, single-use for claiming. A second call with an already-claimed session_id is rejected, not silently accepted.',
      },
      { field: 'content_pages', type: 'array', required: 'Yes', notes: 'One or more pages — see below.' },
      { field: 'content_source_id', type: 'string (UUID)', required: 'Yes', notes: 'Registered via content-sources.' },
      { field: 'content_title', type: 'string', required: 'No', notes: 'Session-level title.' },
      { field: 'content_subtitle', type: 'string', required: 'No', notes: 'Session-level subtitle.' },
      {
        field: 'content_to_explain',
        type: 'string',
        required: 'No',
        notes: 'A short overview only, up to 5000 chars. Put your actual long-form content in content_pages instead — split it across as many pages as you need (one per topic/section), each up to 6000 chars. There is no limit on how many pages you send.',
      },
      { field: 'expected_duration_minutes', type: 'integer', required: 'No', notes: 'Default 30. Used for the wallet/billing gate.' },
      { field: 'end_user_role', type: 'string', required: 'No', notes: '' },
      { field: 'end_user_industry', type: 'string', required: 'No', notes: '' },
      { field: 'language', type: 'string', required: 'No', notes: 'Spoken delivery language.' },
      { field: 'reseller_id', type: 'string (UUID)', required: 'Yes', notes: 'Must match the account resolved from your API key.' },
      {
        field: 'client_id',
        type: 'string (UUID)',
        required: 'Yes',
        notes: 'Your per-client API key is already scoped to one client — this field must match it exactly, or the call is rejected (client_scope_mismatch). It is a cross-check, not a separate credential.',
      },
      {
        field: 'bot_id',
        type: 'string',
        required: 'No',
        notes: 'Your own name for a voice, set in Developer settings > Bot Voices (e.g. "english_bot") — never a literal provider agent ID. Omit it to use your account\'s default voice.',
      },
      {
        field: 'partner_end_user_ref',
        type: 'string',
        required: 'No',
        notes: 'Free-form, your own choice — 1–256 printable-ASCII chars. Your own ID for this specific end user, for your own reporting; Clio never validates or looks anything up with it.',
      },
      {
        field: 'partner_reference',
        type: 'string',
        required: 'No',
        notes: 'Free-form, your own choice — 1–256 printable-ASCII chars, echoed on every usage webhook. A short human-readable tag is a good pattern (e.g. "cohort-week1"). Does NOT provide duplicate-session protection — a repeated value does not block a second session. Use reseller_unique_id below if you need that.',
      },
      { field: 'reseller_unique_id', type: 'string', required: 'No', notes: 'Idempotency key — a retry with the same value returns the original session.' },
    ],
    exampleRequestBody: {
      session_id: '5b1e2b8e-0000-0000-0000-000000000000',
      content_source_id: '11111111-1111-1111-1111-111111111111',
      content_pages: [
        { url: 'https://content.partner.example.com/module-1.html', media_type: 'html', title: 'Module 1', transition_trigger: 'after module 1', content_text: 'Narration for module 1.' },
        { url: 'https://content.partner.example.com/module-2.html', media_type: 'html', title: 'Module 2', transition_trigger: 'after module 2', content_text: 'Narration for module 2.' },
      ],
      reseller_id: '22222222-2222-2222-2222-222222222222',
      client_id: '33333333-3333-3333-3333-333333333333',
      bot_id: 'english_bot',
      partner_reference: 'cohort-week1',
    },
    exampleResponse: { session_id: 'uuid', status: 'widget_active', render_url: 'string', reseller_unique_id: 'string (only if sent)' },
    responseNotes: [
      'end_user_name is not sent here — it came from bot-dispatch and is already attached to session_id.',
      'render_url resolves to your own configured custom domain (Developer settings > Domain) — a verified domain is required before this call succeeds.',
    ],
    otherResponses: [
      { status: '401', meaning: 'invalid_api_key / revoked_api_key' },
      { status: '402', meaning: 'card_required / trial_exhausted / funding_required / balance_exhausted' },
      { status: '403', meaning: 'account_suspended / client_scope_mismatch' },
      {
        status: '422',
        meaning: 'validation failure, session_not_found, session_expired, session_already_claimed, bot_id_not_configured, domain_not_configured, invalid_reseller_id, invalid_client_id, content_source_not_found, or content_source_url_rejected',
      },
      { status: '429', meaning: 'rate limit exceeded, Retry-After header present' },
    ],
    playgroundDisabled: false,
  },
  {
    id: 'usage',
    category: 'Reporting',
    method: 'GET',
    path: '/api/partner/v1/usage',
    purpose: "Reads your account's own billable usage history — one row per metered event.",
    rateLimit: '300 requests/minute per partner account.',
    queryParams: [
      { param: 'from', type: 'ISO 8601 string', default: '30 days ago', notes: '' },
      { param: 'to', type: 'ISO 8601 string', default: 'now', notes: '' },
      {
        param: 'event_type',
        type: '"usage.voice_minute" | "session.completed"',
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
    category: 'Reporting',
    method: 'GET',
    path: '/api/partner/v1/wallet',
    purpose: 'Reads your current prepaid balance, per-event-type burn rate, and projected days-until-exhausted.',
    rateLimit: '300 requests/minute per partner account.',
    exampleResponse: {
      balance_usd: 42.315,
      reference_topup_amount_usd: 100.0,
      low_balance_alert_active: false,
      trial_minutes_used: 6.5,
      trial_minutes_remaining: 13.5,
      trial_minutes_cap: 20,
      test_minutes_balance: 0,
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
      'trial_minutes_used/trial_minutes_remaining/test_minutes_balance are test-mode-only concepts (they gate session-creation when called with a test-mode API key) but are always present in this response regardless of which key mode you call /wallet with.',
    ],
    otherResponses: [{ status: '401/403', meaning: 'same as usage' }],
    playgroundDisabled: false,
  },
]

export const ENDPOINT_CATEGORIES: EndpointCategory[] = ['Auth', 'Content', 'Sessions', 'Reporting']

// B2B-02 architecture.md §7.3 + lib/partner/webhooks.ts's WebhookPayload interface, transcribed
// field-for-field against the live type — not a paraphrase. This is what you RECEIVE, pushed to
// your own outbound_base_url, not something you call.
export const WEBHOOK_DOC = {
  path: 'POST {your outbound_base_url}/webhooks/usage',
  eventTypes: ['usage.voice_minute', 'session.completed', 'session.insights_ready'],
  payloadFields: [
    { field: 'event_id', notes: 'Unique per delivery attempt.' },
    { field: 'event_type', notes: 'One of the types above.' },
    { field: 'clio_session_ref', notes: '' },
    { field: 'partner_reference', notes: 'Echoed from your session-creation request, if you sent one.' },
    { field: 'quantity', notes: 'usage.* events only.' },
    { field: 'unit', notes: '"minutes" | "calls" — usage.* events only.' },
    { field: 'occurred_at', notes: 'When the event actually happened.' },
    { field: 'dispatched_at', notes: 'When this delivery attempt was sent.' },
    { field: 'test_mode', notes: 'true for any session created with a test-mode key — filter these out of real billing.' },
    { field: 'extraction_status', notes: 'session.insights_ready only — "success" | "success_empty" | "failed".' },
    { field: 'action_items', notes: 'session.insights_ready only — extracted action items, [{ text }].' },
    { field: 'learner_insight', notes: 'session.insights_ready only — { summary, topics_of_interest, engagement_style, suggested_next_topics }.' },
    { field: 'end_client_id', notes: 'Present on channel-partner sessions — which of your clients this was.' },
    { field: 'reseller_id', notes: 'Your own account id, always populated.' },
    { field: 'reseller_unique_id', notes: 'Echoed if you sent one at session creation.' },
  ],
  signatureHeader: 'Clio-Signature: t=<unix_timestamp>,v1=<hex_hmac>',
  verificationRecipe: 'HMAC-SHA256(signing_secret, `${t}.${raw_body}`), constant-time compare, reject if |now - t| > 300s.',
  retrySchedule: '1m, 5m, 30m, 2h, 6h (5 attempts total, then marked exhausted).',
}
