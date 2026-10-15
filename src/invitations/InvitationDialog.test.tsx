// @vitest-environment jsdom

import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InvitationDialog, INVITATION_READY_MS } from './InvitationDialog';
import {
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from './justJoined';
import type { InviteRedemption, InviteState } from './useInviteRedemption';
import { JOIN_SYNC_MAX_MS, JOIN_SYNC_WATCHDOG_MS, useJoinSync } from './useJoinSync';

afterEach(() => cleanup());

const NS = 'ns-design';

function redemption(state: InviteState): InviteRedemption {
  return {
    state,
    token: 'tok',
    parsed: null,
    accept: vi.fn(),
    decline: vi.fn(),
    retry: vi.fn(),
    dismiss: vi.fn(),
  };
}

const stage = () => screen.getByTestId('invite-prompt').getAttribute('data-stage');

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InvitationDialog', () => {
  it('renders nothing while there is no invitation', () => {
    render(<InvitationDialog redemption={redemption({ stage: 'idle' })} />);
    expect(screen.queryByTestId('invite-prompt')).toBeNull();
  });

  it('asks first, naming the app and what is being joined', () => {
    const r = redemption({ stage: 'awaiting-confirmation', teamName: 'Design team' });
    render(<InvitationDialog redemption={r} appName="Mero Docs" noun="workspace" />);

    const dialog = screen.getByRole('dialog', { name: 'Join “Design team”?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(stage()).toBe('awaiting-confirmation');
    expect(screen.getByText('Mero Docs')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('invite-accept'));

    fireEvent.click(screen.getByTestId('invite-accept'));
    expect(r.accept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('invite-decline'));
    expect(r.decline).toHaveBeenCalledTimes(1);
  });

  it('declines on Escape and on the backdrop while asking', () => {
    const r = redemption({ stage: 'awaiting-confirmation' });
    render(<InvitationDialog redemption={r} />);
    fireEvent.keyDown(screen.getByTestId('invite-prompt'), { key: 'Escape' });
    expect(r.decline).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId('invite-prompt').parentElement!);
    expect(r.decline).toHaveBeenCalledTimes(2);
  });

  it("shows the app's own words while asking, and a slow join's step", () => {
    const { rerender } = render(
      <InvitationDialog
        redemption={redemption({ stage: 'awaiting-confirmation' })}
        detail="Joining gives you this vault and the rest of the team."
      />,
    );
    expect(screen.getByText('Joining gives you this vault and the rest of the team.')).toBeTruthy();
    rerender(
      <InvitationDialog
        redemption={redemption({ stage: 'joining' })}
        status="Opening the vault…"
      />,
    );
    expect(screen.getByText('Opening the vault…')).toBeTruthy();
  });

  it('cannot be closed mid-join', () => {
    const r = redemption({ stage: 'joining', teamName: 'Design team' });
    render(<InvitationDialog redemption={r} />);
    expect(stage()).toBe('joining');
    expect(screen.getByText('Joining “Design team”…')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('invite-prompt'), { key: 'Escape' });
    fireEvent.mouseDown(screen.getByTestId('invite-prompt').parentElement!);
    expect(r.decline).not.toHaveBeenCalled();
    expect(r.dismiss).not.toHaveBeenCalled();
  });

  it('holds on syncing until the page clears the just-joined flag, then says so and closes', () => {
    vi.useFakeTimers();
    markNamespaceJustJoined(NS);
    const r = redemption({ stage: 'joined', namespaceId: NS, teamName: 'Design team' });
    render(<InvitationDialog redemption={r} />);

    expect(stage()).toBe('syncing');
    expect(screen.getByText('Syncing “Design team”…')).toBeTruthy();

    // The page that reads the namespace's data (`useJoinSync` with `settled`)
    // clears the flag; the dialog hears it without any prop changing.
    act(() => clearNamespaceJustJoined(NS));
    expect(stage()).toBe('ready');
    expect(screen.getByText("You're in “Design team”")).toBeTruthy();

    expect(r.dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(INVITATION_READY_MS));
    expect(r.dismiss).toHaveBeenCalledTimes(1);
  });

  it("ends the wait when the page reading the namespace's data settles", () => {
    markNamespaceJustJoined(NS);
    function Page({ settled }: { settled: boolean }) {
      useJoinSync({ namespaceId: NS, settled });
      return null;
    }
    const r = redemption({ stage: 'joined', namespaceId: NS });
    const { rerender } = render(
      <>
        <InvitationDialog redemption={r} />
        <Page settled={false} />
      </>,
    );
    expect(stage()).toBe('syncing');
    rerender(
      <>
        <InvitationDialog redemption={r} />
        <Page settled />
      </>,
    );
    expect(stage()).toBe('ready');
  });

  it('lets the app root end the wait with `synced`', () => {
    markNamespaceJustJoined(NS);
    const r = redemption({ stage: 'joined', namespaceId: NS });
    const { rerender } = render(<InvitationDialog redemption={r} synced={false} />);
    expect(stage()).toBe('syncing');
    rerender(<InvitationDialog redemption={r} synced />);
    expect(stage()).toBe('ready');
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  it('can be sent to the background while syncing, leaving the flag for the page', () => {
    markNamespaceJustJoined(NS);
    const r = redemption({ stage: 'joined', namespaceId: NS });
    render(<InvitationDialog redemption={r} />);
    fireEvent.click(screen.getByTestId('invite-continue'));
    expect(r.dismiss).toHaveBeenCalledTimes(1);
    expect(isNamespaceJustJoined(NS)).toBe(true);
  });

  it('says it is still waiting past the watchdog, and lets go at the ceiling', () => {
    vi.useFakeTimers();
    markNamespaceJustJoined(NS);
    render(<InvitationDialog redemption={redemption({ stage: 'joined', namespaceId: NS })} />);

    act(() => vi.advanceTimersByTime(JOIN_SYNC_WATCHDOG_MS));
    expect(screen.getByText(/Still waiting on the other members/)).toBeTruthy();
    expect(stage()).toBe('syncing');

    act(() => vi.advanceTimersByTime(JOIN_SYNC_MAX_MS - JOIN_SYNC_WATCHDOG_MS));
    expect(stage()).toBe('ready');
    expect(isNamespaceJustJoined(NS)).toBe(false);
  });

  it('tells an existing member so, with nothing to wait for', () => {
    const r = redemption({ stage: 'already-member', namespaceId: NS, teamName: 'Design team' });
    render(<InvitationDialog redemption={r} />);
    expect(stage()).toBe('already-member');
    fireEvent.click(screen.getByTestId('invite-done'));
    expect(r.dismiss).toHaveBeenCalledTimes(1);
  });

  it('explains a failure in plain words, offering a retry only when one can help', () => {
    const r = redemption({
      stage: 'failed',
      message: 'HTTP 503',
      reason: 'no-one-online',
      retryable: true,
    });
    const { rerender } = render(<InvitationDialog redemption={r} noun="vault" />);
    expect(stage()).toBe('failed');
    expect(screen.getByTestId('invite-error').textContent).toBe(
      'No one in this vault is online to let you in yet. It will try again the next time you open the app.',
    );
    fireEvent.click(screen.getByTestId('invite-retry'));
    expect(r.retry).toHaveBeenCalledTimes(1);

    const spent = redemption({
      stage: 'failed',
      message: 'gone',
      reason: 'expired',
      retryable: false,
    });
    rerender(<InvitationDialog redemption={spent} />);
    expect(screen.queryByTestId('invite-retry')).toBeNull();
    expect(screen.getByTestId('invite-error').textContent).toBe(
      'This invitation has expired. Ask for a new link.',
    );
  });

  it("shows the node's own message when the reason is unknown", () => {
    render(
      <InvitationDialog
        redemption={redemption({
          stage: 'failed',
          message: 'something odd',
          reason: 'unknown',
          retryable: false,
        })}
      />,
    );
    expect(screen.getByTestId('invite-error').textContent).toBe('something odd');
  });
});
