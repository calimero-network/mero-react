// @vitest-environment jsdom

import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useApplicationContexts,
  useContextDiscovery,
  useContextGroup,
  useContexts,
  useCreateContext,
  useCreateGroupInNamespace,
  useCreateNamespace,
  useCreateNamespaceInvitation,
  useDeleteContext,
  useDeleteGroup,
  useDeleteNamespace,
  useDetachContextFromGroup,
  useGroupCapabilities,
  useGroupContexts,
  useGroupInfo,
  useGroupInvitations,
  useGroupMembers,
  useGroupUpgradeStatus,
  useJoinContext,
  useJoinGroup,
  useJoinNamespace,
  useNamespace,
  useNamespaceGroups,
  useNamespaceIdentity,
  useNamespaces,
  useNamespacesForApplication,
  useNestGroup,
  useRegisterGroupSigningKey,
  useRetryGroupUpgrade,
  useSetDefaultCapabilities,
  useSetDefaultVisibility,
  useSetGroupAlias,
  useSetMemberAlias,
  useSetTeeAdmissionPolicy,
  useSubgroups,
  useUnnestGroup,
  useUpdateGroupSettings,
  useUpdateMemberRole,
  useUpgradeGroup,
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
      joinContext: vi.fn().mockResolvedValue({ contextId: 'ctx-1', memberPublicKey: 'pk-1' }),
      getContextGroup: vi.fn().mockResolvedValue('group-hex-id'),
      listGroupMembers: vi.fn().mockResolvedValue({ data: [] }),
      listGroupContexts: vi.fn().mockResolvedValue([]),
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
            inviterIdentity: [],
            groupId: [],
            expirationTimestamp: 0,
          },
          inviterSignature: 'sig-1',
        },
      }),
      joinGroup: vi.fn().mockResolvedValue({ groupId: 'group-1', memberIdentity: 'member-1' }),
      getMemberCapabilities: vi.fn().mockResolvedValue({ capabilities: 7 }),
      setMemberCapabilities: vi.fn().mockResolvedValue(undefined),
      updateMemberRole: vi.fn().mockResolvedValue(undefined),
      setDefaultCapabilities: vi.fn().mockResolvedValue(undefined),
      setDefaultVisibility: vi.fn().mockResolvedValue(undefined),
      setTeeAdmissionPolicy: vi.fn().mockResolvedValue(undefined),
      updateGroupSettings: vi.fn().mockResolvedValue(undefined),
      setGroupAlias: vi.fn().mockResolvedValue(undefined),
      setMemberAlias: vi.fn().mockResolvedValue(undefined),
      registerGroupSigningKey: vi.fn().mockResolvedValue({ publicKey: 'pk-1' }),
      upgradeGroup: vi.fn().mockResolvedValue({ groupId: 'group-1', status: 'in_progress' }),
      getGroupUpgradeStatus: vi.fn().mockResolvedValue(null),
      retryGroupUpgrade: vi.fn().mockResolvedValue({ groupId: 'group-1', status: 'in_progress' }),
      nestGroup: vi.fn().mockResolvedValue(undefined),
      unnestGroup: vi.fn().mockResolvedValue(undefined),
      listSubgroups: vi.fn().mockResolvedValue([]),
      detachContextFromGroup: vi.fn().mockResolvedValue(undefined),
      lookupContextAlias: vi.fn().mockResolvedValue(null),
      // Namespace mocks
      listNamespaces: vi.fn().mockResolvedValue([]),
      getNamespace: vi.fn().mockResolvedValue({
        namespaceId: 'ns-1',
        appKey: 'app-key-1',
        targetApplicationId: 'app-1',
        upgradePolicy: 'manual',
        createdAt: 1,
        memberCount: 1,
        contextCount: 0,
        subgroupCount: 0,
      }),
      getNamespaceIdentity: vi.fn().mockResolvedValue({ namespaceId: 'ns-1', publicKey: 'pk-1' }),
      listNamespacesForApplication: vi.fn().mockResolvedValue([]),
      createNamespace: vi.fn().mockResolvedValue({ namespaceId: 'ns-1' }),
      deleteNamespace: vi.fn().mockResolvedValue({ isDeleted: true }),
      createNamespaceInvitation: vi.fn().mockResolvedValue({
        invitation: { invitation: { inviterIdentity: [], groupId: [], expirationTimestamp: 0, secretSalt: [] }, inviterSignature: 'sig-1' },
        groupAlias: 'test-ns',
      }),
      joinNamespace: vi.fn().mockResolvedValue({ groupId: 'ns-1', memberIdentity: 'member-1', governanceOp: 'MemberAdded' }),
      createGroupInNamespace: vi.fn().mockResolvedValue({ groupId: 'group-1' }),
      listNamespaceGroups: vi.fn().mockResolvedValue([]),
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

  it('useGroupInvitations creates an invitation for a group', async () => {
    const createGroupInvitation = vi.fn().mockResolvedValue({
      invitation: {
        invitation: {
          inviterIdentity: [0],
          groupId: [1],
          expirationTimestamp: 123,
          secretSalt: [42],
        },
        inviterSignature: 'sig-1',
      },
    });
    const mero = createMero({ createGroupInvitation });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupInvitations());

    await act(async () => {
      const response = await result.current.createInvitation('group-1', {
        expirationTimestamp: 123,
      });
      if (!response) {
        throw new Error('Expected invitation to be created');
      }
      if ('invitation' in response) {
        expect(response.invitation.inviterSignature).toBe('sig-1');
      }
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
            inviterIdentity: [0],
            groupId: [1],
            expirationTimestamp: 123,
            secretSalt: [42],
          },
          inviterSignature: 'sig-1',
        },
        groupAlias: 'Lobby',
      });
      if (!joined) {
        throw new Error('Expected group join result');
      }
      expect(joined.memberIdentity).toBe('member-2');
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

    expect(setMemberCapabilities).toHaveBeenCalledWith('group-1', 'member-1', { capabilities: 9 });
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
      const created = await result.current.createContext({ applicationId: 'app-1', groupId: 'group-1' });
      expect(created).toEqual({ contextId: 'ctx-9', memberPublicKey: 'pk-9' });
    });

    expect(createContext).toHaveBeenCalledWith({ applicationId: 'app-1', groupId: 'group-1' });
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

  it('useJoinContext joins a context and returns join data', async () => {
    const joinContext = vi.fn().mockResolvedValue({ contextId: 'ctx-1', memberPublicKey: 'pk-2' });
    const mero = createMero({ joinContext });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useJoinContext());

    await act(async () => {
      const joined = await result.current.joinContext('ctx-1');
      expect(joined).toEqual({ contextId: 'ctx-1', memberPublicKey: 'pk-2' });
    });

    expect(joinContext).toHaveBeenCalledWith('ctx-1');
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

  // ---- Namespace Hooks ----

  it('useNamespaces loads and refetches namespaces', async () => {
    const listNamespaces = vi
      .fn()
      .mockResolvedValueOnce([{ namespaceId: 'ns-1', appKey: 'k1', targetApplicationId: 'app-1', upgradePolicy: 'manual', createdAt: 1, memberCount: 1, contextCount: 0, subgroupCount: 0 }])
      .mockResolvedValueOnce([{ namespaceId: 'ns-2', appKey: 'k2', targetApplicationId: 'app-1', upgradePolicy: 'manual', createdAt: 2, memberCount: 1, contextCount: 0, subgroupCount: 0 }]);
    const mero = createMero({ listNamespaces });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useNamespaces());

    await waitFor(() => {
      expect(result.current.namespaces[0]?.namespaceId).toBe('ns-1');
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.namespaces[0]?.namespaceId).toBe('ns-2');
  });

  it('useNamespace loads a single namespace', async () => {
    const getNamespace = vi.fn().mockResolvedValue({
      namespaceId: 'ns-1',
      appKey: 'k1',
      targetApplicationId: 'app-1',
      upgradePolicy: 'manual',
      createdAt: 1,
      memberCount: 3,
      contextCount: 2,
      subgroupCount: 1,
    });
    const mero = createMero({ getNamespace });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useNamespace('ns-1'));

    await waitFor(() => {
      expect(result.current.namespace?.namespaceId).toBe('ns-1');
      expect(result.current.namespace?.memberCount).toBe(3);
    });

    expect(getNamespace).toHaveBeenCalledWith('ns-1');
  });

  it('useNamespace clears when namespaceId becomes null', async () => {
    const getNamespace = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getNamespace });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ nsId }) => useNamespace(nsId),
      { initialProps: { nsId: 'ns-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ nsId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.namespace).toBeNull();
    });
  });

  it('useNamespaceIdentity loads namespace identity', async () => {
    const getNamespaceIdentity = vi.fn().mockResolvedValue({ namespaceId: 'ns-1', publicKey: 'pk-abc' });
    const mero = createMero({ getNamespaceIdentity });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useNamespaceIdentity('ns-1'));

    await waitFor(() => {
      expect(result.current.identity?.publicKey).toBe('pk-abc');
    });

    expect(getNamespaceIdentity).toHaveBeenCalledWith('ns-1');
  });

  it('useNamespacesForApplication loads namespaces for an app', async () => {
    const listNamespacesForApplication = vi.fn().mockResolvedValue([
      { namespaceId: 'ns-1', appKey: 'k1', targetApplicationId: 'app-1', upgradePolicy: 'manual', createdAt: 1, memberCount: 1, contextCount: 0, subgroupCount: 0 },
    ]);
    const mero = createMero({ listNamespacesForApplication });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useNamespacesForApplication('app-1'));

    await waitFor(() => {
      expect(result.current.namespaces).toHaveLength(1);
      expect(result.current.namespaces[0]?.namespaceId).toBe('ns-1');
    });

    expect(listNamespacesForApplication).toHaveBeenCalledWith('app-1');
  });

  it('useNamespacesForApplication clears when applicationId becomes null', async () => {
    const mero = createMero({
      listNamespacesForApplication: vi.fn().mockResolvedValue([{ namespaceId: 'ns-1' }]),
    });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ appId }) => useNamespacesForApplication(appId),
      { initialProps: { appId: 'app-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.namespaces).toHaveLength(1);
    });

    rerender({ appId: null });

    await waitFor(() => {
      expect(result.current.namespaces).toEqual([]);
    });
  });

  it('useCreateNamespace creates a namespace', async () => {
    const createNamespace = vi.fn().mockResolvedValue({ namespaceId: 'ns-9' });
    const mero = createMero({ createNamespace });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useCreateNamespace());

    await act(async () => {
      const created = await result.current.createNamespace({
        applicationId: 'app-1',
        upgradePolicy: 'manual',
        alias: 'My Namespace',
      });
      expect(created).toEqual({ namespaceId: 'ns-9' });
    });

    expect(createNamespace).toHaveBeenCalledWith({
      applicationId: 'app-1',
      upgradePolicy: 'manual',
      alias: 'My Namespace',
    });
  });

  it('useDeleteNamespace deletes a namespace', async () => {
    const deleteNamespace = vi.fn().mockResolvedValue({ isDeleted: true });
    const mero = createMero({ deleteNamespace });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useDeleteNamespace());

    await act(async () => {
      const deleted = await result.current.deleteNamespace('ns-1');
      expect(deleted).toEqual({ isDeleted: true });
    });

    expect(deleteNamespace).toHaveBeenCalledWith('ns-1', undefined);
  });

  it('useCreateNamespaceInvitation creates an invitation', async () => {
    const invitation = {
      invitation: { invitation: { inviterIdentity: [], groupId: [], expirationTimestamp: 123, secretSalt: [] }, inviterSignature: 'sig-1' },
      groupAlias: 'test-ns',
    };
    const createNamespaceInvitation = vi.fn().mockResolvedValue(invitation);
    const mero = createMero({ createNamespaceInvitation });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useCreateNamespaceInvitation());

    await act(async () => {
      const inv = await result.current.createNamespaceInvitation('ns-1', { expirationTimestamp: 123 });
      expect(inv).toEqual(invitation);
    });

    expect(createNamespaceInvitation).toHaveBeenCalledWith('ns-1', { expirationTimestamp: 123 });
  });

  it('useJoinNamespace joins a namespace', async () => {
    const joinNamespace = vi.fn().mockResolvedValue({ groupId: 'ns-1', memberIdentity: 'member-2', governanceOp: 'MemberAdded' });
    const mero = createMero({ joinNamespace });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useJoinNamespace());

    await act(async () => {
      const joined = await result.current.joinNamespace('ns-1', {
        invitation: {
          invitation: { inviterIdentity: [], groupId: [], expirationTimestamp: 123, secretSalt: [] },
          inviterSignature: 'sig-1',
        },
      });
      if (!joined) {
        throw new Error('Expected namespace join result');
      }
      expect(joined.memberIdentity).toBe('member-2');
    });

    expect(joinNamespace).toHaveBeenCalledWith('ns-1', expect.objectContaining({
      invitation: expect.any(Object),
    }));
  });

  it('useCreateGroupInNamespace creates a group in a namespace', async () => {
    const createGroupInNamespace = vi.fn().mockResolvedValue({ groupId: 'group-9' });
    const mero = createMero({ createGroupInNamespace });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useCreateGroupInNamespace());

    await act(async () => {
      const created = await result.current.createGroupInNamespace('ns-1', { alias: 'Sub Group' });
      expect(created).toEqual({ groupId: 'group-9' });
    });

    expect(createGroupInNamespace).toHaveBeenCalledWith('ns-1', { alias: 'Sub Group' });
  });

  it('useNamespaceGroups loads groups for a namespace', async () => {
    const listNamespaceGroups = vi.fn().mockResolvedValue([
      { groupId: 'group-1', alias: 'Sub A' },
      { groupId: 'group-2' },
    ]);
    const mero = createMero({ listNamespaceGroups });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useNamespaceGroups('ns-1'));

    await waitFor(() => {
      expect(result.current.groups).toHaveLength(2);
      expect(result.current.groups[0]?.groupId).toBe('group-1');
    });

    expect(listNamespaceGroups).toHaveBeenCalledWith('ns-1');
  });

  it('useNamespaceGroups clears when namespaceId becomes null', async () => {
    const listNamespaceGroups = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ listNamespaceGroups });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ nsId }) => useNamespaceGroups(nsId),
      { initialProps: { nsId: 'ns-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ nsId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.groups).toEqual([]);
    });
  });

  // ---- Group Settings & Role Management ----

  it('useUpdateMemberRole updates a member role', async () => {
    const updateMemberRole = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ updateMemberRole });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useUpdateMemberRole());

    await act(async () => {
      await result.current.updateMemberRole('group-1', 'member-1', { role: 'Admin' });
    });

    expect(updateMemberRole).toHaveBeenCalledWith('group-1', 'member-1', { role: 'Admin' });
  });

  it('useSetDefaultCapabilities sets default capabilities for a group', async () => {
    const setDefaultCapabilities = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setDefaultCapabilities });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetDefaultCapabilities());

    await act(async () => {
      await result.current.setDefaultCapabilities('group-1', { defaultCapabilities: 15 });
    });

    expect(setDefaultCapabilities).toHaveBeenCalledWith('group-1', { defaultCapabilities: 15 });
  });

  it('useSetDefaultVisibility sets default visibility for a group', async () => {
    const setDefaultVisibility = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setDefaultVisibility });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetDefaultVisibility());

    await act(async () => {
      await result.current.setDefaultVisibility('group-1', { defaultVisibility: 'private' });
    });

    expect(setDefaultVisibility).toHaveBeenCalledWith('group-1', { defaultVisibility: 'private' });
  });

  it('useSetTeeAdmissionPolicy sets TEE policy for a group', async () => {
    const setTeeAdmissionPolicy = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setTeeAdmissionPolicy });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetTeeAdmissionPolicy());

    const policy = {
      allowedMrtd: ['mrtd-1'],
      allowedRtmr0: [],
      allowedRtmr1: [],
      allowedRtmr2: [],
      allowedRtmr3: [],
      allowedTcbStatuses: ['UpToDate'],
      acceptMock: false,
    };

    await act(async () => {
      await result.current.setTeeAdmissionPolicy('group-1', policy);
    });

    expect(setTeeAdmissionPolicy).toHaveBeenCalledWith('group-1', policy);
  });

  it('useUpdateGroupSettings updates group settings', async () => {
    const updateGroupSettings = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ updateGroupSettings });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useUpdateGroupSettings());

    await act(async () => {
      await result.current.updateGroupSettings('group-1', { upgradePolicy: 'auto' });
    });

    expect(updateGroupSettings).toHaveBeenCalledWith('group-1', { upgradePolicy: 'auto' });
  });

  it('useSetGroupAlias sets a group alias', async () => {
    const setGroupAlias = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setGroupAlias });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetGroupAlias());

    await act(async () => {
      await result.current.setGroupAlias('group-1', { alias: 'Lobby' });
    });

    expect(setGroupAlias).toHaveBeenCalledWith('group-1', { alias: 'Lobby' });
  });

  it('useSetMemberAlias sets a member alias', async () => {
    const setMemberAlias = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setMemberAlias });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetMemberAlias());

    await act(async () => {
      await result.current.setMemberAlias('group-1', 'member-1', { alias: 'Alice' });
    });

    expect(setMemberAlias).toHaveBeenCalledWith('group-1', 'member-1', { alias: 'Alice' });
  });

  // ---- Group Signing Key, Upgrades & Hierarchy ----

  it('useRegisterGroupSigningKey registers a signing key', async () => {
    const registerGroupSigningKey = vi.fn().mockResolvedValue({ publicKey: 'pk-new' });
    const mero = createMero({ registerGroupSigningKey });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useRegisterGroupSigningKey());

    await act(async () => {
      const res = await result.current.registerGroupSigningKey('group-1', { signingKey: 'sk-1' });
      expect(res).toEqual({ publicKey: 'pk-new' });
    });

    expect(registerGroupSigningKey).toHaveBeenCalledWith('group-1', { signingKey: 'sk-1' });
  });

  it('useUpgradeGroup initiates a group upgrade', async () => {
    const upgradeGroup = vi.fn().mockResolvedValue({ groupId: 'group-1', status: 'in_progress', total: 3 });
    const mero = createMero({ upgradeGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useUpgradeGroup());

    await act(async () => {
      const res = await result.current.upgradeGroup('group-1', { targetApplicationId: 'app-2' });
      expect(res?.status).toBe('in_progress');
    });

    expect(upgradeGroup).toHaveBeenCalledWith('group-1', { targetApplicationId: 'app-2' });
  });

  it('useGroupUpgradeStatus loads upgrade status', async () => {
    const getGroupUpgradeStatus = vi.fn().mockResolvedValue({
      fromVersion: '1.0',
      toVersion: '2.0',
      initiatedAt: 100,
      initiatedBy: 'member-1',
      status: 'in_progress',
      total: 3,
      completed: 1,
    });
    const mero = createMero({ getGroupUpgradeStatus });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupUpgradeStatus('group-1'));

    await waitFor(() => {
      expect(result.current.upgradeStatus?.status).toBe('in_progress');
      expect(result.current.upgradeStatus?.total).toBe(3);
    });

    expect(getGroupUpgradeStatus).toHaveBeenCalledWith('group-1');
  });

  it('useGroupUpgradeStatus clears when groupId becomes null', async () => {
    const getGroupUpgradeStatus = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getGroupUpgradeStatus });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId }) => useGroupUpgradeStatus(groupId),
      { initialProps: { groupId: 'group-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.upgradeStatus).toBeNull();
    });
  });

  it('useRetryGroupUpgrade retries a group upgrade', async () => {
    const retryGroupUpgrade = vi.fn().mockResolvedValue({ groupId: 'group-1', status: 'in_progress' });
    const mero = createMero({ retryGroupUpgrade });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useRetryGroupUpgrade());

    await act(async () => {
      const res = await result.current.retryGroupUpgrade('group-1');
      expect(res?.status).toBe('in_progress');
    });

    expect(retryGroupUpgrade).toHaveBeenCalledWith('group-1', undefined);
  });

  it('useNestGroup nests a child group', async () => {
    const nestGroup = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ nestGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useNestGroup());

    await act(async () => {
      await result.current.nestGroup('parent-1', { childGroupId: 'child-1' });
    });

    expect(nestGroup).toHaveBeenCalledWith('parent-1', { childGroupId: 'child-1' });
  });

  it('useUnnestGroup unnests a child group', async () => {
    const unnestGroup = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ unnestGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useUnnestGroup());

    await act(async () => {
      await result.current.unnestGroup('parent-1', { childGroupId: 'child-1' });
    });

    expect(unnestGroup).toHaveBeenCalledWith('parent-1', { childGroupId: 'child-1' });
  });

  it('useSubgroups loads subgroups for a group', async () => {
    const listSubgroups = vi.fn().mockResolvedValue([
      { groupId: 'child-1', alias: 'Sub A' },
      { groupId: 'child-2' },
    ]);
    const mero = createMero({ listSubgroups });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSubgroups('group-1'));

    await waitFor(() => {
      expect(result.current.subgroups).toHaveLength(2);
      expect(result.current.subgroups[0]?.groupId).toBe('child-1');
    });

    expect(listSubgroups).toHaveBeenCalledWith('group-1');
  });

  it('useSubgroups clears when groupId becomes null', async () => {
    const listSubgroups = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ listSubgroups });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId }) => useSubgroups(groupId),
      { initialProps: { groupId: 'group-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.subgroups).toEqual([]);
    });
  });

  // ---- Context-Group Relationship ----

  it('useDetachContextFromGroup detaches a context', async () => {
    const detachContextFromGroup = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ detachContextFromGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useDetachContextFromGroup());

    await act(async () => {
      await result.current.detachContextFromGroup('group-1', 'ctx-1');
    });

    expect(detachContextFromGroup).toHaveBeenCalledWith('group-1', 'ctx-1', undefined);
  });
});
