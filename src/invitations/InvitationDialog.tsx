/**
 * The one invitation prompt: ask, join, wait for the data, done.
 *
 * Mount it once at the app root with the app's `useInviteRedemption()`. It
 * renders nothing until an invitation link has been opened, then walks the
 * person through every stage in one place:
 *
 *   awaiting-confirmation  "Join “Design team”?"           Join / Not now
 *   joining                "Joining “Design team”…"        (cannot be closed)
 *   syncing                "Syncing “Design team”…"        (cannot be closed; once
 *                                                           slow: Continue in background)
 *   ready                  "You're in “Design team”"       closes by itself
 *   already-member         "You're already in …"           Done
 *   failed                 the reason, in plain words      Try again / Close
 *
 * `syncing` is the stage the apps used to skip: a join returns before the
 * namespace's data has arrived, and an empty page then looks exactly like an
 * empty workspace. It lasts while the namespace's just-joined flag is set
 * (`markNamespaceJustJoined`, set by redemption) and ends when the page that
 * reads the data clears it (`useJoinSync` with `settled`), when the app says so
 * here (`synced`), or at the watchdog's hard ceiling. So the app root needs no
 * page state threaded up to it: the page that knows says so through the flag.
 *
 * Joining and syncing are not closed by a stray click or Escape: leaving
 * mid-sync lands on a page whose data has not arrived. While the dialog is up
 * the rest of the page is `inert`, so nothing behind it takes a click or focus.
 * A sync slow enough to trip the watchdog offers "Continue in background"; the
 * dialog then keeps the flag's ceiling running, so a page that never mounts
 * cannot leave the namespace flagged.
 *
 * Test ids are the contract the apps' two-node journeys drive: `invite-prompt`
 * (with `data-stage`), `invite-accept`, `invite-decline`, `invite-retry`,
 * `invite-continue`, `invite-error`.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { describeInviteFailure } from './describeInviteFailure';
import {
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  subscribeJustJoined,
} from './justJoined';
import type { InviteRedemption } from './useInviteRedemption';
import { JOIN_SYNC_MAX_MS, JOIN_SYNC_WATCHDOG_MS } from './useJoinSync';

/** How long "You're in" stays up before the dialog closes by itself. */
export const INVITATION_READY_MS = 1_200;

export interface InvitationDialogProps {
  /** The app's `useInviteRedemption(...)`. */
  redemption: InviteRedemption;
  /** What the app calls the thing being joined: "team", "workspace", "vault". */
  noun?: string;
  /** Shown above the title, so a person knows which app is asking. */
  appName?: string;
  /**
   * Optional: the joined namespace's data has been read, empty or not. For an
   * app whose root already knows; others leave this out and let the page that
   * reads the data clear the flag with `useJoinSync({ settled })`.
   */
  synced?: boolean;
  /**
   * Optional: the app's own words under the question, for an invitation whose
   * grant needs spelling out ("Joining gives you this vault and the rest of
   * the team it belongs to.").
   */
  detail?: string;
  /** Optional: which step a slow join is on, shown while joining. */
  status?: string | null;
}

/** The stage the dialog shows: redemption's, plus the wait for the data. */
export type InvitationDialogStage =
  | 'awaiting-confirmation'
  | 'joining'
  | 'syncing'
  | 'ready'
  | 'already-member'
  | 'failed';

function useJustJoined(namespaceId: string | null): boolean {
  return useSyncExternalStore(
    subscribeJustJoined,
    () => isNamespaceJustJoined(namespaceId),
    () => false,
  );
}

