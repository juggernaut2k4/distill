import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerApiKey } from '@/lib/partner/auth'
import { encryptContentSourceCredential } from '@/lib/partner/crypto'
import { REJECTED_CONTENT_SOURCE_AUTH_TYPES } from '@/lib/partner/content-sources'

/**
 * POST /api/partner/v1/content-sources  (B2B-19, new)
 *
 * Registers an outbound content source and returns an opaque
 * `content_source_id`. Every content source — including public/no-auth — is
 * registered here first (Q-A: universal registration, no inline shortcut).
 * Secrets are AES-256-GCM encrypted-and-retrievable before insert (Clio replays
 * them outward when fetching partner pages — see lib/partner/crypto.ts). The
 * plaintext secret is never returned or echoed.
 *
 * API-only, no portal/Configurator UI (Arun's explicit instruction).
 *
 * Auth: partner API key or OAuth2 access token. Reuses the `'reads'` rate-limit
 * class (a low-frequency write) — there is no per-endpoint authorization-scope
 * layer; tenant isolation via auth.partnerAccountId is the access control.
 */

const NoneSchema = z.object({
  auth_type: z.literal('none'),
  label: z.string().max(200).optional(),
})

const StaticBearerSchema = z.object({
  auth_type: z.literal('static_bearer'),
  label: z.string().max(200).optional(),
  token: z.string().min(1),
  header_name: z.string().min(1).max(100).optional().default('Authorization'),
  header_scheme: z.string().max(50).optional().default('Bearer'), // '' for a raw header value
})

const OAuth2Schema = z.object({
  auth_type: z.literal('oauth2_client_credentials'),
  label: z.string().max(200).optional(),
  token_url: z.string().url(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  scope: z.string().max(500).optional(),
  audience: z.string().max(500).optional(),
})

const ContentSourceSchema = z.discriminatedUnion('auth_type', [NoneSchema, StaticBearerSchema, OAuth2Schema])

export async function POST(request: NextRequest) {
  const auth = await requirePartnerApiKey(request, 'reads')
  if (auth.error) return auth.error

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null

  // State A2 — documented-but-not-built auth types get a specific, actionable
  // error and NO row is written, distinct from a generic validation failure.
  const rawAuthType = body?.auth_type
  if (typeof rawAuthType === 'string' && (REJECTED_CONTENT_SOURCE_AUTH_TYPES as readonly string[]).includes(rawAuthType)) {
    return NextResponse.json(
      {
        error: {
          code: 'content_source_auth_type_not_supported',
          message: `auth_type '${rawAuthType}' is documented but not yet supported. Supported types: none, static_bearer, oauth2_client_credentials.`,
        },
      },
      { status: 422 }
    )
  }

  const parsed = ContentSourceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const data = parsed.data

  // Build the row — secrets encrypted-and-retrievable (never hashed), non-secret
  // fields stored plaintext.
  const row: Record<string, unknown> = {
    partner_account_id: auth.partnerAccountId,
    auth_type: data.auth_type,
    label: data.label ?? null,
  }

  if (data.auth_type === 'static_bearer') {
    row.credential_ciphertext = encryptContentSourceCredential(data.token)
    row.header_name = data.header_name
    row.header_scheme = data.header_scheme
  } else if (data.auth_type === 'oauth2_client_credentials') {
    row.credential_ciphertext = encryptContentSourceCredential(
      JSON.stringify({ client_id: data.client_id, client_secret: data.client_secret })
    )
    row.oauth_token_url = data.token_url
    row.oauth_scope = data.scope ?? null
    row.oauth_audience = data.audience ?? null
  }
  // auth_type === 'none' → no credential fields.

  const supabase = createSupabaseAdminClient()
  const { data: inserted, error } = await supabase
    .from('partner_content_sources')
    .insert(row)
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[partner/content-sources] insert failed:', error?.message)
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to register content source.' } },
      { status: 500 }
    )
  }

  return NextResponse.json({ content_source_id: inserted.id as string }, { status: 201 })
}
