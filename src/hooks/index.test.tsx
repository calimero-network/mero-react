// @vitest-environment jsdom

import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useApplicationContexts,
  useContextDiscovery,
  useContexts,
  useCreateGroup,
  useGroupCapabilities,
  useGroupContexts,
  useGroupInvitations,
  useGroupMembers,
  useGroups,
  useJoinGroup,
  useJoinGroupContext,
} from './index';
import { useMero } from '../context';

vi.mock('../context', () => ({
  useMero: vi.fn(),
}));

const mockUseMero = vi.mocked(useMero);

function createMero(adminOverrides: Record<string, unknown> = {}) {
  return {
    admin: {
      getContexts: vi.fn().mockResolvedValue({ contexts: [] }),
      getContextsForApplication: vi.fn().mockResolvedValue({ contexts: [] }),
      listGroups: vi.fn().mockResolvedValue([]),
      listGroupMembers: vi.fn().mockResolvedValue({ data: [] }),
      listGroupContexts: vi.fn().mockResolvedValue([]),
      createGroup: vi.fn().mockResolvedValue({ groupId: 'group-1' }),
      createGroupInvitation: vi.fn().mockResolvedValue({
        invitation: {
          invitation: {
            inviter_identity: [],
            group_id: [],
            expiration_timestamp: 0,
          },
          inviter_signature: 'sig-1',
        },
      }),
      joinGroup: vi.fn().mockResolvedValue({ groupId: 'group-1', memberIdentity: 'member-1' }),
      joinGroupContext: vi.fn().mockResolvedValue({
        contextId: 'ctx-1',
        memberPublicKey: 'member-key-1',
      }),
      getMemberCapabilities: vi.fn().mockResolvedValue({ capabilities: 7 }),
      setMemberCapabilities: vi.fn().mockResolvedValue(undefined),
      ...adminOverrides,
    },
  };
}

