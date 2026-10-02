/**
 * An account's admin API: the same method names and types as mero-js's
 * `AdminApiClient`, so an app written against a node's admin needs no second
 * code path. Reads go to the relay's caller-scoped admin client; writes go
 * through the relay as governance ops, delegated context and namespace
 * creation, or an invitation the account signs itself. A write with no
 * account form (upgrades, installs) is refused by name.
 */
import {
  type AdminApiClient,
  groupDeletedOp, groupMetadataSetOp, groupReparentedOp, memberAddedOp, memberCapabilitySetOp,
  memberJoinedOpenOp, memberLeftOp, memberMetadataSetOp, memberRemovedOp, contextMetadataSetOp,
  defaultCapabilitiesSetOp, signGroupInvitation, subgroupCreation, subgroupVisibilitySetOp,
  memberRoleSetOp, contextDetachedOp,
  type GovernanceMemberRole, type SignedGroupOpenInvitation,
} from '@calimero-network/mero-js';
import type { DelegatedSession } from './session';
import { governGroup, governRoot, namespaceOfGroup, rememberGroupNamespace } from './govern';
import { createDelegatedContext, foundDelegatedNamespace, latestPublishedVersion } from './create-context';

export class NotForAccountError extends Error {
  constructor(readonly method: string) {
    super(`${method} is not available for an account: it needs a node`);
    this.name = 'NotForAccountError';
  }
}

/**
 * An account that has enrolled but joined nothing has no relay: nothing serves
 * it yet. Its listings are empty, which is true; anything else names this.
 */
export class NoRelayError extends Error {
  constructor(readonly method: string) {
    super(`${method} needs a relay, and this account has none yet: join from an invitation first`);
    this.name = 'NoRelayError';
  }
}

/** What an account with no relay answers: it is a member of nothing. */
const EMPTY_READS: Partial<Record<keyof AdminApiClient, () => Promise<unknown>>> = {
  listNamespaces: async () => [],
  listNamespacesForApplication: async () => [],
  getContexts: async () => ({ contexts: [] }),
};

export interface AccountAdminDeps {
  govern?: { group: typeof governGroup; root: typeof governRoot };
  createContext?: typeof createDelegatedContext;
  found?: typeof foundDelegatedNamespace;
  latestVersion?: (registryUrl: string, pkg: string) => Promise<string>;
  signInvitation?: typeof signGroupInvitation;
  /**
   * Redeem an invitation for this account: resolve the relay the invitation
   * names, have it admit the account, and switch the session onto that relay.
   * The provider supplies it (it owns the session); without it a join is
   * refused by name. Rejects with the refusal's reason and HTTP `status`.
   */
  join?: (namespaceId: string, invitation: SignedGroupOpenInvitation) => Promise<{ namespaceId: string }>;
}

/**
 * Calls with no account form: refused by name, so an app sees why rather than
 * the bare 403 a relay gives a call its session may not make. Everything not
 * listed and not overridden below is a read, answered by the relay.
 *
 * - Upgrades, installs, a node's own context identity: a node's to do.
 * - `deleteContext`: a node drops its own copy and the group keeps the context.
 *   An account's copy is the relay's, shared with every account it serves;
 *   removing a context for the group is `detachContextFromGroup` or
 *   `deleteGroup`.
 * - Aliases, read or written: they are a node's own names, and a relay's are the
 *   relay's. Core gives an account session no alias permission.
 * - Deleting a namespace, legacy group invitations and joins, TEE policy, blob
 *   deletion: core has no delegated form for them.
 * - Account devices: the wallet manages them, not an app.
 *
 * Upgrade and cascade status are NOT here: core 0.11.0-rc.76 (#4392) serves an
 * account its own groups' status, so those go to the relay. Migration status
 * stays until core checks the caller rather than the relay for it.
 */
