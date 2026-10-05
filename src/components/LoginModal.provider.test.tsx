// @vitest-environment jsdom

/**
 * `LoginModal` with the REAL `useAccountEnrolment`, not the mock the main suite
 * uses: the modal now sources its Cloud tab itself, which means it reads
 * `useMero()`. These prove the two sides of that: inside a `MeroProvider` it
 * works with no `cloud` prop, and outside one it fails loudly rather than
 * rendering a node-only dialog that hides the missing provider.
 */

import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeroContext } from '../context';
import type { MeroContextValue } from '../types';
import { LoginModal } from './LoginModal';

function ctx(): MeroContextValue {
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
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Discovery finds nothing: every probe rejects like a closed port.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LoginModal — inside MeroProvider, real enrolment hook', () => {
  it('renders Node and Cloud tabs with no `cloud` prop', async () => {
    render(
      <MeroContext.Provider value={ctx()}>
        <LoginModal isOpen onConnect={vi.fn()} onClose={vi.fn()} />
      </MeroContext.Provider>,
    );
    await screen.findByTestId('node-url-input');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Node', 'Cloud']);
    expect(screen.getByRole('tab', { name: 'Node' }).getAttribute('aria-selected')).toBe('true');
  });

  it('"Enrol with your account" leaves for the hosted wallet', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign, hash: '', origin: 'http://localhost', pathname: '/' },
    });
    try {
      render(
        <MeroContext.Provider value={ctx()}>
          <LoginModal isOpen onConnect={vi.fn()} onClose={vi.fn()} />
        </MeroContext.Provider>,
      );
      fireEvent.click(screen.getByRole('tab', { name: 'Cloud' }));
      fireEvent.click(screen.getByRole('button', { name: 'Enrol with your account' }));
      // Key generation is async; the redirect lands once it has finished.
      await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(String(assign.mock.calls[0][0])).toContain(
        'https://wallet.cloud.calimero.network/account-enroll',
      );
      // No custom-wallet hint for the hosted wallet.
      expect(screen.queryByText(/wallet.cloud.calimero.network/)).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});

describe('LoginModal — outside MeroProvider', () => {
  it('throws the provider error instead of silently dropping the Cloud tab', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<LoginModal isOpen onConnect={vi.fn()} onClose={vi.fn()} />),
    ).toThrow(/useMero must be used within a MeroProvider/);
  });
});
