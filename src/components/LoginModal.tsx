/**
 * LoginModal: sign in, or create an account, with a passkey.
 *
 * On a page the node serves (`servedByNode`) the node is the page's origin, so
 * the dialog asks nothing but the passkey. Elsewhere it asks for the node's URL
 * first. Creating an account asks for a name (what the passkey is saved
 * under).
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useMero } from '../context';
import { resolveMeroTheme, themeToCssVars, type MeroTheme } from '../theme';
import { CalimeroLogo } from './CalimeroLogo';

export type LoginModalTab = 'sign-in' | 'sign-up';

export interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called once a session is open. */
  onSignedIn?: () => void;
  /** Which form to open on. Default `sign-in`. */
  initialTab?: LoginModalTab;
  /** Offer account creation. Default true. */
  allowSignUp?: boolean;
  /** The app's name, shown above the title. */
  appName?: string;
  theme?: MeroTheme;
}

export function LoginModal({
  isOpen,
  onClose,
  onSignedIn,
  initialTab = 'sign-in',
  allowSignUp = true,
  appName,
  theme,
}: LoginModalProps) {
  const { servedByNode, nodeUrl, client, connectToNode, signIn, signUp, isLoading, failure } = useMero();
  const [tab, setTab] = useState<LoginModalTab>(initialTab);
  const [url, setUrl] = useState(nodeUrl ?? '');
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  // A sign-in waiting for the client of a node just chosen.
  const [queued, setQueued] = useState<LoginModalTab | null>(null);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setLocalError(null);
      setUrl(nodeUrl ?? '');
      dialogRef.current?.focus();
    }
    // Reset only when it opens.
  }, [isOpen]);

  const run = async (which: LoginModalTab) => {
    const session = which === 'sign-up' ? await signUp(name.trim()) : await signIn();
    if (session) {
      onSignedIn?.();
      onClose();
    }
  };

  useEffect(() => {
    if (!queued || !client || client.nodeUrl.replace(/\/+$/, '') !== url.trim().replace(/\/+$/, '')) return;
    const which = queued;
    setQueued(null);
    void run(which);
  }, [queued, client]);

  if (!isOpen) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (tab === 'sign-up' && !name.trim()) {
      setLocalError('Enter a name for your account.');
      return;
    }
    if (!servedByNode) {
      const target = url.trim();
      try {
        const parsed = new URL(target);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
      } catch {
        setLocalError('Enter the node URL, for example https://node.example.com');
        return;
      }
      if (!client || target.replace(/\/+$/, '') !== nodeUrl) {
        connectToNode(target);
        setQueued(tab);
        return;
      }
    }
    void run(tab);
  };

  const vars = theme ? themeToCssVars(resolveMeroTheme(theme)) : undefined;
  const message = localError ?? failure?.message ?? null;
  const busy = isLoading || queued !== null;

  return (
    <div
      className="mero-dialog-overlay"
      style={vars}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="mero-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
        }}
      >
        {appName && <p className="mero-dialog-app">{appName}</p>}
        <div className="mero-dialog-head">
          <span className="mero-dialog-icon" aria-hidden="true">
            <CalimeroLogo size={20} />
          </span>
          <h2 id={titleId} className="mero-dialog-title">
            {tab === 'sign-up' ? 'Create your account' : 'Sign in'}
          </h2>
        </div>
        <p className="mero-dialog-body">
          {tab === 'sign-up'
            ? 'Your device saves a passkey for this account. There is no password.'
            : 'Use the passkey saved on this device.'}
        </p>
        <form onSubmit={submit} noValidate>
          {!servedByNode && (
            <label className="mero-dialog-field">
              Node URL
              <input
                className="mero-dialog-input"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://node.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy}
              />
            </label>
          )}
          {tab === 'sign-up' && (
            <label className="mero-dialog-field">
              Name
              <input
                className="mero-dialog-input"
                type="text"
                autoComplete="username webauthn"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
          )}
          {message && (
            <p className="mero-dialog-body mero-dialog-body-error" role="alert">
              {message}
            </p>
          )}
          {busy && (
            <div className="mero-dialog-progress" aria-hidden="true">
              <div className="mero-dialog-progress-bar" />
            </div>
          )}
          <div className="mero-dialog-actions">
            <button type="button" className="mero-dialog-button mero-dialog-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="mero-dialog-button mero-dialog-primary" disabled={busy}>
              {tab === 'sign-up' ? 'Create account' : 'Sign in with passkey'}
            </button>
          </div>
        </form>
        {allowSignUp && (
          <button
            type="button"
            className="mero-dialog-link"
            onClick={() => {
              setLocalError(null);
              setTab(tab === 'sign-up' ? 'sign-in' : 'sign-up');
            }}
            disabled={busy}
          >
            {tab === 'sign-up' ? 'I already have a passkey' : 'New here? Create an account'}
          </button>
        )}
      </div>
    </div>
  );
}

export default LoginModal;
