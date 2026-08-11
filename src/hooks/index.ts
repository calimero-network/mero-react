import { useState, useCallback, useEffect, useRef } from 'react';
import { compareSemver } from '@calimero-network/mero-js';
import { useMero } from '../context';
import { base58ToHex } from '../utils/base58';
import type {
  Context,
  CreateContextRequest,
  CreateGroupInvitationRequest,
  CreateGroupInNamespaceRequest,
  CreateNamespaceInvitationRequest,
  CreateNamespaceInvitationResponseData,
  CreateNamespaceRequest,
  CreateRecursiveInvitationResponseData,
  DeleteGroupRequest,
  DeleteNamespaceRequest,
  DetachContextFromGroupRequest,
  GroupContextEntry,
  GroupInfo,
  GroupUpgradeStatusResponseData,
  MetadataRecord,
  JoinGroupRequest,
  JoinNamespaceRequest,
  ListGroupMembersResponseData,
  Namespace,
  NamespaceIdentity,
  ReparentGroupRequest,
  AddGroupMembersRequest,
  RegisterGroupSigningKeyRequest,
  RemoveGroupMembersRequest,
  RetryGroupUpgradeRequest,
  SetDefaultCapabilitiesRequest,
  SetMetadataRequest,
  SetSubgroupVisibilityRequest,
  SetTeeAdmissionPolicyRequest,
  SubgroupEntry,
  SyncGroupRequest,
  SseEventData,
  UpdateMemberRoleRequest,
  UpgradeGroupRequest,
  ResyncContextRequest,
  MigrationStatus,
  MemberMigrationStatusEntry,
  MigrationStatusRollup,
  MigrateMyEntriesSummary,
  AppVersionChangedEvent,
  GroupMembershipEventData,
} from '@calimero-network/mero-js';
import type {
  ApplicationContextRecord,
  ContextDiscoveryOptions,
  ContextDiscoveryState,
} from '../types';

export { useMero } from '../context';

/**
 * Shape accepted by the metadata-setter hooks — re-exported from mero-js so
 * callers have one canonical type. A `set*Metadata` call **replaces the whole
 * record**: `data` defaults to `{}` and wholly replaces the stored map; omit
 * `name` to keep the current name.
 */
export type SetMetadataInput = SetMetadataRequest;

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function mapApplicationContexts(contexts: Context[]): ApplicationContextRecord[] {
  return contexts.map((context) => ({
    contextId: context.id,
    applicationId: context.applicationId,
  }));
}

function useMountedRef() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}

function useAsyncMutation() {
  const mountedRef = useMountedRef();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      try {
        return await action();
      } catch (err) {
        const errorValue = toError(err);
        if (mountedRef.current) {
          setError(errorValue);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [mountedRef],
  );

  return { loading, error, run, setError };
}

/**
 * Generic read resource: fetch + loading/error/data with a latest-request-wins
 * guard. `fetcher` is null when the read is disabled (missing args) — the
 * resource resets to `initialValue` and nothing is fetched. `deps` drive both
 * the refetch and a synchronous reset when they change, so a slow earlier
 * request can never overwrite a newer one. This is the staleness guard the read
 * hooks used to hand-roll (and mostly lacked), now in one place.
 */
function useAsyncResource<T>(
  fetcher: (() => Promise<T>) | null,
  initialValue: T,
  deps: readonly unknown[],
): { data: T; loading: boolean; error: Error | null; refetch: () => Promise<void> } {
  const mountedRef = useMountedRef();
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const reqRef = useRef(0);

  // fetcherRef is refreshed every render so refetch() always calls the latest
  // closure; initialRef captures the (per-hook constant) initial value once.
  // Neither is a dependency — adding them would break latest-request-wins.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const initialRef = useRef(initialValue);

  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    const fn = fetcherRef.current;
    if (!fn) {
      if (mountedRef.current && seq === reqRef.current) {
        setData(initialRef.current);
        setError(null);
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await fn();
      if (mountedRef.current && seq === reqRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current && seq === reqRef.current) setError(toError(err));
    } finally {
      if (mountedRef.current && seq === reqRef.current) setLoading(false);
    }
  }, deps);

  // Invalidate any in-flight request and clear stale data synchronously when
  // the inputs change, so a pending response for old deps can't land later.
  useEffect(() => {
    reqRef.current += 1;
    setData(initialRef.current);
    setError(null);
  }, deps);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractAliasContextId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  if ('value' in value && typeof value.value === 'string') {
    return value.value;
  }

  if ('contextId' in value && typeof value.contextId === 'string') {
    return value.contextId;
  }

  return null;
}

/**
 * Execute RPC methods against a context.
 * Tracks loading/error state. Unmount-safe.
 */
