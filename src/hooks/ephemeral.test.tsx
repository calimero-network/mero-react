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
let currentMero: unknown;

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

// Indirected through `currentMero` so a test can swap in a client WITHOUT an
// `ephemeral` surface (the mero-js < 9.1.0 case) while keeping the default
// object referentially stable, exactly as a real memoized provider would.
vi.mock('../context', () => ({
  useMero: () => ({ mero: currentMero }),
}));

const emit = (e: unknown) => act(() => { listeners.forEach(h => h(e)); });

beforeEach(() => {
  currentMero = mockMero;
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
    const { result } = renderHook(() => useEphemeral(null));
    expect(result.current.peers.size).toBe(0);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('does not resurrect a peer swept while the snapshot was in flight', async () => {
    // The node sweeps X at 7s and emits its removal BEFORE the mount-time
    // get() resolves. The removal is a no-op (X is not in the map yet), so a
    // naive apply of the older snapshot re-adds X — permanently, because a
    // swept author never emits again and an idle re-publish emits nothing.
    let resolveGet!: (entries: unknown) => void;
    mockGet.mockImplementation(() => new Promise(res => { resolveGet = res; }));

    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));

    emit({ author: 'X', removed: true });

    await act(async () => {
      resolveGet([{ author: 'X', state: { x: 1 }, ageMs: 6900 }]);
      await Promise.resolve();
    });

    expect(result.current.peers.has('X')).toBe(false);
  });

  it('drops a peer the reconciliation snapshot no longer lists', async () => {
    // A peer swept while the SSE stream was disconnected: we never saw the
    // removal and never will, so only the snapshot can retire it.
    vi.useFakeTimers();
    mockGet
      .mockResolvedValueOnce([{ author: 'A', state: { x: 1 }, ageMs: 0 }])
      .mockResolvedValue([]);
    const { result } = renderHook(() =>
      useEphemeral<{ x: number }>('ctx-1', { reconcileMs: 1000 }),
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.peers.has('A')).toBe(true);

    await act(async () => { vi.advanceTimersByTime(1100); await Promise.resolve(); });
    expect(result.current.peers.has('A')).toBe(false);
    vi.useRealTimers();
  });

  it('re-seeds on the reconciliation interval after a failed initial get', async () => {
    vi.useFakeTimers();
    mockGet
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([{ author: 'A', state: { x: 1 }, ageMs: 0 }]);

    const { result } = renderHook(() =>
      useEphemeral<{ x: number }>('ctx-1', { reconcileMs: 1000 }),
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.peers.size).toBe(0);

    await act(async () => { vi.advanceTimersByTime(1100); await Promise.resolve(); });
    expect(result.current.peers.get('A')).toEqual({ x: 1 });
    expect(result.current.error).toBeNull();
    vi.useRealTimers();
  });

  it('does not refetch when an unstable codec identity is passed every render', async () => {
    // `jsonCodec()` is a FACTORY — `{ codec: jsonCodec() }` at the call site is
    // a fresh object per render. As an effect dep that is an unbounded
    // get_ephemeral storm, since every snapshot apply itself re-renders.
    const makeCodec = () => ({
      encode: (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v))),
      decode: (b: number[]) => JSON.parse(new TextDecoder().decode(new Uint8Array(b))),
    });
    mockGet.mockResolvedValue([{ author: 'A', state: { x: 1 }, ageMs: 0 }]);

    const { result, rerender } = renderHook(() =>
      useEphemeral<{ x: number }>('ctx-1', { codec: makeCodec() }),
    );
    await waitFor(() => expect(result.current.peers.size).toBe(1));
    const callsAfterSeed = mockGet.mock.calls.length;
    expect(callsAfterSeed).toBe(1);

    rerender();
    rerender();
    await act(async () => { await Promise.resolve(); });

    expect(mockGet.mock.calls.length).toBe(callsAfterSeed);
    expect(listeners.length).toBe(1);
  });

  it('surfaces an actionable error when the client has no ephemeral surface', async () => {
    // mero-js < 9.1.0: `mero.ephemeral` is undefined. Without this the hook
    // degrades to empty peers + a no-op setPresence and `error: null`.
    currentMero = { admin: { getContextIdentitiesOwned: mockGetContextIdentitiesOwned } };

    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toMatch(/mero\.ephemeral/);
    expect(result.current.error?.message).toMatch(/mero-js/);
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

  it('never publishes a queued slice into the PREVIOUS context after a switch', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ ctx }) =>
        useEphemeral<{ x?: number; y?: number }>(ctx, { throttleMs: 50, initial: { x: 1 } }),
      { initialProps: { ctx: 'ctx-1' } },
    );
    await act(async () => { await Promise.resolve(); });

    // Queued for ctx-1, still inside the throttle window.
    act(() => { result.current.setPresence({ y: 7 }); });
    expect(mockSet).not.toHaveBeenCalled();

    rerender({ ctx: 'ctx-2' });
    act(() => { vi.advanceTimersByTime(500); });

    // The queued timer captured ctx-1's publish — it must have been cancelled.
    expect(mockSet).not.toHaveBeenCalled();

    // ...and the first publish in the new context must not carry ctx-1's `y`.
    act(() => { result.current.setPresence({ x: 2 }); });
    act(() => { vi.advanceTimersByTime(500); });

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][0]).toBe('ctx-2');
    expect(mockSet.mock.calls[0][1]).toEqual({ x: 2 });
    vi.useRealTimers();
  });
});
