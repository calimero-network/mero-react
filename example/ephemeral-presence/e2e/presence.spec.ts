/**
 * Ephemeral presence in a REAL browser, across two browser contexts pointed at
 * two different `merod` nodes.
 *
 * Nothing here is mocked: Chromium runs the example app, which runs
 * `useEphemeral` from ../../src, which runs `mero.ephemeral` from the sibling
 * mero-js build, which talks HTTP + SSE to two live nodes gossiping to each
 * other. What the browser adds over the jsdom suites is exactly the two things
 * jsdom could not test: cross-origin fetch/CORS, and a genuinely streaming SSE
 * body read with `response.body.getReader()`.
 *
 * Boot the nodes first (README, step 2). The three tests share them and run in
 * order; the last one STOPS node 1 on purpose, which is the only way to observe
 * TTL eviction — presence belongs to the node, not to a browser tab, so closing
 * a page retracts nothing. Re-boot before re-running.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const NODE1 = process.env.PRESENCE_NODE1 ?? 'http://localhost:8940';
const NODE2 = process.env.PRESENCE_NODE2 ?? 'http://localhost:8941';
const NODE1_NAME = process.env.PRESENCE_NODE1_NAME ?? 'presence-demo-node-1';
/** Core's `PRESENCE_TTL_MS`. The node sweeps entries it has not heard from for
 * this long; budget generously on top for the sweep tick and gossip. */
const PRESENCE_TTL_MS = 7000;

const ARTIFACTS = path.resolve('artifacts');

/**
 * Resolve the real `merobox`, ignoring every `node_modules/.bin` on PATH.
 *
 * npm/pnpm prepend a `node_modules/.bin` entry for the package dir AND for
 * every ancestor up to `/`. A stray `~/node_modules/.bin/merobox` therefore
 * shadows the user's actual install inside a test run but not in their shell —
 * here that silently resolved merobox 0.1.23 instead of 0.6.41 and the run died
 * on `No such option: --no-docker`. Override with MEROBOX_BIN if needed.
 */
function meroboxBin(): string {
  if (process.env.MEROBOX_BIN) return process.env.MEROBOX_BIN;
  const cleanPath = (process.env.PATH ?? '')
    .split(':')
    .filter((p) => !p.endsWith('node_modules/.bin'))
    .join(':');
  return execFileSync('sh', ['-c', 'command -v merobox'], {
    env: { ...process.env, PATH: cleanPath },
  })
    .toString()
    .trim();
}

let CONTEXT_ID = '';
let KEY1 = '';
let KEY2 = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const contexts = await request.get(`${NODE1}/admin-api/contexts`).catch(() => null);
  expect(
    contexts?.ok(),
    `node 1 at ${NODE1} is not answering — boot the demo workflow first (see README)`,
  ).toBe(true);
  const body = (await contexts!.json()) as { data: { contexts: Array<{ id: string }> } };
  CONTEXT_ID = body.data.contexts[0]?.id ?? '';
  expect(CONTEXT_ID, 'node 1 has no context').toBeTruthy();

  // Each node's own context member key — the value the node stamps as `author`.
  const idsOf = async (base: string) => {
    const r = await request.get(`${base}/admin-api/contexts/${CONTEXT_ID}/identities-owned`);
    const b = (await r.json()) as { data: { identities: string[] } };
    return b.data.identities[0];
  };
  KEY1 = await idsOf(NODE1);
  KEY2 = await idsOf(NODE2);
  expect(KEY1).toBeTruthy();
  expect(KEY2).toBeTruthy();
  expect(KEY1).not.toBe(KEY2);
  mkdirSync(ARTIFACTS, { recursive: true });
  console.log(`[e2e] context=${CONTEXT_ID}\n[e2e] node1 key=${KEY1}\n[e2e] node2 key=${KEY2}`);
});

/** Opens the app in its own browser context (own origin storage, own SSE
 * connections) pointed at one node, and waits until it is subscribed. */