export function useExecute(contextId: string | null, executorId: string | null) {
  const { mero } = useMero();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const execute = useCallback(
    async <T = unknown>(method: string, params?: Record<string, unknown>): Promise<T | null> => {
      if (!mero || !contextId || !executorId) {
        if (mountedRef.current) setError(new Error('Not connected'));
        return null;
      }

      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await mero.rpc.execute<T>({
          contextId,
          method,
          argsJson: params,
          executorPublicKey: executorId,
        });
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(e);
        return null;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [mero, contextId, executorId],
  );

  return { execute, loading, error };
}

/** Event payload delivered to a `useSubscription` callback. */
export type SubscriptionEventData = SseEventData | GroupMembershipEventData;

/** Ids to subscribe to. Either can be omitted, but not both. */
export interface SubscriptionInput {
  contextIds?: string[];
  groupIds?: string[];
}

/**
 * Subscribe to SSE events for context and/or group IDs.
 * StrictMode-safe: tracks the SseClient instance in a ref to avoid
 * double-connect on mount/unmount/remount cycles.
 */
export function useSubscription(
  contextIds: string[],
  callback: (event: SubscriptionEventData) => void,
): void;
export function useSubscription(
  input: SubscriptionInput,
  callback: (event: SubscriptionEventData) => void,
): void;
export function useSubscription(
  input: string[] | SubscriptionInput,
  callback: (event: SubscriptionEventData) => void,
) {
  const { mero } = useMero();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const { contextIds = [], groupIds = [] } = Array.isArray(input)
    ? { contextIds: input, groupIds: [] as string[] }
    : input;

  const contextIdsKey = JSON.stringify(contextIds);
  const groupIdsKey = JSON.stringify(groupIds);

  useEffect(() => {
    if (!mero || (contextIds.length === 0 && groupIds.length === 0)) return;

    const sse = mero.events;

    const handler = (event: SubscriptionEventData) => {
      callbackRef.current(event);
    };

    sse.on('event', handler);
    sse.connect().catch(() => {});
    sse.subscribe({ contextIds, groupIds }).catch(() => {});

    return () => {
      sse.off('event', handler);
    };
  }, [mero, contextIdsKey, groupIdsKey]);
}

/**
 * Fetch contexts for the current node, optionally filtered by application ID.
 */
export function useContexts(applicationId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<ApplicationContextRecord[]>(
    mero
      ? async () => {
          const response = applicationId
            ? await mero.admin.getContextsForApplication(applicationId)
            : await mero.admin.getContexts();
          return mapApplicationContexts(response.contexts ?? []);
        }
      : null,
    [],
    [mero, applicationId],
  );
  return { contexts: data, loading, error, refetch };
}

export function useApplicationContexts(applicationId?: string | null) {
  return useContexts(applicationId);
}

export function useGroupMembers(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<ListGroupMembersResponseData | null>(
    mero && groupId ? () => mero.admin.listGroupMembers(groupId) : null,
    null,
    [mero, groupId],
  );
  // `members` is a guaranteed array on the wire; `?? []` guards mocks / drift.
  return {
    members: data?.members ?? [],
    selfIdentity: data?.selfIdentity ?? null,
    loading,
    error,
    refetch,
  };
}

export function useGroupContexts(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<GroupContextEntry[]>(
    mero && groupId ? () => mero.admin.listGroupContexts(groupId) : null,
    [],
    [mero, groupId],
  );
  return { contexts: data, loading, error, refetch };
}

export function useGroupInvitations() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createInvitation = useCallback(
    async (groupId: string, request?: CreateGroupInvitationRequest) => {
      if (!mero) {
        return null;
      }
      return run(() => mero.admin.createGroupInvitation(groupId, request));
    },
    [mero, run],
  );

  return { createInvitation, loading, error };
}

export function useJoinGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const joinGroup = useCallback(
    async (request: JoinGroupRequest) => {
      if (!mero) {
        return null;
      }
      return run(() => mero.admin.joinGroup(request));
    },
    [mero, run],
  );

  return { joinGroup, loading, error };
}

