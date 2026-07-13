/**
 * Client-token seam test: a token minted the way the auth flow mints it
 * (root token → POST /admin/client-key with getPermissionsForMode strings)
 * must be able to call the routes the SDK uses after login.
 *
 * This is the test that was missing when core 0.11.0-rc.9 shipped scope
 * enforcement: core's unit tests asserted the enforcement, the frontends
 * tested against mocks, and this suite's other files authenticate as root
 * admin — so no CI anywhere exercised the scoped client token every real
 * app actually holds. Result: minted tokens 403'd on every route and apps
 * looped on login.
 *
 * Twins:
 *  - core/crates/auth/tests/client_token_contract.rs (validator-level pin)
 *  - auth-frontend src/__tests__/client-key-permissions.test.tsx
 *    (permissions reach /admin/client-key untouched)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';
import { authedMero, ensureApplication, resolveBaseUrl, runId } from './harness';

/** Keep in sync with getPermissionsForMode(AppMode.MultiContext). */
const MULTI_CONTEXT_PERMISSIONS = [
  'context:create',
  'context:list',
  'context:execute',
  'application:list',
  'namespace',
  'group',
  'blob',
  'context:alias',
];

let root: MeroJs;
let client: MeroJs;
let accessToken: string;
let applicationId: string;
let namespaceId: string;
/** Namespaces the CLIENT creates in tests; cleaned up as root in afterAll. */
const clientNamespaces: string[] = [];

beforeAll(async () => {
  root = await authedMero();
  applicationId = await ensureApplication(root);

  // Shared fixture namespace. Created as root so a failure in the client's
  // own namespace-create test can't cascade into every other test here.
  const ns = await root.admin.createNamespace({
    applicationId,
    upgradePolicy: 'LazyOnAccess',
    name: `ct-${runId()}`,
  });
  namespaceId = ns.namespaceId;

  // Mint the client key exactly like auth-frontend does for multi-context
  // mode: empty context binding, requested permissions passed through.
  const minted = await root.auth.generateClientKey({
    context_id: '',
    context_identity: '',
    permissions: MULTI_CONTEXT_PERMISSIONS,
  });

  accessToken = minted.data.access_token;
  client = new MeroJs({ baseUrl: resolveBaseUrl(), timeoutMs: 0 });
  client.setTokenData({
    access_token: minted.data.access_token,
    refresh_token: minted.data.refresh_token,
    expires_at: Date.now() + 3_600_000,
  });
}, 60000);

afterAll(async () => {
  if (namespaceId) await root?.admin.deleteNamespace(namespaceId).catch(() => {});
  for (const ns of clientNamespaces) {
    await root?.admin.deleteNamespace(ns).catch(() => {});
  }
  client?.close();
  root?.close();
});

