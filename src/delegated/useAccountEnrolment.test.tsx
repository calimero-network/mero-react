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

import { MeroContext } from '../context';
import { useAccountEnrolment } from './useAccountEnrolment';

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
});
