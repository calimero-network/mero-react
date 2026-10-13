// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import type { MeroJs } from '@calimero-network/mero-js';
import { AppMode } from '../types';

// The real mero-js: whether callback tokens are adopted is decided inside it.
const NODE = 'http://node-a.test';
const HASH = `access_token=a.b.c&refresh_token=r&node_url=${encodeURIComponent(NODE)}`;

type Seen = { isLoading: boolean; isAuthenticated: boolean; mero: unknown; connectToNode(url: string): void };

/** What Tauri injects: an object whose `invoke` reaches the host. */
const TAURI = { invoke: () => Promise.resolve() };

/** Load the provider afresh, as a page load does, and render it until settled. */
async function mount({ strict = false } = {}): Promise<Seen> {
  const { MeroProvider, useMero } = await import('./MeroContext');
  const seen: { current: Seen | null } = { current: null };
  function Capture() {
    seen.current = useMero() as unknown as Seen;
    return null;
  }
  const tree = (
    <MeroProvider mode={AppMode.MultiContext}>
      <Capture />
    </MeroProvider>
  );
  render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  await waitFor(() => expect(seen.current?.isLoading).toBe(false));
  return seen.current as Seen;
}

const clientToken = (s: Seen) => (s.mero as MeroJs | null)?.getTokenData()?.access_token ?? null;

let validated: string[];

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  validated = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/auth/validate')) {
        validated.push(url);
        return new Response(null, { status: 200 });
      }
      return new Response('{}', { status: 503 });
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
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  document.getElementById('__TAURI_INTERNALS__')?.remove();
  document.cookie = '__TAURI_INTERNALS__=; max-age=0';
  window.history.replaceState(null, '', '/');
});

describe('MeroProvider — callback tokens nobody asked for', () => {
  it('a crafted link cannot turn the desktop exception on in a browser', async () => {
    localStorage.setItem('mero:node_url', NODE);
    localStorage.setItem('__TAURI_INTERNALS__', '1');
    localStorage.setItem('__TAURI_FETCH_PROXY_INJECTED__', 'true');
    document.cookie = '__TAURI_INTERNALS__=1';
    const flags = 'allowUnsolicited=true&__TAURI_INTERNALS__=1&__TAURI_FETCH_PROXY_INJECTED__=true';
    window.history.replaceState(null, '', `/?${flags}#${HASH}&${flags}`);

    const seen = await mount();

    expect(seen.isAuthenticated).toBe(false);
    expect(clientToken(seen)).toBeNull();
    expect(localStorage.getItem('mero-tokens')).toBeNull();
    expect(validated).toEqual([]);
  });

  it('a desktop global set after start-up does not count', async () => {
    await import('./MeroContext');
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = TAURI;
    localStorage.setItem('mero:node_url', NODE);
    window.history.replaceState(null, '', `/#${HASH}`);

    const seen = await mount();

    expect(seen.isAuthenticated).toBe(false);
    expect(localStorage.getItem('mero-tokens')).toBeNull();
  });

  it('inside Calimero Desktop the tokens the host put in the hash are adopted', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = TAURI;
    window.history.replaceState(null, '', `/#${HASH}`);
    localStorage.setItem('mero:node_url', NODE);

    const seen = await mount();

    expect(seen.isAuthenticated).toBe(true);
    expect(clientToken(seen)).toBe('a.b.c');
  });

  /** Begin a login the way the app does, and land on its callback with tokens. */
  async function beginLoginAndReturn() {
    const first = await mount();
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
      act(() => first.connectToNode(NODE));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
    cleanup();

    const callback = new URL(new URL(navigated).searchParams.get('callback-url') as string);
    window.history.replaceState(null, '', `${callback.pathname}${callback.search}#${HASH}`);
  }

  it('in a browser, the answer to a login this page began is adopted', async () => {
    await beginLoginAndReturn();
    const seen = await mount();

    expect(seen.isAuthenticated).toBe(true);
    expect(clientToken(seen)).toBe('a.b.c');
  });

  it('under StrictMode, the answer to a login this page began is adopted once', async () => {
    await beginLoginAndReturn();
    const seen = await mount({ strict: true });

    expect(seen.isAuthenticated).toBe(true);
    expect(clientToken(seen)).toBe('a.b.c');
    expect(window.location.href).not.toMatch(/access_token|auth_state/);
  });

  it('a refused callback leaves no tokens in the address bar', async () => {
    localStorage.setItem('mero:node_url', NODE);
    window.history.replaceState(null, '', `/app?x=1&auth_state=not-pending#${HASH}`);

    const seen = await mount();

    expect(seen.isAuthenticated).toBe(false);
    expect(window.location.href).not.toMatch(/access_token|refresh_token|auth_state/);
    expect(window.location.pathname + window.location.search).toBe('/app?x=1');
  });

  it('a page element with the Tauri id does not count as the desktop host', async () => {
    const el = document.createElement('div');
    el.id = '__TAURI_INTERNALS__';
    document.body.append(el);
    // What a browser's named access to the element yields; jsdom does not model it.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = el;
    localStorage.setItem('mero:node_url', NODE);
    window.history.replaceState(null, '', `/#${HASH}`);

    const seen = await mount();

    expect(seen.isAuthenticated).toBe(false);
    expect(localStorage.getItem('mero-tokens')).toBeNull();
  });
});
