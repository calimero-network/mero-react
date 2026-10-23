// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { AppMode } from '../types';

const OTHER = 'http://node-a.test';
const HASH = `access_token=a.b.c&refresh_token=r&node_url=${encodeURIComponent(OTHER)}`;

type Seen = {
  isLoading: boolean;
  isAuthenticated: boolean;
  nodeUrl: string | null;
  logout(): void;
  connectToNode(url: string): void;
};

async function mount(servedByNode: boolean): Promise<{ current: Seen }> {
  const { MeroProvider, useMero } = await import('./MeroContext');
  const seen: { current: Seen } = { current: null as unknown as Seen };
  function Capture() {
    seen.current = useMero() as unknown as Seen;
    return null;
  }
  render(
    <MeroProvider mode={AppMode.MultiContext} servedByNode={servedByNode}>
      <Capture />
    </MeroProvider>,
  );
  await waitFor(() => expect(seen.current.isLoading).toBe(false));
  return seen;
}

let requested: string[];

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      requested.push(url);
      return url.endsWith('/auth/validate') ? new Response(null, { status: 200 }) : new Response('{}', { status: 503 });
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('MeroProvider servedByNode', () => {
  /** Start a login the way the app does, then land on its callback carrying `HASH`. */
  async function loginAndReturn() {
    const first = await mount(true);
    const original = window.location;
    let navigated = '';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() {
          return original.href;
        },
        set href(next: string) {
          navigated = next;
        },
      },
    });
    try {
      act(() => first.current.connectToNode(original.origin));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
    cleanup();
    expect(navigated.startsWith(`${original.origin}/auth/login?`)).toBe(true);
    const callback = new URL(new URL(navigated).searchParams.get('callback-url') as string);
    window.history.replaceState(null, '', `${callback.pathname}${callback.search}#${HASH}`);
    requested = [];
  }

  it('talks to its own origin whatever the callback node_url says', async () => {
    await loginAndReturn();

    const seen = await mount(true);

    expect(seen.current.isAuthenticated).toBe(true);
    expect(seen.current.nodeUrl).toBe(window.location.origin);
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every((u) => u.startsWith(window.location.origin))).toBe(true);
  });

  it('keeps its own origin as the node after logout', async () => {
    const seen = await mount(true);

    act(() => seen.current.logout());

    expect(seen.current.nodeUrl).toBe(window.location.origin);
  });

  it('outside the mode, the callback node_url is rejected without an initiated node', async () => {
    window.history.replaceState(null, '', `/#${HASH}`);

    const seen = await mount(false);

    expect(seen.current.isAuthenticated).toBe(false);
    expect(seen.current.nodeUrl).toBeNull();
  });
});
