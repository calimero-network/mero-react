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
  useDefaultCapabilities,
  useDeleteContext,
  useDeleteGroup,
  useDeleteNamespace,
  useDetachContextFromGroup,
  useGroupCapabilities,
  useGroupContexts,
  useGroupInfo,
  useGroupInvitations,
  useGroupMembers,
  useGroupMetadata,
  useGroupUpgradeStatus,
  useJoinContext,
  useJoinGroup,
  useJoinNamespace,
  useJoinSubgroupInheritance,
  useMemberMetadata,
  useNamespace,
  useNamespaceGroups,
  useNamespaceIdentity,
  useNamespaces,
  useNamespacesForApplication,
  useReparentGroup,
  useRegisterGroupSigningKey,
  useRetryGroupUpgrade,
  useSetContextMetadata,
  useSetDefaultCapabilities,
  useSetGroupMetadata,
  useSetMemberMetadata,
  useSetSubgroupVisibility,
  useSetTeeAdmissionPolicy,
  useSubgroups,
  useSubgroupVisibility,
  useUpdateMemberRole,
  useUpgradeGroup,
  useResyncContext,
  useAddGroupMembers,
  useRemoveGroupMembers,
  useSyncGroup,
  useMigrationStatus,
  useAppVersion,
  useLatestVersion,
  useGroupAppVersion,
  useInstallFromRegistry,
  useMyAuthoredMigration,
} from './index';
import { useMero } from '../context';

vi.mock('../context', () => ({
  useMero: vi.fn(),
}));

const mockUseMero = vi.mocked(useMero);

