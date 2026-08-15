// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEphemeral } from './index.js';

const listeners: Array<(e: unknown) => void> = [];
const subscribeCalls: string[] = [];
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
    // The node replays current presence over the subscription itself, so this
    // double records the subscribe and hands back the handler; a test drives
    // both the replayed seed (entries carrying `ageMs`) and the live deltas
    // (no `ageMs`) through it.
    subscribe: (ctx: string, handler: (e: unknown) => void) => {
      subscribeCalls.push(ctx);
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
  subscribeCalls.length = 0;
  mockSet.mockReset().mockResolvedValue(undefined);
  mockGetContextIdentitiesOwned.mockReset().mockResolvedValue({ identities: ['SELF'] });
});

describe('useEphemeral read path', () => {
  it('seeds peers from a replayed entry', async () => {
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'A', state: { x: 1 }, ageMs: 100 });
    expect(result.current.peers.get('A')).toEqual({ x: 1 });
  });

  it('applies an upsert delta', async () => {
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'B', state: { x: 2 }, removed: false });
    expect(result.current.peers.get('B')).toEqual({ x: 2 });
  });

  it('deletes an entry on a removal delta', async () => {
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'A', state: { x: 1 }, ageMs: 0 });
    expect(result.current.peers.has('A')).toBe(true);
    emit({ author: 'A', removed: true });
    expect(result.current.peers.has('A')).toBe(false);
  });

  it('reports age seeded from a replayed entry ageMs, not from zero', async () => {
    // A replayed entry that is already 5s old must not read as fresh — it is
    // back-dated so replay and live deltas share one notion of freshness.
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'A', state: { x: 1 }, ageMs: 5000 });
    expect(result.current.ageOf('A')).toBeGreaterThanOrEqual(5000);
  });

  it('reports a near-zero age for a live delta carrying no ageMs', async () => {
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'B', state: { x: 2 }, removed: false });
    expect(result.current.ageOf('B')).toBeLessThan(1000);
  });

  it('treats an explicit ageMs of 0 as fresh, not as missing', async () => {
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'A', state: { x: 1 }, ageMs: 0 });
    expect(result.current.ageOf('A')).toBeLessThan(1000);
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
    expect(subscribeCalls).toEqual([]);
  });

  it('does not resubscribe when an unstable codec identity is passed every render', async () => {
    // `jsonCodec()` is a FACTORY — `{ codec: jsonCodec() }` at the call site is
    // a fresh object per render. As an effect dep that is an unbounded
    // resubscribe storm, since every applied entry itself re-renders.
    const makeCodec = () => ({
      encode: (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v))),
      decode: (b: number[]) => JSON.parse(new TextDecoder().decode(new Uint8Array(b))),
    });

    const { result, rerender } = renderHook(() =>
      useEphemeral<{ x: number }>('ctx-1', { codec: makeCodec() }),
    );
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'A', state: { x: 1 }, ageMs: 0 });
    expect(result.current.peers.size).toBe(1);
    expect(subscribeCalls.length).toBe(1);

    rerender();
    rerender();
    await act(async () => { await Promise.resolve(); });

    expect(subscribeCalls.length).toBe(1);
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
    expect(subscribeCalls).toEqual([]);
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
    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    // Wait for the identity to resolve, so `selfRef` is populated before the
    // entries land (the retroactive-drop case is covered separately below).
    await waitFor(() => expect(mockGetContextIdentitiesOwned).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    emit({ author: 'SELF', state: { x: 1 }, ageMs: 0 });
    emit({ author: 'OTHER', state: { x: 2 }, ageMs: 0 });

    expect(result.current.peers.has('OTHER')).toBe(true);
    expect(result.current.peers.has('SELF')).toBe(false);
  });

  it('includes self when includeSelf is true', async () => {
    const { result } = renderHook(() =>
      useEphemeral<{ x: number }>('ctx-1', { includeSelf: true }),
    );
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'SELF', state: { x: 1 }, ageMs: 0 });
    expect(result.current.peers.has('SELF')).toBe(true);
  });

  it('retroactively drops self when the identity resolves after the entry arrives', async () => {
    // The identity lookup and the subscription's presence replay land
    // independently, so a self entry can already be in `peers` by the time we
    // learn which author is "self".
    let resolveIdentity!: (v: { identities: string[] }) => void;
    mockGetContextIdentitiesOwned.mockImplementation(
      () => new Promise(res => { resolveIdentity = res; }),
    );

    const { result } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));
    await waitFor(() => expect(listeners.length).toBe(1));

    emit({ author: 'SELF', state: { x: 1 }, ageMs: 0 });
    expect(result.current.peers.has('SELF')).toBe(true);

    await act(async () => {
      resolveIdentity({ identities: ['SELF'] });
      await Promise.resolve();
    });

    expect(result.current.peers.has('SELF')).toBe(false);
    expect(result.current.ageOf('SELF')).toBeUndefined();
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

  it('resets peers when the context changes', async () => {
    const { result, rerender } = renderHook(
      ({ ctx }) => useEphemeral<{ x: number }>(ctx, { includeSelf: true }),
      { initialProps: { ctx: 'ctx-1' } },
    );
    await waitFor(() => expect(listeners.length).toBe(1));
    emit({ author: 'A', state: { x: 1 }, ageMs: 0 });
    expect(result.current.peers.has('A')).toBe(true);

    rerender({ ctx: 'ctx-2' });
    expect(result.current.peers.size).toBe(0);
    expect(result.current.ageOf('A')).toBeUndefined();
    await waitFor(() => expect(subscribeCalls).toEqual(['ctx-1', 'ctx-2']));
  });
});