export function useGroupCapabilities(groupId?: string | null, memberId?: string | null) {
  const { mero } = useMero();
  const [capabilities, setCapabilitiesState] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Read+write hybrid (setCapabilities shares this state), so it keeps the
  // inline latest-request-wins guard rather than useAsyncResource.
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!mero || !groupId || !memberId) {
      if (mountedRef.current && seq === reqRef.current) {
        setCapabilitiesState(null);
        setError(null);
        setLoading(false);
      }
      return null;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await mero.admin.getMemberCapabilities(groupId, memberId);
      if (mountedRef.current && seq === reqRef.current) {
        setCapabilitiesState(response.capabilities);
      }
      return response.capabilities;
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
      return null;
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, memberId, mero, mountedRef]);

  useEffect(() => {
    reqRef.current += 1;
    setCapabilitiesState(null);
    setError(null);
  }, [groupId, memberId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setCapabilities = useCallback(
    async (nextCapabilities: number) => {
      if (!mero || !groupId || !memberId) {
        return null;
      }

      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      try {
        await mero.admin.setMemberCapabilities(groupId, memberId, { capabilities: nextCapabilities });
        if (mountedRef.current) {
          setCapabilitiesState(nextCapabilities);
        }
        return nextCapabilities;
      } catch (err) {
        const errorValue = toError(err);
        if (mountedRef.current) {
          setError(errorValue);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [groupId, memberId, mero, mountedRef],
  );

  return { capabilities, loading, error, refetch, setCapabilities };
}

export function useContextDiscovery(options: ContextDiscoveryOptions): ContextDiscoveryState {
  const { mero } = useMero();
  const [context, setContext] = useState<ApplicationContextRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const knownContextIdsKey = JSON.stringify(options.knownContextIds ?? []);

  const discover = useCallback(async () => {
    if (!mero) {
      const notConnectedError = new Error('Not connected');
      if (mountedRef.current) {
        setError(notConnectedError);
      }
      return null;
    }
    const knownContextIds = new Set(options.knownContextIds ?? []);
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const timeoutMs = options.timeoutMs ?? 30000;
    const deadline = Date.now() + timeoutMs;

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      while (Date.now() <= deadline) {
        if (options.targetAlias) {
          const aliasMatch = extractAliasContextId(
            await mero.admin.lookupContextAlias(options.targetAlias),
          );

          if (aliasMatch && !knownContextIds.has(aliasMatch)) {
            const discoveredFromAlias = {
              contextId: aliasMatch,
              applicationId: options.applicationId,
            };

            if (mountedRef.current) {
              setContext(discoveredFromAlias);
            }

            return discoveredFromAlias;
          }
        }

        const response = await mero.admin.getContextsForApplication(options.applicationId);
        const contexts = mapApplicationContexts(response.contexts ?? []);
        const discovered = contexts.find(
          (applicationContext) => !knownContextIds.has(applicationContext.contextId),
        );

        if (discovered) {
          if (mountedRef.current) {
            setContext(discovered);
          }
          return discovered;
        }

        if (Date.now() + pollIntervalMs > deadline) {
          break;
        }

        await sleep(pollIntervalMs);
      }

      const timeoutError = new Error(
        `Timed out discovering a context for application ${options.applicationId}`,
      );

      if (mountedRef.current) {
        setContext(null);
        setError(timeoutError);
      }

      return null;
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setContext(null);
        setError(errorValue);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [
    knownContextIdsKey,
    mero,
    mountedRef,
    options.applicationId,
    options.knownContextIds,
    options.pollIntervalMs,
    options.targetAlias,
    options.timeoutMs,
  ]);

  const reset = useCallback(() => {
    if (mountedRef.current) {
      setContext(null);
      setError(null);
      setLoading(false);
    }
  }, [mountedRef]);

  return { context, loading, error, discover, reset };
}

// ---- Context CRUD Hooks ----

export function useCreateContext() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createContext = useCallback(
    async (request: CreateContextRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.createContext(request));
    },
    [mero, run],
  );

  return { createContext, loading, error };
}

export function useDeleteContext() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const deleteContext = useCallback(
    async (contextId: string) => {
      if (!mero) return null;
      return run(() => mero.admin.deleteContext(contextId));
    },
    [mero, run],
  );

  return { deleteContext, loading, error };
}

export function useJoinContext() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const joinContext = useCallback(
    async (contextId: string) => {
      if (!mero) return null;
      return run(() => mero.admin.joinContext(contextId));
    },
    [mero, run],
  );

  return { joinContext, loading, error };
}

export function useJoinSubgroupInheritance() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const joinSubgroupInheritance = useCallback(
    async (groupId: string) => {
      if (!mero) return null;
      return run(() => mero.admin.joinSubgroupInheritance(groupId));
    },
    [mero, run],
  );

  return { joinSubgroupInheritance, loading, error };
}

export function useContextGroup(contextId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<string | null>(
    mero && contextId ? () => mero.admin.getContextGroup(contextId) : null,
    null,
    [mero, contextId],
  );
  return { groupId: data, loading, error, refetch };
}

// ---- Group Info / Management Hooks ----

export function useGroupInfo(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<GroupInfo | null>(
    mero && groupId ? () => mero.admin.getGroupInfo(groupId) : null,
    null,
    [mero, groupId],
  );
  return { groupInfo: data, loading, error, refetch };
}

