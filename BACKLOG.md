# BACKLOG.md — Manual Setup Items for Distill

These are the tasks that require your personal action — account creation, financial details, domain registration. Complete them before going live. Claude Code handles everything else.

---

## Day 1 — Do These First (Accounts & Keys)

- [ ] **1. Register domain** — buy `getdistill.ai` or `distill.ai` at Namecheap / GoDaddy / Cloudflare Registrar
- [ ] **2. Create Vercel account** — vercel.com → sign up with GitHub → import the `distill` repo once it's pushed
- [ ] **3. Create Supabase project** — supabase.com → New project → name it `distill-prod` → copy URL + anon key + service role key
- [ ] **4. Create Clerk application** — clerk.com → New application → name it `Distill` → copy publishable key + secret key
- [ ] **5. Create Stripe account** — stripe.com → complete business verification → copy publishable key + secret key
- [ ] **6. Create Resend account** — resend.com → add and verify your domain → create API key → set FROM address to hello@getdistill.ai
- [ ] **7. Create Twilio account** — twilio.com → complete identity verification → buy 2–3 US phone numbers for the shared pool → copy Account SID + Auth Token
- [ ] **8. Create Anthropic account (API)** — console.anthropic.com → add payment method → create API key
- [ ] **9. Create NewsAPI account** — newsapi.org → sign up → copy API key
- [ ] **10. Create Inngest account** — inngest.com → new app → copy event key + signing key

---

## Day 2 — Configure & Connect

- [ ] **11. Add environment variables to Vercel** — go to Vercel project settings → Environment Variables → add every variable from `.env.local.example`
- [ ] **12. Create Stripe products & prices**:
  - Starter Monthly: $12.00/mo recurring
  - Starter Annual: $99.00/yr recurring
  - Pro Monthly: $25.00/mo recurring
  - Pro Annual: $199.00/yr recurring
  - Executive Monthly: $49.00/mo recurring
  - Executive Annual: $399.00/yr recurring
  - Copy all 6 Price IDs into Vercel env vars
- [ ] **13. Set up Stripe webhook** — Stripe dashboard → Webhooks → Add endpoint → URL: `https://getdistill.ai/api/webhooks/stripe` → select events: customer.subscription.*, invoice.payment_failed
- [ ] **14. Set up Twilio webhook** — for each phone number you bought → configure inbound SMS webhook URL: `https://getdistill.ai/api/webhooks/twilio`
- [ ] **15. Run Supabase migration** — in your terminal: `npx supabase db push` (or paste schema.sql into Supabase SQL editor)
- [ ] **16. Connect domain to Vercel** — Vercel project → Domains → add getdistill.ai → update DNS at your registrar

---

## Day 3 — Test Before Launch

- [ ] **17. Test Stripe checkout** — go to your app → click a pricing plan → use Stripe test card `4242 4242 4242 4242` → verify subscription created in Stripe dashboard
- [ ] **18. Test onboarding flow** — complete the 5 questions → verify user profile saved in Supabase
- [ ] **19. Test email delivery** — trigger a test send via Resend dashboard → verify it lands in inbox (check spam)
- [ ] **20. Test SMS delivery** — send a test SMS via Twilio console → verify it arrives on your phone
- [ ] **21. Test inbound SMS** — reply to the Twilio number → verify feedback is logged OR Ask Anything responds
- [ ] **22. Enable Stripe live mode** — flip Stripe from test → live → update Vercel env vars with live keys

---

## Banking & Legal (Do Before First Payment)

- [ ] **23. Add bank account to Stripe** — Stripe dashboard → Settings → Payouts → add your bank account for revenue deposits
- [ ] **24. Set up Stripe Tax** (optional) — if selling to US/EU customers who need tax compliance
- [ ] **25. Add Privacy Policy page** — use termly.io or iubenda to generate → add to your site footer
- [ ] **26. Add Terms of Service page** — same tool → add to footer
- [ ] **27. GDPR consent at onboarding** — ensure EU users see a consent checkbox before data collection (Claude Code handles UI, but you need to decide your DPA approach)

---

## Growth (After Launch)

- [ ] **28. Set up Stripe Customer Portal** — Stripe dashboard → Customer Portal → enable plan switching + cancellation
- [ ] **29. Set up email DNS records** — SPF, DKIM, DMARC for getdistill.ai via Resend → improves deliverability
- [ ] **30. Connect analytics** — add Vercel Analytics or Posthog to track onboarding drop-off, conversion

---

*Backlog version: 1.0 | Project: Distill | Owner: Arun*
