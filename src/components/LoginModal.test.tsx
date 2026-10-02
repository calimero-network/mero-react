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

function renderModal(
  props: Partial<React.ComponentProps<typeof LoginModal>> = {},
) {
  const onConnect = vi.fn();
  const onClose = vi.fn();
  render(
    <LoginModal isOpen onConnect={onConnect} onClose={onClose} {...props} />,
  );
  return { onConnect, onClose };
}

const healthCalls = (mock: ReturnType<typeof mockFetch>) =>
  mock.mock.calls.filter((c) => String(c[0]).includes('/admin-api/health'));
const isAuthedCalls = (mock: ReturnType<typeof mockFetch>) =>
  mock.mock.calls.filter((c) => String(c[0]).includes('/admin-api/is-authed'));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginModal — node discovery', () => {
  it('probes local ports as soon as the modal opens', async () => {
    const fetchMock = mockFetch([NODE_A]);
    vi.stubGlobal('fetch', fetchMock);
    renderModal();

    await screen.findByTestId('node-option-localhost:2428');
    expect(healthCalls(fetchMock).length).toBeGreaterThan(0);
    // No Local/Remote tabs anymore.
    expect(screen.queryByTestId('node-type-local')).toBeNull();
    expect(screen.queryByTestId('node-type-remote')).toBeNull();
  });

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
    expect(isAuthedCalls(fetchMock)).toHaveLength(0);
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
    expect(isAuthedCalls(fetchMock)).toHaveLength(1);
  });
});

describe('LoginModal — no node found', () => {
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
    const before = healthCalls(fetchMock).length;
    expect(before).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('rescan-button'));

    await waitFor(() =>
      expect(healthCalls(fetchMock).length).toBeGreaterThan(before),
    );
  });

  it('prefills the saved node URL from localStorage', async () => {
    localStorage.setItem('mero:node_url', 'https://saved.example.com');
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal();

    const input = (await screen.findByTestId(
      'node-url-input',
    )) as HTMLInputElement;
    expect(input.value).toBe('https://saved.example.com');
  });
});

describe('LoginModal — tabs', () => {
  it('has no tabs without `cloud`', async () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal();

    await screen.findByTestId('node-url-input');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByTestId('connect-button')).toBeTruthy();
  });

  it('with `cloud`, shows Node and Cloud tabs with Node selected', async () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal({ cloud: { onEnrol: vi.fn() } });

    await screen.findByTestId('node-url-input');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Node', 'Cloud']);
    const [node, cloud] = tabs;
    expect(node.getAttribute('aria-selected')).toBe('true');
    expect(cloud.getAttribute('aria-selected')).toBe('false');
    expect(node.tabIndex).toBe(0);
    expect(cloud.tabIndex).toBe(-1);
    expect(node.getAttribute('aria-controls')).toBe('mero-login-panel-node');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(node.id);
    // The Node body is the existing one.
    expect(screen.getByTestId('connect-button')).toBeTruthy();
    expect(screen.queryByTestId('enrol-button')).toBeNull();
  });

  it('switching to Cloud shows the enrol button, which calls onEnrol', async () => {
    vi.stubGlobal('fetch', mockFetch([]));
    const onEnrol = vi.fn();
    renderModal({ cloud: { onEnrol } });

    fireEvent.click(screen.getByRole('tab', { name: 'Cloud' }));
    expect(screen.getByRole('tab', { name: 'Cloud' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('connect-button')).toBeNull();
    expect(screen.queryByTestId('node-url-input')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Enrol with your account' }));
    expect(onEnrol).toHaveBeenCalledTimes(1);
  });

  it('shows the note and the custom-wallet hint on the Cloud tab', () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal({
      cloud: {
        onEnrol: vi.fn(),
        note: 'Signed in, with nowhere to write yet',
        walletUrl: 'http://localhost:8090/account-enroll',
        customWallet: true,
      },
      initialTab: 'cloud',
    });

    expect(screen.getByTestId('account-note').textContent).toContain('nowhere to write yet');
    expect(screen.getByText('http://localhost:8090/account-enroll')).toBeTruthy();
  });

  it('hides the wallet hint for the hosted wallet', () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal({
      cloud: { onEnrol: vi.fn(), walletUrl: 'https://wallet.example', customWallet: false },
      initialTab: 'cloud',
    });
    expect(screen.queryByText('https://wallet.example')).toBeNull();
  });

  it('`initialTab="cloud"` opens on Cloud', () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal({ cloud: { onEnrol: vi.fn() }, initialTab: 'cloud' });

    const cloud = screen.getByRole('tab', { name: 'Cloud' });
    expect(cloud.getAttribute('aria-selected')).toBe('true');
    expect(cloud.tabIndex).toBe(0);
    expect(screen.getByTestId('enrol-button')).toBeTruthy();
  });

  it('arrow keys move selection and focus between tabs', () => {
    vi.stubGlobal('fetch', mockFetch([]));
    renderModal({ cloud: { onEnrol: vi.fn() } });

    const node = screen.getByRole('tab', { name: 'Node' });
    node.focus();
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    const cloud = screen.getByRole('tab', { name: 'Cloud' });
    expect(cloud.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(cloud);

    fireEvent.keyDown(cloud, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Node' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Node' }));

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Cloud' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Node' }).getAttribute('aria-selected')).toBe('true');
  });

  it('a reopen starts on `initialTab` again', () => {
    vi.stubGlobal('fetch', mockFetch([]));
    const props = { onConnect: vi.fn(), onClose: vi.fn(), cloud: { onEnrol: vi.fn() } };
    const { rerender } = render(<LoginModal isOpen {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Cloud' }));
    rerender(<LoginModal isOpen={false} {...props} />);
    rerender(<LoginModal isOpen {...props} />);
    expect(screen.getByRole('tab', { name: 'Node' }).getAttribute('aria-selected')).toBe('true');
  });
});
