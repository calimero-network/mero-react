// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../delegated/useAccountEnrolment', () => ({
  useAccountEnrolment: () => ({
    goToWallet: vi.fn(async () => {}),
    note: null,
    returning: false,
    walletUrl: 'https://wallet.example/account-enroll',
    customWallet: false,
  }),
}));

import { MeroContext } from '../context';
import type { MeroContextValue } from '../types';
import {
  onInvitation,
  peekInvitation,
  primeInvitationCapture,
  resetInvitationCaptureForTests,
} from './capture';
import { InvitationGate } from './InvitationGate';

function session(over: Partial<MeroContextValue> = {}): MeroContextValue {
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

/** A cold open of the app from an invite link, as `main.tsx` primes it. */
function openInviteLink(token = 'TOKEN'): void {
  window.history.replaceState(null, '', `/?invitation=${token}`);
  primeInvitationCapture('test-app');
}

const parse = (token: string) =>
  token === 'BAD' ? null : { namespaceId: 'ns-1', invitation: {}, teamName: 'Design team' };

function Gate({ value, wrap = true }: { value: MeroContextValue; wrap?: boolean }) {
  return (
    <MeroContext.Provider value={value}>
      {wrap ? (
        <InvitationGate parse={parse} appName="Mero Design" noun="team">
          <main data-testid="marketing">Landing</main>
        </InvitationGate>
      ) : (
        <>
          <InvitationGate parse={parse} appName="Mero Design" noun="team" />
          <main data-testid="marketing">Landing</main>
        </>
      )}
    </MeroContext.Provider>
  );
}

beforeEach(() => {
  resetInvitationCaptureForTests();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  resetInvitationCaptureForTests();
  localStorage.clear();
});

describe('InvitationGate', () => {
  it('shows the app as usual when no invitation is pending', () => {
    primeInvitationCapture('test-app');
    render(<Gate value={session()} />);
    expect(screen.getByTestId('marketing')).toBeTruthy();
    expect(screen.queryByTestId('invite-landing')).toBeNull();
  });

  it('logged out with a pending invitation: says so, names it, and offers login instead of the landing page', () => {
    openInviteLink();
    render(<Gate value={session()} />);

    const page = screen.getByTestId('invite-landing');
    expect(page.getAttribute('data-state')).toBe('invited');
    expect(screen.getByRole('dialog', { name: "You're invited to join “Design team”" })).toBe(page);
    expect(screen.getByText('Mero Design')).toBeTruthy();
    expect(screen.queryByTestId('marketing')).toBeNull();

    // The login is the app's usual one: ConnectButton and its connect dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Log in to join' }));
    expect(screen.getByText('Connect to Calimero')).toBeTruthy();
  });

  it('as a sibling of the app, covers it rather than replacing it', () => {
    openInviteLink();
    render(<Gate value={session()} wrap={false} />);
    expect(screen.getByTestId('invite-landing').getAttribute('data-state')).toBe('invited');
    expect(screen.getByTestId('marketing')).toBeTruthy();
  });

  it('falls back to the noun when the invitation carries no name', () => {
    openInviteLink();
    render(
      <MeroContext.Provider value={session()}>
        <InvitationGate noun="vault">app</InvitationGate>
      </MeroContext.Provider>,
    );
    expect(screen.getByRole('dialog', { name: "You're invited to join a vault" })).toBeTruthy();
  });

  it('logged in: gets out of the way, leaving the invitation for the dialog', () => {
    openInviteLink();
    render(<Gate value={session({ isAuthenticated: true })} />);
    expect(screen.getByTestId('marketing')).toBeTruthy();
    expect(screen.queryByTestId('invite-landing')).toBeNull();

    // Still there for useInviteRedemption to pick up.
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.token));
    expect(seen).toEqual(['TOKEN']);
  });

  it('while the session is still restoring, shows neither the landing page nor the invite screen', () => {
    openInviteLink();
    const { rerender } = render(<Gate value={session({ isLoading: true })} />);
    const page = screen.getByTestId('invite-landing');
    expect(page.getAttribute('data-state')).toBe('checking');
    expect(page.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByTestId('marketing')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log in to join' })).toBeNull();

    // Restored a session: straight to the app (and the dialog), no invite screen.
    rerender(<Gate value={session({ isAuthenticated: true })} />);
    expect(screen.queryByTestId('invite-landing')).toBeNull();
    expect(screen.getByTestId('marketing')).toBeTruthy();
  });

  it('Not now clears the invitation and shows the app', () => {
    openInviteLink();
    render(<Gate value={session()} />);
    fireEvent.click(screen.getByTestId('invite-landing-decline'));

    expect(screen.queryByTestId('invite-landing')).toBeNull();
    expect(screen.getByTestId('marketing')).toBeTruthy();
    expect(peekInvitation()).toBeNull();

    // Declined means gone: logging in afterwards does not raise it again.
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.token));
    expect(seen).toEqual([]);
  });

  it('logging in hands over to the app and the dialog', () => {
    openInviteLink();
    const { rerender } = render(<Gate value={session()} />);
    expect(screen.getByTestId('invite-landing')).toBeTruthy();

    rerender(<Gate value={session({ isAuthenticated: true })} />);
    expect(screen.queryByTestId('invite-landing')).toBeNull();
    expect(screen.getByTestId('marketing')).toBeTruthy();
    expect(peekInvitation()?.token).toBe('TOKEN');
  });

  it('appears when a link arrives while the app is already open', () => {
    primeInvitationCapture('test-app');
    render(<Gate value={session()} />);
    expect(screen.queryByTestId('invite-landing')).toBeNull();

    act(() => {
      window.history.replaceState(null, '', '/?invitation=WARM');
      // A fresh controller reads the URL, as a reload would.
      resetInvitationCaptureForTests();
      primeInvitationCapture('test-app');
    });
    expect(screen.getByTestId('invite-landing')).toBeTruthy();
  });

  it('says plainly when the link cannot be read, without asking for a login', () => {
    openInviteLink('BAD');
    render(<Gate value={session()} />);
    const page = screen.getByTestId('invite-landing');
    expect(page.getAttribute('data-state')).toBe('invalid');
    expect(screen.queryByRole('button', { name: 'Log in to join' })).toBeNull();

    fireEvent.click(screen.getByTestId('invite-landing-decline'));
    expect(screen.getByTestId('marketing')).toBeTruthy();
    expect(peekInvitation()).toBeNull();
  });

  it('outside a MeroProvider, stays out of the way instead of throwing', () => {
    openInviteLink();
    render(
      <InvitationGate parse={parse}>
        <main data-testid="marketing">Landing</main>
      </InvitationGate>,
    );
    expect(screen.getByTestId('marketing')).toBeTruthy();
    expect(screen.queryByTestId('invite-landing')).toBeNull();
  });

  it('puts focus on the login, and keeps Tab inside the screen', () => {
    openInviteLink();
    render(<Gate value={session()} />);
    const login = screen.getByRole('button', { name: 'Log in to join' });
    expect(document.activeElement).toBe(login);

    const decline = screen.getByTestId('invite-landing-decline');
    fireEvent.keyDown(screen.getByTestId('invite-landing'), { key: 'Tab' });
    expect(document.activeElement).toBe(decline);
    fireEvent.keyDown(screen.getByTestId('invite-landing'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(login);
  });
});
