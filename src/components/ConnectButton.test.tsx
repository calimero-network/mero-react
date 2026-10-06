// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { enrolment, useAccountEnrolmentMock } = vi.hoisted(() => {
  const enrolment = {
    goToWallet: vi.fn(async () => {}),
    note: null as string | null,
    returning: false,
    walletUrl: 'https://wallet.cloud.calimero.network/account-enroll',
    customWallet: false,
  };
  return { enrolment, useAccountEnrolmentMock: vi.fn(() => enrolment) };
});
vi.mock('../delegated/useAccountEnrolment', () => ({
  useAccountEnrolment: useAccountEnrolmentMock,
}));

import { MeroContext } from '../context';
import type { MeroContextValue } from '../types';
import { saveDelegatedSession } from '@calimero-network/mero-js';
import { ConnectButton } from './ConnectButton';

function ctx(over: Partial<MeroContextValue> = {}): MeroContextValue {
  return {
    mero: null,
    isAuthenticated: false,
    isOnline: true,
    isLoading: false,
    nodeUrl: null,
    applicationId: null,
    contextId: null,
    contextIdentity: null,
    connectToNode: vi.fn(),
    connectWithAccount: vi.fn(),
    isDelegated: false,
    admin: null,
    can: { createNamespace: true, createContext: true, invite: true, upgrade: true },
    app: {},
    logout: vi.fn(),
    ...over,
  };
}

function renderButton(
  props: React.ComponentProps<typeof ConnectButton> = {},
  value: MeroContextValue = ctx(),
) {
  render(
    <MeroContext.Provider value={value}>
      <ConnectButton {...props} />
    </MeroContext.Provider>,
  );
  return value;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  enrolment.note = null;
  enrolment.returning = false;
  enrolment.customWallet = false;
  useAccountEnrolmentMock.mockClear();
  enrolment.goToWallet.mockClear();
  // Discovery finds nothing: every probe rejects like a closed port.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConnectButton — connect dialog tabs', () => {
  it('keeps its look: one Connect button, modal closed', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('by default the modal has Node and Cloud tabs, Node selected', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Node', 'Cloud']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('the Cloud tab enrols through the hook', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enrol with your account' }));
    expect(enrolment.goToWallet).toHaveBeenCalledTimes(1);
  });

  it('inside a Calimero Desktop window there is no Cloud tab unless asked for', () => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_FETCH_PROXY_INJECTED__ = true;
    try {
      renderButton();
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(useAccountEnrolmentMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
      cleanup();

      renderButton({ cloud: true });
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Node', 'Cloud']);
    } finally {
      delete w.__TAURI_FETCH_PROXY_INJECTED__;
    }
  });

  it('`cloud={false}` shows no tabs and disables the hook', () => {
    renderButton({ cloud: false });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('connect-button')).toBeTruthy();
    expect(useAccountEnrolmentMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('passes `accountDefaults.walletUrl` to the hook', () => {
    renderButton({ accountDefaults: { walletUrl: 'http://localhost:8090/account-enroll' } });
    expect(useAccountEnrolmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ walletUrl: 'http://localhost:8090/account-enroll', enabled: true }),
    );
  });

  it('opens on the Cloud tab when coming back from the wallet', () => {
    enrolment.returning = true;
    enrolment.note = 'This enrolment could not be verified as one this tab started';
    renderButton();
    const cloud = screen.getByRole('tab', { name: 'Cloud' });
    expect(cloud.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('account-note').textContent).toContain('could not be verified');
  });

  it('does not open on its own when not returning', () => {
    renderButton();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('ConnectButton — connected', () => {
  it('a node session shows the node URL, Dashboard and Log out', () => {
    renderButton({}, ctx({ isAuthenticated: true, nodeUrl: 'http://localhost:2428' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connected' }));
    expect(screen.getByText('http://localhost:2428')).toBeTruthy();
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Log out')).toBeTruthy();
  });

  it('an account session shows the short account, no Dashboard, and Log out', () => {
    const account = 'ab'.repeat(32);
    saveDelegatedSession({ account, credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: null });
    const value = renderButton({}, ctx({ isAuthenticated: true, isDelegated: true, nodeUrl: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Connected' }));
    expect(screen.getByTestId('connected-account').textContent).toBe('Account ababab…ababab');
    expect(screen.getByText('no relay yet')).toBeTruthy();
    expect(screen.queryByText('Dashboard')).toBeNull();
    fireEvent.click(screen.getByText('Log out'));
    expect(value.logout).toHaveBeenCalledTimes(1);
  });
});
