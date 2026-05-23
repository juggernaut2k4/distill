import { NextResponse } from 'next/server'

export async function GET() {
  const results: Record<string, string> = {}

  const secretKey = process.env.STRIPE_SECRET_KEY ?? ''
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''

  // Key format checks
  results.secret_key_prefix = secretKey ? secretKey.slice(0, 8) + '...' : 'MISSING'
  results.publishable_key_prefix = publishableKey ? publishableKey.slice(0, 8) + '...' : 'MISSING'
  results.webhook_secret_present = webhookSecret ? 'yes (' + webhookSecret.slice(0, 6) + '...)' : 'MISSING'

  const secretIsTest = secretKey.startsWith('sk_test_')
  const secretIsLive = secretKey.startsWith('sk_live_')
  const pubIsTest = publishableKey.startsWith('pk_test_')
  const pubIsLive = publishableKey.startsWith('pk_live_')

  results.secret_mode = secretIsTest ? 'TEST' : secretIsLive ? 'LIVE' : 'UNKNOWN/INVALID'
  results.publishable_mode = pubIsTest ? 'TEST' : pubIsLive ? 'LIVE' : 'UNKNOWN/INVALID'
  results.keys_match = (secretIsTest && pubIsTest) || (secretIsLive && pubIsLive) ? 'YES ✓' : 'NO ✗ — MISMATCH'

  // Price ID checks
  const priceIds = {
    STRIPE_STARTER_MONTHLY_PRICE_ID: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
    STRIPE_STARTER_ANNUAL_PRICE_ID: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID,
    STRIPE_PRO_MONTHLY_PRICE_ID: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    STRIPE_PRO_ANNUAL_PRICE_ID: process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
    STRIPE_EXECUTIVE_MONTHLY_PRICE_ID: process.env.STRIPE_EXECUTIVE_MONTHLY_PRICE_ID,
    STRIPE_EXECUTIVE_ANNUAL_PRICE_ID: process.env.STRIPE_EXECUTIVE_ANNUAL_PRICE_ID,
  }

  for (const [name, val] of Object.entries(priceIds)) {
    if (!val || val.startsWith('PLACEHOLDER_')) {
      results[name] = 'MISSING/PLACEHOLDER'
    } else if (!val.startsWith('price_')) {
      results[name] = `INVALID FORMAT (got: ${val.slice(0, 10)}...)`
    } else {
      results[name] = val.slice(0, 14) + '...'
    }
  }

  // Live Stripe API call to verify secret key works
  try {
    const { stripe } = await import('@/lib/stripe')
    if (stripe) {
      const balance = await stripe.balance.retrieve()
      results.stripe_api_call = `OK — ${balance.livemode ? 'LIVE' : 'TEST'} mode`
    } else {
      results.stripe_api_call = 'Stripe client not initialized'
    }
  } catch (err) {
    const e = err as { type?: string; message?: string }
    results.stripe_api_call = `FAILED: ${e?.type ?? ''} ${e?.message ?? String(err)}`
  }

  return NextResponse.json(results, { status: 200 })
}