export function useDeleteGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const deleteGroup = useCallback(
    async (groupId: string, request?: DeleteGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.deleteGroup(groupId, request));
    },
    [mero, run],
  );

  return { deleteGroup, loading, error };
}

export function useSyncGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const syncGroup = useCallback(
    async (groupId: string, request?: SyncGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.syncGroup(groupId, request));
    },
    [mero, run],
  );

  return { syncGroup, loading, error };
}

export function useAddGroupMembers() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const addGroupMembers = useCallback(
    async (groupId: string, request: AddGroupMembersRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.addGroupMembers(groupId, request));
    },
    [mero, run],
  );

  return { addGroupMembers, loading, error };
}

export function useRemoveGroupMembers() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const removeGroupMembers = useCallback(
    async (groupId: string, request: RemoveGroupMembersRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.removeGroupMembers(groupId, request));
    },
    [mero, run],
  );

  return { removeGroupMembers, loading, error };
}

// ---- Namespace Hooks ----

export function useNamespaces() {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<Namespace[]>(
    mero ? () => mero.admin.listNamespaces() : null,
    [],
    [mero],
  );
  return { namespaces: data, loading, error, refetch };
}

export function useNamespace(namespaceId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<Namespace | null>(
    mero && namespaceId ? () => mero.admin.getNamespace(namespaceId) : null,
    null,
    [mero, namespaceId],
  );
  return { namespace: data, loading, error, refetch };
}

export function useNamespaceIdentity(namespaceId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<NamespaceIdentity | null>(
    mero && namespaceId ? () => mero.admin.getNamespaceIdentity(namespaceId) : null,
    null,
    [mero, namespaceId],
  );
  return { identity: data, loading, error, refetch };
}

export function useNamespacesForApplication(applicationId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<Namespace[]>(
    mero && applicationId ? () => mero.admin.listNamespacesForApplication(applicationId) : null,
    [],
    [mero, applicationId],
  );
  return { namespaces: data, loading, error, refetch };
}

export function useCreateNamespace() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createNamespace = useCallback(
    async (request: CreateNamespaceRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.createNamespace(request));
    },
    [mero, run],
  );

  return { createNamespace, loading, error };
}

export function useDeleteNamespace() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const deleteNamespace = useCallback(
    async (namespaceId: string, request?: DeleteNamespaceRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.deleteNamespace(namespaceId, request));
    },
    [mero, run],
  );

  return { deleteNamespace, loading, error };
}

export function useCreateNamespaceInvitation() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createNamespaceInvitation = useCallback(
    async (
      namespaceId: string,
      request?: CreateNamespaceInvitationRequest,
    ): Promise<CreateNamespaceInvitationResponseData | CreateRecursiveInvitationResponseData | null> => {
      if (!mero) return null;
      return run(() => mero.admin.createNamespaceInvitation(namespaceId, request));
    },
    [mero, run],
  );

  return { createNamespaceInvitation, loading, error };
}

export function useJoinNamespace() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const joinNamespace = useCallback(
    async (namespaceId: string, request: JoinNamespaceRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.joinNamespace(namespaceId, request));
    },
    [mero, run],
  );

  return { joinNamespace, loading, error };
}

export function useCreateGroupInNamespace() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createGroupInNamespace = useCallback(
    async (namespaceId: string, request?: CreateGroupInNamespaceRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.createGroupInNamespace(namespaceId, request));
    },
    [mero, run],
  );

  return { createGroupInNamespace, loading, error };
}

export function useNamespaceGroups(namespaceId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<SubgroupEntry[]>(
    mero && namespaceId ? () => mero.admin.listNamespaceGroups(namespaceId) : null,
    [],
    [mero, namespaceId],
  );
  return { groups: data, loading, error, refetch };
}

// ---- Group Settings & Role Management ----

export function useUpdateMemberRole() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const updateMemberRole = useCallback(
    async (groupId: string, identity: string, request: UpdateMemberRoleRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.updateMemberRole(groupId, identity, request));
    },
    [mero, run],
  );

  return { updateMemberRole, loading, error };
}

export function useSetDefaultCapabilities() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setDefaultCapabilities = useCallback(
    async (groupId: string, request: SetDefaultCapabilitiesRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setDefaultCapabilities(groupId, request));
    },
    [mero, run],
  );

  return { setDefaultCapabilities, loading, error };
}

export function useSetSubgroupVisibility() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setSubgroupVisibility = useCallback(
    async (groupId: string, request: SetSubgroupVisibilityRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setSubgroupVisibility(groupId, request));
    },
    [mero, run],
  );

  return { setSubgroupVisibility, loading, error };
}