async function openWindow(
  context: BrowserContext,
  node: string,
  label: string,
): Promise<Page> {
  const page = await context.newPage();
  const failures: string[] = [];
  page.on('requestfailed', (r) => failures.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  (page as Page & { _failures?: string[] })._failures = failures;

  await page.goto(`/?node=${encodeURIComponent(node)}&label=${label}&context=${CONTEXT_ID}`);
  await expect(page.getByTestId('stage')).toBeVisible();
  await expect(page.getByTestId('context-id')).toHaveText(CONTEXT_ID);
  // No hook error means the client really did expose `mero.ephemeral` and the
  // local identity resolved over a cross-origin admin call.
  await expect(page.getByTestId('hook-error')).toHaveCount(0);
  // The hash poll is async; wait for the first real answer so a caller can
  // compare before/after without racing the placeholder.
  await expect(page.getByTestId('state-hash')).not.toHaveText('…');
  return page;
}

/** The cursor rendered for one specific author, if any. */
const peer = (page: Page, author: string) =>
  page.locator(`[data-testid="peer-cursor"][data-author="${author}"]`);

async function moveTo(page: Page, x: number, y: number) {
  // A short path, not a teleport: the point is a mousemove stream, which the
  // hook throttles to one publish per 30ms on the trailing edge.
  await page.mouse.move(x - 40, y - 40, { steps: 8 });
  await page.mouse.move(x, y, { steps: 8 });
}

test('1. a cursor moved in browser context A renders in browser context B, across two nodes', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const ctxB = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const a = await openWindow(ctxA, NODE1, 'node-1');
  const b = await openWindow(ctxB, NODE2, 'node-2');

  const hashBefore = await b.getByTestId('state-hash').textContent();

  const t0 = Date.now();
  await moveTo(a, 420, 380);
  const selfPos = await a.getByTestId('self-pos').textContent();
  const [sx, sy] = selfPos!.split(',').map(Number);

  await expect(peer(b, KEY1)).toHaveCount(1);
  // The remote arrow must land on the exact coordinates A published.
  await expect(peer(b, KEY1)).toHaveAttribute('data-x', String(sx));
  await expect(peer(b, KEY1)).toHaveAttribute('data-y', String(sy));
  console.log(`[e2e] 1. A(${sx},${sy}) -> rendered in B after ${Date.now() - t0}ms`);

  // Both windows publishing: B now shows its own blue cursor plus A's arrow.
  await moveTo(b, 260, 200);
  await expect(b.getByTestId('self-cursor')).toBeVisible();

  // Keep A moving so both arrows are live for the screenshot, and so the
  // no-DAG-growth claim is measured under real traffic rather than at rest.
  for (let i = 0; i < 60; i++) await a.mouse.move(300 + i * 3, 300 + (i % 20) * 4);
  // Live, not replayed: `ageOf` is driven off `Date.now() - ageMs` per entry, so
  // deltas streaming in right now pin it near zero. (`data-origin` is NOT
  // asserted here — it records how the author FIRST arrived on this page, and a
  // node keeps heartbeating a slice after its tab is gone, so a re-run against
  // un-rebooted nodes legitimately opens with a seed.)
  await expect
    .poll(async () => Number(await peer(b, KEY1).getAttribute('data-age-ms')), {
      timeout: 10_000,
    })
    .toBeLessThan(1000);

  const shot = path.join(ARTIFACTS, 'two-live-cursors.png');
  await b.screenshot({ path: shot });
  console.log(`[e2e] screenshot: ${shot}`);

  // No DAG growth: hundreds of presence events, hash unmoved.
  const events = Number(await b.getByTestId('presence-events').textContent());
  const hashAfter = await b.getByTestId('state-hash').textContent();
  const hashChanges = await b.getByTestId('hash-changes').textContent();
  console.log(
    `[e2e] 1. presence events on B: ${events}; contextStateHash ${hashBefore} -> ${hashAfter} (${hashChanges} changes)`,
  );
  expect(hashAfter).not.toBe('UNREADABLE');
  expect(hashAfter).toBe(hashBefore);
  expect(hashChanges).toBe('0');
  expect(events).toBeGreaterThan(10);

  expect((a as Page & { _failures?: string[] })._failures).toEqual([]);
  expect((b as Page & { _failures?: string[] })._failures).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});

