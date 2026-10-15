// @vitest-environment jsdom
/**
 * The account device key as a person meets it: enrol, use, sign out, and the
 * next person in the same browser profile enrolling.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const { getAccountRelays, readSession, closed } = vi.hoisted(() => ({ getAccountRelays: vi.fn(), readSession: vi.fn(), closed: vi.fn() }));
vi.mock('@calimero-network/mero-js', async (importActual) => {
  const actual = await importActual<typeof import('@calimero-network/mero-js')>();
  const buildDelegatedClient: typeof actual.buildDelegatedClient = (...args) => {
    const client = actual.buildDelegatedClient(...args);
    return client && new Proxy(client, { get: (t, p) => (p === 'close' ? () => (closed(), t.close()) : Reflect.get(t, p, t)) });
  };
  return { ...actual, CloudClient: vi.fn(() => ({ getAccountRelays })), readDelegatedSession: readSession, buildDelegatedClient };
});

import { MeroProvider, useMero } from './MeroContext';
import { AppMode } from '../types';
import { useAccountEnrolment } from '../delegated/useAccountEnrolment';
import { deviceRecords, enrolledDevice, walletAnswer } from '../test-utils/enrolledDevice';
import { beginDeviceEnrolment, saveDelegatedSession } from '@calimero-network/mero-js';

const { readDelegatedSession: realReadSession } =
  await vi.importActual<typeof import('@calimero-network/mero-js')>('@calimero-network/mero-js');

function Probe() {
  const m = useMero();
  const { goToWallet } = useAccountEnrolment();
  return (
    <div>
      <span data-testid="loading">{String(m.isLoading)}</span>
      <span data-testid="delegated">{String(m.isDelegated)}</span>
      <button onClick={() => void goToWallet()}>enrol</button>
      <button onClick={() => void m.logout()}>logout</button>
    </div>
  );
}

const assign = vi.fn();
const realLocation = window.location;

/** The wallet URL `goToWallet` left for, parsed. */
function lastWalletRequest() {
  const url = new URL(String(assign.mock.calls[assign.mock.calls.length - 1][0]));
  return {
    devicePublicKey: url.searchParams.get('enrol-device')!,
    kemPublicKey: url.searchParams.get('enrol-kem')!,
    state: url.searchParams.get('state')!,
  };
}

/** Every 64-hex string anything on this origin can read out of web storage. */
function hexInWebStorage(): string[] {
  const values = [localStorage, sessionStorage].flatMap((s) =>
    Object.keys(s).flatMap((k) => [k, s.getItem(k) ?? '']),
  );
  return values.flatMap((v) => v.match(/[0-9a-f]{64}/g) ?? []);
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  getAccountRelays.mockReset().mockResolvedValue([]);
  readSession.mockReset().mockImplementation(realReadSession);
  closed.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, assign, origin: 'https://app.example', pathname: '/', search: '', hash: '' },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.restoreAllMocks();
});

