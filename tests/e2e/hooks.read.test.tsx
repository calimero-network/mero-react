/**
 * Phase 1 — read hooks against a live node. The point is to let the real wire
 * surface bugs the mocked unit tests can't: each hook must reach loading=false
 * with error=null (a parse/shape/wire bug shows up as a thrown error), and
 * where the fixture guarantees data we assert it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { waitFor } from '@testing-library/react';
import { setupFixture, teardownFixture, type E2eFixture } from './harness';
import { renderHookWithMero } from './render';
import {
  useContexts,
  useGroupContexts,
  useContextGroup,
  useNamespaces,
  useNamespacesForApplication,
  useNamespace,
  useNamespaceIdentity,
  useNamespaceGroups,
  useGroupInfo,
  useGroupMembers,
  useGroupCapabilities,
  useDefaultCapabilities,
  useSubgroupVisibility,
  useGroupMetadata,
  useMemberMetadata,
  useSubgroups,
  useGroupUpgradeStatus,
} from '../../src/hooks';

let fx: E2eFixture;

beforeAll(async () => {
  fx = await setupFixture();
}, 60000);

afterAll(async () => {
  await teardownFixture(fx);
});

/** Render a read hook, wait for it to settle, return its final result object. */
async function settle<T extends { loading: boolean }>(
  render: () => { result: { current: T } },
): Promise<T> {
  const { result } = render();
  await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 30000 });
  return result.current;
}

describe('Phase 1 — read hooks vs live node', () => {
  it('useContexts(appId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useContexts(fx.applicationId)));
    expect(r.error).toBeNull();
    expect(r.contexts.some((c) => c.contextId === fx.contextId)).toBe(true);
  });

  it('useGroupContexts(groupId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useGroupContexts(fx.groupId)));
    expect(r.error).toBeNull();
    expect(Array.isArray(r.contexts)).toBe(true);
  });

  it('useContextGroup(contextId) resolves to the fixture group', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useContextGroup(fx.contextId)));
    expect(r.error).toBeNull();
    expect(r.groupId).toBe(fx.groupId);
  });

  it('useNamespaces()', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useNamespaces()));
    expect(r.error).toBeNull();
    expect(r.namespaces.some((n) => n.namespaceId === fx.namespaceId)).toBe(true);
  });

  it('useNamespacesForApplication(appId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useNamespacesForApplication(fx.applicationId)));
    expect(r.error).toBeNull();
    expect(r.namespaces.some((n) => n.namespaceId === fx.namespaceId)).toBe(true);
  });

  it('useNamespace(namespaceId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useNamespace(fx.namespaceId)));
    expect(r.error).toBeNull();
    expect(r.namespace).toBeTruthy();
  });

  it('useNamespaceIdentity(namespaceId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useNamespaceIdentity(fx.namespaceId)));
    expect(r.error).toBeNull();
    expect(r.identity).toBeTruthy();
  });

  it('useNamespaceGroups(namespaceId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useNamespaceGroups(fx.namespaceId)));
    expect(r.error).toBeNull();
    expect(Array.isArray(r.groups)).toBe(true);
  });

  it('useGroupInfo(groupId) returns groupStateHash', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useGroupInfo(fx.groupId)));
    expect(r.error).toBeNull();
    expect(r.groupInfo).toBeTruthy();
    expect(r.groupInfo?.groupId).toBe(fx.groupId);
  });

  it('useGroupMembers(groupId) includes the creator', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useGroupMembers(fx.groupId)));
    expect(r.error).toBeNull();
    expect(r.members.length).toBeGreaterThan(0);
    expect(r.members.some((m) => m.identity === fx.identity)).toBe(true);
  });

  it('useGroupCapabilities(groupId, identity)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useGroupCapabilities(fx.groupId, fx.identity)));
    expect(r.error).toBeNull();
  });

  it('useDefaultCapabilities(groupId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useDefaultCapabilities(fx.groupId)));
    expect(r.error).toBeNull();
    expect(typeof r.defaultCapabilities).toBe('number');
  });

  it('useSubgroupVisibility(groupId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useSubgroupVisibility(fx.groupId)));
    expect(r.error).toBeNull();
    expect(typeof r.subgroupVisibility).toBe('string');
  });

  it('useGroupMetadata(groupId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useGroupMetadata(fx.groupId)));
    expect(r.error).toBeNull();
  });

  it('useMemberMetadata(groupId, identity)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useMemberMetadata(fx.groupId, fx.identity)));
    expect(r.error).toBeNull();
  });

  it('useSubgroups(groupId)', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useSubgroups(fx.groupId)));
    expect(r.error).toBeNull();
    expect(Array.isArray(r.subgroups)).toBe(true);
  });

  it('useGroupUpgradeStatus(groupId) [guarded hook]', async () => {
    const r = await settle(() => renderHookWithMero(fx.mero, () => useGroupUpgradeStatus(fx.groupId)));
    expect(r.error).toBeNull();
  });
});
