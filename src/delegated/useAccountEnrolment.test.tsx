// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { readEnrolmentCallback, completeDeviceEnrolment, getAccountRelays } = vi.hoisted(() => ({
  readEnrolmentCallback: vi.fn(),
  completeDeviceEnrolment: vi.fn(),
  getAccountRelays: vi.fn(),
}));
vi.mock('@calimero-network/mero-js', async (orig) => ({
  ...(await orig<typeof import('@calimero-network/mero-js')>()),
  readEnrolmentCallback,
  completeDeviceEnrolment,
  CloudClient: vi.fn(() => ({ getAccountRelays })),
}));
// `foundDelegatedNamespace` lives in mero-js and enables HA through mero-js's own
// `CloudClient`, which the module mock above cannot reach; its prototype can be.
const { CloudClient: RealCloudClient } = await vi.importActual<typeof import('@calimero-network/mero-js')>('@calimero-network/mero-js');

import { RelayClient } from '@calimero-network/mero-js';
import { MeroContext } from '../context';
import { isReturningFromWallet, useAccountEnrolment } from './useAccountEnrolment';
import { foundDelegatedNamespace } from '@calimero-network/mero-js';
import { readDelegatedSession, saveDelegatedSession, signerFromSecret, type DelegatedAccountSession as DelegatedSession } from '@calimero-network/mero-js';
import { enrolledDevice } from '../test-utils/enrolledDevice';

const connectWithAccount = vi.fn();
function wrapper({ children }: { children: React.ReactNode }) {
  const value = { connectWithAccount, cloudBaseUrl: undefined } as unknown as React.ContextType<typeof MeroContext>;
  return <MeroContext.Provider value={value}>{children}</MeroContext.Provider>;
}

/** A loopback relay's mock quote binding `nodeKey` to the nonce it was asked with. */
function mockAttestation(nodeKey: string) {
  return async (_url: unknown, init?: RequestInit) => {
    const { nonce } = JSON.parse(String(init?.body)) as { nonce: string };
    const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
    const binding = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new Uint8Array([...new TextEncoder().encode('calimero.tee-attest.key-binding.v1'), ...new Uint8Array(32), ...bytes(nodeKey)]),
      ),
    );
    const quote = new Uint8Array([...new TextEncoder().encode('MOCK_TDX_QUOTE_V1'), ...bytes(nonce), ...binding]);
    const quoteB64 = btoa(String.fromCharCode(...quote));
    return new Response(JSON.stringify({ data: { quoteB64, boundPublicKey: nodeKey } }), { status: 200 });
  };
}

