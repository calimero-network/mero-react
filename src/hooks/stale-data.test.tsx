// @vitest-environment jsdom
//
// Deterministic proof of the stale-data race in read hooks: when the hook's id
// changes (A -> B) and request A resolves AFTER request B, the result must
// reflect B (latest-request-wins). An unguarded hook clobbers B with A's late
// response. useGroupInfo stands in for the cohort migrated to useAsyncResource.
import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGroupInfo, useContexts } from './index';
import { useMero } from '../context';

vi.mock('../context', () => ({ useMero: vi.fn() }));
const mockUseMero = vi.mocked(useMero);

beforeEach(() => {
  mockUseMero.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('read-hook staleness guard', () => {
  it('useGroupInfo: a slow earlier request must not overwrite the latest', async () => {
    const resolvers: Record<string, (v: unknown) => void> = {};
    const getGroupInfo = vi.fn(
      (groupId: string) =>
        new Promise((resolve) => {
          resolvers[groupId] = resolve;
        }),
    );
    mockUseMero.mockReturnValue({ mero: { admin: { getGroupInfo } } } as never);

    const { result, rerender } = renderHook(({ groupId }) => useGroupInfo(groupId), {
      initialProps: { groupId: 'A' },
    });
    await waitFor(() => expect(getGroupInfo).toHaveBeenCalledWith('A'));

    rerender({ groupId: 'B' });
    await waitFor(() => expect(getGroupInfo).toHaveBeenCalledWith('B'));

    // Resolve B first, then the stale A — A must be ignored.
    await act(async () => resolvers['B']({ groupId: 'B' }));
    await act(async () => resolvers['A']({ groupId: 'A' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groupInfo?.groupId).toBe('B');
  });

  it('useContexts: latest applicationId wins even if an earlier fetch resolves later', async () => {
    const resolvers: Record<string, (v: unknown) => void> = {};
    const getContextsForApplication = vi.fn(
      (appId: string) =>
        new Promise((resolve) => {
          resolvers[appId] = resolve;
        }),
    );
    mockUseMero.mockReturnValue({ mero: { admin: { getContextsForApplication } } } as never);

    const { result, rerender } = renderHook(({ appId }) => useContexts(appId), {
      initialProps: { appId: 'A' },
    });
    await waitFor(() => expect(getContextsForApplication).toHaveBeenCalledWith('A'));
    rerender({ appId: 'B' });
    await waitFor(() => expect(getContextsForApplication).toHaveBeenCalledWith('B'));

    await act(async () => resolvers['B']({ contexts: [{ id: 'ctx-B', applicationId: 'B' }] }));
    await act(async () => resolvers['A']({ contexts: [{ id: 'ctx-A', applicationId: 'A' }] }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contexts.map((c) => c.contextId)).toEqual(['ctx-B']);
  });
});
