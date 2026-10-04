// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

const NODE_KEY = 'cd'.repeat(32);
const RELAY = 'https://relay.example.com';

/** What the relay's attest endpoint does on each request; the last one repeats. */
let attest: Array<'down' | 'up'> = ['up'];
let attestHits = 0;
/** Whether the relay's quote is of a trusted image. */
let quoteVerifies = true;

// The relay key is learned through the real session code; only the two calls
// that leave the page are stood in for. The attestation goes out through the
// `fetch` it is handed, as mero-js's does, so a relay that cannot be reached
// fails exactly where a real one would.
vi.mock('@calimero-network/mero-js', async (importActual) => {
  const actual = await importActual<typeof import('@calimero-network/mero-js')>();
  return {
    ...actual,
    attestRelayNodeKey: vi.fn(async ({ relayUrl, fetch: givenFetch }: { relayUrl: string; fetch: typeof fetch }) => {
      const response = await givenFetch(`${relayUrl}/admin-api/tee/attest`, { method: 'POST' });
      if (!response.ok) throw new Error(`the relay would not attest (HTTP ${response.status})`);
      if (!quoteVerifies) throw new Error("the relay's quote did not verify: not a trusted image");
      return { nodeKey: NODE_KEY, mock: false };
    }),
    login: vi.fn(async () => ({ accessToken: 'relay-session', refreshToken: 'r' })),
  };
});

import { MeroProvider, useMero } from './MeroContext';
import { AppMode } from '../types';
import type { MeroContextValue } from '../types';
import { saveDelegatedSession, readPinnedRelayNodeKey } from '../delegated/session';

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
      if (url === `${RELAY}/admin-api/tee/attest`) {
        const step = attest[Math.min(attestHits++, attest.length - 1)];
        if (step === 'down') throw new TypeError('Failed to fetch');
        return json({ data: {} });
      }
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