export function InvitationDialog({
  redemption,
  noun = 'team',
  appName,
  synced,
  detail,
  status,
}: InvitationDialogProps) {
  const { state, accept, decline, retry, dismiss } = redemption;
  const joinedId = state.stage === 'joined' ? state.namespaceId : null;
  // The namespace still being waited on, kept after "Continue in background"
  // takes the redemption back to idle: the wait goes on without the dialog.
  const [backgroundId, setBackgroundId] = useState<string | null>(null);
  useEffect(() => {
    if (joinedId) setBackgroundId(joinedId);
  }, [joinedId]);
  const waitingId = joinedId ?? backgroundId;
  const flagged = useJustJoined(waitingId);
  const stillSyncing = joinedId !== null && flagged;
  useEffect(() => {
    if (!joinedId && backgroundId && !flagged) setBackgroundId(null);
  }, [joinedId, backgroundId, flagged]);

  // The app's own word that the data is here ends the wait just as the page's
  // `useJoinSync` would.
  useEffect(() => {
    if (waitingId && flagged && synced) clearNamespaceJustJoined(waitingId);
  }, [waitingId, flagged, synced]);

  // A sync that never settles must not pin the dialog: past the watchdog it
  // says so, and at the hard ceiling it lets go (the flag too, so the page's
  // own banner does not outlive it).
  const [slow, setSlow] = useState(false);
  // Keyed on the namespace, not on whether the dialog shows it, so sending it
  // to the background neither restarts nor drops the ceiling.
  useEffect(() => {
    setSlow(false);
    if (!waitingId || !flagged) return;
    const slowTimer = setTimeout(() => setSlow(true), JOIN_SYNC_WATCHDOG_MS);
    const ceiling = setTimeout(
      () => clearNamespaceJustJoined(waitingId),
      JOIN_SYNC_MAX_MS,
    );
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(ceiling);
    };
  }, [waitingId, flagged]);

  const stage: InvitationDialogStage | null =
    state.stage === 'idle'
      ? null
      : state.stage === 'joined'
        ? stillSyncing
          ? 'syncing'
          : 'ready'
        : state.stage;

  // "You're in" closes by itself; everything else waits for the person.
  useEffect(() => {
    if (stage !== 'ready') return;
    const t = setTimeout(dismiss, INVITATION_READY_MS);
    return () => clearTimeout(t);
  }, [stage, dismiss]);

  const titleId = useId();
  const bodyId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Modal for real: the page behind takes no click, focus or screen-reader
  // visit while the dialog is up, including what the app mounts meanwhile.
  const open = stage !== null;
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!open || !overlay || typeof MutationObserver === 'undefined') return;
    const made = new Set<Element>();
    const shut = (el: Element) => {
      if (el === overlay || el.hasAttribute('inert')) return;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      el.setAttribute('inert', '');
      made.add(el);
    };
    Array.from(document.body.children).forEach(shut);
    const observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach((n) => n instanceof Element && shut(n));
    });
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      made.forEach((el) => el.removeAttribute('inert'));
    };
  }, [open]);

  // Focus follows the stage, so a keyboard user lands on what to do next.
  useEffect(() => {
    if (!stage) return;
    (primaryRef.current ?? dialogRef.current)?.focus();
  }, [stage]);

  /**
   * Closing means what the stage says it means. Mid-join and mid-sync it means
   * nothing: a stray click must not drop the person on a page whose data has
   * not arrived. A slow sync has its own, deliberate, button.
   */
  const close = useCallback(() => {
    if (stage === 'awaiting-confirmation') decline();
    else if (stage && stage !== 'joining' && stage !== 'syncing') dismiss();
  }, [stage, decline, dismiss]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    // Keep focus inside while the dialog is up.
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
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

  if (!stage || typeof document === 'undefined') return null;

  const teamName = 'teamName' in state ? state.teamName : undefined;
  const named = teamName ? `“${teamName}”` : `this ${noun}`;
  const busy = stage === 'joining' || stage === 'syncing';

  let icon: 'spinner' | 'invite' | 'done' | 'error' = 'invite';
  let title = '';
  let body: string | null = null;
  if (stage === 'awaiting-confirmation') {
    title = teamName ? `Join “${teamName}”?` : `Join this ${noun}?`;
    body =
      detail ??
      `You have been invited. Joining makes this device a member, and the ${noun}'s data syncs to it from the other members.`;
  } else if (stage === 'joining') {
    icon = 'spinner';
    title = `Joining ${named}…`;
    body =
      status ||
      'Asking a member to let you in. With few members online this can take up to a minute.';
  } else if (stage === 'syncing') {
    icon = 'spinner';
    title = `Syncing ${named}…`;
    body = slow
      ? `Still waiting on the other members. You can carry on; the ${noun} fills in as its data arrives.`
      : `You're in. Getting the ${noun}'s data from the other members.`;
  } else if (stage === 'ready') {
    icon = 'done';
    title = `You're in ${named}`;
  } else if (stage === 'already-member') {
    icon = 'done';
    title = `You're already in ${named}`;
  } else {
    icon = 'error';
    title = "Couldn't join";
    body =
      state.stage === 'failed'
        ? (describeInviteFailure(state.reason, noun) ?? state.message)
        : null;
  }

  const retryable = state.stage === 'failed' && state.retryable;

  return createPortal(
    <div
      ref={overlayRef}
      className="mero-invite-overlay"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Keep focus in the dialog: a press on the backdrop would otherwise
        // move it to <body>, and Tab from there walks the page behind.
        event.preventDefault();
        close();
      }}
    >
      <div
        ref={dialogRef}
        className="mero-invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        aria-busy={busy}
        tabIndex={-1}
        data-testid="invite-prompt"
        data-stage={stage}
        onKeyDown={onKeyDown}
      >
        {appName ? <p className="mero-invite-app">{appName}</p> : null}
        <div className="mero-invite-head">
          <InviteIcon kind={icon} />
          <h2 id={titleId} className="mero-invite-title">
            {title}
          </h2>
        </div>
        {body ? (
          <p
            id={bodyId}
            className={
              stage === 'failed'
                ? 'mero-invite-body mero-invite-body-error'
                : 'mero-invite-body'
            }
            role={stage === 'failed' ? 'alert' : undefined}
            data-testid={stage === 'failed' ? 'invite-error' : undefined}
          >
            {body}
          </p>
        ) : null}
        {stage === 'syncing' || stage === 'joining' ? (
          <div className="mero-invite-progress" aria-hidden="true">
            <span className="mero-invite-progress-bar" />
          </div>
        ) : null}

        <div className="mero-invite-actions">
          {stage === 'awaiting-confirmation' ? (
            <>
              <button
                type="button"
                className="mero-invite-button mero-invite-secondary"
                onClick={decline}
                data-testid="invite-decline"
              >
                Not now
              </button>
              <button
                ref={primaryRef}
                type="button"
                className="mero-invite-button mero-invite-primary"
                onClick={accept}
                data-testid="invite-accept"
              >
                Join
              </button>
            </>
          ) : null}
          {stage === 'syncing' && slow ? (
            <button
              ref={primaryRef}
              type="button"
              className="mero-invite-button mero-invite-secondary"
              onClick={dismiss}
              data-testid="invite-continue"
            >
              Continue in background
            </button>
          ) : null}
          {stage === 'ready' || stage === 'already-member' ? (
            <button
              ref={primaryRef}
              type="button"
              className="mero-invite-button mero-invite-primary"
              onClick={dismiss}
              data-testid="invite-done"
            >
              Done
            </button>
          ) : null}
          {stage === 'failed' ? (
            <>
              <button
                ref={retryable ? undefined : primaryRef}
                type="button"
                className="mero-invite-button mero-invite-secondary"
                onClick={dismiss}
                data-testid="invite-decline"
              >
                Close
              </button>
              {retryable ? (
                <button
                  ref={primaryRef}
                  type="button"
                  className="mero-invite-button mero-invite-primary"
                  onClick={retry}
                  data-testid="invite-retry"
                >
                  Try again
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InviteIcon({ kind }: { kind: 'spinner' | 'invite' | 'done' | 'error' }) {
  if (kind === 'spinner') {
    return <span className="mero-invite-icon mero-invite-spinner" aria-hidden="true" />;
  }
  const path =
    kind === 'done'
      ? 'M5 12.5l4.5 4.5L19 7.5'
      : kind === 'error'
        ? 'M12 7v6m0 4h.01'
        : 'M4 7l8 6 8-6M5 6h14a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z';
  return (
    <span className={`mero-invite-icon mero-invite-icon-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
  );
}
