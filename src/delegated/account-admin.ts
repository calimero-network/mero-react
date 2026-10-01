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
} from '@calimero-network/mero-js';
import type { DelegatedSession } from './session';
import { governGroup, governRoot, rememberGroupNamespace } from './govern';
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
}

/** Writes with no account form. Everything else not overridden is a read. */
const NODE_ONLY = new Set([
  'upgradeGroup', 'retryGroupUpgrade', 'abortMigration', 'installApplication', 'installDevApplication',
  'uninstallApplication', 'generateContextIdentity', 'deleteContext', 'createAlias', 'deleteAlias',
]);

export function createAccountAdmin(
  input: { session: DelegatedSession; read: AdminApiClient | null; app: { packageName?: string; packageVersion?: string; registryUrl?: string } },
  deps: AccountAdminDeps = {},
): AdminApiClient {
  const { session: s, read, app } = input;
  const group = deps.govern?.group ?? governGroup;
  const root = deps.govern?.root ?? governRoot;
  const createContext = deps.createContext ?? createDelegatedContext;
  const found = deps.found ?? foundDelegatedNamespace;
  const latestVersion = deps.latestVersion ?? latestPublishedVersion;
  const signInvitation = deps.signInvitation ?? signGroupInvitation;

  // Only reached through the relay proxy below, so a null here is unreachable;
  // the guard keeps the types honest rather than asserting it away.
  const relay = (): AdminApiClient => {
    if (read === null) throw new NoRelayError('this call');
    return read;
  };

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
    // An account holds no context identity: leaving a context is leaving its group.
    async leaveContext(contextId: string) {
      const groupId = await relay().getContextGroup(contextId);
      await group(s, String(groupId), memberLeftOp(s.account));
    },
    async joinContext(contextId: string) {
      const groupId = String(await relay().getContextGroup(contextId));
      await root(s, groupId, memberJoinedOpenOp({ member: s.account, groupId, credential: s.credential }));
      return { contextId, memberPublicKey: '' };
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
      const invitation = await signInvitation({
        groupId: namespaceId,
        inviterAccount: s.account,
        deviceSecret: s.deviceSecret,
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
  };

  if (read === null) {
    return new Proxy({} as AdminApiClient, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'getNodeIdentity') return writes.getNodeIdentity;
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
