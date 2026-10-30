/**
 * The signed-in account. Was `useNodeIdentity`: there are no node identities
 * or executor keys any more, the caller is the account.
 */

import { useCallback } from 'react';
import { useMero } from '../context';
import { useClientAction, useResource, useSignedInClient, type MutationOptions } from './internal';

/** `GET /auth/me`: the account, its passkeys, its orgs. */
export function useAccount() {
  const client = useSignedInClient();
  const { accountId } = useMero();
  const me = useResource<Record<string, unknown> | null>(client ? () => client.me() : null, null, [client, accountId]);
  return { accountId, ...me };
}

/** Add a passkey (another device) or remove one. */
export function usePasskeys(options?: MutationOptions) {
  const { passkey } = useMero();
  const { withClient, ...state } = useClientAction(options);
  const add = useCallback(() => withClient((c) => c.addPasskey(passkey)), [withClient, passkey]);
  const remove = useCallback(
    (credentialId: string) =>
      withClient(async (c) => {
        await c.removePasskey(credentialId);
        return true;
      }),
    [withClient],
  );
  const label = useCallback(
    (credentialId: string, name: string) =>
      withClient(async (c) => {
        await c.labelPasskey(credentialId, name);
        return true;
      }),
    [withClient],
  );
  return { add, remove, label, ...state };
}
