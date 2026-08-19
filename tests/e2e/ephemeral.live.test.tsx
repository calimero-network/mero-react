/**
 * Ephemeral presence, end to end, through the WHOLE stack — no mocks anywhere.
 *
 *   useEphemeral (this repo)  ->  mero-js EphemeralClient + SseClient (published)
 *                             ->  two real merod nodes gossiping to each other
 *
 * Every other test of this feature stubs the layer below: the unit suite mocks
 * `mero.ephemeral`, and `tsc` only proves the hook agrees with mero-js's type
 * declarations. Neither can catch the SDK's runtime behaviour drifting from the
 * node's actual wire — the shapes still line up, so both stay green. This file
 * is the only thing that can, because it runs the published package against
 * real nodes.
 *
 * Presence is delivered over gossip BETWEEN nodes, so it needs two of them; the
 * single node the other e2e suites share cannot exercise it. That is why this
 * suite has its own fixture and its own CI job.
 *
 * ── RUNNING IT — two commands, from a shell in this repo ────────────────────
 *
 * 1. Boot the two nodes and build the shared context fixture (pass a merod
 *    binary; a released one is fine):
 *    ./tests/e2e/boot-presence-nodes.sh ./merod
 *
 * 2. Run this suite:
 *    pnpm test:e2e:presence
 *
 * Stop the nodes afterwards with: kill $(cat .presence-nodes.pids)
 *
 * The suite auto-discovers the per-run context id from node 1's admin API, so
 * no ids need pasting. Override the defaults with MERO_E2E_NODE1 /
 * MERO_E2E_NODE2 / MERO_E2E_CONTEXT / MERO_E2E_NODE1_NAME if your nodes differ.
 *
 * NOTE: the last phase STOPS node 1 on purpose — that is the only way to
 * observe TTL eviction (presence belongs to the node, not to a client socket).
 * Re-run the boot script before running the suite again.
 */

// Side-effect import, FIRST: jsdom's AbortController is incompatible with
// Node's fetch, which otherwise kills every SSE stream. See the file's header.
import './jsdom-stream-fetch';

import React from 'react';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { MeroJs } from '@calimero-network/mero-js';
import { MeroContext } from '../../src/context';
import { useEphemeral } from '../../src/hooks';
import type { MeroContextValue } from '../../src/types';

const NODE1 = process.env.MERO_E2E_NODE1 ?? 'http://localhost:8940';
const NODE2 = process.env.MERO_E2E_NODE2 ?? 'http://localhost:8941';
const NODE1_NAME = process.env.MERO_E2E_NODE1_NAME ?? 'presence-demo-node-1';

/** The node sweeps presence it has not heard from for this long. */
const PRESENCE_TTL_MS = 7000;

interface Cursor {
  line: number;
  col: number;
  tag?: string;
}

/** Presence entry exactly as `mero-js` hands it over — used where the test has
 * to inspect the WIRE (is `ageMs` present or absent?), not the hook's view. */
interface WireEntry {
  author: string;
  state?: Cursor;
  removed?: boolean;
  ageMs?: number;
}

const clients: MeroJs[] = [];
/** Every client is tracked so afterAll can close the SSE streams — an open
 * reader keeps the vitest worker alive. */
function client(baseUrl: string): MeroJs {
  // timeoutMs:0 disables the per-request AbortSignal — jsdom replaces global
  // AbortSignal with its own, which Node's fetch (undici) rejects ("Expected
  // signal to be an instance of AbortSignal"), surfacing as "HTTP 0 Network
  // Error". Same workaround as tests/e2e/harness.ts; vitest's own timeouts
  // bound the run. Harness-only — no SDK change needed.
  const c = new MeroJs({ baseUrl, timeoutMs: 0 });
  clients.push(c);
  return c;
}

/** Minimal real MeroContext value: `useEphemeral` reads only `mero`, and the
 * point here is to exercise the hook against a REAL client, not to re-test
 * MeroProvider's auth machinery (the nodes run in Proxy auth mode anyway). */
function wrapperFor(mero: MeroJs) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      MeroContext.Provider,
      { value: { mero } as unknown as MeroContextValue },
      children,
    );
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Raw `mero.ephemeral.subscribe` recorder — the wire, with nothing normalized
 * away by the hook. */
