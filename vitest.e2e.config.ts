import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Live-node integration tests: render hooks/provider against a real merod.
// Kept separate from the default (mocked) unit run; needs a booted node.
//
// Two fixtures, deliberately separate:
//   - most suites share ONE node (see tests/e2e/README.md)
//   - tests/e2e/ephemeral.live.test.tsx needs TWO peered nodes, because
//     presence is delivered over gossip BETWEEN nodes and a single node cannot
//     exercise it. Boot those with tests/e2e/boot-presence-nodes.sh, then run
//     `pnpm test:e2e:presence`, which sets MERO_E2E_PRESENCE; without it that
//     suite skips itself.
//
// This config used to alias `@calimero-network/mero-js` to a sibling checkout's
// build, because the pinned ^7.3.0 had no `ephemeral` surface and the hook had
// to cast through structural types it declared itself. Both of those are gone:
// the package is now ^13.1.0, which exports `EphemeralClient`, `EphemeralEntry`
// and `Codec`, and the hook imports them nominally — so `tsc` checks the hook
// against the real SDK and the e2e runs the published package. No alias needed,
// and no way for a local build to mask a drift from what consumers install.

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/e2e/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    testTimeout: 60000,
    hookTimeout: 60000,
    // Shared node fixtures — run serially to avoid cross-test interference.
    fileParallelism: false,
  },
});
