import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // B2B-51 — this repo's tsconfig.json sets "jsx": "preserve" (required for Next.js's own SWC-based
  // build). Vite 7 (which this vitest version bundles) transforms TSX via its oxc transformer by
  // default, and "preserve" isn't a usable mode there either — it also needs an explicit JSX runtime
  // mode. Without this, component tests that render TSX (e.g.
  // tests/unit/b2b51-performance-tab-table.test.tsx) fail to parse. Scoped to the test runner only —
  // does not affect `next build`, which uses its own SWC-based JSX transform regardless of this file.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
    globals: true,
    exclude: ['**/node_modules/**', '**/tests/e2e/**', '**/.claude/worktrees/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
