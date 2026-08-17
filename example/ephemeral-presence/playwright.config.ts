import { defineConfig, devices } from '@playwright/test';

/**
 * Drives the example app in a real Chromium against two real `merod` nodes.
 *
 * Boot the nodes first (see README) — the spec asserts against live gossip and
 * will fail fast if they are not up. The last test deliberately STOPS node 1 to
 * observe TTL eviction, so the run is single-worker and serial, and the nodes
 * must be re-booted between runs.
 */
export default defineConfig({
  testDir: './e2e',
  // Presence propagates over gossip between two nodes; the default 5s expect
  // timeout is tight enough to flake on a cold mesh.
  expect: { timeout: 20_000 },
  timeout: 120_000,
  fullyParallel: false,
  // One worker: every test shares the same two nodes, and the TTL test kills one.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    // localhost, not 127.0.0.1: Vite binds IPv6-first on macOS.
    baseURL: 'http://localhost:5273',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5273',
    reuseExistingServer: process.env.CI !== 'true',
    timeout: 60_000,
  },
});
