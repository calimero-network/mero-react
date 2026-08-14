// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEphemeral } from './index.js';

const listeners: Array<(e: unknown) => void> = [];
const mockGet = vi.fn();

vi.mock('../context', () => ({
  useMero: () => ({
    mero: {
      ephemeral: {
        get: mockGet,
        subscribe: (_ctx: string, handler: (e: unknown) => void) => {
          listeners.push(handler);
          return () => {
            const i = listeners.indexOf(handler);
            if (i >= 0) listeners.splice(i, 1);
          };
        },
        set: vi.fn().mockResolvedValue(undefined),
      },
      admin: { getContextIdentitiesOwned: vi.fn().mockResolvedValue({ identities: [] }) },
    },
  }),
}));

const emit = (e: unknown) => act(() => { listeners.forEach(h => h(e)); });

beforeEach(() => {
  listeners.length = 0;
  mockGet.mockReset().mockResolvedValue([]);
});

describe('useEphemeral read path', () => {
  it('seeds peers from the snapshot', async () => {
    mockGet.mockResolvedValue([{ author: 'A', state: { x: 1 }, ageMs: 100 }]);
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(result.current.peers.get('A')).toEqual({ x: 1 }));
  });

  it('applies an upsert delta', async () => {
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(result.current.peers.size).toBe(0));
    emit({ author: 'B', state: { x: 2 }, removed: false });
    expect(result.current.peers.get('B')).toEqual({ x: 2 });
  });

  it('deletes an entry on a removal delta', async () => {
    mockGet.mockResolvedValue([{ author: 'A', state: { x: 1 }, ageMs: 0 }]);
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(result.current.peers.has('A')).toBe(true));
    emit({ author: 'A', removed: true });
    expect(result.current.peers.has('A')).toBe(false);
  });

  it('reports age seeded from the snapshot ageMs, not from zero', async () => {
    // A snapshot entry that is already 5s old must not read as fresh — the
    // hook back-dates it so both sources share one notion of freshness.
    mockGet.mockResolvedValue([{ author: 'A', state: { x: 1 }, ageMs: 5000 }]);
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(result.current.peers.has('A')).toBe(true));
    expect(result.current.ageOf('A')).toBeGreaterThanOrEqual(5000);
  });

  it('reports a near-zero age for an entry that arrived as a delta', async () => {
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(result.current.peers.size).toBe(0));
    emit({ author: 'B', state: { x: 2 }, removed: false });
    expect(result.current.ageOf('B')).toBeLessThan(1000);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useEphemeral('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));
    unmount();
    expect(listeners.length).toBe(0);
  });

  it('does nothing when contextId is null', () => {
    const { result } = renderHook(() => useEphemeral('' as unknown as null));
    expect(result.current.peers.size).toBe(0);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