test('2. a page opened while A is already present is SEEDED with A, tagged with the node’s ageMs', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const a = await openWindow(ctxA, NODE1, 'node-1');
  await moveTo(a, 500, 300);

  // Let node 2 learn about A before the fresh page subscribes, so what the new
  // page receives is unambiguously a replay and not a live delta it happened to
  // catch. (Node 1 re-publishes on A's behalf every 2.5s regardless of movement.)
  await a.waitForTimeout(4000);

  const ctxC = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const t0 = Date.now();
  const c = await openWindow(ctxC, NODE2, 'node-2-observer');

  // "Immediately": no mouse has moved in this window and no peer has published
  // since it opened — the only way A can be on screen is the replay.
  await expect(peer(c, KEY1)).toHaveCount(1);
  const seenAfterMs = Date.now() - t0;

  // Read off the WIRE, not off a timer: `ageMs` is present only on a replayed
  // entry. A live delta carries no age at all, which is a different answer from
  // an age of 0.
  // Both attributes in ONE snapshot: node 1 re-publishes A every 2.5s, so a
  // heartbeat landing between two separate reads would reset ageOf() and make
  // the pair inconsistent for reasons that have nothing to do with seeding.
  const { origin, arrivalAge, hookAge } = await peer(c, KEY1).evaluate((el) => ({
    origin: el.getAttribute('data-origin'),
    arrivalAge: Number(el.getAttribute('data-arrival-age-ms')),
    hookAge: Number(el.getAttribute('data-age-ms')),
  }));
  console.log(
    `[e2e] 2. seeded ${seenAfterMs}ms after load; node reported ageMs=${arrivalAge}; ageOf()=${hookAge}ms`,
  );

  // It must not read as fresh: the node said this entry was already stale, and
  // the hook's ageOf() carries that staleness rather than starting from zero.
  expect(origin).toBe('seed');
  expect(arrivalAge).toBeGreaterThan(0);
  expect(arrivalAge).toBeLessThanOrEqual(PRESENCE_TTL_MS);
  expect(hookAge).toBeGreaterThan(0);

  await ctxA.close();
  await ctxC.close();
});

test('3. stopping the publishing NODE evicts its cursor within the presence TTL', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const ctxB = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const a = await openWindow(ctxA, NODE1, 'node-1');
  const b = await openWindow(ctxB, NODE2, 'node-2');

  await moveTo(a, 600, 420);
  await expect(peer(b, KEY1)).toHaveCount(1);

  // Closing A's tab would NOT retract anything — node 1 keeps heartbeating the
  // slice. Only stopping the node itself can produce an eviction.
  await ctxA.close();
  await b.waitForTimeout(1000);
  expect(await peer(b, KEY1).count(), 'closing the tab must not retract presence').toBe(1);

  const merobox = meroboxBin();
  // merobox's binary-mode node registry is CWD-RELATIVE: `stop` run from
  // anywhere else answers "Node ... is not running" and exits non-zero even
  // while the node is plainly serving requests. It has to run from the same
  // directory the bootstrap did — the core checkout.
  const coreDir = process.env.PRESENCE_CORE_DIR;
  expect(
    coreDir,
    'set PRESENCE_CORE_DIR to the core checkout you booted the nodes from — ' +
      'merobox resolves native nodes relative to that directory',
  ).toBeTruthy();
  console.log(`[e2e] 3. stopping ${NODE1_NAME} with ${merobox} (cwd ${coreDir})`);
  const t0 = Date.now();
  execFileSync(merobox, ['stop', NODE1_NAME, '--no-docker'], {
    stdio: 'inherit',
    cwd: coreDir,
  });

  await expect(peer(b, KEY1)).toHaveCount(0, { timeout: PRESENCE_TTL_MS * 3 });
  const elapsed = Date.now() - t0;
  console.log(`[e2e] 3. evicted ${elapsed}ms after the node was stopped (TTL ${PRESENCE_TTL_MS}ms)`);
  expect(elapsed).toBeGreaterThan(1000);

  await expect(b.getByTestId('peer-count')).toHaveText('0');
  await ctxB.close();
});
