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

beforeAll(async () => {
  root = await authedMero();
  applicationId = await ensureApplication(root);

  // The workspace an app would normally get during login. Created as root:
  // namespace creation is admin-only today (see the pinned test below).
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

  it('KNOWN GAP: cannot create a namespace (namespace routes are admin-only)', async () => {
    // /admin-api/namespaces/* has no permission mappings in core's validator,
    // so the /admin-api/* default-deny requires `admin` — a client token is
    // rejected even though namespaces are the recommended way for apps to
    // provision workspaces. When core adds namespace permission mappings,
    // this expectation must FLIP to `resolves` (and the beforeAll can mint
    // the namespace with the client token instead of root).
    await expect(
      client.admin.createNamespace({
        applicationId,
        upgradePolicy: 'LazyOnAccess',
        name: `ct-denied-${runId()}`,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