function recordWire(c: MeroJs, contextId: string): WireEntry[] {
  const seen: WireEntry[] = [];
  (c as unknown as {
    ephemeral: {
      subscribe: (ctx: string, h: (e: WireEntry) => void) => () => void;
    };
  }).ephemeral.subscribe(contextId, (e) => seen.push(e));
  return seen;
}

let CONTEXT_ID = '';
let KEY1 = '';
let KEY2 = '';

beforeAll(async () => {
  // Discover the per-run ids straight off the live nodes, so the run command
  // stays a bare `npm run test:e2e`.
  const res = await fetch(`${NODE1}/admin-api/contexts`);
  if (!res.ok) {
    throw new Error(
      `e2e: node 1 at ${NODE1} is not answering (${res.status}). Boot the nodes first — ` +
        'see the header comment in this file.',
    );
  }
  const body = (await res.json()) as { data: { contexts: Array<{ id: string }> } };
  CONTEXT_ID = process.env.MERO_E2E_CONTEXT ?? body.data.contexts[0]?.id ?? '';
  expect(CONTEXT_ID, 'no context on node 1 — boot the demo workflow first').toBeTruthy();

  // Both nodes' own context member keys, read from the admin API. These are the
  // values the node stamps as `author`, and the same lookup the hook uses to
  // recognise "self" — asserted against a real observed author below.
  KEY1 = (await client(NODE1).admin.getContextIdentitiesOwned(CONTEXT_ID)).identities[0];
  KEY2 = (await client(NODE2).admin.getContextIdentitiesOwned(CONTEXT_ID)).identities[0];
  expect(KEY1).toBeTruthy();
  expect(KEY2).toBeTruthy();
  expect(KEY1).not.toBe(KEY2);
  console.log(`[e2e] context=${CONTEXT_ID}\n[e2e] node1 key=${KEY1}\n[e2e] node2 key=${KEY2}`);
});

afterAll(() => {
  cleanup();
  for (const c of clients) {
    try {
      c.close();
    } catch {
      /* closing a client whose node is already gone is fine */
    }
  }
});

// Requires the TWO peered nodes from tests/e2e/boot-presence-nodes.sh, which
// sets this variable. The other e2e suites share a single node and cannot serve
// this one - presence travels over gossip BETWEEN nodes - so skip rather than
// fail when only that single-node fixture is up.
//
// This no longer gates on a local mero-js build: the published package exports
// the `ephemeral` surface, so the suite runs against exactly what consumers
// install.
const hasPresenceNodes = process.env.MERO_E2E_PRESENCE === '1';

