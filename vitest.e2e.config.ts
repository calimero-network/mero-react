import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Live-node integration tests: render hooks/provider against a real merod.
// Kept separate from the default (mocked) unit run; needs a booted node.
export default defineConfig({
  plugins: [react()],
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
