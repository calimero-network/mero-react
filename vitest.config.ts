import { defineConfig } from 'vitest/config';

// Default (mocked) unit run. The live-node e2e suite has its own config
// (vitest.e2e.config.ts) and is excluded here so `pnpm test` needs no node.
export default defineConfig({
  test: {
    server: {
      deps: {
        // mero-platform 0.1.0 ships extensionless directory imports that Vite
        // resolves but Node's ESM loader rejects; transform it through Vite.
        // (The build bundles it for the same reason; see tsup.config.ts.)
        inline: [/@calimero-network\/mero-platform/],
      },
    },
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
