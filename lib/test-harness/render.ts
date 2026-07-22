/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen C render note, AT-4).
 *
 * Wraps a pasted HTML fragment (no `<html>` tag) in a minimal valid document shell so the render
 * route's response is always a complete document, whether Arun pasted a full page or a bare
 * fragment. A full document (already containing `<html>`) passes through byte-identical.
 */
export function wrapHtmlFragmentIfNeeded(html: string): string {
  if (/<html[\s>]/i.test(html)) return html
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
}
