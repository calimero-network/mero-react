import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Live-node integration tests: render hooks/provider against a real merod.
// Kept separate from the default (mocked) unit run; needs a booted node.
//
// See tests/e2e/README.md for the three one-line commands (build mero-js,
// boot the nodes, run this suite).

/**
 * TEST-ONLY resolution of a LOCAL `@calimero-network/mero-js` build.
 *
 * `package.json` pins `^7.3.0`, which has no `ephemeral` surface at all, and
 * keeping that pin unbumped is a constraint on this change — so the hook casts
 * to locally-declared structural types (`EphemeralClient`, `EphemeralEntry`,
 * `Codec` in src/hooks/index.ts) instead of importing them.
 *
 * That is precisely why this alias matters: a drift between those local
 * declarations and what `mero-js` actually does at runtime is invisible to the
 * unit suite (which mocks mero-js) AND to `tsc` (which type-checks against the
 * installed 7.3.0). Only running the real package can catch it. The alias
 * swaps in the sibling checkout's build for the e2e run only — no
 * package.json edit, no lockfile churn.
 */
const localMeroJs = fileURLToPath(new URL('../mero-js/dist/index.mjs', import.meta.url));
if (!existsSync(localMeroJs)) {
  throw new Error(
    `e2e: local mero-js build not found at ${localMeroJs}. ` +
      'Build it first: (cd ../mero-js && npm run build)',
  );
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@calimero-network\/mero-js$/, replacement: localMeroJs }],
  },
  test: {
    include: ['tests/e2e/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    testTimeout: 60000,
    hookTimeout: 60000,
    // One node, shared fixtures — run serially to avoid cross-test interference.
    fileParallelism: false,
  },
});
