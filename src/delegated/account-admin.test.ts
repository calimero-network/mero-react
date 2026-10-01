import { describe, expect, it, vi } from 'vitest';
import { createAccountAdmin, NoRelayError, NotForAccountError } from './account-admin';

const S = { account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: 'http://relay' };
const NS = '01'.repeat(32), SUB = '02'.repeat(32), CTX = '03'.repeat(32), ME = S.account, BOB = 'bb'.repeat(32);

function rig() {
  const govern = {
    group: vi.fn(async (_s, groupId: string) => ({ groupId })),
    root: vi.fn(async (_s, _groupId: string) => ({ groupId: SUB })),
  };
  const read = {
    getContextGroup: vi.fn(async () => SUB),
    listGroupMembers: vi.fn(async () => ({ members: [{ identity: ME, role: 'Admin' }] })),
    getGroupInfo: vi.fn(async () => ({ groupId: NS, targetApplicationId: 'ap'.repeat(32), appKey: 'ak'.repeat(32), namespaceId: NS })),
    listNamespaces: vi.fn(async () => [{ namespaceId: NS }]),
  };
  read.listNamespaces.mockResolvedValue([
    { namespaceId: NS, targetApplicationId: 'ap'.repeat(32) },
    { namespaceId: SUB, targetApplicationId: 'zz'.repeat(32) },
  ] as never);
  const deps = {
    govern,
    createContext: vi.fn(async () => ({ contextId: CTX })),
    found: vi.fn(async () => ({ namespaceId: NS, teeEnabled: true })),
    latestVersion: vi.fn(async () => '1.2.3'),
    signInvitation: vi.fn(async () => ({ invitation: { group_id: NS }, inviter_signature: 'sig' })),
  };
  const admin = createAccountAdmin(
    { session: S, read: read as never, app: { packageName: 'com.calimero.chat', registryUrl: 'https://reg' } },
    deps as never,
  );
  return { admin, govern, read, deps };
}

