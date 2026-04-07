import { useState, useCallback, useEffect, useRef } from 'react';
import { useMero } from '../context';
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
  GroupMember,
  GroupUpgradeStatusResponseData,
  JoinGroupRequest,
  JoinNamespaceRequest,
  ListGroupMembersResponseData,
  Namespace,
  NamespaceIdentity,
  NestGroupRequest,
  AddGroupMembersRequest,
  RegisterGroupSigningKeyRequest,
  RegisterGroupSigningKeyResponseData,
  RemoveGroupMembersRequest,
  RetryGroupUpgradeRequest,
  RetryGroupUpgradeResponseData,
  SetDefaultCapabilitiesRequest,
  SetDefaultVisibilityRequest,
  SetGroupAliasRequest,
  SetMemberAliasRequest,
  SetTeeAdmissionPolicyRequest,
  SubgroupEntry,
  SyncGroupRequest,
  SseEventData,
  UnnestGroupRequest,
  UpdateGroupSettingsRequest,
  UpdateMemberRoleRequest,
  UpgradeGroupRequest,
  UpgradeGroupResponseData,
} from '@calimero-network/mero-js';
import type {
  ApplicationContextRecord,
  ContextDiscoveryOptions,
  ContextDiscoveryState,
} from '../types';

export { useMero } from '../context';

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

/**
 * Subscribe to SSE events for context IDs.
 * StrictMode-safe: tracks the SseClient instance in a ref to avoid
 * double-connect on mount/unmount/remount cycles.
 */
export function useSubscription(
  contextIds: string[],
  callback: (event: SseEventData) => void,
) {
  const { mero } = useMero();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const contextIdsKey = JSON.stringify(contextIds);

  useEffect(() => {
    if (!mero || contextIds.length === 0) return;

    const sse = mero.events;

    const handler = (event: SseEventData) => {
      callbackRef.current(event);
    };

    sse.on('event', handler);
    sse.connect().catch(() => {});
    sse.subscribe(contextIds).catch(() => {});

    return () => {
      sse.off('event', handler);
    };
  }, [mero, contextIdsKey]);
}

/**
 * Fetch contexts for the current node, optionally filtered by application ID.
 */