export function useDefaultCapabilities(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<number | null>(
    mero && groupId ? () => mero.admin.getDefaultCapabilities(groupId) : null,
    null,
    [mero, groupId],
  );
  return { defaultCapabilities: data, loading, error, refetch };
}

export function useSubgroupVisibility(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<string | null>(
    mero && groupId ? () => mero.admin.getSubgroupVisibility(groupId) : null,
    null,
    [mero, groupId],
  );
  return { subgroupVisibility: data, loading, error, refetch };
}

export function useSetTeeAdmissionPolicy() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setTeeAdmissionPolicy = useCallback(
    async (groupId: string, request: SetTeeAdmissionPolicyRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setTeeAdmissionPolicy(groupId, request));
    },
    [mero, run],
  );

  return { setTeeAdmissionPolicy, loading, error };
}

// ---- Metadata Hooks ----

export function useSetGroupMetadata() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setGroupMetadata = useCallback(
    async (groupId: string, request: SetMetadataInput) => {
      if (!mero) return null;
      return run(() => mero.admin.setGroupMetadata(groupId, request));
    },
    [mero, run],
  );

  return { setGroupMetadata, loading, error };
}

export function useSetMemberMetadata() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setMemberMetadata = useCallback(
    async (groupId: string, identity: string, request: SetMetadataInput) => {
      if (!mero) return null;
      return run(() => mero.admin.setMemberMetadata(groupId, identity, request));
    },
    [mero, run],
  );

  return { setMemberMetadata, loading, error };
}

export function useSetContextMetadata() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setContextMetadata = useCallback(
    async (groupId: string, contextId: string, request: SetMetadataInput) => {
      if (!mero) return null;
      return run(() => mero.admin.setContextMetadata(groupId, contextId, request));
    },
    [mero, run],
  );

  return { setContextMetadata, loading, error };
}

export function useGroupMetadata(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<MetadataRecord | null>(
    mero && groupId ? () => mero.admin.getGroupMetadata(groupId) : null,
    null,
    [mero, groupId],
  );
  return { metadata: data, loading, error, refetch };
}

export function useMemberMetadata(groupId?: string | null, identity?: string | null) {
  const { mero } = useMero();
  const [metadata, setMetadata] = useState<MetadataRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Shared fetch logic for the auto-mount effect and the explicit
  // refetch callable. The per-invocation `signal.aborted` flag covers
  // the response-during-unmount race cleanly without the global
  // mountedRef gate that — under StrictMode-like fast unmount/remount
  // cycles — could leave the hook stuck on `metadata = null` when an
  // in-flight response landed during cleanup and the followup mount's
  // useCallback referential identity hadn't changed enough to re-fire
  // the effect.
  const run = useCallback(
    async (signal: { aborted: boolean }) => {
      if (!mero || !groupId || !identity) {
        if (!signal.aborted) {
          setMetadata(null);
          setError(null);
          setLoading(false);
        }
        return;
      }
      if (!signal.aborted) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await mero.admin.getMemberMetadata(groupId, identity);
        if (!signal.aborted) setMetadata(result);
      } catch (err) {
        if (!signal.aborted) setError(toError(err));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [mero, groupId, identity],
  );

  useEffect(() => {
    const signal = { aborted: false };
    void run(signal);
    return () => {
      signal.aborted = true;
    };
  }, [run]);

  // Explicit refetch — the caller's `await refetch()` resolves only
  // after state has been written (preserves the prior API contract;
  // call sites like `useMemberDisplayName.setName` rely on the new
  // value being readable from state after the await).
  const refetch = useCallback(async () => {
    const signal = { aborted: false };
    await run(signal);
  }, [run]);

  return { metadata, loading, error, refetch };
}

// ---- Group Signing Key, Upgrades & Hierarchy ----

export function useRegisterGroupSigningKey() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const registerGroupSigningKey = useCallback(
    async (groupId: string, request: RegisterGroupSigningKeyRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.registerGroupSigningKey(groupId, request));
    },
    [mero, run],
  );

  return { registerGroupSigningKey, loading, error };
}

export function useUpgradeGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const upgradeGroup = useCallback(
    async (groupId: string, request: UpgradeGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.upgradeGroup(groupId, request));
    },
    [mero, run],
  );

  return { upgradeGroup, loading, error };
}

/**
 * Install a registry package version onto the node — the discrete "Download"
 * step an Updates flow runs before an `upgradeGroup`. Resolves the installed
 * application id (`InstallApplicationResponseData`). Downloading does not by
 * itself change what any group runs; pair it with a subsequent upgrade.
 */