const NODE_ONLY = new Set([
  'upgradeGroup', 'retryGroupUpgrade', 'abortMigration', 'installApplication', 'installDevApplication',
  'uninstallApplication', 'generateContextIdentity', 'deleteContext',
  // A node's leaveContext is a local opt-out (a tombstone, its own identity rows)
  // and publishes nothing; an account has nothing local to opt out of, and
  // leaving the context's group instead is leaveGroup.
  'leaveContext',
  'createContextAlias', 'createApplicationAlias', 'createDeviceAlias',
  'deleteContextAlias', 'deleteApplicationAlias', 'deleteDeviceAlias',
  'lookupContextAlias', 'lookupApplicationAlias', 'lookupDeviceAlias',
  'listContextAliases', 'listApplicationAliases', 'listDeviceAliases',
  'deleteNamespace', 'createGroupInvitation', 'joinGroup',
  'setTeeAdmissionPolicy', 'getTeeAdmissionPolicy', 'deleteBlob',
  'listAccountDevices', 'revokeAccountDevice',
  // Core rc.76 asks the NODE to be the namespace admin for this read, which a
  // relay is not, so an account that is the admin is answered a bare 403.
  // Refused by name until core checks the caller, as it does for the other two.
  'getMigrationStatus',
]);

/**
 * Core's refusal of a MemberJoinedOpen from someone already a direct member
 * (`AlreadyDirectMember`, answered 409): "signer … is a direct member; use
 * MemberJoined or add_group_members instead". Not to be confused with "is not a
 * direct member", which a leave by an inherited member gets.
 */
function isAlreadyDirectMember(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as { status?: number }).status;
  return (status === undefined || status === 409) && /signer [0-9a-f]+ is a direct member/i.test(e.message);
}