export function useContexts(applicationId?: string | null) {
  const { mero } = useMero();
  const [contexts, setContexts] = useState<ApplicationContextRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero) return;

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = applicationId
        ? await mero.admin.getContextsForApplication(applicationId)
        : await mero.admin.getContexts();
      const list = mapApplicationContexts(response.contexts ?? []);
      if (mountedRef.current) {
        setContexts(list);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [mero, applicationId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { contexts, loading, error, refetch };
}

export function useApplicationContexts(applicationId?: string | null) {
  return useContexts(applicationId);
}

export function useGroupMembers(groupId?: string | null) {
  const { mero } = useMero();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [selfIdentity, setSelfIdentity] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setMembers([]);
        setSelfIdentity(null);
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
      const response: ListGroupMembersResponseData = await mero.admin.listGroupMembers(groupId);
      if (mountedRef.current) {
        setMembers(response.data ?? []);
        setSelfIdentity(response.selfIdentity ?? null);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { members, selfIdentity, loading, error, refetch };
}

export function useGroupContexts(groupId?: string | null) {
  const { mero } = useMero();
  const [contexts, setContexts] = useState<GroupContextEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setContexts([]);
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
      const nextContexts = await mero.admin.listGroupContexts(groupId);
      if (mountedRef.current) {
        setContexts(nextContexts);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { contexts, loading, error, refetch };
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

  const refetch = useCallback(async () => {
    if (!mero || !groupId || !memberId) {
      if (mountedRef.current) {
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
      if (mountedRef.current) {
        setCapabilitiesState(response.capabilities);
      }
      return response.capabilities;
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
  }, [groupId, memberId, mero, mountedRef]);

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

export function useContextGroup(contextId?: string | null) {
  const { mero } = useMero();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !contextId) {
      if (mountedRef.current) {
        setGroupId(null);
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
      const result = await mero.admin.getContextGroup(contextId);
      if (mountedRef.current) {
        setGroupId(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [contextId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { groupId, loading, error, refetch };
}

// ---- Group Info / Management Hooks ----

export function useGroupInfo(groupId?: string | null) {
  const { mero } = useMero();
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setGroupInfo(null);
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
      const result = await mero.admin.getGroupInfo(groupId);
      if (mountedRef.current) {
        setGroupInfo(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { groupInfo, loading, error, refetch };
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
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero) return;

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await mero.admin.listNamespaces();
      if (mountedRef.current) {
        setNamespaces(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { namespaces, loading, error, refetch };
}

export function useNamespace(namespaceId?: string | null) {
  const { mero } = useMero();
  const [namespace, setNamespace] = useState<Namespace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !namespaceId) {
      if (mountedRef.current) {
        setNamespace(null);
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
      const result = await mero.admin.getNamespace(namespaceId);
      if (mountedRef.current) {
        setNamespace(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [namespaceId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { namespace, loading, error, refetch };
}

export function useNamespaceIdentity(namespaceId?: string | null) {
  const { mero } = useMero();
  const [identity, setIdentity] = useState<NamespaceIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !namespaceId) {
      if (mountedRef.current) {
        setIdentity(null);
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
      const result = await mero.admin.getNamespaceIdentity(namespaceId);
      if (mountedRef.current) {
        setIdentity(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [namespaceId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { identity, loading, error, refetch };
}

export function useNamespacesForApplication(applicationId?: string | null) {
  const { mero } = useMero();
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !applicationId) {
      if (mountedRef.current) {
        setNamespaces([]);
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
      const result = await mero.admin.listNamespacesForApplication(applicationId);
      if (mountedRef.current) {
        setNamespaces(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [applicationId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { namespaces, loading, error, refetch };
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
  const [groups, setGroups] = useState<SubgroupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !namespaceId) {
      if (mountedRef.current) {
        setGroups([]);
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
      const result = await mero.admin.listNamespaceGroups(namespaceId);
      if (mountedRef.current) {
        setGroups(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [namespaceId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { groups, loading, error, refetch };
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

export function useSetDefaultVisibility() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setDefaultVisibility = useCallback(
    async (groupId: string, request: SetDefaultVisibilityRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setDefaultVisibility(groupId, request));
    },
    [mero, run],
  );

  return { setDefaultVisibility, loading, error };
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

export function useUpdateGroupSettings() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const updateGroupSettings = useCallback(
    async (groupId: string, request: UpdateGroupSettingsRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.updateGroupSettings(groupId, request));
    },
    [mero, run],
  );

  return { updateGroupSettings, loading, error };
}

export function useSetGroupAlias() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setGroupAlias = useCallback(
    async (groupId: string, request: SetGroupAliasRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setGroupAlias(groupId, request));
    },
    [mero, run],
  );

  return { setGroupAlias, loading, error };
}

export function useSetMemberAlias() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setMemberAlias = useCallback(
    async (groupId: string, identity: string, request: SetMemberAliasRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setMemberAlias(groupId, identity, request));
    },
    [mero, run],
  );

  return { setMemberAlias, loading, error };
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

export function useGroupUpgradeStatus(groupId?: string | null) {
  const { mero } = useMero();
  const [upgradeStatus, setUpgradeStatus] = useState<GroupUpgradeStatusResponseData>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
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
      if (mountedRef.current) {
        setUpgradeStatus(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

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

export function useNestGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const nestGroup = useCallback(
    async (parentGroupId: string, request: NestGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.nestGroup(parentGroupId, request));
    },
    [mero, run],
  );

  return { nestGroup, loading, error };
}

export function useUnnestGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const unnestGroup = useCallback(
    async (parentGroupId: string, request: UnnestGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.unnestGroup(parentGroupId, request));
    },
    [mero, run],
  );

  return { unnestGroup, loading, error };
}

export function useSubgroups(groupId?: string | null) {
  const { mero } = useMero();
  const [subgroups, setSubgroups] = useState<SubgroupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const refetch = useCallback(async () => {
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setSubgroups([]);
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
      const result = await mero.admin.listSubgroups(groupId);
      if (mountedRef.current) {
        setSubgroups(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { subgroups, loading, error, refetch };
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
