import { useState, useCallback, useEffect, useRef } from 'react';
import { useMero } from '../context';
import type { SseEventData } from '@calimero-network/mero-js';

export { useMero } from '../context';

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
  const [contexts, setContexts] = useState<
    Array<{ contextId: string; applicationId: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    if (!mero) return;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await mero.admin.getContexts();
      let list = (response.contexts ?? []).map((c) => ({ contextId: c.id, applicationId: c.applicationId }));
      if (applicationId) {
        list = list.filter((c) => c.applicationId === applicationId);
      }
      if (mountedRef.current) setContexts(list);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) setError(e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [mero, applicationId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { contexts, loading, error, refetch };
}