export function useInstallFromRegistry() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const installFromRegistry = useCallback(
    async (registryUrl: string, packageName: string, version: string) => {
      if (!mero) return null;
      return run(() => mero.admin.installFromRegistry(registryUrl, packageName, version));
    },
    [mero, run],
  );

  return { installFromRegistry, loading, error };
}

/**
 * Kick off a full state re-pull for a context — operator recovery for a
 * context stranded mid-sync. `force` re-pulls even when the node does not
 * flag the context as stranded.
 */
export function useResyncContext() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const resyncContext = useCallback(
    async (contextId: string, request: ResyncContextRequest = {}) => {
      if (!mero) return null;
      return run(() => mero.admin.resyncContext(contextId, request));
    },
    [mero, run],
  );

  return { resyncContext, loading, error };
}

export function useGroupUpgradeStatus(groupId?: string | null) {
  const { mero } = useMero();
  const [upgradeStatus, setUpgradeStatus] = useState<GroupUpgradeStatusResponseData>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Latest-request-wins token (see useMigrationStatus) so overlapping refetches
  // can't land out of order and overwrite fresher data.
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setUpgradeStatus(null);
        setError(null);
        setLoading(false);
      }
      return;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await mero.admin.getGroupUpgradeStatus(groupId);
      if (mountedRef.current && seq === reqRef.current) {
        setUpgradeStatus(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

  // Clear stale status synchronously when the target group changes (and
  // invalidate any in-flight refetch), mirroring useMigrationStatus.
  useEffect(() => {
    reqRef.current += 1;
    setUpgradeStatus(null);
    setError(null);
  }, [groupId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { upgradeStatus, loading, error, refetch };
}

export function useRetryGroupUpgrade() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const retryGroupUpgrade = useCallback(
    async (groupId: string, request?: RetryGroupUpgradeRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.retryGroupUpgrade(groupId, request));
    },
    [mero, run],
  );

  return { retryGroupUpgrade, loading, error };
}

/** Move `childGroupId` under a new parent. */
export function useReparentGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const reparentGroup = useCallback(
    async (childGroupId: string, request: ReparentGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.reparentGroup(childGroupId, request));
    },
    [mero, run],
  );

  return { reparentGroup, loading, error };
}

export function useSubgroups(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<SubgroupEntry[]>(
    mero && groupId ? () => mero.admin.listSubgroups(groupId) : null,
    [],
    [mero, groupId],
  );
  return { subgroups: data, loading, error, refetch };
}

// ---- Context-Group Relationship ----

export function useDetachContextFromGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const detachContextFromGroup = useCallback(
    async (groupId: string, contextId: string, request?: DetachContextFromGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.detachContextFromGroup(groupId, contextId, request));
    },
    [mero, run],
  );

  return { detachContextFromGroup, loading, error };
}

/**
 * Migration-status rollup for a namespace (skew #3). Migration facts arrive via
 * heartbeat gossip (no SSE), so liveness is polling: pass `pollIntervalMs` to
 * re-fetch on an interval. Derived counters are null-safe before the first load.
 */
