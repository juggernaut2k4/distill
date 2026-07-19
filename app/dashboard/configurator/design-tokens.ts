// Hotfix for B2B-29 production incident (digest 2779826077): a Server
// Component (app/dashboard/channel-partner/page.tsx) dotted into `COLORS`
// after importing it through './_shared' -> '../configurator/_shared', and
// that second file has a 'use client' directive. Next.js turns every export
// of a 'use client' module into an opaque client reference for Server
// Component consumers — fine for passing a component through as JSX
// (<Card>), but accessing a plain object's properties (COLORS.textPrimary)
// throws "Cannot access X on the server" at runtime. tsc/build do not catch
// this class of error (same root cause as the c7783e0 fix earlier this
// project). COLORS has zero client-only dependencies (no hooks, no
// next/navigation), so it lives here with no directive at all — safe to dot
// into from both Server and Client Components.
export const COLORS = {
  bg: '#080808',
  surface: '#111111',
  raised: '#1A1A1A',
  borderSubtle: '#222222',
  borderStrong: '#333333',
  purple: '#7C3AED',
  cyan: '#06B6D4',
  amber: '#F59E0B',
  green: '#10B981',
  red: '#EF4444',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#475569',
}

// Same fix, same reason — SHELL_CONTENT_STYLE is a plain object with the
// identical exposure (was previously defined in a 'use client' file and
// dotted into by Server Components via style={SHELL_CONTENT_STYLE}).
export const SHELL_CONTENT_STYLE: Record<string, string> = {
  ['--cfg-shell-px']: 'clamp(16px, 4vw, 32px)',
  padding: 'var(--cfg-shell-px)',
  maxWidth: 'clamp(640px, 96vw, 1900px)',
  margin: '0 auto',
}
