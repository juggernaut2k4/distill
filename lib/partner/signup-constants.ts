// Split out of lib/partner/signup.ts (2026-07-19) because that file imports
// server-only dependencies (Supabase admin client, Inngest) — a Client
// Component (e.g. SettingsClient.tsx) importing anything from it, even just
// this string, would bundle those server-only imports into the browser.
// Same root cause as the earlier design-tokens.ts fix. Zero dependencies here
// so both server and client code can import it directly.
export const UNNAMED_PARTNER_PLACEHOLDER = 'New partner account'
