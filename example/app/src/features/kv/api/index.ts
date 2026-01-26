import { AbiClient, AppContext, AbiEvent } from '../../../api/AbiClient';
import type { MeroJs } from '@calimero-network/mero-react';

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
 * @param targetContextId - Required: specific context ID to use (from auth callback)
 */
export async function createKvClient(
  mero: MeroJs,
  targetContextId: string,
): Promise<{ client: AbiClient; context: AppContext }> {
  console.log('Creating KV client, target context:', targetContextId);
  
  if (!targetContextId) {
    throw new Error('targetContextId is required. Please select a context during authentication.');
  }
  
  // Fetch contexts using mero-js admin API
  const contextsResponse = await mero.admin.contexts.listContexts();
  console.log('Contexts response:', contextsResponse);
  
  const contexts = contextsResponse.contexts;
  
  if (!contexts || contexts.length === 0) {
    throw new Error('No contexts available. You may need to create a context first.');
  }
  
  // Find the target context - NO FALLBACK
  const targetContext = contexts.find(c => c.id === targetContextId);
  
  if (!targetContext) {
    console.error('Available contexts:', contexts.map(c => c.id));
    throw new Error(`Context ${targetContextId} not found. Available contexts: ${contexts.map(c => c.id).join(', ')}`);
  }
  
  console.log('Using context:', targetContext);
  
  // Server returns 'id' for context ID
  const contextId = targetContext.id;
  const applicationId = targetContext.applicationId;
  
  if (!contextId) {
    console.error('Context object missing id:', targetContext);
    throw new Error('Context missing id - unexpected server response format');
  }
  
  // Get identities for this context
  const identitiesResponse = await mero.admin.contexts.getContextIdentitiesOwned(contextId);
  console.log('Identities response:', identitiesResponse);
  
  const identities = identitiesResponse.identities;
  
  if (!identities || identities.length === 0) {
    throw new Error('No identities available for context. You may need to join or create the context.');
  }
  
  const appContext: AppContext = {
    contextId,
    executorPublicKey: identities[0],
    applicationId,
  };
  
  console.log('App context created:', appContext);
  
  return {
    client: new AbiClient(mero, appContext),
    context: appContext,
  };
}