function createMero(
  adminOverrides: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  return {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        id: 'ctx-1',
        applicationId: 'app-1',
        rootHash: 'rh',
        dagHeads: [],
        applicationVersion: '1.0.0',
      }),
      getMigrationStatus: vi.fn().mockResolvedValue({
        targetVersion: 2,
        expectedMembers: 0,
        rollup: { migrated: 0, inProgress: 0, unknown: 0, failed: 0, total: 0, allMigrated: true, membersPendingSignature: 0 },
        members: [],
      }),
      getRegistryVersions: vi.fn().mockResolvedValue(['2.0.0', '1.0.0']),
      getCascadeStatus: vi.fn().mockResolvedValue([]),
      getContexts: vi.fn().mockResolvedValue({ contexts: [] }),
      getContextsForApplication: vi.fn().mockResolvedValue({ contexts: [] }),
      createContext: vi.fn().mockResolvedValue({ contextId: 'ctx-1', memberPublicKey: 'pk-1' }),
      deleteContext: vi.fn().mockResolvedValue({ isDeleted: true }),
      joinContext: vi.fn().mockResolvedValue({ contextId: 'ctx-1', memberPublicKey: 'pk-1' }),
      getContextGroup: vi.fn().mockResolvedValue('group-hex-id'),
      listGroupMembers: vi.fn().mockResolvedValue({ members: [] }),
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
        subgroupVisibility: 'open',
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
      joinSubgroupInheritance: vi.fn().mockResolvedValue({
        groupId: 'group-1',
        memberPublicKey: 'pk-1',
        wasInherited: true,
      }),
      getMemberCapabilities: vi.fn().mockResolvedValue({ capabilities: 7 }),
      setMemberCapabilities: vi.fn().mockResolvedValue(undefined),
      updateMemberRole: vi.fn().mockResolvedValue(undefined),
      setDefaultCapabilities: vi.fn().mockResolvedValue(undefined),
      setSubgroupVisibility: vi.fn().mockResolvedValue(undefined),
      setTeeAdmissionPolicy: vi.fn().mockResolvedValue(undefined),
      updateGroupSettings: vi.fn().mockResolvedValue(undefined),
      setGroupMetadata: vi.fn().mockResolvedValue(undefined),
      getGroupMetadata: vi.fn().mockResolvedValue(null),
      setMemberMetadata: vi.fn().mockResolvedValue(undefined),
      getMemberMetadata: vi.fn().mockResolvedValue(null),
      setContextMetadata: vi.fn().mockResolvedValue(undefined),
      getContextMetadata: vi.fn().mockResolvedValue(null),
      getDefaultCapabilities: vi.fn().mockResolvedValue(7),
      getSubgroupVisibility: vi.fn().mockResolvedValue('open'),
      registerGroupSigningKey: vi.fn().mockResolvedValue({ publicKey: 'pk-1' }),
      upgradeGroup: vi.fn().mockResolvedValue({ groupId: 'group-1', status: 'in_progress' }),
      installFromRegistry: vi.fn().mockResolvedValue({ applicationId: 'app-1' }),
      getApplication: vi.fn().mockResolvedValue({
        application: {
          id: 'app-1',
          blob: { bytecode: 'CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB', compiled: '' },
          size: 0,
          source: '',
          metadata: [],
          signer_id: '',
          package: 'com.acme.app',
          version: '1.0.0',
        },
      }),
      resyncContext: vi.fn().mockResolvedValue({ contextId: 'ctx-1', resyncStarted: true }),
      getGroupUpgradeStatus: vi.fn().mockResolvedValue(null),
      retryGroupUpgrade: vi.fn().mockResolvedValue({ groupId: 'group-1', status: 'in_progress' }),
      reparentGroup: vi.fn().mockResolvedValue({ reparented: true }),
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
        groupName: 'test-ns',
      }),
      joinNamespace: vi.fn().mockResolvedValue({ groupId: 'ns-1', memberIdentity: 'member-1', governanceOp: 'MemberAdded' }),
      createGroupInNamespace: vi.fn().mockResolvedValue({ groupId: 'group-1' }),
      listNamespaceGroups: vi.fn().mockResolvedValue([]),
      ...adminOverrides,
    },
    ...extra,
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
        members: [{ identity: 'member-1', role: 'Admin' }],
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
        groupName: 'Lobby',
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

  it('useJoinSubgroupInheritance materialises inherited membership', async () => {
    const joinSubgroupInheritance = vi
      .fn()
      .mockResolvedValue({ groupId: 'g-1', memberPublicKey: 'pk-1', wasInherited: true });
    const mero = createMero({ joinSubgroupInheritance });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useJoinSubgroupInheritance());

    await act(async () => {
      const joined = await result.current.joinSubgroupInheritance('g-1');
      expect(joined).toEqual({ groupId: 'g-1', memberPublicKey: 'pk-1', wasInherited: true });
    });

    expect(joinSubgroupInheritance).toHaveBeenCalledWith('g-1');
  });

  it('useJoinSubgroupInheritance returns wasInherited=false on direct-member no-op', async () => {
    const joinSubgroupInheritance = vi
      .fn()
      .mockResolvedValue({ groupId: 'g-2', memberPublicKey: 'pk-2', wasInherited: false });
    const mero = createMero({ joinSubgroupInheritance });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useJoinSubgroupInheritance());

    await act(async () => {
      const joined = await result.current.joinSubgroupInheritance('g-2');
      expect(joined?.wasInherited).toBe(false);
    });

    expect(joinSubgroupInheritance).toHaveBeenCalledWith('g-2');
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
        subgroupVisibility: 'open',
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
        upgradePolicy: 'LazyOnAccess',
        name: 'My Namespace',
      });
      expect(created).toEqual({ namespaceId: 'ns-9' });
    });

    expect(createNamespace).toHaveBeenCalledWith({
      applicationId: 'app-1',
      upgradePolicy: 'LazyOnAccess',
      name: 'My Namespace',
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
      groupName: 'test-ns',
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
      const created = await result.current.createGroupInNamespace('ns-1', { name: 'Sub Group' });
      expect(created).toEqual({ groupId: 'group-9' });
    });

    expect(createGroupInNamespace).toHaveBeenCalledWith('ns-1', { name: 'Sub Group' });
  });

  it('useNamespaceGroups loads groups for a namespace', async () => {
    const listNamespaceGroups = vi.fn().mockResolvedValue([
      { groupId: 'group-1', name: 'Sub A' },
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

  it('useSetSubgroupVisibility sets subgroup visibility for a group', async () => {
    const setSubgroupVisibility = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setSubgroupVisibility });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetSubgroupVisibility());

    await act(async () => {
      await result.current.setSubgroupVisibility('group-1', { subgroupVisibility: 'Restricted' });
    });

    expect(setSubgroupVisibility).toHaveBeenCalledWith('group-1', { subgroupVisibility: 'Restricted' });
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

  // ---- Metadata Hooks ----

  it('useSetGroupMetadata sets group metadata', async () => {
    const setGroupMetadata = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setGroupMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetGroupMetadata());

    await act(async () => {
      await result.current.setGroupMetadata('group-1', { name: 'Lobby', data: { color: 'blue' } });
    });

    expect(setGroupMetadata).toHaveBeenCalledWith('group-1', { name: 'Lobby', data: { color: 'blue' } });
  });

  it('useSetGroupMetadata surfaces errors', async () => {
    const setGroupMetadata = vi.fn().mockRejectedValue(new Error('nope'));
    const mero = createMero({ setGroupMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetGroupMetadata());

    await act(async () => {
      await result.current.setGroupMetadata('group-1', { name: 'Lobby' });
    });

    expect(result.current.error?.message).toBe('nope');
  });

  it('useSetMemberMetadata sets member metadata', async () => {
    const setMemberMetadata = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setMemberMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetMemberMetadata());

    await act(async () => {
      await result.current.setMemberMetadata('group-1', 'member-1', { name: 'Alice' });
    });

    expect(setMemberMetadata).toHaveBeenCalledWith('group-1', 'member-1', { name: 'Alice' });
  });

  it('useSetContextMetadata sets context metadata', async () => {
    const setContextMetadata = vi.fn().mockResolvedValue(undefined);
    const mero = createMero({ setContextMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSetContextMetadata());

    await act(async () => {
      await result.current.setContextMetadata('group-1', 'ctx-1', { data: { k: 'v' } });
    });

    expect(setContextMetadata).toHaveBeenCalledWith('group-1', 'ctx-1', { data: { k: 'v' } });
  });

  it('useGroupMetadata loads group metadata', async () => {
    const record = { name: 'Lobby', data: { color: 'blue' }, updatedAt: 1, updatedBy: 'member-1' };
    const getGroupMetadata = vi.fn().mockResolvedValue(record);
    const mero = createMero({ getGroupMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupMetadata('group-1'));

    await waitFor(() => {
      expect(result.current.metadata).toEqual(record);
    });

    expect(getGroupMetadata).toHaveBeenCalledWith('group-1');
  });

  it('useGroupMetadata clears when groupId becomes null', async () => {
    const getGroupMetadata = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getGroupMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId }) => useGroupMetadata(groupId),
      { initialProps: { groupId: 'group-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.metadata).toBeNull();
    });
  });

  it('useMemberMetadata loads member metadata', async () => {
    const record = { name: 'Alice', data: {}, updatedAt: 2, updatedBy: 'member-1' };
    const getMemberMetadata = vi.fn().mockResolvedValue(record);
    const mero = createMero({ getMemberMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useMemberMetadata('group-1', 'member-1'));

    await waitFor(() => {
      expect(result.current.metadata).toEqual(record);
    });

    expect(getMemberMetadata).toHaveBeenCalledWith('group-1', 'member-1');
  });

  it('useMemberMetadata clears when identity becomes null', async () => {
    const getMemberMetadata = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getMemberMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId, identity }) => useMemberMetadata(groupId, identity),
      { initialProps: { groupId: 'group-1' as string | null, identity: 'member-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: 'group-1', identity: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.metadata).toBeNull();
    });
  });

  it('useMemberMetadata refetch() awaits the fetch (state ready after the promise resolves)', async () => {
    // Regression for the original cursor[bot] concern on #24: an
    // earlier draft of this PR had refetch() bump a tick and resolve
    // immediately — callers that do `await refetch()` and then read
    // state would see the OLD value. Production caller
    // `useMemberDisplayName.setName` does exactly that. This asserts
    // the state has been written by the time the promise resolves.
    let resolveSecond: (record: typeof recordA) => void = () => {};
    const recordA = { name: 'Alice', data: {}, updatedAt: 1, updatedBy: 'm-1' };
    const recordB = { name: 'Alice Renamed', data: {}, updatedAt: 2, updatedBy: 'm-1' };
    const getMemberMetadata = vi
      .fn()
      .mockResolvedValueOnce(recordA)
      .mockImplementationOnce(
        () =>
          new Promise<typeof recordA>((r) => {
            resolveSecond = r;
          }),
      );
    const mero = createMero({ getMemberMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useMemberMetadata('group-1', 'member-1'));
    await waitFor(() => {
      expect(result.current.metadata).toEqual(recordA);
    });

    let awaitedDone = false;
    await act(async () => {
      const p = result.current.refetch();
      // resolve the in-flight fetch BEFORE the await sees it. The
      // promise must not resolve until state has been written.
      resolveSecond(recordB);
      await p;
      awaitedDone = true;
    });
    expect(awaitedDone).toBe(true);
    expect(result.current.metadata).toEqual(recordB);
  });

  it('useMemberMetadata re-fetches on remount (regression: settings close→reopen)', async () => {
    // Repro for the mero-drive #42 / playwright "display-name input
    // stays empty on settings reopen" failure: under StrictMode-like
    // mount/unmount cycles, the prior mountedRef-gated implementation
    // could drop both setState calls when the first mount's pending
    // fetch landed during cleanup, leaving the second mount stuck on
    // `metadata = null` forever. The auto-fetch effect must fire
    // unconditionally for each fresh hook instance.
    const record = { name: 'Alice', data: {}, updatedAt: 2, updatedBy: 'member-1' };
    const getMemberMetadata = vi.fn().mockResolvedValue(record);
    const mero = createMero({ getMemberMetadata });
    mockUseMero.mockReturnValue({ mero } as never);

    const first = renderHook(() => useMemberMetadata('group-1', 'member-1'));
    await waitFor(() => {
      expect(first.result.current.metadata).toEqual(record);
    });
    first.unmount();

    // Second mount with the same params — must trigger a fresh fetch
    // and end up with the same record in state.
    const second = renderHook(() => useMemberMetadata('group-1', 'member-1'));
    await waitFor(() => {
      expect(second.result.current.metadata).toEqual(record);
    });

    // Both mounts each fire one fetch — proves the second mount's
    // auto-effect actually ran (not just inherited stale state).
    expect(getMemberMetadata.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('useDefaultCapabilities loads default capabilities for a group', async () => {
    const getDefaultCapabilities = vi.fn().mockResolvedValue(15);
    const mero = createMero({ getDefaultCapabilities });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useDefaultCapabilities('group-1'));

    await waitFor(() => {
      expect(result.current.defaultCapabilities).toBe(15);
    });

    expect(getDefaultCapabilities).toHaveBeenCalledWith('group-1');
  });

  it('useDefaultCapabilities clears when groupId becomes null', async () => {
    const getDefaultCapabilities = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getDefaultCapabilities });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId }) => useDefaultCapabilities(groupId),
      { initialProps: { groupId: 'group-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.defaultCapabilities).toBeNull();
    });
  });

  it('useSubgroupVisibility loads subgroup visibility for a group', async () => {
    const getSubgroupVisibility = vi.fn().mockResolvedValue('Restricted');
    const mero = createMero({ getSubgroupVisibility });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useSubgroupVisibility('group-1'));

    await waitFor(() => {
      expect(result.current.subgroupVisibility).toBe('Restricted');
    });

    expect(getSubgroupVisibility).toHaveBeenCalledWith('group-1');
  });

  it('useSubgroupVisibility clears when groupId becomes null', async () => {
    const getSubgroupVisibility = vi.fn().mockRejectedValue(new Error('boom'));
    const mero = createMero({ getSubgroupVisibility });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ groupId }) => useSubgroupVisibility(groupId),
      { initialProps: { groupId: 'group-1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe('boom');
    });

    rerender({ groupId: null });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.subgroupVisibility).toBeNull();
    });
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

  it('useInstallFromRegistry installs a package version and toggles loading', async () => {
    let resolveInstall: (v: { applicationId: string }) => void = () => {};
    const installFromRegistry = vi
      .fn()
      .mockReturnValue(new Promise<{ applicationId: string }>((r) => { resolveInstall = r; }));
    const mero = createMero({ installFromRegistry });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useInstallFromRegistry());
    expect(result.current.loading).toBe(false);

    let installed: { applicationId: string } | null = null;
    act(() => {
      void result.current
        .installFromRegistry('https://registry.example.com', 'com.acme.app', '2.0.0')
        .then((v) => { installed = v; });
    });
    // loading flips true synchronously while the install is in flight
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveInstall({ applicationId: 'app-2' });
    });

    expect(installed).toEqual({ applicationId: 'app-2' });
    expect(installFromRegistry).toHaveBeenCalledWith(
      'https://registry.example.com',
      'com.acme.app',
      '2.0.0',
    );
    expect(result.current.loading).toBe(false);
  });

  it('useResyncContext kicks off a context re-pull', async () => {
    const resyncContext = vi.fn().mockResolvedValue({ contextId: 'ctx-1', resyncStarted: true });
    const mero = createMero({ resyncContext });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useResyncContext());

    await act(async () => {
      const res = await result.current.resyncContext('ctx-1', { force: true });
      expect(res?.resyncStarted).toBe(true);
    });

    expect(resyncContext).toHaveBeenCalledWith('ctx-1', { force: true });
  });

  it('useResyncContext defaults to an empty request', async () => {
    const resyncContext = vi.fn().mockResolvedValue({ contextId: 'ctx-1', resyncStarted: false });
    const mero = createMero({ resyncContext });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useResyncContext());

    await act(async () => {
      await result.current.resyncContext('ctx-1');
    });

    expect(resyncContext).toHaveBeenCalledWith('ctx-1', {});
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

  it('useReparentGroup moves a child group under a new parent', async () => {
    const reparentGroup = vi.fn().mockResolvedValue({ reparented: true });
    const mero = createMero({ reparentGroup });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useReparentGroup());

    let res: { reparented: boolean } | null = null;
    await act(async () => {
      res = await result.current.reparentGroup('child-1', { newParentId: 'parent-2' });
    });

    expect(reparentGroup).toHaveBeenCalledWith('child-1', { newParentId: 'parent-2' });
    expect(res).toEqual({ reparented: true });
  });

  it('useSubgroups loads subgroups for a group', async () => {
    const listSubgroups = vi.fn().mockResolvedValue([
      { groupId: 'child-1', name: 'Sub A' },
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

describe('useMigrationStatus', () => {
  it('exposes the rollup, members, and derived counters', async () => {
    const getMigrationStatus = vi.fn().mockResolvedValue({
      targetVersion: 2,
      expectedMembers: 3,
      rollup: { migrated: 2, inProgress: 0, unknown: 1, total: 3, allMigrated: false, membersPendingSignature: 1 },
      members: [
        { peer: 'aa', report: { schemaVersion: 2, residueAuto: 0, residueIdentity: 0, syncedUpToHlc: 0, reportedAt: 0, authoredRemaining: 0 }, state: 'migrated' },
        { peer: 'bb', report: { schemaVersion: 1, residueAuto: 0, residueIdentity: 0, syncedUpToHlc: 0, reportedAt: 0, authoredRemaining: 2 }, state: 'in_progress' },
        { peer: 'cc', report: null, state: 'unknown' },
      ],
    });
    const mero = createMero({ getMigrationStatus });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useMigrationStatus('ns1'));

    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current.membersPendingSignature).toBe(1);
    expect(result.current.members).toHaveLength(3);
    expect(result.current.allMigrated).toBe(false);
    expect(getMigrationStatus).toHaveBeenCalledWith('ns1');
  });

  it('does not fetch when namespaceId is null', async () => {
    const getMigrationStatus = vi.fn();
    const mero = createMero({ getMigrationStatus });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useMigrationStatus(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBeNull();
    expect(getMigrationStatus).not.toHaveBeenCalled();
  });

  it('polls at the default interval when none is provided', async () => {
    vi.useFakeTimers();
    try {
      const getMigrationStatus = vi.fn().mockResolvedValue({
        targetVersion: 2,
        expectedMembers: 1,
        rollup: { migrated: 0, inProgress: 1, unknown: 0, failed: 0, total: 1, allMigrated: false, membersPendingSignature: 0 },
        members: [],
      });
      const mero = createMero({ getMigrationStatus });
      mockUseMero.mockReturnValue({ mero } as never);

      renderHook(() => useMigrationStatus('ns1'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getMigrationStatus).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(getMigrationStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useAppVersion', () => {
  it('reports stale when the installed version differs from expected', async () => {
    const mero = createMero(
      { getContext: vi.fn().mockResolvedValue({ id: 'ctx1', applicationId: 'a', rootHash: 'r', dagHeads: [], applicationVersion: '1.0.0' }) },
      { events: { onAppVersionChanged: vi.fn(() => () => {}) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useAppVersion('ctx1', '2.0.0'));
    await waitFor(() => expect(result.current.appVersion).toBe('1.0.0'));
    expect(result.current.isStale).toBe(true);
  });

  it('is not stale when versions match', async () => {
    const mero = createMero(
      { getContext: vi.fn().mockResolvedValue({ id: 'ctx1', applicationId: 'a', rootHash: 'r', dagHeads: [], applicationVersion: '2.0.0' }) },
      { events: { onAppVersionChanged: vi.fn(() => () => {}) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useAppVersion('ctx1', '2.0.0'));
    await waitFor(() => expect(result.current.appVersion).toBe('2.0.0'));
    expect(result.current.isStale).toBe(false);
  });

  it('updates appVersion live from an AppVersionChanged event', async () => {
    let captured: ((e: { contextId: string; toVersion?: string }) => void) | null = null;
    const mero = createMero(
      { getContext: vi.fn().mockResolvedValue({ id: 'ctx1', applicationId: 'a', rootHash: 'r', dagHeads: [], applicationVersion: '1.0.0' }) },
      { events: { onAppVersionChanged: vi.fn((cb: (e: { contextId: string; toVersion?: string }) => void) => { captured = cb; return () => {}; }) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useAppVersion('ctx1', '2.0.0'));
    await waitFor(() => expect(result.current.appVersion).toBe('1.0.0'));

    act(() => captured?.({ contextId: 'ctx1', toVersion: '2.0.0' }));
    expect(result.current.appVersion).toBe('2.0.0');
    expect(result.current.isStale).toBe(false);
  });
});

describe('useLatestVersion', () => {
  it('flags an available update when the registry is ahead of the running version', async () => {
    const getRegistryVersions = vi.fn().mockResolvedValue(['2.0.0', '1.0.0']);
    const mero = createMero({ getRegistryVersions });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() =>
      useLatestVersion('https://registry.example.com', 'com.acme.app', '1.0.0'),
    );
    await waitFor(() => expect(result.current.latestVersion).toBe('2.0.0'));
    expect(result.current.updateAvailable).toBe(true);
    expect(getRegistryVersions).toHaveBeenCalledWith('https://registry.example.com', 'com.acme.app');
  });

  it('reports no update when the running version is already the latest', async () => {
    const getRegistryVersions = vi.fn().mockResolvedValue(['2.0.0', '1.0.0']);
    const mero = createMero({ getRegistryVersions });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() =>
      useLatestVersion('https://registry.example.com', 'com.acme.app', '2.0.0'),
    );
    await waitFor(() => expect(result.current.latestVersion).toBe('2.0.0'));
    expect(result.current.updateAvailable).toBe(false);
  });

  it('does not fetch until registry and package are provided', async () => {
    const getRegistryVersions = vi.fn().mockResolvedValue(['2.0.0']);
    const mero = createMero({ getRegistryVersions });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useLatestVersion(null, null, '1.0.0'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getRegistryVersions).not.toHaveBeenCalled();
    expect(result.current.updateAvailable).toBe(false);
  });

  it('a late fetch does not repopulate versions after the package is cleared', async () => {
    // Hang the fetch so we can clear the inputs while it is in flight.
    let resolveFetch: (v: string[]) => void = () => {};
    const getRegistryVersions = vi
      .fn()
      .mockReturnValue(new Promise<string[]>((r) => { resolveFetch = r; }));
    const mero = createMero({ getRegistryVersions });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result, rerender } = renderHook(
      ({ pkg }: { pkg: string | null }) =>
        useLatestVersion('https://registry.example.com', pkg, '1.0.0'),
      { initialProps: { pkg: 'com.acme.app' as string | null } },
    );
    await waitFor(() => expect(getRegistryVersions).toHaveBeenCalled());

    // Caller clears the package before the in-flight request resolves.
    rerender({ pkg: null });

    // The stale response arrives late — it must NOT restore the old versions.
    await act(async () => {
      resolveFetch(['2.0.0', '1.0.0']);
    });
    expect(result.current.versions).toEqual([]);
    expect(result.current.latestVersion).toBeNull();
    expect(result.current.updateAvailable).toBe(false);
  });
});

describe('useGroupAppVersion', () => {
  // base58 blob ids for 32-byte 0xaa.. / 0xbb.. (see base58.test.ts vectors).
  const BLOB_AA = 'CVDFLCAjXhVWiPXH9nTCTpCgVzmDVoiPzNJYuccr1dqB';
  const BLOB_BB = 'DdqGmK5uamYN5vmuZrzpQhKeehLdwtPLVJdhu5P2iJKC';
  const KEY_AA = 'aa'.repeat(32);

  function namespace(appKey: string) {
    return {
      namespaceId: 'group-1',
      appKey,
      targetApplicationId: 'app-1',
      upgradePolicy: 'LazyOnAccess',
      createdAt: 1,
      memberCount: 1,
      contextCount: 0,
      subgroupCount: 0,
    };
  }

  function application(bytecode: string, version = '1.0.0') {
    return {
      application: {
        id: 'app-1',
        blob: { bytecode, compiled: '' },
        size: 0,
        source: '',
        metadata: [],
        signer_id: '',
        package: 'com.acme.app',
        version,
      },
    };
  }

  it('reports no pending apply when appKey matches the installed blob', async () => {
    const mero = createMero(
      {
        listNamespaces: vi.fn().mockResolvedValue([namespace(KEY_AA)]),
        getApplication: vi.fn().mockResolvedValue(application(BLOB_AA, '2.1.0')),
      },
      { events: { onAppVersionChanged: vi.fn(() => () => {}) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupAppVersion('group-1'));

    await waitFor(() => expect(result.current.version).toBe('2.1.0'));
    expect(result.current.applicationId).toBe('app-1');
    expect(result.current.pendingApply).toBe(false);
    expect(result.current.activeUpgrade).toBeNull();
    expect(mero.admin.getApplication).toHaveBeenCalledWith('app-1');
  });

  it('reports a pending apply when appKey differs from the installed blob', async () => {
    const mero = createMero(
      {
        listNamespaces: vi.fn().mockResolvedValue([namespace(KEY_AA)]),
        getApplication: vi.fn().mockResolvedValue(application(BLOB_BB)),
      },
      { events: { onAppVersionChanged: vi.fn(() => () => {}) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupAppVersion('group-1'));

    await waitFor(() => expect(result.current.pendingApply).toBe(true));
    expect(result.current.version).toBe('1.0.0');
  });

  it('treats a zeroed appKey as carrying no pending signal', async () => {
    const mero = createMero(
      {
        listNamespaces: vi.fn().mockResolvedValue([namespace('00'.repeat(32))]),
        getApplication: vi.fn().mockResolvedValue(application(BLOB_BB)),
      },
      { events: { onAppVersionChanged: vi.fn(() => () => {}) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupAppVersion('group-1'));

    await waitFor(() => expect(result.current.version).toBe('1.0.0'));
    expect(result.current.pendingApply).toBe(false);
  });

  it('falls back to getGroupInfo when the id is not a namespace, surfacing activeUpgrade', async () => {
    const activeUpgrade = {
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      initiatedAt: 100,
      initiatedBy: 'member-1',
      status: 'in_progress',
    };
    const getGroupInfo = vi.fn().mockResolvedValue({
      groupId: 'sub-1',
      appKey: KEY_AA,
      targetApplicationId: 'app-1',
      upgradePolicy: 'Automatic',
      memberCount: 2,
      contextCount: 1,
      defaultCapabilities: 7,
      subgroupVisibility: 'open',
      activeUpgrade,
    });
    const mero = createMero(
      {
        listNamespaces: vi.fn().mockResolvedValue([]),
        getGroupInfo,
        getApplication: vi.fn().mockResolvedValue(application(BLOB_AA)),
      },
      { events: { onAppVersionChanged: vi.fn(() => () => {}) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupAppVersion('sub-1'));

    await waitFor(() => expect(result.current.activeUpgrade).toEqual(activeUpgrade));
    expect(getGroupInfo).toHaveBeenCalledWith('sub-1');
    expect(result.current.pendingApply).toBe(false);
  });

  it('does not fetch when groupId is undefined', async () => {
    const listNamespaces = vi.fn();
    const mero = createMero(
      { listNamespaces },
      { events: { onAppVersionChanged: vi.fn(() => () => {}) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupAppVersion(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listNamespaces).not.toHaveBeenCalled();
    expect(result.current.version).toBeNull();
  });

  it('refetches when an AppVersionChanged event fires', async () => {
    let captured: (() => void) | null = null;
    const listNamespaces = vi.fn().mockResolvedValue([namespace(KEY_AA)]);
    const mero = createMero(
      { listNamespaces, getApplication: vi.fn().mockResolvedValue(application(BLOB_AA)) },
      { events: { onAppVersionChanged: vi.fn((cb: () => void) => { captured = cb; return () => {}; }) } },
    );
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useGroupAppVersion('group-1'));
    await waitFor(() => expect(result.current.version).toBe('1.0.0'));
    expect(listNamespaces).toHaveBeenCalledTimes(1);

    await act(async () => {
      captured?.();
    });

    await waitFor(() => expect(listNamespaces).toHaveBeenCalledTimes(2));
  });
});

describe('useMyAuthoredMigration', () => {
  it('reports pending from countMyPending and clears after authorize', async () => {
    const countMyPending = vi.fn().mockResolvedValue(2);
    const migrateMyEntries = vi.fn().mockResolvedValue({ converted: 2, remaining: 0 });
    const mero = createMero({}, { rpc: { countMyPending, migrateMyEntries } });
    mockUseMero.mockReturnValue({ mero } as never);

    const { result } = renderHook(() => useMyAuthoredMigration('ctx1'));
    await waitFor(() => expect(result.current.pending).toBe(true));
    expect(result.current.pendingCount).toBe(2);

    await act(async () => {
      await result.current.authorize();
    });

    expect(migrateMyEntries).toHaveBeenCalledWith('ctx1');
    expect(result.current.summary).toEqual({ converted: 2, remaining: 0 });
    expect(result.current.pending).toBe(false);
    expect(result.current.pendingCount).toBe(0);
  });
});
