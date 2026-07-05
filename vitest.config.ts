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
    ],
  },
});