export function createAccountAdmin(
  input: { session: DelegatedSession; read: AdminApiClient | null; app: { packageName?: string; packageVersion?: string; registryUrl?: string } },
  deps: AccountAdminDeps = {},
): AdminApiClient {
  const { session: s, read, app } = input;
  const governGroupOp = deps.govern?.group ?? governGroup;
  const governRootOp = deps.govern?.root ?? governRoot;
  const createContext = deps.createContext ?? createDelegatedContext;
  const found = deps.found ?? foundDelegatedNamespace;
  const latestVersion = deps.latestVersion ?? latestPublishedVersion;
  const signInvitation = deps.signInvitation ?? signGroupInvitation;
  const join = deps.join;

  // Reachable with or without a relay: the join is how an account gets one.
  async function joinNamespace(namespaceId: string, req: { invitation: SignedGroupOpenInvitation }) {
    if (!join) throw new NotForAccountError('joinNamespace without a join handler');
    return join(namespaceId, req.invitation);
  }

  // Only reached through the relay proxy below, so a null here is unreachable;
  // the guard keeps the types honest rather than asserting it away.
  const relay = (): AdminApiClient => {
    if (read === null) throw new NoRelayError('this call');
    return read;
  };

  // A group or root op is posted to the group's namespace. A subgroup this
  // account neither created nor joined (an open channel someone else made) is
  // one the relay can name: ask it once, as `createContext` does, and remember.
  async function knowNamespaceOf(groupId: string): Promise<void> {
    if (namespaceOfGroup(s, groupId)) return;
    const info = await relay().getGroupInfo(groupId);
    rememberGroupNamespace(s.account, groupId, (info as { namespaceId?: string }).namespaceId ?? groupId);
  }
  const group: typeof governGroup = async (session, groupId, op) => {
    await knowNamespaceOf(groupId);
    return governGroupOp(session, groupId, op);
  };
  const root: typeof governRoot = async (session, groupId, op) => {
    await knowNamespaceOf(groupId);
    return governRootOp(session, groupId, op);
  };

  // MemberJoinedOpen on `groupId`, as a node's join sends it: a member who only
  // inherits becomes a direct one, and a direct member's join is a no-op. The
  // member list cannot tell those two apart (it lists inherited members too), so
  // the join is sent and core's refusal of a direct member is the no-op.
  // Returns whether this join made the account a member.
  async function joinOpen(groupId: string): Promise<boolean> {
    try {
      await root(s, groupId, memberJoinedOpenOp({ member: s.account, groupId, credential: s.credential }));
      return true;
    } catch (e) {
      if (isAlreadyDirectMember(e)) return false;
      throw e;
    }
  }

  async function isMemberOfContextGroup(contextId: string, knownGroupId?: string): Promise<boolean> {
    const groupId = knownGroupId ?? String(await relay().getContextGroup(contextId));
    const { members } = await relay().listGroupMembers(groupId);
    return members.some((m) => m.identity.toLowerCase() === s.account.toLowerCase());
  }

  const writes: Partial<Record<keyof AdminApiClient, unknown>> = {
    // The node-wide `for-application` listing is not caller-scoped, so a relay
    // refuses it to an account. Its own scoped list, filtered, is the answer.
    async listNamespacesForApplication(applicationId: string) {
      return (await relay().listNamespaces()).filter((ns) => ns.targetApplicationId === applicationId);
    },
    async getNodeIdentity() {
      return { accountId: s.account, deviceId: null, publicKey: '', deviceCertified: true };
    },
    async createNamespace(req: { applicationId: string; name?: string }) {
      if (!app.packageName) throw new NotForAccountError('createNamespace without a packageName');
      const version = app.packageVersion ?? (await latestVersion(app.registryUrl ?? 'https://apps.calimero.network', app.packageName));
      const { namespaceId } = await found(s, {
        defaultCapabilities: 231,
        application: { applicationId: req.applicationId, package: app.packageName, version },
      });
      if (req.name) await group(s, namespaceId, groupMetadataSetOp({ name: req.name }));
      return { namespaceId };
    },
    async createGroupInNamespace(namespaceId: string, req: { groupName?: string; visibility?: 'open' | 'restricted' } = {}) {
      const { op } = await subgroupCreation({ parentId: namespaceId, restricted: req.visibility !== 'open', admin: s.account });
      const { groupId } = await root(s, namespaceId, op);
      rememberGroupNamespace(s.account, groupId, namespaceId);
      if (req.groupName) await group(s, groupId, groupMetadataSetOp({ name: req.groupName }));
      return { groupId };
    },
    async addGroupMembers(groupId: string, req: { members: { identity: string; role?: string }[] }) {
      for (const m of req.members) await group(s, groupId, memberAddedOp(m.identity, (m.role ?? 'Member') as never));
    },
    async removeGroupMembers(groupId: string, req: { members: string[] }) {
      for (const m of req.members) await group(s, groupId, memberRemovedOp(m));
    },
    async setGroupMetadata(groupId: string, req: { name?: string; data?: Record<string, string> }) {
      await group(s, groupId, groupMetadataSetOp(req));
    },
    async setMemberMetadata(groupId: string, identity: string, req: { name?: string; data?: Record<string, string> }) {
      await group(s, groupId, memberMetadataSetOp(identity, req));
    },
    async setContextMetadata(groupId: string, contextId: string, req: { name?: string; data?: Record<string, string> }) {
      await group(s, groupId, contextMetadataSetOp(contextId, req));
    },
    async setDefaultCapabilities(groupId: string, req: { defaultCapabilities: number }) {
      await group(s, groupId, defaultCapabilitiesSetOp(req.defaultCapabilities));
    },
    async setSubgroupVisibility(groupId: string, req: { subgroupVisibility: string }) {
      await group(s, groupId, subgroupVisibilitySetOp(req.subgroupVisibility === 'open' ? 'open' : 'restricted'));
    },
    async setMemberCapabilities(groupId: string, identity: string, req: { capabilities: number }) {
      await group(s, groupId, memberCapabilitySetOp(identity, req.capabilities));
    },
    async deleteGroup(groupId: string) {
      await root(s, groupId, groupDeletedOp(groupId));
      return { isDeleted: true };
    },
    async reparentGroup(childGroupId: string, req: { newParentId: string }) {
      await root(s, childGroupId, groupReparentedOp(childGroupId, req.newParentId));
      return { reparented: true };
    },
    async leaveGroup(groupId: string) {
      await group(s, groupId, memberLeftOp(s.account));
    },
    async leaveNamespace(namespaceId: string) {
      await group(s, namespaceId, memberLeftOp(s.account));
    },
    // An account runs as itself in every context it can reach (the relay
    // executes as the account), so its identity there is the account. Owned
    // when its account is a member of the context's group, as on a node a
    // context identity is owned once the node has joined.
    async getContextIdentitiesOwned(contextId: string) {
      return { identities: (await isMemberOfContextGroup(contextId)) ? [s.account] : [] };
    },
    async joinContext(contextId: string) {
      await joinOpen(String(await relay().getContextGroup(contextId)));
      return { contextId, memberPublicKey: s.account };
    },
    async createContext(req: { applicationId: string; groupId: string; name?: string; initializationParams?: number[] }) {
      const info = await relay().getGroupInfo(req.groupId);
      const namespaceId = (info as { namespaceId?: string }).namespaceId ?? req.groupId;
      const { contextId } = await createContext(s, {
        namespaceId, groupId: req.groupId, applicationId: req.applicationId,
        name: req.name, initializationParams: req.initializationParams,
      });
      return { contextId, memberPublicKey: '', groupId: req.groupId };
    },
    async createNamespaceInvitation(namespaceId: string) {
      const [{ members }, info] = await Promise.all([relay().listGroupMembers(namespaceId), relay().getGroupInfo(namespaceId)]);
      // The relays admit: whoever claims an account's invitation may have no
      // node, and only a relay can admit a joiner with none. With no relay in
      // the namespace, leave it to the admins (signGroupInvitation's default).
      const relays = members
        .filter((m) => m.role === 'RelayTee')
        .map((m) => m.identity.toLowerCase());
      const invitation = await signInvitation({
        groupId: namespaceId,
        inviterAccount: s.account,
        deviceSecret: s.deviceSecret,
        ...(relays.length > 0 ? { admitters: relays } : {}),
        members: members as never,
        applicationId: (info as { targetApplicationId?: string }).targetApplicationId,
        appKey: (info as { appKey?: string }).appKey,
      });
      return { invitation };
    },
    // The relay syncs its own view; an account has nothing to pull.
    async syncGroup(groupId: string) {
      return { groupId, synced: true };
    },
    async syncContext() {},
    joinNamespace,
    async updateMemberRole(groupId: string, identity: string, req: { role: string }) {
      await group(s, groupId, memberRoleSetOp(identity, req.role as GovernanceMemberRole));
    },
    // An open subgroup is joined the way `joinContext` joins one: MemberJoinedOpen
    // on the subgroup, and nothing to do for a member already in it.
    async joinSubgroupInheritance(groupId: string) {
      return { groupId, memberPublicKey: s.account, wasInherited: await joinOpen(groupId) };
    },
    async detachContextFromGroup(groupId: string, contextId: string) {
      await group(s, groupId, contextDetachedOp(contextId));
    },
  };

  if (read === null) {
    return new Proxy({} as AdminApiClient, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'getNodeIdentity') return writes.getNodeIdentity;
        if (prop === 'joinNamespace') return joinNamespace;
        if (prop in EMPTY_READS) return EMPTY_READS[prop as keyof AdminApiClient];
        return async () => {
          throw new NoRelayError(prop);
        };
      },
    });
  }

  return new Proxy(read, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in writes) return writes[prop as keyof AdminApiClient];
      if (typeof prop === 'string' && NODE_ONLY.has(prop)) {
        return async () => {
          throw new NotForAccountError(prop);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as AdminApiClient;
}