describe('useEphemeral error clearing', () => {
  it('clears an error raised for the previous context after switching to a healthy one', async () => {
    // ctx-1: identity resolution fails outright.
    mockGetContextIdentitiesOwned.mockRejectedValueOnce(new Error('identity boom'));
    const { result, rerender } = renderHook(
      ({ ctx }) => useEphemeral<{ x: number }>(ctx),
      { initialProps: { ctx: 'ctx-1' } },
    );
    await waitFor(() => expect(result.current.error?.message).toBe('identity boom'));

    // ctx-2: everything resolves cleanly.
    mockGetContextIdentitiesOwned.mockResolvedValue({ identities: ['SELF'] });
    rerender({ ctx: 'ctx-2' });

    // The reset effect clears synchronously, before the new context's async
    // work even resolves.
    expect(result.current.error).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toBeNull();
  });

  it('clears the missing-ephemeral-surface error once a client exposing it arrives', async () => {
    currentMero = { admin: { getContextIdentitiesOwned: mockGetContextIdentitiesOwned } };
    const { result, rerender } = renderHook(() => useEphemeral<{ x: number }>('ctx-1'));

    await waitFor(() => expect(result.current.error?.message).toMatch(/mero\.ephemeral/));

    // MeroProvider swaps in an upgraded client that DOES expose `mero.ephemeral`.
    currentMero = mockMero;
    rerender();

    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('clears an identity-resolution failure once a later run resolves successfully', async () => {
    mockGetContextIdentitiesOwned.mockResolvedValueOnce({ identities: [] });
    const { result, rerender } = renderHook(
      ({ includeSelf }) => useEphemeral<{ x: number }>('ctx-1', { includeSelf }),
      { initialProps: { includeSelf: false } },
    );
    await waitFor(() =>
      expect(result.current.error?.message).toMatch(/could not resolve a local context identity/),
    );

    // Toggling includeSelf re-runs the identity effect; this time it resolves.
    mockGetContextIdentitiesOwned.mockResolvedValue({ identities: ['SELF'] });
    rerender({ includeSelf: true });

    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('does not let a recovered identity lookup clobber a still-live publish error', async () => {
    // The case the tagged/shared error slot exists for: `identity` and
    // `publish` are different producers, and a recovery in one must not clear
    // the other's error.
    mockGetContextIdentitiesOwned.mockResolvedValueOnce({ identities: [] });
    mockSet.mockRejectedValue(new Error('publish boom'));

    const { result, rerender } = renderHook(
      ({ includeSelf }) =>
        useEphemeral<{ x: number }>('ctx-1', { includeSelf, throttleMs: 0 }),
      { initialProps: { includeSelf: false } },
    );
    await waitFor(() =>
      expect(result.current.error?.message).toMatch(/could not resolve a local context identity/),
    );

    // A failed publish takes ownership of the error slot.
    act(() => { result.current.setPresence({ x: 1 }); });
    await waitFor(() => expect(result.current.error?.message).toBe('publish boom'));

    // The identity effect re-runs and this time resolves — it clears only the
    // error IT raised, so the live publish error must survive.
    mockGetContextIdentitiesOwned.mockResolvedValue({ identities: ['SELF'] });
    rerender({ includeSelf: true });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.error?.message).toBe('publish boom');
  });
});
