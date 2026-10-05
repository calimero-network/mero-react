// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

const NODE_KEY = 'cd'.repeat(32);
const RELAY = 'https://relay.example.com';
const REGISTRY = 'https://apps.calimero.network';
const KV_SIGNER = 'did:key:z6MkoWkrrFjwC4FXQfyGwwcgTPvRoJZenMEVm9Z332bdkz6B';
const KV_ID = 'e810e86f443e8c1feb98bb83a266246478a34c75397a66a78bd5a790c6d72d0d';

// The account path runs through the real session code; the relay's login is
// stood in for, and every request that leaves the page is answered below.
vi.mock('@calimero-network/mero-js', async (importActual) => {
  const actual = await importActual<typeof import('@calimero-network/mero-js')>();
  return {
    ...actual,
    login: vi.fn(async () => ({ accessToken: 'relay-session', refreshToken: 'r' })),
  };
});

import { MeroProvider, useMero } from './MeroContext';
import { AppMode } from '../types';
import type { MeroContextValue } from '../types';
import { pinRelayNodeKey, saveDelegatedSession } from '../delegated/session';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The account's contexts, as the relay lists them. */
let contexts: Array<{ id: string; applicationId: string }> = [];
/** What the registry answers for the bundles listing. */
let registry: () => Response = () => json([]);
let requests: string[] = [];

function stubNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push(url);
      if (url.startsWith(`${RELAY}/admin-api/contexts`)) return json({ data: { contexts } });
      if (url.startsWith(`${RELAY}/admin-api/namespaces`)) return json({ data: [] });
      if (url.startsWith(`${REGISTRY}/api/v2/bundles`)) return registry();
      return json({ data: {} });
    }),
  );
}

let seen: MeroContextValue | null = null;
function Capture() {
  seen = useMero();
  return null;
}

const registryReads = () => requests.filter((u) => u.startsWith(`${REGISTRY}/api/v2/bundles`));
const settled = () => waitFor(() => expect(seen?.isLoading).toBe(false));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  seen = null;
  requests = [];
  contexts = [];
  registry = () =>
    json([
      { package: 'com.calimero.kv-store', signerId: KV_SIGNER, appVersion: '0.0.41', yanked: false },
      { package: 'com.calimero.kv-store', signerId: KV_SIGNER, appVersion: '0.0.54', yanked: false },
    ]);
  stubNetwork();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  saveDelegatedSession({ account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: RELAY });
  pinRelayNodeKey(RELAY, NODE_KEY);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MeroProvider — an account learns its applicationId', () => {
  it('from the registry, by packageName, when the account has no contexts yet', async () => {
    render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.kv-store">
        <Capture />
      </MeroProvider>,
    );
    await settled();
    await waitFor(() => expect(seen!.applicationId).toBe(KV_ID));
    expect(registryReads()).toEqual([`${REGISTRY}/api/v2/bundles?package=com.calimero.kv-store`]);
  });

  it('stays null with no contexts and no packageName: nothing names an application', async () => {
    render(
      <MeroProvider mode={AppMode.MultiContext}>
        <Capture />
      </MeroProvider>,
    );
    await settled();
    await waitFor(() => expect(requests.some((u) => u.startsWith(`${RELAY}/admin-api/contexts`))).toBe(true));
    expect(seen!.applicationId).toBeNull();
    expect(registryReads()).toEqual([]);
  });

  it('from the registry, by packageName, even when the account has contexts of two applications', async () => {
    // One account used in two apps (mero-chess and kv-store, as reproduced):
    // the tab is kv-store's, and kv-store says so by its packageName.
    contexts = [
      { id: 'ctx-1', applicationId: 'ff'.repeat(32) },
      { id: 'ctx-2', applicationId: 'ee'.repeat(32) },
    ];
    render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.kv-store">
        <Capture />
      </MeroProvider>,
    );
    await settled();
    await waitFor(() => expect(seen!.applicationId).toBe(KV_ID));
    expect(registryReads()).toEqual([`${REGISTRY}/api/v2/bundles?package=com.calimero.kv-store`]);
  });

  it("from the registry, by packageName, not from the account's contexts of ANOTHER application", async () => {
    // An account whose only contexts are chess's opens kv-store: the id must be
    // kv-store's, or kv-store would found a namespace targeting chess's contract.
    contexts = [
      { id: 'ctx-1', applicationId: 'ff'.repeat(32) },
      { id: 'ctx-2', applicationId: 'ff'.repeat(32) },
    ];
    render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.kv-store">
        <Capture />
      </MeroProvider>,
    );
    await settled();
    await waitFor(() => expect(seen!.applicationId).toBe(KV_ID));
    expect(seen!.applicationId).not.toBe('ff'.repeat(32));
    expect(registryReads()).toHaveLength(1);
  });

  it('from its contexts, without asking the registry, when the app passes no packageName', async () => {
    contexts = [
      { id: 'ctx-1', applicationId: 'ff'.repeat(32) },
      { id: 'ctx-2', applicationId: 'ff'.repeat(32) },
    ];
    render(
      <MeroProvider mode={AppMode.MultiContext}>
        <Capture />
      </MeroProvider>,
    );
    await settled();
    await waitFor(() => expect(seen!.applicationId).toBe('ff'.repeat(32)));
    expect(registryReads()).toEqual([]);
  });

  it('stays null, with no packageName, when its contexts span several applications, on purpose', async () => {
    contexts = [
      { id: 'ctx-1', applicationId: 'ff'.repeat(32) },
      { id: 'ctx-2', applicationId: 'ee'.repeat(32) },
    ];
    render(
      <MeroProvider mode={AppMode.MultiContext}>
        <Capture />
      </MeroProvider>,
    );
    await settled();
    await waitFor(() => expect(requests.some((u) => u.startsWith(`${RELAY}/admin-api/contexts`))).toBe(true));
    expect(seen!.applicationId).toBeNull();
    expect(registryReads()).toEqual([]);
  });

  it('stays null, warning once, when the registry fails and the account has no contexts', async () => {
    registry = () => json({ error: 'boom' }, 500);
    render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.kv-store">
        <Capture />
      </MeroProvider>,
    );
    await settled();
    await waitFor(() => expect(registryReads().length).toBe(1));
    await waitFor(() =>
      expect(vi.mocked(console.warn).mock.calls.some((c) => String(c[0]).includes('application id'))).toBe(true),
    );
    expect(seen!.applicationId).toBeNull();
    expect(vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('application id'))).toHaveLength(1);
    // No retry loop: one ask, one answer.
    expect(registryReads()).toHaveLength(1);
  });

  it('warns once when the registry fails, then falls back to the one application its contexts name', async () => {
    registry = () => json({ error: 'boom' }, 500);
    contexts = [
      { id: 'ctx-1', applicationId: 'ff'.repeat(32) },
      { id: 'ctx-2', applicationId: 'ff'.repeat(32) },
    ];
    render(
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.kv-store">
        <Capture />
      </MeroProvider>,
    );
    await settled();
    await waitFor(() => expect(seen!.applicationId).toBe('ff'.repeat(32)));
    expect(vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('application id'))).toHaveLength(1);
    expect(registryReads()).toHaveLength(1);
  });
});