describe('account device key', () => {
  it('keeps no secret readable, is gone after logout, and is never offered to the next account', async () => {
    // What an earlier release left behind: the device secret as hex.
    localStorage.setItem('calimero.device', JSON.stringify({ signSk: '0f'.repeat(32), kemSk: '0e'.repeat(32) }));

    const first = render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => screen.getByText('enrol').click());
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const asked = lastWalletRequest();
    first.unmount();

    // Back from the wallet with a certificate over the key this browser asked about.
    const answer = await walletAnswer(asked);
    window.location.hash = '#' + new URLSearchParams({ ...answer }).toString();
    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await waitFor(() => expect(screen.getByTestId('delegated').textContent).toBe('true'));

    const publicValues = new Set([answer.account, answer.device, asked.devicePublicKey, asked.kemPublicKey]);
    expect(hexInWebStorage().filter((h) => !publicValues.has(h))).toEqual([]);

    await act(async () => screen.getByText('logout').click());
    await waitFor(() => expect(screen.getByTestId('delegated').textContent).toBe('false'));
    await waitFor(async () => expect(await deviceRecords()).toEqual([]));
    expect(localStorage.getItem('calimero.device')).toBeNull();

    // The next person in this browser profile enrols: a new key, never the last one.
    await act(async () => screen.getByText('enrol').click());
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
    expect(lastWalletRequest().devicePublicKey).not.toBe(asked.devicePublicKey);
  });

  it('restores a session on reload, loading until the device is read', async () => {
    const device = await enrolledDevice();
    await saveDelegatedSession({ ...device, relayUrl: null });

    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => expect(screen.getByTestId('delegated').textContent).toBe('true'));
  });

  it('stays signed out when logout lands before the session is restored', async () => {
    const device = await enrolledDevice();
    await saveDelegatedSession({ ...device, relayUrl: null });

    // The restore read answers only after the logout has run.
    let answer!: () => void;
    readSession.mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve({ ...device, relayUrl: null }))));

    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await act(async () => screen.getByText('logout').click());
    await act(async () => answer());
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    expect(screen.getByTestId('delegated').textContent).toBe('false');
    await waitFor(async () => expect(await deviceRecords()).toEqual([]));
  });

  it('stays signed out when an enrolment finishes connecting after logout', async () => {
    let relays!: (rows: unknown[]) => void;
    getAccountRelays.mockReturnValueOnce(new Promise((resolve) => (relays = resolve)));
    const asked = await beginDeviceEnrolment();
    window.location.hash = '#' + new URLSearchParams({ ...(await walletAnswer(asked)) }).toString();

    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await waitFor(() => expect(getAccountRelays).toHaveBeenCalled());
    await act(async () => screen.getByText('logout').click());
    await waitFor(async () => expect(await deviceRecords()).toEqual([]));
    await act(async () => relays([]));
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByTestId('delegated').textContent).toBe('false');
  });

  it('forgets the stored account on a logout that lands before the restore', async () => {
    const device = await enrolledDevice();
    await saveDelegatedSession({ ...device, relayUrl: null });
    localStorage.setItem(`calimero.delegated.relays.${device.account}`, '{}');
    readSession.mockImplementationOnce(() => new Promise(() => {}));

    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await act(async () => screen.getByText('logout').click());

    await waitFor(() => expect(localStorage.getItem(`calimero.delegated.relays.${device.account}`)).toBeNull());
  });

  it('stops waiting for a device store that never answers', async () => {
    readSession.mockImplementationOnce(() => new Promise(() => {}));

    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'), { timeout: 5000 });
  });

  it('restores a session whose read is slow, after letting the app stop loading', async () => {
    const device = await enrolledDevice();
    readSession.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ ...device, relayUrl: null }), 3500)),
    );

    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'), { timeout: 3400 });
    await waitFor(() => expect(screen.getByTestId('delegated').textContent).toBe('true'), { timeout: 2000 });
  }, 10_000);

  it('logs out of a node login even when the device store cannot be opened', async () => {
    let result = '';
    function Logout() {
      const { logout } = useMero();
      return <button onClick={() => logout().then(() => (result = 'resolved'), () => (result = 'rejected'))}>node logout</button>;
    }
    render(<MeroProvider mode={AppMode.MultiContext}><Logout /></MeroProvider>);
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await act(async () => screen.getByText('node logout').click());

    await waitFor(() => expect(result).toBe('resolved'));
  });

  it('closes the relay client, and with it its event stream, on logout', async () => {
    const device = await enrolledDevice();
    await saveDelegatedSession({ ...device, relayUrl: 'http://127.0.0.1:4480' });

    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await waitFor(() => expect(screen.getByTestId('delegated').textContent).toBe('true'));
    await act(async () => screen.getByText('logout').click());

    await waitFor(() => expect(closed).toHaveBeenCalled());
  });

  it('drops the legacy hex device record on load, signed in or not', async () => {
    localStorage.setItem('calimero.device', JSON.stringify({ signSk: '0f'.repeat(32) }));

    render(<MeroProvider mode={AppMode.MultiContext}><Probe /></MeroProvider>);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(localStorage.getItem('calimero.device')).toBeNull();
  });
});
