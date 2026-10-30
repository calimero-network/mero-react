/**
 * App instances (was: contexts). An app instance runs one signed package
 * release; its id is `SHA-256(app)`. Creating one is new work, which a passed
 * release deadline refuses (`ReleaseDeadlineError`).
 */

import { useCallback } from 'react';
import type { AppInfo } from '@calimero-network/mero-js';
import { useMero } from '../context';
import { NotConnectedError, useAppId, useAsyncAction, useResource, useSignedInClient, type MutationOptions } from './internal';

/** The app instances this account can see. Was `useContexts`. */
export function useApps(filter: { package?: string; bundle?: string } = {}) {
  const client = useSignedInClient();
  const { package: pkg, bundle } = filter;
  return useResource<AppInfo[]>(client ? () => client.listApps({ package: pkg, bundle }) : null, [], [client, pkg, bundle]);
}

export interface CreateAppInput {
  name: string;
  /** A bundle hash, or a package release (`{ package, version? }`). */
  bundle: string | { package: string; version?: string; service?: string };
  /** The organization that owns it (default: the account). */
  org?: string;
  access?: Record<string, unknown>;
  /** Methods that need the caller's passkey on every call. */
  confirmMethods?: string[];
  initArgs?: unknown;
}

/** Create an app instance. Was `useCreateContext`. Resolves its app id. */
export function useCreateApp(options?: MutationOptions) {
  const client = useSignedInClient();
  const action = useAsyncAction(options);
  const create = useCallback(
    (input: CreateAppInput) =>
      action.run(() => {
        if (!client) throw new NotConnectedError();
        const { name, bundle, ...rest } = input;
        return client.createApp(name, bundle, rest);
      }),
    [client, action.run],
  );
  return { create, loading: action.loading, error: action.error, failure: action.failure };
}

/** Delete an app instance. Was `useDeleteContext`. */
export function useDeleteApp(options?: MutationOptions) {
  const client = useSignedInClient();
  const action = useAsyncAction(options);
  const remove = useCallback(
    (appId: string) =>
      action.run(async () => {
        if (!client) throw new NotConnectedError();
        await client.deleteApp(appId);
        return true;
      }),
    [client, action.run],
  );
  return { deleteApp: remove, loading: action.loading, error: action.error, failure: action.failure };
}

/** Set an app instance's metadata. Was `useSetContextMetadata`. */
export function useSetAppMetadata(options?: MutationOptions) {
  const client = useSignedInClient();
  const action = useAsyncAction(options);
  const setMetadata = useCallback(
    (appId: string, metadata: unknown) =>
      action.run(async () => {
        if (!client) throw new NotConnectedError();
        await client.setAppMetadata(appId, metadata);
        return true;
      }),
    [client, action.run],
  );
  return { setMetadata, loading: action.loading, error: action.error, failure: action.failure };
}

export interface UpgradeTarget {
  version?: string;
  package?: string;
  service?: string;
  bundle?: string;
  migrate?: string;
}

/**
 * Upgrade an app instance. Was `useUpgradeGroup`. Asks for the passkey (the
 * node confirms an upgrade). A session opened on an app's own frontend cannot
 * upgrade (`403`): send the person to the consent page instead
 * (`useConsent` with `upgradeConsent`).
 */
export function useUpgradeApp(appId?: string | null, options?: MutationOptions) {
  const client = useSignedInClient();
  const { passkey } = useMero();
  const id = useAppId(appId);
  const action = useAsyncAction(options);
  const upgrade = useCallback(
    (target: UpgradeTarget) =>
      action.run(() => {
        if (!client) throw new NotConnectedError();
        if (!id) throw new Error('No app to upgrade.');
        return client.upgradeApp(id, target, passkey);
      }),
    [client, id, passkey, action.run],
  );
  return { upgrade, loading: action.loading, error: action.error, failure: action.failure };
}

/** The installed package releases. */
export function usePackages() {
  const client = useSignedInClient();
  return useResource(client ? () => client.packages() : null, [], [client]);
}
