/**
 * Live-node e2e harness for mero-react. Boots/attaches to a real merod and
 * provisions an app + namespace + context fixture, so the React hooks run
 * against real core wire — not mocks.
 *
 * Env:
 *   NODE_URL        node base URL (default http://localhost:4001)
 *   MERO_E2E_USER   embedded-auth username (default dev)
 *   MERO_E2E_PASS   embedded-auth password (default dev)
 */
import { resolve } from 'node:path';
import { MeroJs } from '@calimero-network/mero-js';

export const KV_STORE_PACKAGE = 'com.calimero.kv-store';

export function resolveBaseUrl(): string {
  return process.env.NODE_URL || 'http://localhost:4001';
}

export function resolveCreds(): { username: string; password: string } {
  return {
    username: process.env.MERO_E2E_USER || 'dev',
    password: process.env.MERO_E2E_PASS || 'dev',
  };
}

/** Short, strictly-increasing suffix so fixtures don't collide on a persistent node. */
export function runId(): string {
  return process.hrtime.bigint().toString(36);
}

/** A real, authenticated MeroJs pointed at the live node. */
export async function authedMero(): Promise<MeroJs> {
  // timeoutMs:0 disables the per-request AbortSignal. jsdom replaces global
  // AbortSignal with its own, which Node's fetch (undici) rejects ("Expected
  // signal to be an instance of AbortSignal"). Tests rely on vitest's own
  // timeout instead. ponytail: harness-only; no SDK change needed.
  const mero = new MeroJs({ baseUrl: resolveBaseUrl(), timeoutMs: 0 });
  await mero.authenticate(resolveCreds());
  return mero;
}

/** Install the kv-store demo app if absent; returns its applicationId. */
export async function ensureApplication(mero: MeroJs): Promise<string> {
  const { apps } = await mero.admin.listApplications();
  const existing = apps.find((a) => a.package === KV_STORE_PACKAGE);
  if (existing) return existing.id;
  // cwd-based, not import.meta.url: jsdom gives a non-file: import.meta.url.
  const path = resolve(process.cwd(), 'tests/e2e/assets/kv-store.mpk');
  const res = await mero.admin.installDevApplication({ path, metadata: [] });
  return res.applicationId;
}

/** Full fixture: authed client + an application, namespace, and context. */
export interface E2eFixture {
  mero: MeroJs;
  applicationId: string;
  namespaceId: string;
  groupId: string;
  contextId: string;
  /** The creator's member public key (executor identity for the context). */
  identity: string;
  run: string;
}

export async function setupFixture(): Promise<E2eFixture> {
  const run = runId();
  const mero = await authedMero();
  const applicationId = await ensureApplication(mero);
  const ns = await mero.admin.createNamespace({
    applicationId,
    upgradePolicy: 'LazyOnAccess',
    alias: `rt-${run}`,
  });
  const namespaceId = ns.namespaceId;
  const ctx = await mero.admin.createContext({ applicationId, groupId: namespaceId });
  return {
    mero,
    applicationId,
    namespaceId,
    groupId: namespaceId,
    contextId: ctx.contextId,
    identity: ctx.memberPublicKey,
    run,
  };
}

export async function teardownFixture(fx: E2eFixture | undefined): Promise<void> {
  if (!fx) return;
  if (fx.namespaceId) await fx.mero.admin.deleteNamespace(fx.namespaceId).catch(() => {});
  fx.mero.close();
}
