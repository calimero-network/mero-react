import { defineConfig } from 'vitest/config';

// Default (mocked) unit run. The live-node e2e suite has its own config
// (vitest.e2e.config.ts) and is excluded here so `pnpm test` needs no node.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      'tests/e2e/**',
      // Playwright specs, not vitest ones: `example/**/e2e` is driven by
      // `playwright test` against live nodes and a browser. Vitest would
      // otherwise collect them and fail on Playwright-only APIs.
      'example/**/e2e/**',
    ],
  },
});