describe.skipIf(!hasPresenceNodes)('ephemeral presence — real merod, real mero-js, real hook', () => {
  it('1. publishes from a hook on node 1 and observes it in a hook on node 2 (cross-node, over gossip)', async () => {
    const a = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID), {
      wrapper: wrapperFor(client(NODE1)),
    });
    const b = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID), {
      wrapper: wrapperFor(client(NODE2)),
    });

    // Let node 2's subscription attach before publishing, so this is a live
    // delta crossing the wire rather than a replay.
    await sleep(1500);

    const t0 = Date.now();
    act(() => a.result.current.setPresence({ line: 3, col: 17, tag: 'cross-node' }));

    await waitFor(
      () => expect(b.result.current.peers.get(KEY1)).toEqual({ line: 3, col: 17, tag: 'cross-node' }),
      { timeout: 30000 },
    );
    console.log(`[e2e] 1. node1 -> node2 delivery: ${Date.now() - t0}ms`);

    // The publisher's own hook must not show itself (default self-filter).
    expect(a.result.current.peers.has(KEY1)).toBe(false);
    expect(a.result.current.error).toBeNull();
    expect(b.result.current.error).toBeNull();

    a.unmount();
    b.unmount();
  });

  it('3. delivers a live delta with NO ageMs on the wire, and the hook reads it as near-zero age', async () => {
    const publisher = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID), {
      wrapper: wrapperFor(client(NODE1)),
    });
    const observerClient = client(NODE2);
    const wire = recordWire(observerClient, CONTEXT_ID);
    const observer = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID), {
      wrapper: wrapperFor(client(NODE2)),
    });

    // Everything mounted and seeded BEFORE the publish — what arrives next is
    // unambiguously a live delta.
    await sleep(2000);
    const seedCount = wire.length;

    act(() => publisher.result.current.setPresence({ line: 9, col: 1, tag: 'live-delta' }));

    await waitFor(
      () => expect(observer.result.current.peers.get(KEY1)?.tag).toBe('live-delta'),
      { timeout: 30000 },
    );

    const delta = wire.slice(seedCount).find((e) => e.author === KEY1 && e.state?.tag === 'live-delta');
    expect(delta, 'the live delta never reached the raw subscriber').toBeDefined();
    // ABSENT, not 0 — absent and zero mean different things, and mero-js is
    // specified never to synthesize a 0 here.
    expect(Object.prototype.hasOwnProperty.call(delta, 'ageMs')).toBe(false);
    expect(delta!.ageMs).toBeUndefined();
    // `removed` is absent on the wire for an upsert; mero-js normalizes it.
    expect(delta!.removed).toBe(false);

    const age = observer.result.current.ageOf(KEY1);
    console.log(`[e2e] 3. live delta wire ageMs=${delta!.ageMs} (absent), hook ageOf=${age}ms`);
    expect(age).toBeDefined();
    expect(age!).toBeLessThan(2000);

    publisher.unmount();
    observer.unmount();
  });

  it('5. filters your own echoed presence by default, includes it with includeSelf, and the filtered key is exactly the author the node stamps', async () => {
    // Node 2 publishes its own presence; a hook on node 2 must not see itself.
    const selfClient = client(NODE2);
    const selfHook = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID), {
      wrapper: wrapperFor(selfClient),
    });
    const inclusiveHook = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID, { includeSelf: true }), {
      wrapper: wrapperFor(client(NODE2)),
    });
    // An INDEPENDENT observer on node 1 reads the author the node actually
    // stamped, so the "is the self key the same key?" question is answered by
    // two live reads (admin identities-owned vs. observed author), never by
    // reading source on both sides.
    const foreignWire = recordWire(client(NODE1), CONTEXT_ID);

    await sleep(1500);
    act(() => selfHook.result.current.setPresence({ line: 42, col: 7, tag: 'self-echo' }));

    await waitFor(
      () => expect(inclusiveHook.result.current.peers.get(KEY2)?.tag).toBe('self-echo'),
      { timeout: 30000 },
    );
    await waitFor(
      () => expect(foreignWire.some((e) => e.author === KEY2 && e.state?.tag === 'self-echo')).toBe(true),
      { timeout: 30000 },
    );

    // The node echoed it back and a peer node saw it under KEY2 — so the entry
    // genuinely reached node 2's own subscription and was dropped by the hook,
    // not merely never delivered.
    expect(selfHook.result.current.peers.has(KEY2)).toBe(false);
    expect(selfHook.result.current.error).toBeNull();
    console.log(
      `[e2e] 5. self key from getContextIdentitiesOwned=${KEY2}; ` +
        `author observed by node 1 for the same slice=${
          foreignWire.find((e) => e.state?.tag === 'self-echo')!.author
        } (filtered by default: ${!selfHook.result.current.peers.has(KEY2)}, ` +
        `present with includeSelf: ${inclusiveHook.result.current.peers.has(KEY2)})`,
    );

    selfHook.unmount();
    inclusiveHook.unmount();
  });

  // Assertions 2 and 4 share ONE test on purpose. Both need a node that has
  // just died, and both are driven from mounts made BEFORE it died — but
  // @testing-library/react registers a global `afterEach(cleanup)`, so any hook
  // mounted in a `beforeAll` is unmounted (and unsubscribed) the moment the
  // first `it` in the block ends. A long-lived observer therefore cannot
  // survive across two tests; splitting these would silently observe nothing.
  // Killing node 1 is also destructive — it does not come back, so this runs
  // last.
  it('2 + 4. after the publishing node is KILLED: a fresh mount is seeded with the stale entry back-dated by the node-reported ageMs, and the existing subscription is evicted within ~PRESENCE_TTL_MS with no goodbye', async () => {
    // A long-lived observer on node 2, already holding node 1's presence,
    // watches the eviction happen on its EXISTING subscription.
    const observer = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID), {
      wrapper: wrapperFor(client(NODE2)),
    });
    const publisher = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID), {
      wrapper: wrapperFor(client(NODE1)),
    });
    await sleep(1500);
    act(() => publisher.result.current.setPresence({ line: 1, col: 1, tag: 'about-to-die' }));
    await waitFor(() => expect(observer.result.current.peers.has(KEY1)).toBe(true), {
      timeout: 30000,
    });
    publisher.unmount();

    // Presence is per-NODE: unmounting the client above retracts nothing —
    // node 1 keeps heartbeating the slice for as long as the node lives. Only
    // stopping the node itself makes node 2 stop hearing about it.
    //
    // SIGKILL by listening port rather than `merobox stop`: merobox only finds
    // a node from the checkout it was launched in, and a hard kill is the
    // stronger proof anyway — the process gets no chance to say goodbye, so the
    // removal that follows can only be node 2's own TTL sweep.
    const port = new URL(NODE1).port;
    const pids = execFileSync('lsof', ['-t', '-i', `tcp:${port}`, '-sTCP:LISTEN'])
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number);
    expect(pids.length, `no process listening on ${NODE1}`).toBeGreaterThan(0);
    for (const pid of pids) process.kill(pid, 'SIGKILL');
    const killedAt = Date.now();
    console.log(`[e2e] SIGKILLed node 1 (${NODE1_NAME}, pid ${pids.join(',')})`);

    // ── 2. seed-on-subscribe carries ageMs ─────────────────────────────────
    // With node 1 dead its entry on node 2 ages monotonically instead of being
    // refreshed every 2.5s by the heartbeat, so a genuinely stale entry can be
    // observed in the window before the TTL sweep removes it.
    let hookAge: number | undefined;
    let wireAge: number | undefined;
    const deadline = killedAt + 20000;

    while (Date.now() < deadline) {
      const wire = recordWire(client(NODE2), CONTEXT_ID);
      const fresh = renderHook(() => useEphemeral<Cursor>(CONTEXT_ID), {
        wrapper: wrapperFor(client(NODE2)),
      });
      try {
        // Immediate: the node replays current presence to a new subscriber.
        await waitFor(() => expect(fresh.result.current.peers.has(KEY1)).toBe(true), {
          timeout: 3000,
        });
      } catch {
        fresh.unmount();
        break; // already swept — keep the best age observed so far
      }
      hookAge = fresh.result.current.ageOf(KEY1);
      wireAge = wire.find((e) => e.author === KEY1)?.ageMs;
      fresh.unmount();
      if ((hookAge ?? 0) >= 5000) break;
      await sleep(700);
    }

    console.log(
      `[e2e] 2. seed replay: wire ageMs=${wireAge}, hook ageOf=${hookAge}ms ` +
        `(${Date.now() - killedAt}ms after the kill)`,
    );
    // Present on a replayed entry — unlike the live delta in test 3.
    expect(wireAge, 'the replayed seed carried no ageMs').toBeDefined();
    // The load-bearing assertion: the hook back-dates by the node's ageMs. Had
    // it treated the replayed seed as fresh, this would read ~0.
    expect(hookAge).toBeDefined();
    expect(hookAge!).toBeGreaterThanOrEqual(5000);
    expect(hookAge!).toBeGreaterThanOrEqual(wireAge!);

    // ── 4. TTL eviction on the existing subscription ───────────────────────
    await waitFor(() => expect(observer.result.current.peers.has(KEY1)).toBe(false), {
      timeout: 30000,
    });
    const elapsed = Date.now() - killedAt;
    console.log(
      `[e2e] 4. peer evicted ${elapsed}ms after the kill ` +
        `(TTL ${PRESENCE_TTL_MS}ms + sweep granularity; nothing sent a goodbye)`,
    );
    // Upper bound is generous: the entry's clock starts at the LAST heartbeat
    // node 2 heard (up to 2.5s before the kill) and the sweep is periodic.
    expect(elapsed).toBeLessThan(25000);
    expect(observer.result.current.error).toBeNull();
    observer.unmount();
  });
});
