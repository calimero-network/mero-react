/**
 * The page an invite link lands on when you are not logged in.
 *
 * Before this, a logged-out person who opened an invite link saw the app's
 * ordinary logged-out page, usually its marketing landing, with nothing saying
 * they had been invited: the invitation sat captured in storage, and the
 * `InvitationDialog` only appeared once they had worked out on their own that
 * they should log in. This screen is the missing step:
 *
 *   session restoring   a blank page with a spinner (no landing-page flash)
 *   logged out          "You're invited to join “Design team”"
 *                       Not now / Log in to join (the app's usual login)
 *   unreadable link     "This invitation can't be read"   Continue
 *   logged in           nothing: `InvitationDialog` asks, joins and syncs
 *
 * It reads the captured invitation without taking it (`subscribeInvitation`,
 * `peekInvitation`), so the app's `useInviteRedemption` still receives it after
 * login. "Not now" acks it, exactly as the dialog's does.
 *
 * Two ways to mount it, both inside `MeroProvider`:
 *
 *   - beside the app's `InvitationDialog`, with no children: the screen covers
 *     whatever page is underneath (a full-page layer, opaque). One line in the
 *     component that already owns the dialog.
 *   - around the app, `<InvitationGate …>{app}</InvitationGate>`: the screen is
 *     rendered instead of the children, so the landing page does not mount.
 *
 * Test ids: `invite-landing` (with `data-state`: `checking`, `invited`,
 * `invalid`), `invite-landing-login`, `invite-landing-decline`.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { ConnectButton, type ConnectButtonProps } from '../components/ConnectButton';
import { useMero } from '../context';
import { peekInvitation, subscribeInvitation, type CapturedInvitation } from './capture';
import type { ParsedInvitation } from './useInviteRedemption';

export interface InvitationGateProps {
  /**
   * The app, shown as usual unless an invitation is waiting on a login. Leave
   * out to mount the gate beside the app instead, as a full-page layer.
   */
  children?: ReactNode;
  /**
   * The app's invitation codec, the same `parse` it gives `useInviteRedemption`.
   * Decoding needs no session, so the screen can name what is being joined.
   * Without it the screen falls back to the noun.
   */
  parse?: (token: string, params: Record<string, string>) => ParsedInvitation | null;
  /** What the app calls the thing being joined: "team", "workspace", "vault". */
  noun?: string;
  /** The app's name, so a person knows where the invitation is taking them. */
  appName?: string;
  /** Optional: the app's own words about what joining gives you. */
  detail?: string;
  /** Passed to the login button (theme, `cloud`, `connectionType`). */
  connectButtonProps?: Omit<ConnectButtonProps, 'label'>;
}

type GateState = 'checking' | 'invited' | 'invalid';

/** The captured invitation, re-rendering when one arrives or is acked. */
export function usePendingInvitation(): CapturedInvitation | null {
  return useSyncExternalStore(subscribeInvitation, peekInvitation, () => null);
}

export function InvitationGate({
  children,
  parse,
  noun = 'team',
  appName,
  detail,
  connectButtonProps,
}: InvitationGateProps) {
  const { isAuthenticated, isLoading } = useMero();
  const pending = usePendingInvitation();

  // `undefined`: not readable at all. `null`: no codec given, so no name.
  const parsed = useMemo((): ParsedInvitation | null | undefined => {
    if (!pending || !parse) return null;
    try {
      const result = parse(pending.token, pending.params);
      return result?.namespaceId ? result : undefined;
    } catch {
      return undefined;
    }
  }, [pending, parse]);

  const state: GateState | null =
    !pending || isAuthenticated
      ? null
      : isLoading
        ? 'checking'
        : parsed === undefined
          ? 'invalid'
          : 'invited';

  if (!state) return children === undefined ? null : <>{children}</>;

  const page = (
    <InvitationScreen
      state={state}
      teamName={parsed?.teamName}
      noun={noun}
      appName={appName}
      detail={detail}
      connectButtonProps={connectButtonProps}
      onDecline={() => pending?.resolve()}
    />
  );
  if (children !== undefined || typeof document === 'undefined') return page;
  return createPortal(page, document.body);
}

interface InvitationScreenProps {
  state: GateState;
  teamName?: string;
  noun: string;
  appName?: string;
  detail?: string;
  connectButtonProps?: Omit<ConnectButtonProps, 'label'>;
  onDecline: () => void;
}

function InvitationScreen({
  state,
  teamName,
  noun,
  appName,
  detail,
  connectButtonProps,
  onDecline,
}: InvitationScreenProps) {
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const loginRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  // Focus lands on what to do next: the login, or Continue past a bad link.
  useEffect(() => {
    if (state === 'checking') return;
    const target =
      state === 'invited'
        ? loginRef.current?.querySelector<HTMLElement>('button')
        : continueRef.current;
    (target ?? cardRef.current)?.focus();
  }, [state]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // No Escape: on a full page it would decline by accident. Keep Tab inside.
    if (event.key !== 'Tab' || !cardRef.current) return;
    const focusable = cardRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (state === 'checking') {
    // Deliberately wordless: a restored session goes straight to the dialog,
    // and a card that says "invited" for a blink before it would be noise.
    return (
      <div
        className="mero-invite-landing"
        role="status"
        aria-busy="true"
        aria-label="Checking your session"
        data-testid="invite-landing"
        data-state="checking"
      >
        <span className="mero-invite-icon mero-invite-spinner" aria-hidden="true" />
      </div>
    );
  }

  const invalid = state === 'invalid';
  const title = invalid
    ? "This invitation can't be read"
    : teamName
      ? `You're invited to join “${teamName}”`
      : `You're invited to join a ${noun}`;
  const where = appName ? ` in ${appName}` : '';
  const body = invalid
    ? 'The link may have been cut short when it was shared. Ask whoever sent it for a new one.'
    : `Someone sent you a link to join this ${noun}${where}. Log in to accept it; you'll be asked to confirm before you join.`;

  return (
    <div className="mero-invite-landing">
      <div
        ref={cardRef}
        className="mero-invite-dialog mero-invite-landing-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-testid="invite-landing"
        data-state={state}
        onKeyDown={onKeyDown}
      >
        {appName ? <p className="mero-invite-app">{appName}</p> : null}
        <div className="mero-invite-head">
          <InviteIcon error={invalid} />
          <h1 id={titleId} className="mero-invite-title">
            {title}
          </h1>
        </div>
        <p id={bodyId} className="mero-invite-body">
          {body}
        </p>
        {detail && !invalid ? <p className="mero-invite-body">{detail}</p> : null}

        <div className="mero-invite-actions">
          {invalid ? (
            <button
              ref={continueRef}
              type="button"
              className="mero-invite-button mero-invite-primary"
              onClick={onDecline}
              data-testid="invite-landing-decline"
            >
              Continue
            </button>
          ) : (
            <>
              <button
                type="button"
                className="mero-invite-button mero-invite-secondary"
                onClick={onDecline}
                data-testid="invite-landing-decline"
              >
                Not now
              </button>
              <div
                ref={loginRef}
                className="mero-invite-landing-login"
                data-testid="invite-landing-login"
              >
                <ConnectButton {...connectButtonProps} label="Log in to join" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InviteIcon({ error }: { error: boolean }) {
  const path = error
    ? 'M12 7v6m0 4h.01'
    : 'M4 7l8 6 8-6M5 6h14a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z';
  return (
    <span
      className={error ? 'mero-invite-icon mero-invite-icon-error' : 'mero-invite-icon'}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
  );
}
