import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useContexts } from '../../src/hooks';
import { setupFixture, teardownFixture, type E2eFixture } from './harness';
import { renderHookWithMero } from './render';

let fx: E2eFixture;

beforeAll(async () => {
  fx = await setupFixture();
}, 60000);

afterAll(async () => {
  await teardownFixture(fx);
});

describe('e2e smoke — harness wiring', () => {
  it('fixture provisioned an app + context', () => {
    expect(fx.applicationId).toBeTruthy();
    expect(fx.contextId).toBeTruthy();
  });

  it('useContexts returns the fixture context against the live node', async () => {
    const { result } = renderHookWithMero(fx.mero, () => useContexts(fx.applicationId));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.contexts.length).toBeGreaterThan(0);
  });
});
