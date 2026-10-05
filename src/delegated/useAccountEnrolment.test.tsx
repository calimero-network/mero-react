// @vitest-environment jsdom
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
import { readDelegatedSession, saveDelegatedSession, type DelegatedAccountSession as DelegatedSession } from '@calimero-network/mero-js';

const connectWithAccount = vi.fn();
function wrapper({ children }: { children: React.ReactNode }) {
  const value = { connectWithAccount, cloudBaseUrl: undefined } as unknown as React.ContextType<typeof MeroContext>;
  return <MeroContext.Provider value={value}>{children}</MeroContext.Provider>;
}

const KEYS = { signPk: 'aa'.repeat(32), signSk: 'bb'.repeat(32), kemPk: 'cc'.repeat(32), kemSk: 'dd'.repeat(32) };

beforeEach(() => {
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
    expect(localStorage.getItem('calimero.device')).toBeNull();
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
    localStorage.setItem('calimero.device', JSON.stringify(KEYS));
    readEnrolmentCallback.mockReturnValue({ state: 'x', cert: 'c' });
    const { result } = renderHook(() => useAccountEnrolment(), { wrapper });
    expect(result.current.returning).toBe(true);
    await waitFor(() => expect(result.current.note).toMatch(/could not be verified/));
    expect(completeDeviceEnrolment).not.toHaveBeenCalled();
    expect(connectWithAccount).not.toHaveBeenCalled();
  });

  it('a callback it started completes and connects', async () => {
    localStorage.setItem('calimero.device', JSON.stringify(KEYS));
    sessionStorage.setItem('calimero.enrol.state', 'sent-state');
    readEnrolmentCallback.mockReturnValue({ state: 'sent-state', cert: 'c' });
    completeDeviceEnrolment.mockResolvedValue({ account: 'ee'.repeat(32), credential: 'cred' });
    getAccountRelays.mockResolvedValue([{ relayUrl: 'https://relay.example', fresh: true }]);
    const { result } = renderHook(() => useAccountEnrolment(), { wrapper });

    await waitFor(() => expect(connectWithAccount).toHaveBeenCalledTimes(1));
    expect(completeDeviceEnrolment).toHaveBeenCalledWith(
      expect.objectContaining({ expectState: 'sent-state', devicePublicKey: KEYS.signPk, kemPublicKey: KEYS.kemPk }),
    );
    expect(connectWithAccount).toHaveBeenCalledWith({
      relayUrl: 'https://relay.example',
      account: 'ee'.repeat(32),
      credential: 'cred',
      deviceSecret: KEYS.signSk,
    });
    expect(result.current.note).toBeNull();
    expect(sessionStorage.getItem('calimero.enrol.state')).toBeNull();
  });

  it('an account with no relays connects with a note', async () => {
    localStorage.setItem('calimero.device', JSON.stringify(KEYS));
    sessionStorage.setItem('calimero.enrol.state', 's');
    readEnrolmentCallback.mockReturnValue({ state: 's' });
    completeDeviceEnrolment.mockResolvedValue({ account: 'ee'.repeat(32), credential: 'cred' });
    getAccountRelays.mockResolvedValue([]);
    const { result } = renderHook(() => useAccountEnrolment(), { wrapper });

    await waitFor(() => expect(connectWithAccount).toHaveBeenCalledWith(expect.objectContaining({ relayUrl: null })));
    expect(result.current.note).toMatch(/nowhere to write yet/);
  });

  it('goToWallet remembers a state and leaves for the wallet', async () => {
    localStorage.setItem('calimero.device', JSON.stringify(KEYS));
    readEnrolmentCallback.mockReturnValue(null);
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    try {
      const { result } = renderHook(() => useAccountEnrolment({ walletUrl: 'https://wallet.test/enrol' }), { wrapper });
      await result.current.goToWallet();
      const state = sessionStorage.getItem('calimero.enrol.state');
      expect(state).toMatch(/^[0-9a-f]{32}$/);
      expect(assign).toHaveBeenCalledTimes(1);
      expect(String(assign.mock.calls[0][0])).toContain('https://wallet.test/enrol');
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
    const RELAY = 'https://relay.example';

    /** Enrol with `rows` as the cloud's relay answer; resolve with the session connected. */
    async function enrol(rows: unknown[]): Promise<DelegatedSession> {
      localStorage.setItem('calimero.device', JSON.stringify(KEYS));
      sessionStorage.setItem('calimero.enrol.state', 's');
      readEnrolmentCallback.mockReturnValue({ state: 's' });
      completeDeviceEnrolment.mockResolvedValue({ account: ACCOUNT, credential: 'cred' });
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
        deviceSecret: KEYS.signSk,
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
        const session = await enrol([
          { peerId: 'p', relayUrl: RELAY, fresh: true, executorAccount: EXECUTOR, assigned: true },
        ]);
        // Through storage, as `connectWithAccount` persists it and a reload restores it.
        saveDelegatedSession(session);
        const restored = readDelegatedSession()!;
        expect(restored.executorAccount).toBe(EXECUTOR);
        // Nothing joined: the account's relay map is empty.
        expect(localStorage.getItem(`calimero.delegated.relays.${ACCOUNT}`)).toBeNull();

        await expect(foundDelegatedNamespace(restored)).resolves.toMatchObject({
          namespaceId: 'ab'.repeat(32),
          haEnabled: true,
        });
        expect(founded).toHaveBeenCalledWith(expect.objectContaining({ executorAccount: EXECUTOR }));
        expect(describeGovernance).not.toHaveBeenCalled();
      } finally {
        founded.mockRestore();
        describeGovernance.mockRestore();
        enableHa.mockRestore();
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
      expect(session).toEqual({ relayUrl: RELAY, account: ACCOUNT, credential: 'cred', deviceSecret: KEYS.signSk });
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