describe('createAccountAdmin', () => {
  it('reads go to the relay read client unchanged', async () => {
    const { admin, read } = rig();
    await expect(admin.listNamespaces()).resolves.toHaveLength(2);
    expect(read.listNamespaces).toHaveBeenCalledOnce();
  });

  it('lists its namespaces for an application from its own scoped list', async () => {
    // The node-wide `for-application` route is not caller-scoped, so the relay
    // refuses it to an account; its own list, filtered, is the same answer.
    const { admin } = rig();
    await expect(admin.listNamespacesForApplication('ap'.repeat(32))).resolves.toEqual([
      { namespaceId: NS, targetApplicationId: 'ap'.repeat(32) },
    ]);
  });

  it('is the account itself when asked who it is', async () => {
    const { admin } = rig();
    await expect(admin.getNodeIdentity()).resolves.toMatchObject({ accountId: ME });
  });

  it('creates a subgroup through the namespace and remembers which namespace it is in', async () => {
    const { admin, govern } = rig();
    await expect(admin.createGroupInNamespace(NS, { groupName: 'general', visibility: 'open' })).resolves.toEqual({ groupId: SUB });
    expect(govern.root).toHaveBeenCalledWith(S, NS, expect.objectContaining({ kind: 'root' }));
    // the name is set on the subgroup itself, as a group op
    expect(govern.group).toHaveBeenCalledWith(S, SUB, expect.objectContaining({ kind: 'group' }));
  });

  it('member, metadata, visibility and capability writes are group ops on the named group', async () => {
    const { admin, govern } = rig();
    await admin.addGroupMembers(SUB, { members: [{ identity: BOB, role: 'Member' }] });
    await admin.removeGroupMembers(SUB, { members: [BOB] });
    await admin.setGroupMetadata(SUB, { name: 'general' });
    await admin.setMemberMetadata(SUB, BOB, { name: 'Bob' });
    await admin.setContextMetadata(SUB, CTX, { name: 'room' });
    await admin.setDefaultCapabilities(SUB, { defaultCapabilities: 231 });
    await admin.setSubgroupVisibility(SUB, { subgroupVisibility: 'restricted' });
    await admin.setMemberCapabilities(SUB, BOB, { capabilities: 1 });
    expect(govern.group).toHaveBeenCalledTimes(8);
    for (const call of govern.group.mock.calls) expect(call[1]).toBe(SUB);
  });

  it('delete and reparent are root ops; leaving is my own MemberLeft', async () => {
    const { admin, govern } = rig();
    await expect(admin.deleteGroup(SUB)).resolves.toEqual({ isDeleted: true });
    await expect(admin.reparentGroup(SUB, { newParentId: NS })).resolves.toEqual({ reparented: true });
    expect(govern.root).toHaveBeenCalledTimes(2);
    await admin.leaveGroup(SUB);
    expect(govern.group).toHaveBeenLastCalledWith(S, SUB, expect.objectContaining({ kind: 'group' }));
  });

  it('joins an open channel by its context: MemberJoinedOpen on the context group', async () => {
    const { admin, govern, read } = rig();
    read.listGroupMembers.mockResolvedValueOnce({ members: [{ identity: BOB, role: 'Admin' }] });
    await expect(admin.joinContext(CTX)).resolves.toEqual({ contextId: CTX, memberPublicKey: ME });
    expect(read.getContextGroup).toHaveBeenCalledWith(CTX);
    expect(govern.root).toHaveBeenCalledWith(S, SUB, expect.objectContaining({ kind: 'root' }));
  });

  it('joining a context whose group it already belongs to is a no-op, as on a node', async () => {
    // Core refuses MemberJoinedOpen from a direct member (409), and a node's
    // joinContext for a context it already holds just succeeds.
    const { admin, govern } = rig();
    await expect(admin.joinContext(CTX)).resolves.toEqual({ contextId: CTX, memberPublicKey: ME });
    expect(govern.root).not.toHaveBeenCalled();
  });

  // An account runs as itself in every context it can reach: the relay executes
  // as the account, so the account IS its identity there. Answering with it is
  // what lets an app tell "joined" from "not joined" the way it does on a node.
  it('owns its account as the identity of a context whose group it belongs to', async () => {
    const { admin } = rig();
    await expect(admin.getContextIdentitiesOwned(CTX)).resolves.toEqual({ identities: [ME] });
  });

  it('owns no identity in a context whose group it has not joined', async () => {
    const { admin, read } = rig();
    read.listGroupMembers.mockResolvedValueOnce({ members: [{ identity: BOB, role: 'Admin' }] });
    await expect(admin.getContextIdentitiesOwned(CTX)).resolves.toEqual({ identities: [] });
  });

  it('creates a context through the relay, in the group it names', async () => {
    const { admin, deps } = rig();
    await expect(admin.createContext({ applicationId: 'ap'.repeat(32), groupId: SUB, name: 'room' })).resolves.toMatchObject({ contextId: CTX });
    expect(deps.createContext).toHaveBeenCalledWith(S, expect.objectContaining({ groupId: SUB, name: 'room' }));
  });

  it("founds a namespace with this app's package at the registry's latest version", async () => {
    const { admin, deps } = rig();
    await expect(admin.createNamespace({ applicationId: 'ap'.repeat(32), name: 'Team' })).resolves.toMatchObject({ namespaceId: NS });
    expect(deps.found).toHaveBeenCalledWith(S, expect.objectContaining({ application: { applicationId: 'ap'.repeat(32), package: 'com.calimero.chat', version: '1.2.3' } }));
  });

  it("signs an invitation itself, defaulting the admitters to the group's members", async () => {
    const { admin, deps, read } = rig();
    const out = await admin.createNamespaceInvitation(NS);
    expect(read.listGroupMembers).toHaveBeenCalledWith(NS);
    expect(deps.signInvitation).toHaveBeenCalledWith(expect.objectContaining({ groupId: NS, inviterAccount: ME, deviceSecret: S.deviceSecret }));
    expect(out).toMatchObject({ invitation: { inviter_signature: 'sig' } });
  });

  it('a node-only write is refused by name, never sent to a node route', async () => {
    const { admin } = rig();
    await expect(admin.upgradeGroup(NS, {} as never)).rejects.toBeInstanceOf(NotForAccountError);
    await expect(admin.installApplication({} as never)).rejects.toBeInstanceOf(NotForAccountError);
  });

  it('syncGroup is a no-op for an account: the relay syncs', async () => {
    const { admin } = rig();
    await expect(admin.syncGroup(NS)).resolves.toBeDefined();
  });

  it('a subgroup created in the second of two namespaces is written to that namespace', async () => {
    const { admin, govern } = rig();
    const NS2 = '09'.repeat(32);
    await admin.createGroupInNamespace(NS2, { groupName: 'general' });
    expect(govern.root).toHaveBeenLastCalledWith(S, NS2, expect.anything());
  });
});

describe('createAccountAdmin with no relay yet', () => {
  const fresh = createAccountAdmin({ session: { ...S, relayUrl: null } as never, read: null, app: {} });

  it('is a member of nothing: the listings are empty', async () => {
    await expect(fresh.listNamespaces()).resolves.toEqual([]);
    await expect(fresh.getContexts()).resolves.toEqual({ contexts: [] });
    await expect(fresh.listNamespacesForApplication('ap'.repeat(32))).resolves.toEqual([]);
  });

  it('still knows who it is', async () => {
    await expect(fresh.getNodeIdentity()).resolves.toMatchObject({ accountId: ME });
  });

  it('refuses anything else by name, as a missing relay', async () => {
    await expect(fresh.getGroupInfo(NS)).rejects.toBeInstanceOf(NoRelayError);
    await expect(fresh.setGroupMetadata(NS, { name: 'x' })).rejects.toBeInstanceOf(NoRelayError);
  });
});
