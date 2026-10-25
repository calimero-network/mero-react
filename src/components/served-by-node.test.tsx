// @vitest-environment jsdom

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeroContext } from '../context';
import type { MeroContextValue } from '../types';
import { LoginModal } from './LoginModal';
import { ConnectButtonAccount } from './ConnectButtonAccount';
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

function withCtx(node: React.ReactNode, value: MeroContextValue) {
  return <MeroContext.Provider value={value}>{node}</MeroContext.Provider>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const probed = () => fetchMock.mock.calls.map(([u]) => String(u));

describe('servedByNode: every connect path stays on the node origin', () => {
  it('an opened LoginModal connects to the own origin and shows no picker or scan', () => {
    const value = ctx({ servedByNode: true });
    const onConnect = vi.fn();
    render(withCtx(<LoginModal isOpen onConnect={onConnect} onClose={() => {}} />, value));
    expect(onConnect).toHaveBeenCalledWith(window.location.origin);
    expect(document.querySelector('.mero-login-dialog')).toBeNull();
    expect(probed()).toEqual([]);
  });

  it('ConnectButtonAccount "I run a node" goes straight to the own origin', () => {
    const value = ctx({ servedByNode: true });
    render(withCtx(<ConnectButtonAccount />, value));
    fireEvent.click(screen.getByRole('button', { name: /I run a node/ }));
    expect(value.connectToNode).toHaveBeenCalledWith(window.location.origin);
    expect(document.querySelector('.mero-login-dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'I have an account' })).toBeNull();
    expect(probed()).toEqual([]);
  });

  it('ConnectButton makes no cross-origin request on mount or connect', () => {
    const value = ctx({ servedByNode: true });
    render(withCtx(<ConnectButton />, value));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(value.connectToNode).toHaveBeenCalledWith(window.location.origin);
    expect(probed()).toEqual([]);
  });
});

describe('outside servedByNode', () => {
  it('LoginModal still scans local nodes and shows the picker', async () => {
    const value = ctx();
    const onConnect = vi.fn();
    render(withCtx(<LoginModal isOpen onConnect={onConnect} onClose={() => {}} />, value));
    expect(await screen.findByTestId('connect-button')).toBeTruthy();
    expect(onConnect).not.toHaveBeenCalled();
    expect(probed().some((u) => u.includes('localhost:2428'))).toBe(true);
  });

  it('ConnectButtonAccount "I run a node" still opens the picker', async () => {
    const value = ctx();
    render(withCtx(<ConnectButtonAccount />, value));
    fireEvent.click(screen.getByRole('button', { name: /I run a node/ }));
    expect(await screen.findByTestId('connect-button')).toBeTruthy();
    expect(value.connectToNode).not.toHaveBeenCalled();
  });
});
