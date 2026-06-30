// @vitest-environment jsdom

import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginModal } from './LoginModal';
import { ConnectionType } from '../types';

/**
 * `fetch` stand-in: the listed base URLs answer `/admin-api/health` as alive;
 * any base answers `/admin-api/is-authed` with 200 so manual connects succeed.
 * Everything else rejects, like a closed port.
 */
function mockFetch(healthyBases: string[]) {
  const healthy = new Set(healthyBases);
  return vi.fn(async (input: string) => {
    const url = String(input);
    const base = url.replace(/\/admin-api\/.*$/, '');
    if (url.includes('/admin-api/health')) {
      if (healthy.has(base)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { status: 'alive' } }),
        } as Response;
      }
      throw new TypeError('Failed to fetch');
    }
    if (url.includes('/admin-api/is-authed')) {
      return { ok: true, status: 200, statusText: 'OK' } as Response;
    }
    throw new TypeError(`unexpected fetch: ${url}`);
  });
}

const NODE_A = 'http://localhost:2428';
const NODE_B = 'http://localhost:2528';

function renderModal(props: Partial<React.ComponentProps<typeof LoginModal>> = {}) {
  const onConnect = vi.fn();
  const onClose = vi.fn();
  render(
    <LoginModal
      isOpen
      onConnect={onConnect}
      onClose={onClose}
      connectionType={ConnectionType.RemoteAndLocal}
      {...props}
    />,
  );
  return { onConnect, onClose };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginModal — local node discovery', () => {
  it('shows a discovering state while probing local ports', () => {
    // A never-resolving fetch keeps discovery pending.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderModal();
    expect(screen.getByTestId('node-discovering')).toBeTruthy();
  });

  it('lists each discovered node plus an always-present manual option', async () => {
    vi.stubGlobal('fetch', mockFetch([NODE_A, NODE_B]));
    renderModal();

    await screen.findByTestId('node-option-localhost:2428');
    expect(screen.getByTestId('node-option-localhost:2528')).toBeTruthy();
    // The manual "enter URL" choice is always offered alongside found nodes.
    expect(screen.getByTestId('node-option-custom')).toBeTruthy();
    expect(screen.queryByTestId('node-discovering')).toBeNull();
  });

  it('connects directly to the default (first) discovered node without an extra check', async () => {
    const fetchMock = mockFetch([NODE_A, NODE_B]);
    vi.stubGlobal('fetch', fetchMock);
    const { onConnect } = renderModal();

    await screen.findByTestId('node-option-localhost:2428');
    fireEvent.click(screen.getByTestId('connect-button'));

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(NODE_A));
    // Discovered nodes are already health-checked, so no is-authed probe.
    const isAuthedCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('is-authed'),
    );
    expect(isAuthedCalls).toHaveLength(0);
  });

  it('connects to a different discovered node when selected', async () => {
    vi.stubGlobal('fetch', mockFetch([NODE_A, NODE_B]));
    const { onConnect } = renderModal();

    await screen.findByTestId('node-option-localhost:2528');
    fireEvent.click(screen.getByTestId('node-option-localhost:2528'));
    fireEvent.click(screen.getByTestId('connect-button'));

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(NODE_B));
  });

  it('reveals the URL field and verifies reachability when manual entry is chosen', async () => {
    const fetchMock = mockFetch([NODE_A]);
    vi.stubGlobal('fetch', fetchMock);
    const { onConnect } = renderModal();

    await screen.findByTestId('node-option-custom');
    fireEvent.click(screen.getByTestId('node-option-custom'));

    const input = screen.getByTestId('node-url-input');
    fireEvent.change(input, {
      target: { value: 'https://remote.example.com' },
    });
    fireEvent.click(screen.getByTestId('connect-button'));

    await waitFor(() =>
      expect(onConnect).toHaveBeenCalledWith('https://remote.example.com'),
    );
    const isAuthedCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('is-authed'),
    );
    expect(isAuthedCalls).toHaveLength(1);
  });
});

describe('LoginModal — no local node found', () => {
  it('falls through to manual entry with a "no local node" message', async () => {
    vi.stubGlobal('fetch', mockFetch([]));
    const { onConnect } = renderModal();

    const input = await screen.findByTestId('node-url-input');
    expect(screen.getByText(/no local node found/i)).toBeTruthy();
    // Nothing typed yet → cannot connect.
    expect(
      (screen.getByTestId('connect-button') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(input, { target: { value: 'http://localhost:2428' } });
    expect(
      (screen.getByTestId('connect-button') as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByTestId('connect-button'));
    await waitFor(() =>
      expect(onConnect).toHaveBeenCalledWith('http://localhost:2428'),
    );
  });

  it('keeps the connect button disabled for an invalid URL', async () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal();

    const input = await screen.findByTestId('node-url-input');
    fireEvent.change(input, { target: { value: 'not a url' } });
    expect(
      (screen.getByTestId('connect-button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('re-probes when the user clicks rescan', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    renderModal();

    await screen.findByTestId('rescan-button');
    const healthCallsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/admin-api/health'),
    ).length;
    expect(healthCallsBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('rescan-button'));

    await waitFor(() => {
      const healthCallsAfter = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes('/admin-api/health'),
      ).length;
      expect(healthCallsAfter).toBeGreaterThan(healthCallsBefore);
    });
  });
});

describe('LoginModal — remote-only', () => {
  it('skips local discovery and shows only the URL field', async () => {
    const fetchMock = mockFetch([]);
    vi.stubGlobal('fetch', fetchMock);
    renderModal({ connectionType: ConnectionType.Remote });

    await screen.findByTestId('node-url-input');
    // No local probing for remote-only.
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/admin-api/health')),
    ).toBe(false);
    expect(screen.queryByTestId('rescan-button')).toBeNull();
    expect(screen.queryByTestId('node-discovering')).toBeNull();
  });

  it('prefills the saved node URL from localStorage', async () => {
    localStorage.setItem('mero:node_url', 'https://saved.example.com');
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal({ connectionType: ConnectionType.Remote });

    const input = (await screen.findByTestId(
      'node-url-input',
    )) as HTMLInputElement;
    expect(input.value).toBe('https://saved.example.com');
  });
});
