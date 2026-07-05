// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';

// Mock only the mero-js module; node-trust + storage run for real.
vi.mock('@calimero-network/mero-js', () => ({
  MeroJs: vi.fn().mockImplementation(() => ({
    admin: { getContexts: vi.fn().mockResolvedValue([]) },
    auth: {
      validateToken: vi.fn().mockResolvedValue({ valid: true, headers: {}, status: 200 }),
    },
    events: { on: vi.fn(), off: vi.fn(), connect: vi.fn().mockResolvedValue(undefined) },
    clearToken: vi.fn(),
    close: vi.fn(),
  })),
  LocalStorageTokenStore: vi.fn().mockImplementation(() => ({
    getTokens: vi.fn().mockReturnValue(null),
    setTokens: vi.fn(),
    clear: vi.fn(),
  })),
  parseAuthCallback: vi.fn(),
  buildAuthLoginUrl: vi.fn(() => 'https://auth.example/login'),
}));

import { MeroProvider, useMero, getPermissionsForMode } from './MeroContext';
import { AppMode } from '../types';
import { MeroJs, parseAuthCallback } from '@calimero-network/mero-js';
import type { TokenStore } from '@calimero-network/mero-js';

const meroMock = vi.mocked(MeroJs);
const mockParseAuthCallback = vi.mocked(parseAuthCallback);

/** baseUrls every MeroJs client was constructed with this test. */
const constructedBaseUrls = () =>
  meroMock.mock.calls.map((c) => (c[0] as { baseUrl: string }).baseUrl);

type MockStore = TokenStore & {
  setTokens: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  getTokens: ReturnType<typeof vi.fn>;
};
function makeStore(): MockStore {
  return {
    getTokens: vi.fn().mockReturnValue(null),
    setTokens: vi.fn(),
    clear: vi.fn(),
  } as unknown as MockStore;
}

function Consumer() {
  const { isLoading, isAuthenticated, logout } = useMero();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <button onClick={logout}>logout</button>
    </div>
  );
}

const settled = () =>
  waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

