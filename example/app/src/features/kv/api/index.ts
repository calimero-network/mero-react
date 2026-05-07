import { AbiClient, AppContext, AbiEvent } from '../../../api/AbiClient';
import type { MeroJs } from '@calimero-network/mero-js';

export { AbiClient };
export type { AbiEvent, AppContext };

export type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: number; message: string } };

export function isOk<T>(
  result: ApiResult<T>,
): result is { data: T; error: null } {
  return result.error === null;
}

/**
 * Create a KV client from MeroJs instance
 * 
 * @param mero - MeroJs instance
 * @param targetContextId - Optional: specific context ID to use (from auth callback)
 */
export async function createKvClient(
  mero: MeroJs,
  targetContextId?: string | null,
): Promise<{ client: AbiClient; context: AppContext }> {
  console.log('Creating KV client, target context:', targetContextId);
  
  // Fetch contexts using mero-js admin API (v2 — flat methods on `admin`)
  const contextsResponse = await mero.admin.getContexts();
  console.log('Contexts response:', contextsResponse);

  const contexts = contextsResponse.contexts;

  if (!contexts || contexts.length === 0) {
    throw new Error('No contexts available. You may need to create a context first.');
  }

  // Pick the explicitly requested context. Fall back to the first only
  // when no target was provided (e.g. legacy SingleContext flow). Silent
  // fallback on a missing target would risk operating on the wrong context.
  let targetContext;
  if (targetContextId) {
    const found = contexts.find((c: { id: string }) => c.id === targetContextId);
    if (!found) {
      throw new Error(
        `Selected context ${targetContextId} not found on this node. ` +
          'It may have been deleted — please pick another from /select-context.',
      );
    }
    targetContext = found;
  } else {
    targetContext = contexts[0];
  }

  console.log('Using context:', targetContext);

  const contextId = targetContext.id;
  const applicationId = targetContext.applicationId;

  if (!contextId) {
    console.error('Context object missing id:', targetContext);
    throw new Error('Context missing id - unexpected server response format');
  }

  // mero-js v2 RPC no longer requires `executorPublicKey` — the server
  // resolves the identity from the access token. We skip the
  // `getContextIdentitiesOwned` round-trip entirely.
  const appContext: AppContext = {
    contextId,
    applicationId,
  };

  console.log('App context created:', appContext);

  return {
    client: new AbiClient(mero, appContext),
    context: appContext,
  };
}
