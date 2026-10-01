/**
 * Join a namespace and one of its contexts from an invitation — the same call
 * whatever the connection is.
 *
 *  - A node login publishes its own membership op (`joinNamespace`) and joins
 *    the context (`joinContext`) on that node.
 *  - An account (no node) signs the join with its device key and hands it to
 *    an admitter the invitation names (`useDelegatedBootstrap`); from then on it
 *    reaches the namespace through that relay.
 *
 * The app gets one result shape back either way, including whether the failure
 * is FINAL — worth discarding the invitation for — or worth retrying.
 */
import { useCallback, useState } from 'react';
import type { InviteRedeemer, SignedGroupOpenInvitation } from '@calimero-network/mero-js';
import { useMero } from '../context';
import { useDelegatedBootstrap } from '../delegated/useDelegatedBootstrap';
import type { BootstrapFailure } from '../delegated/bootstrap-from-invitation';
import { listDelegatedNamespaces, readDelegatedSession } from '../delegated/session';

/** The HTTP status an error carries, read the way mero-js's classifier reads it. */
function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const c of [e.status, e.response?.status, e.statusCode]) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return undefined;
}

export interface JoinInvitationInput {
  readonly namespaceId: string;
  /** The context the invitation was for, when it names one; a workspace invitation names none. */
  readonly contextId?: string;
  readonly invitation: SignedGroupOpenInvitation;
}

export type JoinInvitationStep = BootstrapFailure['step'] | 'node-join';

export type JoinInvitationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly step: JoinInvitationStep;
      /** What went wrong, in words a person can act on. */
      readonly reason: string;
      /** True when no retry can succeed: a fresh invitation is the only cure. */
      readonly final: boolean;
      /** The HTTP status of the refusal, when there was one. */
      readonly status?: number;
    };

/** Which step failed, in the words a person can act on. */
const STEP_LABEL: Record<BootstrapFailure['step'], string> = {
  'no-credential': 'No enrolled account',
  'admitters-lookup': 'Admitters lookup failed',
  'no-nodes': 'No hosted node serves this namespace',
  'not-invited': 'This invitation names none of the serving nodes',
  'invited-unreachable': 'The invited admitter cannot take a join right now',
  'no-relay-url': 'The invited admitter has no address yet',
  sign: 'The join could not be signed',
  admit: 'The admitter refused the join',
};

/**
 * Whether an account's join failure is final. Per step: an admitter's 400/403
 * judged the op or the invitation; `not-invited` and `sign` fail identically
 * next time. Everything else (a lookup, an unreachable admitter, no fleet
 * assignment yet, a 409) is kept for a retry.
 */
function accountJoinIsFinal(failure: BootstrapFailure): boolean {
  if (failure.step === 'admit') return failure.status === 400 || failure.status === 403;
  return failure.step === 'not-invited' || failure.step === 'sign';
}

/**
 * Whether a node's join failure means the invitation itself will never work.
 *
 * Errs toward false: a dropped invitation is unrecoverable for the user, a
 * retried one costs a round trip, so a timeout or anything unfamiliar keeps
 * it. Phrases, not bare words — `"invalid"` alone would also match an
 * "invalid response" from a proxy, a transient failure.
 */
export function isFinalInvitationError(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return [
    'invitation expired',
    'expired invitation',
    'invalid invitation',
    'invitation is invalid',
    'malformed invitation',
    'malformed payload',
    'invalid signature',
    'signature verification failed',
    'not admin',
    'revoked',
    'already a member',
  ].some((t) => m.includes(t));
}

export function useJoinInvitation(): {
  joinInvitation: (input: JoinInvitationInput) => Promise<JoinInvitationResult>;
  joining: boolean;
  /** The namespaces this connection is a member of: a node's own, or an account's across its relays. */
  memberships: () => Promise<string[]>;
  /**
   * The `{ join, memberships }` pair mero-js's `redeemInvitation` drives, for
   * whichever connection this is, so an app redeems an invitation (join once,
   * then check membership) with no transport of its own. `join` throws on a
   * refusal, carrying its HTTP status for the outcome's reason.
   */
  invitationRedeemer: (input: JoinInvitationInput) => InviteRedeemer;
} {
  const { mero, isDelegated } = useMero();
  const { credential, bootstrap } = useDelegatedBootstrap();
  const [joining, setJoining] = useState(false);

  const joinInvitation = useCallback(
    async (input: JoinInvitationInput): Promise<JoinInvitationResult> => {
      setJoining(true);
      try {
        // An account joins through an admitter: when the connection is one, or
        // when an account is enrolled and no node session exists. A node login
        // joins on its own node even if a credential lingers in this tab.
        const asAccount = isDelegated || (credential !== null && mero === null);
        if (asAccount) {
          const outcome = await bootstrap({
            namespaceId: input.namespaceId,
            invitation: input.invitation,
            contextId: input.contextId,
          });
          if (outcome.ok) return { ok: true };
          return {
            ok: false,
            step: outcome.step,
            reason: `${STEP_LABEL[outcome.step]}. ${outcome.reason}`,
            final: accountJoinIsFinal(outcome),
            ...(outcome.status !== undefined ? { status: outcome.status } : {}),
          };
        }

        if (!mero) {
          return { ok: false, step: 'node-join', reason: 'Not connected to a node.', final: false };
        }
        // The admin client directly, not the join hooks: those swallow errors
        // (they resolve to null), which would report a failed join as joined.
        await mero.admin.joinNamespace(input.namespaceId, { invitation: input.invitation });
        if (input.contextId) await mero.admin.joinContext(input.contextId);
        return { ok: true };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        const status = statusOf(e);
        return {
          ok: false,
          step: 'node-join',
          reason,
          final: isFinalInvitationError(reason),
          ...(status !== undefined ? { status } : {}),
        };
      } finally {
        setJoining(false);
      }
    },
    [mero, isDelegated, credential, bootstrap],
  );

  const memberships = useCallback(async (): Promise<string[]> => {
    const asAccount = isDelegated || (credential !== null && mero === null);
    const ids = (list: ReadonlyArray<{ namespaceId?: string; groupId?: string; id?: string }>) =>
      list.map((n) => n.namespaceId ?? n.groupId ?? n.id ?? '').filter(Boolean);
    if (asAccount) {
      const session = readDelegatedSession();
      return session ? ids(await listDelegatedNamespaces(session)) : [];
    }
    if (!mero) return [];
    return ids((await mero.admin.listNamespaces()) as Array<{ namespaceId?: string; groupId?: string; id?: string }>);
  }, [mero, isDelegated, credential]);

  const invitationRedeemer = useCallback(
    (input: JoinInvitationInput): InviteRedeemer => ({
      join: async () => {
        const outcome = await joinInvitation(input);
        if (!outcome.ok) {
          throw Object.assign(new Error(outcome.reason), outcome.status !== undefined ? { status: outcome.status } : {});
        }
      },
      memberships,
    }),
    [joinInvitation, memberships],
  );

  return { joinInvitation, joining, memberships, invitationRedeemer };
}
