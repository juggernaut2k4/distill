/**
 * B2B-03 — Client-safe subset of lib/partner/theme.ts.
 *
 * `lib/partner/theme.ts` imports `createSupabaseAdminClient`
 * (`lib/supabase.ts`), which pulls in `next/headers` — a server-only module.
 * `PartnerRenderClient.tsx` ('use client') needs only the pure
 * CSS-custom-property serialization helper, not any of theme.ts's DB
 * access, so that helper (and its type) live here instead, with no
 * server-only imports, and theme.ts re-exports both for its own server-side
 * callers.
 */

export type CSSCustomProperties = Record<string, string>

/** Serializes a CSS custom-property map into a `<style>` block body scoped to a selector. */
export function cssCustomPropertiesToStyleBlock(selector: string, props: CSSCustomProperties): string {
  const declarations = Object.entries(props)
    .map(([key, value]) => `  ${key}: ${cssEscapeValue(value)};`)
    .join('\n')
  return `${selector} {\n${declarations}\n}`
}

/** Escapes a value for safe inclusion inside a CSS custom-property declaration (defense in depth — values are already enum/hex-validated at write time). */
function cssEscapeValue(value: string): string {
  // Values are already constrained to hex colors, fixed enums, or short
  // partner-authored plain text (title_override, max 200 chars per the
  // Configurator's own input constraints) — strip anything that could break
  // out of the declaration (braces, semicolons, angle brackets).
  return value.replace(/[{};<>]/g, '')
}