beforeEach(() => {
  localStorage.clear();
  meroMock.mockClear();
  mockParseAuthCallback.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MeroProvider — OAuth callback node_url binding', () => {
  it('rejects a node_url that differs from the initiated node (no tokens stored, no client against the attacker) but still restores the existing session', async () => {
    localStorage.setItem('mero:node_url', 'https://node-a.example.com'); // initiated / existing session
    mockParseAuthCallback.mockReturnValue({
      accessToken: 'a.b.c',
      refreshToken: 'r',
      nodeUrl: 'https://evil.com',
    } as never);
    const store = makeStore();

    render(
      <MeroProvider mode={AppMode.MultiContext} tokenStore={store}>
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    expect(store.setTokens).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    const urls = constructedBaseUrls();
    expect(urls).not.toContain('https://evil.com');
    // a tampered callback must not log out a real user — the saved session is restored
    expect(urls).toContain('https://node-a.example.com');
  });

  it('accepts a callback node_url matching the initiated node and stores tokens against it', async () => {
    localStorage.setItem('mero:node_url', 'https://node-a.example.com');
    mockParseAuthCallback.mockReturnValue({
      accessToken: 'a.b.c',
      refreshToken: 'r',
      nodeUrl: 'https://node-a.example.com/callback',
    } as never);
    const store = makeStore();

    render(
      <MeroProvider mode={AppMode.MultiContext} tokenStore={store}>
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    expect(store.setTokens).toHaveBeenCalledTimes(1);
    expect(constructedBaseUrls()).toContain('https://node-a.example.com/callback');
  });

  it('rejects a callback node_url not in allowedNodeUrls when there is no initiated node', async () => {
    mockParseAuthCallback.mockReturnValue({
      accessToken: 'a.b.c',
      refreshToken: 'r',
      nodeUrl: 'https://evil.com',
    } as never);
    const store = makeStore();

    render(
      <MeroProvider
        mode={AppMode.MultiContext}
        tokenStore={store}
        allowedNodeUrls={['https://node-a.example.com']}
      >
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    expect(store.setTokens).not.toHaveBeenCalled();
    expect(constructedBaseUrls()).not.toContain('https://evil.com');
    expect(console.error).toHaveBeenCalled();
  });

  it('rejects a node_url when there is no trust anchor (no initiated node and no allowlist)', async () => {
    mockParseAuthCallback.mockReturnValue({
      accessToken: 'a.b.c',
      refreshToken: 'r',
      nodeUrl: 'https://evil.com',
    } as never);
    const store = makeStore();

    render(
      <MeroProvider mode={AppMode.MultiContext} tokenStore={store}>
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    expect(store.setTokens).not.toHaveBeenCalled();
    expect(constructedBaseUrls()).not.toContain('https://evil.com');
    expect(console.error).toHaveBeenCalled();
  });

  it('stores no tokens when the callback resolves to no node (no node_url, no saved node)', async () => {
    mockParseAuthCallback.mockReturnValue({
      accessToken: 'a.b.c',
      refreshToken: 'r',
    } as never);
    const store = makeStore();

    render(
      <MeroProvider mode={AppMode.MultiContext} tokenStore={store}>
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    expect(store.setTokens).not.toHaveBeenCalled();
  });
});

describe('MeroProvider — checkAuth (scope-enforced cores, rc.9+)', () => {
  // Cores since 0.11.0-rc.9 enforce token permission scopes: GET /admin-api/contexts
  // requires Global `context:list`, which single-context and app-scoped tokens don't
  // hold. checkAuth must therefore probe /auth/validate (permission-free), never the
  // contexts route — otherwise valid sessions 403 and every app loops back to login.

  function storeWithTokens(): MockStore {
    const store = makeStore();
    store.getTokens.mockReturnValue({
      access_token: 'a.b.c',
      refresh_token: 'r',
      expires_at: Date.now() + 3_600_000,
    });
    return store;
  }

  /** Build a full mock MeroJs instance and make the next constructions return it. */
  function mockInstance(validateResult: { valid: boolean; status: number }) {
    const instance = {
      admin: { getContexts: vi.fn().mockResolvedValue([]) },
      auth: {
        validateToken: vi.fn().mockResolvedValue({ ...validateResult, headers: {} }),
      },
      events: { on: vi.fn(), off: vi.fn(), connect: vi.fn().mockResolvedValue(undefined) },
      clearToken: vi.fn(),
      close: vi.fn(),
    };
    meroMock.mockImplementation(() => instance as never);
    return instance;
  }

  it('restores a saved session via auth.validateToken, without touching admin.getContexts', async () => {
    localStorage.setItem('mero:node_url', 'https://node-a.example.com');
    mockParseAuthCallback.mockReturnValue(null as never);
    const store = storeWithTokens();
    const instance = mockInstance({ valid: true, status: 200 });

    render(
      <MeroProvider mode={AppMode.SingleContext} tokenStore={store}>
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    expect(screen.getByTestId('authed').textContent).toBe('true');
    expect(instance.auth.validateToken).toHaveBeenCalledWith('a.b.c');
    expect(instance.admin.getContexts).not.toHaveBeenCalled();
  });

  it('is not authenticated when the token fails validation', async () => {
    localStorage.setItem('mero:node_url', 'https://node-a.example.com');
    mockParseAuthCallback.mockReturnValue(null as never);
    const store = storeWithTokens();
    mockInstance({ valid: false, status: 401 });

    render(
      <MeroProvider mode={AppMode.MultiContext} tokenStore={store}>
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    expect(screen.getByTestId('authed').textContent).toBe('false');
  });

  it('is not authenticated when the token store is empty (no /auth/validate round-trip)', async () => {
    localStorage.setItem('mero:node_url', 'https://node-a.example.com');
    mockParseAuthCallback.mockReturnValue(null as never);
    const store = makeStore(); // getTokens → null
    const instance = mockInstance({ valid: true, status: 200 });

    render(
      <MeroProvider mode={AppMode.MultiContext} tokenStore={store}>
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    expect(screen.getByTestId('authed').textContent).toBe('false');
    expect(instance.auth.validateToken).not.toHaveBeenCalled();
  });
});

describe('MeroProvider — logout', () => {
  it('clears the token store even when not connected (meroRef is null)', async () => {
    mockParseAuthCallback.mockReturnValue(null as never); // no callback, no node → mero stays null
    const store = makeStore();

    render(
      <MeroProvider mode={AppMode.MultiContext} tokenStore={store}>
        <Consumer />
      </MeroProvider>,
    );
    await settled();

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(store.clear).toHaveBeenCalled();
  });
});

describe('getPermissionsForMode — grants requested at login (scope-enforced cores)', () => {
  it('MultiContext requests context + namespace/group/blob/alias grants', () => {
    expect(getPermissionsForMode(AppMode.MultiContext)).toEqual([
      'context:create',
      'context:list',
      'context:execute',
      'namespace',
      'group',
      'blob',
      'context:alias',
    ]);
  });

  it('SingleContext requests execute/list plus blob and alias grants', () => {
    // context:list: every app calls GET /admin-api/contexts/:id/identities-owned
    // right after login, which maps to a context:list requirement.
    expect(getPermissionsForMode(AppMode.SingleContext)).toEqual([
      'context:execute',
      'context:list',
      'blob',
      'context:alias',
    ]);
  });

  it('Admin is unchanged', () => {
    expect(getPermissionsForMode(AppMode.Admin)).toEqual(['admin']);
  });

  it('throws on an unsupported mode', () => {
    expect(() => getPermissionsForMode('bogus' as AppMode)).toThrow(
      /Unsupported application mode/,
    );
  });
});
