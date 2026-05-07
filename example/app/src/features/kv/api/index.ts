import { AbiClient, AppContext, AbiEvent } from '../../../api/AbiClient';
import type { Context, MeroJs } from '@calimero-network/mero-js';

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
  // Fetch the target context directly by ID — avoids paging through the
  // full `getContexts()` list when the user has many contexts.
  let targetContext: Context;
  try {
    targetContext = await mero.admin.getContext(targetContextId);
  } catch (err) {
    // Preserve the underlying error via Error.cause so stack traces
    // survive the rewrap.
    throw new Error(
      `Selected context ${targetContextId} could not be loaded — it may ` +
        'have been deleted. Please pick another from /select-context.',
      { cause: err },
    );
  }

  const { id: contextId, applicationId } = targetContext;
  if (!contextId) {
    throw new Error(
      'Context missing id — unexpected server response format',
    );
  }
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