export function useMigrationStatus(
  namespaceId?: string | null,
  options?: { pollIntervalMs?: number },
) {
  const { mero } = useMero();
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Monotonic request token: only the latest in-flight request applies its
  // result, so an overlapping poll or a fast namespace change can't let a
  // stale response overwrite fresher data.
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mero || !namespaceId) {
      if (mountedRef.current) {
        setStatus(null);
        setError(null);
        setLoading(false);
      }
      return;
    }

    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await mero.admin.getMigrationStatus(namespaceId);
      if (mountedRef.current && seq === reqRef.current) {
        setStatus(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [namespaceId, mero, mountedRef]);

  // Clear stale state the instant the namespace changes, so the panel shows a
  // loading state rather than the previous namespace's data during the refetch.
  useEffect(() => {
    setStatus(null);
    setError(null);
  }, [namespaceId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // 5s: migration facts arrive via heartbeat gossip, not push, and heartbeats
  // are not sub-second, so faster polling adds load without fresher data.
  const pollIntervalMs = options?.pollIntervalMs ?? 5000;
  useEffect(() => {
    if (!pollIntervalMs || !mero || !namespaceId) return;
    const handle = setInterval(() => void refetch(), pollIntervalMs);
    return () => clearInterval(handle);
  }, [pollIntervalMs, mero, namespaceId, refetch]);

  const rollup: MigrationStatusRollup | null = status?.rollup ?? null;
  const members: MemberMigrationStatusEntry[] = status?.members ?? [];

  return {
    status,
    rollup,
    members,
    allMigrated: rollup?.allMigrated ?? false,
    membersPendingSignature: rollup?.membersPendingSignature ?? 0,
    /** Members whose migrate aborted (migration-check failed or apply errored). */
    failed: rollup?.failed ?? 0,
    loading,
    error,
    refetch,
  };
}

/**
 * Bundle-version skew (#2): reads the context's installed `applicationVersion`
 * (semver) and compares it to the app-declared `expected` build constant. Any
 * mismatch (either direction) is `isStale` → "reload to update". Subscribes to
 * `AppVersionChanged` so a live flip updates `appVersion` without a refetch.
 */
export function useAppVersion(contextId?: string | null, expected?: string) {
  const { mero } = useMero();
  const [appVersion, setAppVersion] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Latest-request-wins token (see useMigrationStatus).
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mero || !contextId) {
      if (mountedRef.current) {
        setAppVersion(undefined);
        setError(null);
        setLoading(false);
      }
      return;
    }

    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const context = await mero.admin.getContext(contextId);
      if (mountedRef.current && seq === reqRef.current) {
        setAppVersion(context.applicationVersion);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [contextId, mero, mountedRef]);

  // Reset on context change so a stale version isn't shown during the refetch.
  useEffect(() => {
    setAppVersion(undefined);
    setError(null);
  }, [contextId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!mero?.events || !contextId) return;
    const off = mero.events.onAppVersionChanged((event: AppVersionChangedEvent) => {
      if (event.contextId !== contextId) return;
      if (mountedRef.current && event.toVersion) {
        // Invalidate any in-flight refetch so its (older) result can't clobber
        // this live update.
        reqRef.current += 1;
        setAppVersion(event.toVersion);
      }
    });
    return off;
  }, [mero, contextId, mountedRef]);

  const isStale = appVersion != null && expected != null && appVersion !== expected;

  return { appVersion, expected, isStale, loading, error, refetch };
}

/**
 * "Is a newer version available?" for an Updates view. Reads a package's
 * published versions from the registry and compares the newest to the running
 * `currentVersion` (e.g. a context's `applicationVersion`). `updateAvailable`
 * is true only when the registry's newest is strictly greater. This is the
 * registry-side check the admin acts on; gate rendering on admin status at the
 * call site. Pure read — fetching nothing until both `registryUrl` and
 * `packageName` are provided.
 */
