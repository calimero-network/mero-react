/**
 * Builds the two-node fixture that tests/e2e/ephemeral.live.test.tsx needs:
 * one application, one namespace, one context, with BOTH nodes as members.
 *
 * Presence travels over gossip between two different nodes, so unlike every
 * other e2e suite here this one cannot be served by a single node.
 *
 * Assumes both nodes are already running in Proxy auth mode (no token). Boot
 * them with tests/e2e/boot-presence-nodes.sh, which then runs this script.
 *
 * Deliberately driven through mero-js rather than an external harness: the SDK
 * is version-matched to the node by construction, so the fixture cannot fail on
 * a wire-shape skew that the suite it feeds would not also hit.
 */
import { resolve } from 'node:path';
import { MeroJs } from '@calimero-network/mero-js';

const NODE1 = process.env.MERO_E2E_NODE1 ?? 'http://localhost:8940';
const NODE2 = process.env.MERO_E2E_NODE2 ?? 'http://localhost:8941';
const APP = resolve(process.cwd(), 'tests/e2e/assets/kv-store.mpk');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry until `fn` resolves or the budget runs out. Namespace governance has
 *  to gossip from node 1 before node 2 can join, and how long that takes is not
 *  a fixed number — polling beats a sleep long enough to always work. */
async function until(label, fn, { timeoutMs = 60000, everyMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (Date.now() > deadline) {
        throw new Error(`${label}: gave up after ${timeoutMs}ms — ${last?.message ?? last}`);
      }
      await sleep(everyMs);
    }
  }
}

// timeoutMs:0 for the same reason as the suite and harness.ts: jsdom's
// AbortSignal is rejected by Node's fetch. Harmless here, kept for symmetry.
const n1 = new MeroJs({ baseUrl: NODE1, timeoutMs: 0 });
const n2 = new MeroJs({ baseUrl: NODE2, timeoutMs: 0 });

// Both nodes need the application: node 2 cannot join a context whose app it
// does not have. Same bundle on both, so both resolve the same ApplicationId.
const app1 = await until('install app on node 1', () =>
  n1.admin.installDevApplication({ path: APP, metadata: [] }),
);
const app2 = await until('install app on node 2', () =>
  n2.admin.installDevApplication({ path: APP, metadata: [] }),
);
if (app1.applicationId !== app2.applicationId) {
  throw new Error(
    `nodes disagree on ApplicationId (${app1.applicationId} vs ${app2.applicationId}) — ` +
      'the same bundle must yield the same id on both',
  );
}

const ns = await n1.admin.createNamespace({
  applicationId: app1.applicationId,
  name: `presence-${Date.now().toString(36)}`,
});
const ctx = await n1.admin.createContext({
  applicationId: app1.applicationId,
  groupId: ns.namespaceId,
});
const inv = await n1.admin.createNamespaceInvitation(ns.namespaceId);

// Node 2 joins. Retried: node 1's governance has to reach node 2 first, and
// until it does the join legitimately fails.
const joined = await until('node 2 joins namespace', () =>
  n2.admin.joinNamespace(ns.namespaceId, { invitation: inv.invitation }),
);
const ctx2 = await until('node 2 joins context', () => n2.admin.joinContext(ctx.contextId));

// The suite reads both nodes' member keys and asserts they differ; a fixture
// that quietly produced one member would surface there as a confusing failure.
if (!ctx.memberPublicKey || !ctx2.memberPublicKey) {
  throw new Error('a node has no member key in the context');
}
if (ctx.memberPublicKey === ctx2.memberPublicKey) {
  throw new Error('both nodes report the same member key — not a two-node fixture');
}

console.log(`[fixture] application  ${app1.applicationId}`);
console.log(`[fixture] namespace    ${ns.namespaceId}`);
console.log(`[fixture] context      ${ctx.contextId}`);
console.log(`[fixture] node1 key    ${ctx.memberPublicKey}`);
console.log(`[fixture] node2 key    ${ctx2.memberPublicKey} (identity ${joined.memberIdentity})`);

n1.close();
n2.close();
