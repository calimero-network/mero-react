/**
 * The delegated connect path, entered from an invitation instead of an account.
 *
 * `ConnectButtonAccount` enrols the device and then asks the cloud which relays
 * serve the ACCOUNT. For a first-time account that answer is `[]` and there is
 * nothing to connect to — correctly, since nothing yet serves an account that is
 * a member of nothing. This hook is the other door into the same connection: it
 * takes an invitation, resolves a relay from the NAMESPACE, presents the signed
 * join, and then connects through the node that carried it.
 *
 * It is `MeroContext`'s own `connectWithAccount` at the end, not a second
 * connection mechanism — the only difference is how the relay was found.
 */

import { useCallback, useState, useMemo } from 'react';
import type { SignedGroupOpenInvitation } from '@calimero-network/mero-js';
import { useMero } from '../context';
import {
  bootstrapFromInvitation,
  type BootstrapResult,
} from './bootstrap-from-invitation';
import {
  readDelegatedCredential,
  readDelegatedSession,
  rememberRelay,
  type DelegatedCredential,
} from './session';

export interface UseDelegatedBootstrapOptions {
  /** Point at a cloud other than the hosted manager. For local rigs. */
  readonly cloudBaseUrl?: string;
}

export interface UseDelegatedBootstrapResult {
  /** The enrolled account and its certificate, or `null` if none was ever held. */
  readonly credential: DelegatedCredential | null;
  /**
   * Whether this account is signed in with nowhere to write.
   *
   * True means: an enrolled credential is held and no relay is known for it, so
   * the account→relay lookup has nothing and an invitation is what changes that.
   * Being signed in is NOT the missing part — that is the whole point, since you
   * have to be signed in to be invited.
   *
   * False covers "already has a relay" and "never enrolled", which need the two
   * other entry points rather than this one.
   */
  readonly needsBootstrap: boolean;
  readonly running: boolean;
  /** The last attempt's outcome, kept so a UI can name the failing step. */
  readonly result: BootstrapResult | null;
  /**
   * Admit this account to the invitation's namespace and connect through the
   * admitting node.
   *
   * Resolves rather than throws for every expected refusal: the step names are
   * the point, because an empty intersection, an unreachable admitter and a
   * namespace with no fleet assignment need three different actions.
   */
  readonly bootstrap: (input: {
    readonly namespaceId: string;
    readonly invitation: SignedGroupOpenInvitation;
    /**
     * A node to present the join to, skipping the cloud lookup — an operator's,
     * a local rig's, or one a future invitation carries.
     */
    readonly nodeUrl?: string;
    /** The context the invitation is for, so its relay is known before any listing. */
    readonly contextId?: string;
  }) => Promise<BootstrapResult>;
}

export function useDelegatedBootstrap(
  options: UseDelegatedBootstrapOptions = {},
): UseDelegatedBootstrapResult {
  const { connectWithAccount, cloudBaseUrl: providerCloud } = useMero();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BootstrapResult | null>(null);

  // Read at render rather than held in state: the record is written by the
  // enrolment return in `ConnectButtonAccount`, in the same tab but outside
  // React's knowledge, so a cached copy would be stale exactly once — on the
  // load where it matters.
  //
  // Read every render, but the same object while its contents are the same:
  // a fresh parse each time made every callback below new on every render, and
  // an app with any of them in an effect's dependencies looped ("Maximum update
  // depth exceeded").
  const read = readDelegatedCredential();
  const credential = useMemo(
    () => read,
    // Keyed on the contents, not the parsed object.
    [read?.account, read?.credential, read?.deviceSecret],
  );
  // The stored record rather than the context's `nodeUrl`: that one is seeded
  // from `getNodeUrl()`, which can still hold a node URL from an earlier
  // node-login on this origin, and a stale value there would hide the very state
  // this reports.
  const relayUrl = readDelegatedSession()?.relayUrl ?? null;

  const cloudBaseUrl = options.cloudBaseUrl ?? providerCloud;
  const bootstrap = useCallback(
    async (input: {
      namespaceId: string;
      invitation: SignedGroupOpenInvitation;
      nodeUrl?: string;
      contextId?: string;
    }): Promise<BootstrapResult> => {
      const held = readDelegatedCredential();
      if (!held) {
        const failure: BootstrapResult = {
          ok: false,
          step: 'no-credential',
          reason:
            'This tab holds no enrolled account, so there is no identity to admit. Enrol with ' +
            'your account first — the invitation is then what gives it its first membership.',
        };
        setResult(failure);
        return failure;
      }
      setRunning(true);
      try {
        const outcome = await bootstrapFromInvitation({
          namespaceId: input.namespaceId,
          invitation: input.invitation,
          credential: held,
          nodeUrl: input.nodeUrl,
          cloudBaseUrl,
        });
        setResult(outcome);
        // Connected only on a node that actually took the join. A session
        // installed after a refusal would look connected and refuse every write,
        // which is the failure this whole path exists to avoid.
        if (outcome.ok) {
          // Added to the account's relay map, never replacing it: the relays
          // that serve its other namespaces stay reachable.
          if (outcome.session.relayUrl) {
            rememberRelay(held.account, outcome.session.relayUrl, {
              namespaceId: input.namespaceId,
              contextId: input.contextId,
            });
          }
          connectWithAccount(outcome.session);
        }
        return outcome;
      } finally {
        setRunning(false);
      }
    },
    [cloudBaseUrl, connectWithAccount],
  );

  return {
    credential,
    needsBootstrap: credential !== null && relayUrl === null,
    running,
    result,
    bootstrap,
  };
}
