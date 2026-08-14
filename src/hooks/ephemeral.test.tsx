// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEphemeral } from './index.js';

const listeners: Array<(e: unknown) => void> = [];
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockGetContextIdentitiesOwned = vi.fn();

// A real MeroProvider memoizes its context value (useMemo over a `useState`
// client instance), so `mero` is referentially STABLE across re-renders
// unless the underlying client is actually replaced. Building this object
// once at module scope — rather than as a fresh literal inside `useMero()`
// — mirrors that and avoids a test-double-only churn the production
// effects were never meant to tolerate.
const mockMero = {
  ephemeral: {
    get: mockGet,
    subscribe: (_ctx: string, handler: (e: unknown) => void) => {
      listeners.push(handler);
      return () => {
        const i = listeners.indexOf(handler);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    set: mockSet,
  },
  admin: { getContextIdentitiesOwned: mockGetContextIdentitiesOwned },
};

vi.mock('../context', () => ({
  useMero: () => ({ mero: mockMero }),
}));

const emit = (e: unknown) => act(() => { listeners.forEach(h => h(e)); });

beforeEach(() => {
  listeners.length = 0;
  mockGet.mockReset().mockResolvedValue([]);
  mockSet.mockReset().mockResolvedValue(undefined);
  mockGetContextIdentitiesOwned.mockReset().mockResolvedValue({ identities: ['SELF'] });
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

describe('useEphemeral write path', () => {
  it('shallow-merges over the previous value and publishes the union', async () => {
    const { result } = renderHook(() =>
      useEphemeral<{ x?: number; y?: number }>('ctx-1', {
        initial: { x: 1, y: 2 },
        throttleMs: 0,
      }),
    );
    await waitFor(() => expect(result.current.setPresence).toBeTypeOf('function'));

    act(() => { result.current.setPresence({ y: 9 }); });
    await waitFor(() => expect(mockSet).toHaveBeenCalled());

    // y overridden, x preserved from `initial`.
    const published = mockSet.mock.calls[mockSet.mock.calls.length - 1]?.[1];
    expect(published).toEqual({ x: 1, y: 9 });
  });

  it('throttles to the LATEST value, not the first', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useEphemeral<{ x: number }>('ctx-1', { throttleMs: 50 }),
    );
    await act(async () => { await Promise.resolve(); });

    act(() => {
      result.current.setPresence({ x: 1 });
      result.current.setPresence({ x: 2 });
      result.current.setPresence({ x: 3 });
    });
    act(() => { vi.advanceTimersByTime(60); });

    // Trailing edge: one publish carrying the newest value.
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][1]).toEqual({ x: 3 });
    vi.useRealTimers();
  });

  it('excludes your own echoed presence by default', async () => {
    mockGet.mockResolvedValue([
      { author: 'SELF', state: { x: 1 }, ageMs: 0 },
      { author: 'OTHER', state: { x: 2 }, ageMs: 0 },
    ]);
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(result.current.peers.has('OTHER')).toBe(true));
    expect(result.current.peers.has('SELF')).toBe(false);
  });

  it('includes self when includeSelf is true', async () => {
    mockGet.mockResolvedValue([{ author: 'SELF', state: { x: 1 }, ageMs: 0 }]);
    const { result } = renderHook(() =>
      useEphemeral<{ x: number }>('ctx-1', { includeSelf: true }),
    );
    await waitFor(() => expect(result.current.peers.has('SELF')).toBe(true));
  });
});