describe('e2e — multi-context client token (the token real apps hold)', () => {
  it('passes the session gate: /auth/validate accepts it', async () => {
    // mero-react's checkAuth (PR #41) rides on this being permission-free.
    const result = await client.auth.validateToken(accessToken);
    expect(result.valid).toBe(true);
  });

  it('can list contexts (context:list — the pre-4.1 auth gate route)', async () => {
    await expect(client.admin.getContexts()).resolves.toBeDefined();
  });

  it('can create a context in an existing namespace (context:create)', async () => {
    const ctx = await client.admin.createContext({ applicationId, groupId: namespaceId });
    expect(ctx.contextId).toBeTruthy();
  });

  it('can execute RPC in its context (context:execute)', async () => {
    const ctx = await client.admin.createContext({ applicationId, groupId: namespaceId });
    const key = `ct-${runId()}`;
    await client.rpc.execute({
      contextId: ctx.contextId,
      method: 'set',
      argsJson: { key, value: 'client-token-e2e' },
    });
    const got = await client.rpc.execute<string>({
      contextId: ctx.contextId,
      method: 'get',
      argsJson: { key },
    });
    expect(got).toBe('client-token-e2e');
  });

  // ── Governance + blob + alias battery (core ≥0.11.0-rc.11, core#3201) ──────
  // One test per grant↔route pair that was admin-only on rc.9/rc.10. If any of
  // these regress, apps break in exactly the way the rc.9 release broke them —
  // this suite runs against the newest released merod in CI, so a core release
  // that loses a mapping (or a grant this SDK stops requesting) fails here.

  it('can list applications (application:list — GET /admin-api/applications)', async () => {
    const { apps } = await client.admin.listApplications();
    expect(apps.some((a) => a.id === applicationId)).toBe(true);
  });

  it('can get one application (application:list, specific)', async () => {
    await expect(client.admin.getApplication(applicationId)).resolves.toBeDefined();
  });

  it('can create a namespace (namespace — was the rc.9/rc.10 KNOWN GAP)', async () => {
    const ns = await client.admin.createNamespace({
      applicationId,
      upgradePolicy: 'LazyOnAccess',
      name: `ct-own-${runId()}`,
    });
    expect(ns.namespaceId).toBeTruthy();
    clientNamespaces.push(ns.namespaceId);
  });

  it('can list + get namespaces (namespace list routes)', async () => {
    const list = await client.admin.listNamespaces();
    expect(Array.isArray(list)).toBe(true);
    await expect(client.admin.getNamespace(namespaceId)).resolves.toBeDefined();
    await expect(
      client.admin.listNamespacesForApplication(applicationId),
    ).resolves.toBeDefined();
  });

  it('can create + list + inspect a group (group create/list routes)', async () => {
    const { groupId } = await client.admin.createGroupInNamespace(namespaceId, {
      name: `ct-grp-${runId()}`,
    });
    expect(groupId).toBeTruthy();
    await expect(client.admin.listNamespaceGroups(namespaceId)).resolves.toBeDefined();
    await expect(client.admin.getGroupInfo(groupId)).resolves.toBeDefined();
    await expect(client.admin.listGroupMembers(groupId)).resolves.toBeDefined();
  });

  it('can run a group mutation (group manage — POST /groups/:id/invite)', async () => {
    const { groupId } = await client.admin.createGroupInNamespace(namespaceId, {
      name: `ct-inv-${runId()}`,
    });
    // Any 2xx/4xx-validation response proves the permission gate passed;
    // 403 is the only failure mode under test.
    await client.admin
      .createGroupInvitation(groupId, {})
      .catch((e: { status?: number }) => {
        expect(e.status).not.toBe(403);
      });
  });

  it('can read identities-owned (context sub-op every app calls at login)', async () => {
    const ctx = await client.admin.createContext({ applicationId, groupId: namespaceId });
    await expect(
      client.admin.getContextIdentitiesOwned(ctx.contextId),
    ).resolves.toBeDefined();
  });

  it('can upload and list blobs (blob add/list routes)', async () => {
    const data = new TextEncoder().encode(`ct-blob-${runId()}`);
    const { blobId } = await client.admin.uploadBlob({ data });
    expect(blobId).toBeTruthy();
    await expect(client.admin.listBlobs()).resolves.toBeDefined();
  });

  it('can read blob info (HEAD /admin-api/blobs/:id — blob:get since rc.13)', async () => {
    // getBlobInfo issues a HEAD request; rc.13 (core#3203) maps HEAD to
    // blob:get, closing the rc.11 gap where HEAD fell through to the
    // /admin-api/* default-deny.
    const data = new TextEncoder().encode(`ct-blobinfo-${runId()}`);
    const { blobId } = await client.admin.uploadBlob({ data });
    await expect(client.admin.getBlobInfo(blobId)).resolves.toBeDefined();
  });

  it('can create + lookup a context alias (context:alias routes)', async () => {
    const ctx = await client.admin.createContext({ applicationId, groupId: namespaceId });
    const alias = `ct-alias-${runId()}`;
    await client.admin.createContextAlias({ alias, contextId: ctx.contextId });
    await expect(client.admin.lookupContextAlias(alias)).resolves.toBeDefined();
  });

  // ── Negative controls: the fence itself must survive ───────────────────────

  it('still CANNOT reach admin-only routes (usage) — the rc.9 fence holds', async () => {
    await expect(client.admin.getUsage()).rejects.toMatchObject({ status: 403 });
  });

  it('still CANNOT list root keys (key management stays admin)', async () => {
    await expect(client.auth.listRootKeys()).rejects.toMatchObject({ status: 403 });
  });
});
