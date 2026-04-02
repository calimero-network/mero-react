// @vitest-environment jsdom

import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useApplicationContexts,
  useContextDiscovery,
  useContextGroup,
  useContexts,
  useCreateContext,
  useCreateGroup,
  useDeleteContext,
  useDeleteGroup,
  useGroupCapabilities,
  useGroupContexts,
  useGroupInfo,
  useGroupInvitations,
  useGroupMembers,
  useGroups,
  useInviteToContext,
  useJoinContext,
  useJoinGroup,
  useJoinGroupContext,
  useAddGroupMembers,
  useRemoveGroupMembers,
  useSyncGroup,
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
      createContext: vi.fn().mockResolvedValue({ contextId: 'ctx-1', memberPublicKey: 'pk-1' }),
      deleteContext: vi.fn().mockResolvedValue({ isDeleted: true }),
      inviteToContext: vi.fn().mockResolvedValue(null),
      joinContext: vi.fn().mockResolvedValue({ contextId: 'ctx-1', memberPublicKey: 'pk-1' }),
      getContextGroup: vi.fn().mockResolvedValue('group-hex-id'),
      listGroups: vi.fn().mockResolvedValue([]),
      listGroupMembers: vi.fn().mockResolvedValue({ data: [] }),
      listGroupContexts: vi.fn().mockResolvedValue([]),
      createGroup: vi.fn().mockResolvedValue({ groupId: 'group-1' }),
      deleteGroup: vi.fn().mockResolvedValue({ isDeleted: true }),
      getGroupInfo: vi.fn().mockResolvedValue({
        groupId: 'group-1',
        appKey: 'app-key-1',
        targetApplicationId: 'app-1',
        upgradePolicy: 'manual',
        memberCount: 2,
        contextCount: 1,
        defaultCapabilities: 7,
        defaultVisibility: 'open',
      }),
      syncGroup: vi.fn().mockResolvedValue({
        groupId: 'group-1',
        appKey: 'app-key-1',
        targetApplicationId: 'app-1',
        memberCount: 2,
        contextCount: 1,
      }),
      addGroupMembers: vi.fn().mockResolvedValue(null),
      removeGroupMembers: vi.fn().mockResolvedValue(null),
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

  // ---- Context CRUD Hooks ----

  it('useCreateContext creates a context and returns the result', async () => {
    const createContext = vi.fn().mockResolvedValue({ contextId: 'ctx-9', memberPublicKey: 'pk-9' });
    const mero = createMero({ createContext });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useCreateContext());

    await act(async () => {
      const created = await result.current.createContext({ applicationId: 'app-1' });
      expect(created).toEqual({ contextId: 'ctx-9', memberPublicKey: 'pk-9' });
    });

    expect(createContext).toHaveBeenCalledWith({ applicationId: 'app-1' });
  });

  it('useDeleteContext deletes a context and returns the result', async () => {
    const deleteContext = vi.fn().mockResolvedValue({ isDeleted: true });
    const mero = createMero({ deleteContext });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useDeleteContext());

    await act(async () => {
      const deleted = await result.current.deleteContext('ctx-1');
      expect(deleted).toEqual({ isDeleted: true });
    });

    expect(deleteContext).toHaveBeenCalledWith('ctx-1');
  });

  it('useInviteToContext invites to a context and returns invitation', async () => {
    const invitation = {
      invitation: { inviter_identity: 'id-1', context_id: 'ctx-1', expiration_timestamp: 123, secret_salt: [0] },
      inviter_signature: 'sig-1',
    };
    const inviteToContext = vi.fn().mockResolvedValue(invitation);
    const mero = createMero({ inviteToContext });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useInviteToContext());

    await act(async () => {
      const inv = await result.current.inviteToContext({ contextId: 'ctx-1', inviterId: 'id-1', validForSeconds: 3600 });
      expect(inv).toEqual(invitation);
    });
  });

  it('useJoinContext joins a context and returns join data', async () => {
    const joinContext = vi.fn().mockResolvedValue({ contextId: 'ctx-1', memberPublicKey: 'pk-2' });
    const mero = createMero({ joinContext });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useJoinContext());

    await act(async () => {
      const joined = await result.current.joinContext({
        invitation: {
          invitation: { inviter_identity: 'id-1', context_id: 'ctx-1', expiration_timestamp: 123, secret_salt: [0] },
          inviter_signature: 'sig-1',
        },
        newMemberPublicKey: 'pk-2',
      });
      expect(joined).toEqual({ contextId: 'ctx-1', memberPublicKey: 'pk-2' });
    });
  });

  it('useContextGroup fetches the group id for a context', async () => {
    const getContextGroup = vi.fn().mockResolvedValue('group-abc');
    const mero = createMero({ getContextGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useContextGroup('ctx-1'));

    await waitFor(() => {
      expect(result.current.groupId).toBe('group-abc');
    });

    expect(getContextGroup).toHaveBeenCalledWith('ctx-1');
  });

  it('useContextGroup clears stale errors when contextId becomes null', async () => {
    const getContextGroup = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getContextGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ contextId }) => useContextGroup(contextId),
      { initialProps: { contextId: 'ctx-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ contextId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.groupId).toBeNull();
    });
  });

  // ---- Group Info / Management Hooks ----

  it('useGroupInfo loads group info', async () => {
    const mero = createMero({
      getGroupInfo: vi.fn().mockResolvedValue({
        groupId: 'group-1',
        memberCount: 5,
        contextCount: 2,
        defaultCapabilities: 7,
        defaultVisibility: 'open',
      }),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupInfo('group-1'));

    await waitFor(() => {
      expect(result.current.groupInfo?.memberCount).toBe(5);
    });
  });

  it('useGroupInfo clears stale errors when groupId becomes null', async () => {
    const getGroupInfo = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getGroupInfo });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId }) => useGroupInfo(groupId),
      { initialProps: { groupId: 'group-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.groupInfo).toBeNull();
    });
  });

  it('useDeleteGroup deletes a group', async () => {
    const deleteGroup = vi.fn().mockResolvedValue({ isDeleted: true });
    const mero = createMero({ deleteGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useDeleteGroup());

    await act(async () => {
      const deleted = await result.current.deleteGroup('group-1');
      expect(deleted).toEqual({ isDeleted: true });
    });

    expect(deleteGroup).toHaveBeenCalledWith('group-1', undefined);
  });

  it('useSyncGroup syncs a group', async () => {
    const syncGroup = vi.fn().mockResolvedValue({
      groupId: 'group-1',
      appKey: 'key',
      targetApplicationId: 'app-1',
      memberCount: 2,
      contextCount: 1,
    });
    const mero = createMero({ syncGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSyncGroup());

    await act(async () => {
      const synced = await result.current.syncGroup('group-1');
      expect(synced?.groupId).toBe('group-1');
    });

    expect(syncGroup).toHaveBeenCalledWith('group-1', undefined);
  });

  it('useAddGroupMembers adds members to a group', async () => {
    const addGroupMembers = vi.fn().mockResolvedValue(null);
    const mero = createMero({ addGroupMembers });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useAddGroupMembers());

    const request = { members: [{ identity: 'member-2', role: 'Member' as const }] };
    await act(async () => {
      await result.current.addGroupMembers('group-1', request);
    });

    expect(addGroupMembers).toHaveBeenCalledWith('group-1', request);
  });

  it('useRemoveGroupMembers removes members from a group', async () => {
    const removeGroupMembers = vi.fn().mockResolvedValue(null);
    const mero = createMero({ removeGroupMembers });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useRemoveGroupMembers());

    const request = { members: ['member-2'] };
    await act(async () => {
      await result.current.removeGroupMembers('group-1', request);
    });

    expect(removeGroupMembers).toHaveBeenCalledWith('group-1', request);
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