const SIGNER = await signerFromSecret('bb'.repeat(32));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  readEnrolmentCallback.mockReset();
  completeDeviceEnrolment.mockReset();
  getAccountRelays.mockReset();
  connectWithAccount.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('useAccountEnrolment', () => {
  it('a page load with no callback does nothing, and is not returning', async () => {
    readEnrolmentCallback.mockReturnValue(null);
    const { result } = renderHook(() => useAccountEnrolment(), { wrapper });
    await Promise.resolve();
    expect(result.current.returning).toBe(false);
    expect(result.current.note).toBeNull();
    expect(result.current.walletUrl).toBe('https://wallet.cloud.calimero.network/account-enroll');
    expect(result.current.customWallet).toBe(false);
    expect(completeDeviceEnrolment).not.toHaveBeenCalled();
    expect(connectWithAccount).not.toHaveBeenCalled();
  });

  it('reads the callback once, however many renders', () => {
    readEnrolmentCallback.mockReturnValue(null);
    const { rerender } = renderHook(() => useAccountEnrolment(), { wrapper });
    rerender();
    rerender();
    expect(readEnrolmentCallback).toHaveBeenCalledTimes(1);
  });

  it('a wallet override is reported as custom', () => {
    readEnrolmentCallback.mockReturnValue(null);
    const { result } = renderHook(() => useAccountEnrolment({ walletUrl: 'http://localhost:8090/x' }), { wrapper });
    expect(result.current.walletUrl).toBe('http://localhost:8090/x');
    expect(result.current.customWallet).toBe(true);
  });

  it('disabled, it reads no callback', () => {
    const { result } = renderHook(() => useAccountEnrolment({ enabled: false }), { wrapper });
    expect(readEnrolmentCallback).not.toHaveBeenCalled();
    expect(result.current.returning).toBe(false);
  });

  it('an error callback is returning and becomes the note', async () => {
    readEnrolmentCallback.mockImplementation(() => {
      throw new Error('enrolment cancelled');
    });
    const { result } = renderHook(() => useAccountEnrolment(), { wrapper });
    expect(result.current.returning).toBe(true);
    await waitFor(() => expect(result.current.note).toBe('enrolment cancelled'));
    expect(result.current.returning).toBe(true);
  });

  it('a callback this tab did not start is refused', async () => {
    const refusal = 'this enrolment was not started here, or was already completed - start it again';
    readEnrolmentCallback.mockReturnValue({ state: 'x', cert: 'c' });
    completeDeviceEnrolment.mockRejectedValue(new Error(refusal));
    const { result } = renderHook(() => useAccountEnrolment(), { wrapper });
    expect(result.current.returning).toBe(true);
    await waitFor(() => expect(result.current.note).toBe(refusal));
    expect(connectWithAccount).not.toHaveBeenCalled();
  });

  it('a callback it started completes and connects', async () => {
    const callback = { state: 'sent-state', cert: 'c' };
    readEnrolmentCallback.mockReturnValue(callback);
    completeDeviceEnrolment.mockResolvedValue({ account: 'ee'.repeat(32), credential: 'cred', signer: SIGNER });
    getAccountRelays.mockResolvedValue([{ relayUrl: 'https://relay.example', fresh: true }]);
    const { result } = renderHook(() => useAccountEnrolment(), { wrapper });

    await waitFor(() => expect(connectWithAccount).toHaveBeenCalledTimes(1));
    expect(completeDeviceEnrolment).toHaveBeenCalledWith(callback);
    expect(connectWithAccount).toHaveBeenCalledWith({
      relayUrl: 'https://relay.example',
      account: 'ee'.repeat(32),
      credential: 'cred',
      signer: SIGNER,
    });
    expect(result.current.note).toBeNull();
  });

  it('an account with no relays connects with a note', async () => {
    readEnrolmentCallback.mockReturnValue({ state: 's' });
    completeDeviceEnrolment.mockResolvedValue({ account: 'ee'.repeat(32), credential: 'cred', signer: SIGNER });
    getAccountRelays.mockResolvedValue([]);
    const { result } = renderHook(() => useAccountEnrolment(), { wrapper });

    await waitFor(() => expect(connectWithAccount).toHaveBeenCalledWith(expect.objectContaining({ relayUrl: null })));
    expect(result.current.note).toMatch(/nowhere to write yet/);
  });

  it('goToWallet remembers a state and leaves for the wallet', async () => {
    readEnrolmentCallback.mockReturnValue(null);
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    try {
      const { result } = renderHook(() => useAccountEnrolment({ walletUrl: 'https://wallet.test/enrol' }), { wrapper });
      await result.current.goToWallet();
      expect(assign).toHaveBeenCalledTimes(1);
      const url = new URL(String(assign.mock.calls[0][0]));
      expect(url.origin + url.pathname).toBe('https://wallet.test/enrol');
      for (const key of ['state', 'enrol-device', 'enrol-kem']) expect(url.searchParams.get(key)).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('a device key that cannot be made becomes the note, not an unhandled rejection', async () => {
    readEnrolmentCallback.mockReturnValue(null);
    const generateKey = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValue(new Error('X25519 is not supported'));
    try {
      const { result } = renderHook(() => useAccountEnrolment(), { wrapper });
      await expect(result.current.goToWallet()).resolves.toBeUndefined();
      await waitFor(() => expect(result.current.note).toMatch(/X25519 is not supported/));
    } finally {
      generateKey.mockRestore();
    }
  });

  describe('a relay the cloud assigned', () => {
    const ACCOUNT = 'ee'.repeat(32);
    const EXECUTOR = '6a'.repeat(32);
    const RELAY = 'http://127.0.0.1:4480';

    /** Enrol with `rows` as the cloud's relay answer; resolve with the session connected. */
    async function enrol(rows: unknown[], enrolled: object = { account: ACCOUNT, credential: 'cred', signer: SIGNER }): Promise<DelegatedSession> {
      readEnrolmentCallback.mockReturnValue({ state: 's' });
      completeDeviceEnrolment.mockResolvedValue(enrolled);
      getAccountRelays.mockResolvedValue(rows);
      renderHook(() => useAccountEnrolment(), { wrapper });
      await waitFor(() => expect(connectWithAccount).toHaveBeenCalledTimes(1));
      return connectWithAccount.mock.calls[0][0] as DelegatedSession;
    }

    it("connects on it with the relay's executor account", async () => {
      const session = await enrol([
        { peerId: 'p', relayUrl: RELAY, fresh: true, executorAccount: EXECUTOR, assigned: true },
      ]);
      expect(session).toEqual({
        relayUrl: RELAY,
        executorAccount: EXECUTOR,
        account: ACCOUNT,
        credential: 'cred',
        signer: SIGNER,
      });
    });

    it('keeps the executor of a relay whose heartbeat lapsed, when it is the only one', async () => {
      const session = await enrol([
        { peerId: 'p', relayUrl: RELAY, fresh: false, executorAccount: EXECUTOR, assigned: true },
      ]);
      expect(session).toMatchObject({ relayUrl: RELAY, executorAccount: EXECUTOR });
    });

    it('takes the executor of the relay it chose, not of another row', async () => {
      const session = await enrol([
        { peerId: 'a', relayUrl: 'https://stale.example', fresh: false, executorAccount: 'ab'.repeat(32), assigned: false },
        { peerId: 'b', relayUrl: RELAY, fresh: true, executorAccount: EXECUTOR, assigned: false },
      ]);
      expect(session).toMatchObject({ relayUrl: RELAY, executorAccount: EXECUTOR });
    });

    it('founds a namespace on it straight away, with no namespace joined first', async () => {
      const founded = vi
        .spyOn(RelayClient.prototype, 'foundNamespace')
        .mockResolvedValue({ namespaceId: 'ab'.repeat(32), salt: 'cd'.repeat(32), teeEnabled: true } as never);
      const describeGovernance = vi.spyOn(RelayClient.prototype, 'describeGovernance');
      const enableHa = vi.spyOn(RealCloudClient.prototype, 'enableHaAsAccount').mockResolvedValue({ status: 'enabled' } as never);
      try {
        completeDeviceEnrolment.mockImplementation(
          (await vi.importActual<typeof import('@calimero-network/mero-js')>('@calimero-network/mero-js')).completeDeviceEnrolment,
        );
        const device = await enrolledDevice();
        const session = await enrol(
          [{ peerId: 'p', relayUrl: RELAY, fresh: true, executorAccount: EXECUTOR, assigned: true }],
          { ...device, device: 'dd'.repeat(32) },
        );
        // Through storage, as `connectWithAccount` persists it and a reload restores it.
        await saveDelegatedSession(session);
        const restored = (await readDelegatedSession())!;
        expect(restored.executorAccount).toBe(EXECUTOR);
        // Nothing joined: the account's relay map is empty.
        expect(localStorage.getItem(`calimero.delegated.relays.${device.account}`)).toBeNull();
        vi.stubGlobal('fetch', mockAttestation('ef'.repeat(32)));

        await expect(foundDelegatedNamespace(restored)).resolves.toMatchObject({
          namespaceId: 'ab'.repeat(32),
          haEnabled: true,
        });
        expect(founded).toHaveBeenCalledWith(expect.objectContaining({ executor: { executorAccount: EXECUTOR, executorKey: 'ef'.repeat(32) } }));
        expect(describeGovernance).not.toHaveBeenCalled();
      } finally {
        founded.mockRestore();
        describeGovernance.mockRestore();
        enableHa.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    // An older server names no executor: the session is the record it always
    // was, and founding still asks for a namespace on the relay first.
    it.each([
      ['omits the field', {}],
      ['sends null', { executorAccount: null }],
      ['sends something that is not an account', { executorAccount: 'NOT-HEX' }],
    ])('an old-server row that %s connects as before', async (_label, extra) => {
      const session = await enrol([{ peerId: 'p', relayUrl: RELAY, fresh: true, ...extra }]);
      expect(session).toEqual({ relayUrl: RELAY, account: ACCOUNT, credential: 'cred', signer: SIGNER });
      await expect(foundDelegatedNamespace(session)).rejects.toThrow(/executor account/);
    });
  });
});

// A peek, for the one thing the hook cannot do for a caller that owns `isOpen`:
// decide to open the modal on the load that comes back from the wallet. It must
// not consume the fragment, or the hook that follows it finds nothing.
describe('isReturningFromWallet', () => {
  it('is false on an ordinary page load', () => {
    expect(isReturningFromWallet({ hash: '' })).toBe(false);
    expect(isReturningFromWallet({ hash: '#section-2' })).toBe(false);
    expect(isReturningFromWallet({ hash: '#credential=only' })).toBe(false);
  });
  it('is true for a completed enrolment and for a declined one', () => {
    expect(isReturningFromWallet({ hash: '#credential=aa&account=bb&device=cc&state=dd' })).toBe(true);
    expect(isReturningFromWallet({ hash: '#error=cancelled' })).toBe(true);
  });
  it('leaves the fragment where it is', () => {
    const location = { hash: '#credential=aa&account=bb&device=cc' };
    isReturningFromWallet(location);
    expect(location.hash).toBe('#credential=aa&account=bb&device=cc');
    expect(window.location.hash).toBe('');
  });
});
