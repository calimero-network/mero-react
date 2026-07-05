/**
 * Phase 1 — mutation + execute round-trips against a live node. Mutations are
 * the higher-risk surface (wrong request bodies, response handling), so these
 * perform an action then read it back to prove the effect really landed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { setupFixture, teardownFixture, type E2eFixture } from './harness';
import { wrapperFor } from './render';
import {
  useCreateGroupInNamespace,
  useNamespaceGroups,
  useSetGroupMetadata,
  useGroupMetadata,
  useExecute,
} from '../../src/hooks';

let fx: E2eFixture;

beforeAll(async () => {
  fx = await setupFixture();
}, 60000);

afterAll(async () => {
  await teardownFixture(fx);
});

describe('Phase 1 — mutations + round-trips vs live node', () => {
  it('useCreateGroupInNamespace creates a subgroup that useNamespaceGroups then lists', async () => {
    const wrapper = wrapperFor(fx.mero);
    const name = `sub-${fx.run}`;

    const { result: mut } = renderHook(() => useCreateGroupInNamespace(), { wrapper });
    let created: Awaited<ReturnType<typeof mut.current.createGroupInNamespace>> | undefined;
    await act(async () => {
      created = await mut.current.createGroupInNamespace(fx.namespaceId, { name });
    });
    expect(mut.current.error).toBeNull();
    expect(created?.groupId).toBeTruthy();

    const { result: read } = renderHook(() => useNamespaceGroups(fx.namespaceId), { wrapper });
    await waitFor(() => expect(read.current.loading).toBe(false), { timeout: 30000 });
    expect(read.current.error).toBeNull();
    expect(read.current.groups.some((g) => g.groupId === created?.groupId)).toBe(true);
  });

  // BUG (mero-js): getGroupMetadata/getMemberMetadata do `response.data.data`,
  // but core single-envelopes `{ data: MetadataRecord }`, so they return the
  // bare data map instead of the MetadataRecord (`.name`/`.updatedAt` lost).
  // Verified against the raw wire. Re-enable after the mero-js fix + dep bump.
  it.skip('useSetGroupMetadata → useGroupMetadata reads the value back', async () => {
    const wrapper = wrapperFor(fx.mero);
    const value = `val-${fx.run}`;

    const { result: mut } = renderHook(() => useSetGroupMetadata(), { wrapper });
    await act(async () => {
      await mut.current.setGroupMetadata(fx.groupId, { name: 'e2e', data: { marker: value } });
    });
    expect(mut.current.error).toBeNull();

    const { result: read } = renderHook(() => useGroupMetadata(fx.groupId), { wrapper });
    await waitFor(() => expect(read.current.loading).toBe(false), { timeout: 30000 });
    expect(read.current.error).toBeNull();
    expect(read.current.metadata?.name).toBe('e2e');
    expect(read.current.metadata?.data?.marker).toBe(value);
  });

  it('useExecute kv-store set → get round-trips the value', async () => {
    const wrapper = wrapperFor(fx.mero);
    const key = `k-${fx.run}`;
    const value = `v-${fx.run}`;

    const { result } = renderHook(() => useExecute(fx.contextId, fx.identity), { wrapper });

    await act(async () => {
      await result.current.execute('set', { key, value });
    });
    expect(result.current.error).toBeNull();

    let got: unknown;
    await act(async () => {
      got = await result.current.execute('get', { key });
    });
    expect(result.current.error).toBeNull();
    // kv-store `get` returns the stored string (shape may be the bare value).
    expect(JSON.stringify(got)).toContain(value);
  });
});
