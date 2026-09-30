/**
 * An account's group management through a relay: one delegated governance op
 * per call (`RelayClient.govern`), posted to the relay that serves the group's
 * namespace.
 *
 * A group op goes to the group it acts on; a root op (create, delete, move a
 * subgroup; join an open one) goes to the NAMESPACE. An account cannot read a
 * group's details, so the namespace of a subgroup is known only if this
 * account created it or was told it — remembered here per account.
 */
import { type GovernanceOp } from '@calimero-network/mero-js';
import { delegatedGovernance } from './create-context';
import { readRelayMap, type DelegatedSession } from './session';

const GROUP_NAMESPACE_PREFIX = 'calimero.delegated.group-namespace.';

function readGroupNamespaces(account: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(GROUP_NAMESPACE_PREFIX + account) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Record that `groupId` is a subgroup of `namespaceId`, for this account. */
export function rememberGroupNamespace(account: string, groupId: string, namespaceId: string): void {
  try {
    const all = readGroupNamespaces(account);
    all[groupId] = namespaceId;
    localStorage.setItem(GROUP_NAMESPACE_PREFIX + account, JSON.stringify(all));
  } catch {
    /* unpersisted: root ops on this subgroup will ask for its namespace */
  }
}

/** The namespace a group belongs to: itself if it is a namespace this account is in, else what was remembered. */
export function namespaceOfGroup(s: DelegatedSession, groupId: string): string | undefined {
  if (readRelayMap(s.account).namespaces[groupId]) return groupId;
  return readGroupNamespaces(s.account)[groupId];
}

function requireNamespace(s: DelegatedSession, groupId: string): string {
  const ns = namespaceOfGroup(s, groupId);
  if (!ns) {
    throw new Error(
      `the namespace of group ${groupId} is not known to this account: it can manage only groups in namespaces it joined or subgroups it created`,
    );
  }
  return ns;
}

/** A group op (member, role, capabilities, metadata, visibility, detach) on `groupId`. */
export async function governGroup(s: DelegatedSession, groupId: string, op: GovernanceOp): Promise<{ groupId: string }> {
  return delegatedGovernance(s, { namespaceId: requireNamespace(s, groupId), group: groupId, op });
}

/** A root op, posted to the namespace `groupId` belongs to. */
export async function governRoot(s: DelegatedSession, groupId: string, op: GovernanceOp): Promise<{ groupId: string }> {
  const namespaceId = requireNamespace(s, groupId);
  return delegatedGovernance(s, { namespaceId, group: namespaceId, op });
}
