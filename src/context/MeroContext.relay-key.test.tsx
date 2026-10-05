// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

const NODE_KEY = 'cd'.repeat(32);
const RELAY = 'https://relay.example.com';

/** What learning the relay's key does on each attempt; the last one repeats. */
let attest: Array<'down' | 'up'> = ['up'];
let attestHits = 0;
/** Whether the relay's quote is of a trusted image. */
let quoteVerifies = true;

// The provider awaits mero-js's `learnRelayNodeKey`, which waits out a relay it
// cannot reach and refuses a quote that does not verify — that retry and that
// refusal are mero-js's tests. It is stood in for here, attempt by attempt, so
// these tests are about what the provider does while the key is on its way,
// once it has arrived, and when it will never come. Everything else — the
// relay login, the admin reads — is the real code over a stubbed network.
vi.mock('@calimero-network/mero-js', async (importActual) => {
  const actual = await importActual<typeof import('@calimero-network/mero-js')>();
  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  return {
    ...actual,
    learnRelayNodeKey: vi.fn(async (relayUrl: string, { signal }: { signal?: AbortSignal } = {}) => {
      while (!signal?.aborted) {
        const step = attest[Math.min(attestHits++, attest.length - 1)];
        if (step === 'down') {
          await sleep(1_000, signal);
          continue;
        }
        if (!quoteVerifies) return null;
        actual.pinRelayNodeKey(relayUrl, NODE_KEY);
        return NODE_KEY;
      }
      return null;
    }),
  };
});

import { MeroProvider, useMero } from './MeroContext';
import { AppMode } from '../types';
import type { MeroContextValue } from '../types';
import { saveDelegatedSession, readPinnedRelayNodeKey } from '@calimero-network/mero-js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Every request that left the page, with the Authorization it carried. */
let requests: Array<{ url: string; authorization: string | null }> = [];

function stubNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
      requests.push({ url, authorization: headers.get('authorization') });
      // The relay login, as the real `login()` performs it: a challenge, then a token.
      if (url === `${RELAY}/auth/challenge`) return json({ data: { challenge: 'c'.repeat(64) } });
      if (url === `${RELAY}/auth/token`) return json({ data: { access_token: 'relay-session', refresh_token: 'r' } });
      if (url.startsWith(`${RELAY}/admin-api/contexts`)) return json({ data: { contexts: [] } });
      if (url.startsWith(`${RELAY}/admin-api/namespaces`)) return json({ data: [] });
      return json({ data: {} });
    }),
  );
}

let seen: MeroContextValue | null = null;
function Capture() {
  seen = useMero();
  return null;
}

const adminReads = () => requests.filter((r) => /\/admin-api\/(contexts|namespaces)/.test(r.url));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  seen = null;
  requests = [];
  attest = ['up'];
  attestHits = 0;
  quoteVerifies = true;
  stubNetwork();
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  saveDelegatedSession({ account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: RELAY });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('MeroProvider — a relay node key learned late still signs the session', () => {
  it('keeps awaiting the key through a failed attempt, then hands out a client that signs its reads', async () => {
    attest = ['down', 'up'];
    render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.chat">
        <Capture />
      </MeroProvider>,
    );
    await flush();

    // The first attempt failed. Still loading, no client: nothing the app does
    // can go out unsigned while the key is on its way.
    expect(attestHits).toBe(1);
    expect(seen!.isLoading).toBe(true);
    expect(seen!.mero).toBeNull();
    expect(adminReads()).toEqual([]);

    await flush(1_000);

    expect(attestHits).toBe(2);
    expect(readPinnedRelayNodeKey(RELAY)).toBe(NODE_KEY);
    expect(seen!.isLoading).toBe(false);
    expect(seen!.mero).not.toBeNull();

    requests = [];
    await act(async () => {
      await (seen!.mero as unknown as { admin: { getContexts(): Promise<unknown> } }).admin.getContexts();
    });
    const reads = adminReads();
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.authorization).toBe('Bearer relay-session');
  });

  it('refuses a quote that does not verify once, and does not ask again', async () => {
    quoteVerifies = false;
    render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.chat">
        <Capture />
      </MeroProvider>,
    );
    await flush();
    await flush(300_000);

    expect(attestHits).toBe(1);
    expect(readPinnedRelayNodeKey(RELAY)).toBeNull();
    // Writes carry their own warrant, so the client is still handed out; only
    // the session that reads need is missing, as before.
    expect(seen!.isLoading).toBe(false);
    expect(seen!.mero).not.toBeNull();
  });

  it('stops retrying once the provider is gone', async () => {
    attest = ['down'];
    const { unmount } = render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.chat">
        <Capture />
      </MeroProvider>,
    );
    await flush();
    await flush(3_000);
    const before = attestHits;
    unmount();
    await flush(300_000);

    expect(attestHits).toBe(before);
  });
});
