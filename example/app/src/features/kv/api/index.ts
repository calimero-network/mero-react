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
 * Create a KV client from a MeroJs instance.
 *
 * `targetContextId` is required — it comes from `useMero().contextId`
 * which the home page guarantees is set before calling. Falling back to
 * `contexts[0]` would risk operating on the wrong context.
 */
export async function createKvClient(
  mero: MeroJs,
  targetContextId: string,
): Promise<{ client: AbiClient; context: AppContext }> {
  // Fetch contexts using mero-js admin API (v2 — flat methods on `admin`)
  const contextsResponse = await mero.admin.getContexts();
  const contexts = contextsResponse.contexts;

  if (!contexts || contexts.length === 0) {
    throw new Error('No contexts available. You may need to create a context first.');
  }

  const targetContext = contexts.find((c) => c.id === targetContextId);
  if (!targetContext) {
    throw new Error(
      `Selected context ${targetContextId} not found on this node. ` +
        'It may have been deleted — please pick another from /select-context.',
    );
  }

  // `find` already guarantees `targetContext.id === targetContextId`, so we
  // only need to defend against a missing `applicationId` on the response.
  const { id: contextId, applicationId } = targetContext;
  if (!applicationId) {
    throw new Error(
      'Context missing applicationId — unexpected server response format',
    );
  }

  // mero-js v2 RPC no longer requires `executorPublicKey` — the server
  // resolves the identity from the access token. We skip the
  // `getContextIdentitiesOwned` round-trip entirely.
  return {
    client: new AbiClient(mero, { contextId, applicationId }),
    context: { contextId, applicationId },
  };
}