describe('group and context hooks', () => {
  beforeEach(() => {
    mockUseMero.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('useContexts fetches contexts for a specific application via getContextsForApplication', async () => {
    const mero = createMero({
      getContextsForApplication: vi.fn().mockResolvedValue({
        contexts: [{ id: 'ctx-1', applicationId: 'app-1' }],
      }),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useContexts('app-1'));

    await waitFor(() => {
      expect(result.current.contexts).toEqual([{ contextId: 'ctx-1', applicationId: 'app-1' }]);
    });

    expect(mero.admin.getContextsForApplication).toHaveBeenCalledWith('app-1');
    expect(mero.admin.getContexts).not.toHaveBeenCalled();
  });

  it('useApplicationContexts delegates to the application-scoped context query', async () => {
    const mero = createMero({
      getContextsForApplication: vi.fn().mockResolvedValue({
        contexts: [{ id: 'ctx-2', applicationId: 'app-2' }],
      }),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useApplicationContexts('app-2'));

    await waitFor(() => {
      expect(result.current.contexts).toEqual([{ contextId: 'ctx-2', applicationId: 'app-2' }]);
    });
  });

  it('useGroups loads and refetches group summaries', async () => {
    const listGroups = vi
      .fn()
      .mockResolvedValueOnce([{ groupId: 'group-1', appKey: 'app-key-1', targetApplicationId: 'app-1', upgradePolicy: 'manual', createdAt: 1 }])
      .mockResolvedValueOnce([{ groupId: 'group-2', appKey: 'app-key-2', targetApplicationId: 'app-1', upgradePolicy: 'manual', createdAt: 2 }]);
    const mero = createMero({ listGroups });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroups());

    await waitFor(() => {
      expect(result.current.groups[0]?.groupId).toBe('group-1');
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.groups[0]?.groupId).toBe('group-2');
  });

  it('useGroupMembers loads members for a group', async () => {
    const mero = createMero({
      listGroupMembers: vi.fn().mockResolvedValue({
        data: [{ identity: 'member-1', role: 'Admin' }],
        selfIdentity: 'member-1',
      }),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupMembers('group-1'));

    await waitFor(() => {
      expect(result.current.members).toEqual([{ identity: 'member-1', role: 'Admin' }]);
      expect(result.current.selfIdentity).toBe('member-1');
    });
  });

  it('useGroupMembers clears stale errors when the group selection is removed', async () => {
    const listGroupMembers = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ listGroupMembers });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId }) => useGroupMembers(groupId),
      { initialProps: { groupId: 'group-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.members).toEqual([]);
    });
  });

  it('useGroupContexts loads contexts for a group', async () => {
    const mero = createMero({
      listGroupContexts: vi.fn().mockResolvedValue([{ contextId: 'ctx-1' }]),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupContexts('group-1'));

    await waitFor(() => {
      expect(result.current.contexts).toEqual([{ contextId: 'ctx-1' }]);
    });
  });

  it('useGroupContexts clears stale errors when the group selection is removed', async () => {
    const listGroupContexts = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ listGroupContexts });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId }) => useGroupContexts(groupId),
      { initialProps: { groupId: 'group-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.contexts).toEqual([]);
    });
  });

  it('useCreateGroup creates a group and returns the created record', async () => {
    const createGroup = vi.fn().mockResolvedValue({ groupId: 'group-9' });
    const mero = createMero({ createGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useCreateGroup());

    await act(async () => {
      const created = await result.current.createGroup({
        applicationId: 'app-1',
        upgradePolicy: 'manual',
        alias: 'Lobby',
      });
      expect(created).toEqual({ groupId: 'group-9' });
    });

    expect(createGroup).toHaveBeenCalledWith({
      applicationId: 'app-1',
      upgradePolicy: 'manual',
      alias: 'Lobby',
    });
  });

  it('useGroupInvitations creates an invitation for a group', async () => {
    const createGroupInvitation = vi.fn().mockResolvedValue({
      invitation: {
        invitation: {
          inviter_identity: [0],
          group_id: [1],
          expiration_timestamp: 123,
        },
        inviter_signature: 'sig-1',
      },
    });
    const mero = createMero({ createGroupInvitation });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupInvitations());

    await act(async () => {
      const invitation = await result.current.createInvitation('group-1', {
        expirationTimestamp: 123,
      });
      if (!invitation) {
        throw new Error('Expected invitation to be created');
      }
      expect(invitation.invitation.inviter_signature).toBe('sig-1');
    });

    expect(createGroupInvitation).toHaveBeenCalledWith('group-1', {
      expirationTimestamp: 123,
    });
  });

  it('useJoinGroup submits a group invitation', async () => {
    const joinGroup = vi.fn().mockResolvedValue({ groupId: 'group-1', memberIdentity: 'member-2' });
    const mero = createMero({ joinGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useJoinGroup());

    await act(async () => {
      const joined = await result.current.joinGroup({
        invitation: {
          invitation: {
            inviter_identity: [0],
            group_id: [1],
            expiration_timestamp: 123,
          },
          inviter_signature: 'sig-1',
        },
        groupAlias: 'Lobby',
      });
      if (!joined) {
        throw new Error('Expected group join result');
      }
      expect(joined.memberIdentity).toBe('member-2');
    });
  });

  it('useJoinGroupContext joins a group context', async () => {
    const joinGroupContext = vi.fn().mockResolvedValue({
      contextId: 'ctx-1',
      memberPublicKey: 'member-key-1',
    });
    const mero = createMero({ joinGroupContext });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useJoinGroupContext());

    await act(async () => {
      const joined = await result.current.joinGroupContext('group-1', 'ctx-1');
      if (!joined) {
        throw new Error('Expected group context join result');
      }
      expect(joined.contextId).toBe('ctx-1');
    });
  });

  it('useGroupCapabilities loads and updates member capabilities', async () => {
    const getMemberCapabilities = vi.fn().mockResolvedValue({ capabilities: 7 });
    const setMemberCapabilities = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ getMemberCapabilities, setMemberCapabilities });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupCapabilities('group-1', 'member-1'));

    await waitFor(() => {
      expect(result.current.capabilities).toBe(7);
    });

    await act(async () => {
      await result.current.setCapabilities(9);
    });

    expect(setMemberCapabilities).toHaveBeenCalledWith('group-1', 'member-1', 9);
  });

  it('useGroupCapabilities clears stale errors when the member selection is removed', async () => {
    const getMemberCapabilities = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getMemberCapabilities });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId, memberId }) => useGroupCapabilities(groupId, memberId),
      {
        initialProps: {
          groupId: 'group-1' as string | null,
          memberId: 'member-1' as string | null,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: 'group-1', memberId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.capabilities).toBeNull();
    });
  });

  it('useContextDiscovery finds the first unseen application context', async () => {
    const getContextsForApplication = vi
      .fn()
      .mockResolvedValueOnce({ contexts: [{ id: 'ctx-known', applicationId: 'app-1' }] })
      .mockResolvedValueOnce({
        contexts: [
          { id: 'ctx-known', applicationId: 'app-1' },
          { id: 'ctx-new', applicationId: 'app-1' },
        ],
      });
    const mero = createMero({ getContextsForApplication });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() =>
      useContextDiscovery({
        applicationId: 'app-1',
        knownContextIds: ['ctx-known'],
        pollIntervalMs: 1,
        timeoutMs: 50,
      }),
    );

    await act(async () => {
      const discovered = await result.current.discover();
      expect(discovered?.contextId).toBe('ctx-new');
    });
  });

  it('useContextDiscovery reports a timeout when no new context is found', async () => {
    const mero = createMero({
      getContextsForApplication: vi.fn().mockResolvedValue({
        contexts: [{ id: 'ctx-known', applicationId: 'app-1' }],
      }),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() =>
      useContextDiscovery({
        applicationId: 'app-1',
        knownContextIds: ['ctx-known'],
        pollIntervalMs: 1,
        timeoutMs: 5,
      }),
    );

    await act(async () => {
      const discovered = await result.current.discover();
      expect(discovered).toBeNull();
    });

    expect(result.current.error).toBeInstanceOf(Error);
  });
});