export function useLatestVersion(
  registryUrl?: string | null,
  packageName?: string | null,
  currentVersion?: string | null,
) {
  const { mero } = useMero();
  const [versions, setVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Latest-request-wins token (see useMigrationStatus).
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mero || !registryUrl || !packageName) {
      // Invalidate any in-flight request so a late response can't repopulate
      // stale versions for the previous package after the inputs were cleared.
      reqRef.current += 1;
      if (mountedRef.current) {
        setVersions([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await mero.admin.getRegistryVersions(registryUrl, packageName);
      if (mountedRef.current && seq === reqRef.current) {
        setVersions(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [mero, registryUrl, packageName, mountedRef]);

  // Clear stale versions the instant the package/registry changes.
  useEffect(() => {
    setVersions([]);
    setError(null);
  }, [registryUrl, packageName]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // getRegistryVersions returns newest-first, so [0] is the latest published.
  const latestVersion = versions[0] ?? null;
  const updateAvailable =
    latestVersion != null &&
    currentVersion != null &&
    compareSemver(latestVersion, currentVersion) > 0;

  return { versions, latestVersion, currentVersion, updateAvailable, loading, error, refetch };
}

interface GroupAppVersion {
  /** Semver of the application the group currently targets (`null` until loaded). */
  version: string | null;
  /** The group's `targetApplicationId`. */
  applicationId: string | null;
  /** The installed blob differs from the one the group targets (see hook doc). */
  pendingApply: boolean;
  upgradePolicy: string | null;
  /** Only populated via the group-info path; `null` in the namespace path. */
  activeUpgrade: GroupUpgradeStatusResponseData;
}

const EMPTY_GROUP_APP_VERSION: GroupAppVersion = {
  version: null,
  applicationId: null,
  pendingApply: false,
  upgradePolicy: null,
  activeUpgrade: null,
};

/** An appKey carries no "pending" signal when it is absent or all-zero. */
function isZeroAppKey(appKey?: string): boolean {
  return !appKey || /^0+$/.test(appKey);
}

/**
 * What app version does this group run, and is there a downloaded-but-not-yet-
 * applied update? Replaces the appKey-vs-installed-blob comparison apps
 * otherwise hand-roll: `pendingApply` is true when the group's `appKey` (the
 * blob it targets) is present, non-zero, and differs from the blob actually
 * installed for its `targetApplicationId`. Deciding whether to render or gate on
 * that status (admin-only actions, etc.) is the call site's job.
 *
 * Resolution stays cheap: the group's record comes from `listNamespaces()` when
 * the id is a namespace, else from `getGroupInfo()`; `getApplication()` then
 * reads the installed version and blob. `activeUpgrade` is returned only when it
 * arrives for free on the group-info path (it is not fetched separately).
 * Subscribes to `AppVersionChanged` and refetches, since any version flip in the
 * workspace can make the rollup stale.
 */
export function useGroupAppVersion(groupId?: string) {
  const { mero } = useMero();
  const [data, setData] = useState<GroupAppVersion>(EMPTY_GROUP_APP_VERSION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Latest-request-wins token (see useMigrationStatus).
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setData(EMPTY_GROUP_APP_VERSION);
        setError(null);
        setLoading(false);
      }
      return;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      // Namespace-first resolution: a top-level group is a namespace; only
      // subgroups need the getGroupInfo fallback (which also carries
      // activeUpgrade, so we surface it without a third call).
      const namespaces = await mero.admin.listNamespaces();
      const namespace = namespaces.find((entry) => entry.namespaceId === groupId);

      let appKey: string | undefined;
      let applicationId: string | null;
      let upgradePolicy: string | null;
      let activeUpgrade: GroupUpgradeStatusResponseData = null;

      if (namespace) {
        appKey = namespace.appKey;
        applicationId = namespace.targetApplicationId;
        upgradePolicy = namespace.upgradePolicy;
      } else {
        const info = await mero.admin.getGroupInfo(groupId);
        appKey = info.appKey;
        applicationId = info.targetApplicationId;
        upgradePolicy = info.upgradePolicy;
        activeUpgrade = info.activeUpgrade ?? null;
      }

      let version: string | null = null;
      let pendingApply = false;
      if (applicationId) {
        const { application } = await mero.admin.getApplication(applicationId);
        version = application?.version ?? null;
        if (application && !isZeroAppKey(appKey)) {
          const installedHex = base58ToHex(application.blob.bytecode).toLowerCase();
          pendingApply = appKey!.toLowerCase() !== installedHex;
        }
      }

      if (mountedRef.current && seq === reqRef.current) {
        setData({ version, applicationId, pendingApply, upgradePolicy, activeUpgrade });
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

  // Clear stale state synchronously when the target group changes (and
  // invalidate any in-flight refetch). Mirrors useGroupUpgradeStatus.
  useEffect(() => {
    reqRef.current += 1;
    setData(EMPTY_GROUP_APP_VERSION);
    setError(null);
  }, [groupId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!mero?.events || !groupId) return;
    const off = mero.events.onAppVersionChanged(() => {
      if (mountedRef.current) void refetch();
    });
    return off;
  }, [mero, groupId, refetch, mountedRef]);

  return { ...data, loading, error, refetch };
}

/**
 * The caller's own identity-gated entries pending re-signature (skew #1).
 * `pending` is `pendingCount > 0` (from `count_my_pending`); `authorize()` runs
 * the one-tap `migrate_my_entries` convert and folds the resulting `remaining`
 * back into the count.
 */
export function useMyAuthoredMigration(contextId?: string | null) {
  const { mero } = useMero();
  const [summary, setSummary] = useState<MigrateMyEntriesSummary | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const mountedRef = useMountedRef();
  const { loading, error, run } = useAsyncMutation();
  // Latest-request-wins token (see useMigrationStatus).
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!mero || !contextId) {
      if (mountedRef.current) setPendingCount(0);
      return;
    }
    const seq = ++reqRef.current;
    try {
      const count = await mero.rpc.countMyPending(contextId);
      if (mountedRef.current && seq === reqRef.current) setPendingCount(count);
    } catch {
      // best-effort count; leave the previous value on a transient failure
    }
  }, [mero, contextId, mountedRef]);

  // Clear stale per-context state synchronously when the target changes (and
  // invalidate any in-flight refresh), so the banner doesn't flash the previous
  // context's count until the new count resolves. Mirrors useMigrationStatus.
  useEffect(() => {
    reqRef.current += 1;
    setPendingCount(0);
    setSummary(null);
  }, [contextId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const authorize = useCallback(async () => {
    if (!mero || !contextId) return null;
    const result = await run(() => mero.rpc.migrateMyEntries(contextId));
    if (result && mountedRef.current) {
      // Invalidate any in-flight refresh so a stale count can't overwrite the
      // authoritative post-convert remaining.
      reqRef.current += 1;
      setSummary(result);
      setPendingCount(result.remaining);
    }
    return result;
  }, [mero, contextId, run, mountedRef]);

  return {
    summary,
    pendingCount,
    pending: pendingCount > 0,
    authorize,
    loading,
    error,
    refresh,
  };
}
