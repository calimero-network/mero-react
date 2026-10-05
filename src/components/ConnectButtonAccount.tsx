/**
 * ConnectButtonAccount — ConnectButton, plus a second way in.
 *
 * A copy of {@link ConnectButton} rather than a change to it, deliberately:
 * the node-login path is load-bearing for every shipped app, and this is an
 * experiment. `ConnectButton` and `LoginModal` are untouched.
 *
 * Two ways to connect, and the difference is who runs the node:
 *
 * - **I run a node** — exactly today's behaviour. `LoginModal` discovers nodes
 *   or takes a URL, and `connectToNode` redirects into the node's auth flow.
 * - **I have an account** — no node. A wallet on another origin certifies this
 *   tab's device key, and a relay writes on the account's behalf under warrants
 *   signed here.
 *
 * ## One credential, two signatures over it
 *
 * The certificate the wallet mints is the whole of what this holds. The device
 * key it certifies signs two different things, and neither needs anything more:
 *
 * - a **warrant**, per intent, is what `rpc.execute` sends — an app's own logic,
 *   including a generated ABI client, runs on this alone;
 * - a **request proof** (`X-Calimero-Proof`), per request, authenticates the
 *   caller-scoped reads and the event stream. The node verifies the signature
 *   against the certificate with no store read and no prior relationship, so
 *   `getContexts` and `listNamespaces` answer this account's own and `/sse`
 *   delivers this account's contexts.
 *
 * ## The pane asks for nothing
 *
 * It used to have three fields, and not one of them was a question an end user
 * could answer. All three are gone:
 *
 * - the **relay** is discovered. The same certificate proves the cloud's
 *   account→relay lookup (`CloudClient.getAccountRelays`): the device signs an
 *   account-bound nonce and the cloud names the relays. No cloud session, no
 *   Google sign-in, no account root.
 * - the **wallet** is a platform constant, defaulted here, overridable only for
 *   working on the wallet itself.
 * - the **context** is chosen after connecting, not before. `MeroContext` learns
 *   this tab's `applicationId` from the registry by the app's `packageName`
 *   (the account's contexts, caller-scoped by the request proof, name it only
 *   when the app passes none), so an app's own context picker has what it needs
 *   and the person picks from a list instead of pasting a 64-hex id.
 *
 * So the account path is one button.
 *
 * This pane used to ask for the relay node's signing key as well, to mint an
 * `account_proof` session with `login()`. Nothing needs it: the proof path was
 * measured serving the same reads and the same events without it, against a node
 * built from core `aecba573b`. A session remains the right shape where the device
 * key sits behind a boundary worth crossing once — a hardware key — which is not
 * this.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMero } from '../context';
import { useAccountEnrolment } from '../delegated/useAccountEnrolment';
import { LoginModal } from './LoginModal';
import { CalimeroLogo } from './CalimeroLogo';
import { resolveMeroTheme, themeToCssVars, type MeroTheme } from '../theme';

export interface ConnectButtonAccountProps {
  className?: string;
  style?: React.CSSProperties;
  theme?: MeroTheme;
  /**
   * Overrides for local development. An app in production passes none of this,
   * and the pane asks the person for nothing at all.
   *
   * Nothing here is a value an end user could know, which is precisely why none
   * of it is a form field any more:
   *
   * - the **relay** is discovered — the certificate the enrolment returns proves
   *   the cloud's account→relay lookup, so there is nothing to type and a prefill
   *   would only be a staler second source of truth;
   * - the **context** is chosen after connecting, from the account's own contexts,
   *   which `admin.getContexts()` answers caller-scoped through the request proof.
   */
  defaults?: {
    /**
     * Point enrolment at a wallet other than the hosted one.
     *
     * Exists for working ON the wallet: a wallet served from `localhost:8090`
     * cannot be reached through the hosted URL, and without this the only way to
     * test a wallet change would be to deploy it.
     */
    walletUrl?: string;
  };
}

export function ConnectButtonAccount({
  className,
  style,
  theme,
  defaults = {},
}: ConnectButtonAccountProps) {
  const { isAuthenticated, isOnline, nodeUrl, isDelegated, connectToNode, logout } = useMero();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isNodeModalOpen, setIsNodeModalOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const resolvedTheme = useMemo(() => (theme ? resolveMeroTheme(theme) : null), [theme]);
  const themeVars = useMemo(
    () => (resolvedTheme ? themeToCssVars(resolvedTheme) : undefined),
    [resolvedTheme],
  );

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const { goToWallet, note, walletUrl } = useAccountEnrolment({ walletUrl: defaults.walletUrl });

  if (isAuthenticated && !isOnline) {
    return (
      <div className="mero-connect-container" style={{ ...themeVars, display: 'inline-block' }}>
        <button
          className={['mero-connect-button', 'mero-reconnecting', className].filter(Boolean).join(' ')}
          style={style}
          disabled
          aria-label="Reconnecting..."
        >
          <CalimeroLogo size={18} className="mero-logo" />
          Reconnecting...
        </button>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div
        ref={dropdownRef}
        className="mero-connect-container"
        style={{ ...themeVars, position: 'relative', display: 'inline-block' }}
      >
        <button
          className={['mero-connect-button', 'mero-connected', className].filter(Boolean).join(' ')}
          style={style}
          onClick={() => setIsDropdownOpen((p) => !p)}
          aria-label="Connected"
        >
          <CalimeroLogo size={18} className="mero-logo" />
          {isDelegated ? 'Connected (account)' : 'Connected'}
        </button>
        {isDropdownOpen && (
          <div className="mero-dropdown">
            <div className="mero-dropdown-info" title={nodeUrl || ''}>
              {/* A delegated account with no relay is signed in and has no node
                  to name. Saying so beats an empty row that reads as a bug. */}
              {nodeUrl ?? (isDelegated ? 'no relay yet' : null)}
            </div>
            {/* No dashboard link on the delegated path: the admin dashboard is
                a node-operator surface, and a keyholder has no credential for
                it. Offering a link that 401s would be worse than omitting it. */}
            {!isDelegated && nodeUrl && (
              <a
                href={new URL('admin-dashboard/', nodeUrl).toString()}
                target="_blank"
                rel="noopener noreferrer"
                className="mero-dropdown-item"
              >
                Dashboard
              </a>
            )}
            <button
              className="mero-dropdown-item"
              onClick={() => {
                setIsDropdownOpen(false);
                logout();
              }}
            >
              Log out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mero-connect-container" style={{ ...themeVars, display: 'inline-block' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className={['mero-connect-button', className].filter(Boolean).join(' ')}
          style={style}
          onClick={() => setIsNodeModalOpen(true)}
        >
          <CalimeroLogo size={18} className="mero-logo" />
          I run a node
        </button>
        <button
          className={['mero-connect-button', className].filter(Boolean).join(' ')}
          style={style}
          onClick={() => setIsAccountOpen((p) => !p)}
        >
          I have an account
        </button>
      </div>

      {isAccountOpen && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            border: '1px solid rgba(127,127,127,.35)',
            borderRadius: 8,
            display: 'grid',
            gap: 8,
            maxWidth: 520,
            textAlign: 'left',
            font: '13px system-ui, sans-serif',
          }}
        >
          {/* No form fields. Every one this pane used to have asked for
              something only an operator could know, and all three are now
              answered by the certificate: the wallet is the platform's, the relay
              is looked up, and the context is chosen afterwards from the
              account's own. What is left is a button and an explanation of what
              pressing it does. */}
          <button className="mero-connect-button" onClick={goToWallet}>
            Enrol with your account
          </button>
          <p style={{ margin: 0, opacity: 0.75 }}>
            You will approve a device key on the wallet&apos;s own page, then come
            back here. The relay never sees your account root — only the
            certificate it signed.
          </p>
          <p style={{ margin: 0, opacity: 0.75 }}>
            That one certificate is all of it: finding the relay that serves your
            account, writing through it, reading your own contexts and namespaces,
            and live events. Nothing to paste in.
          </p>
          {defaults.walletUrl && (
            /* Shown only when an app overrode it, so a local rig can see at a
               glance that it is not enrolling against the hosted wallet. */
            <p style={{ margin: 0, opacity: 0.6 }}>
              Enrolling at <code>{walletUrl}</code>, not the hosted wallet.
            </p>
          )}
        </div>
      )}

      {note && (
        <p style={{ font: '13px system-ui, sans-serif', color: '#b3261e' }}>{note}</p>
      )}

      <LoginModal
        isOpen={isNodeModalOpen}
        onConnect={(url) => {
          setIsNodeModalOpen(false);
          connectToNode(url);
        }}
        onClose={() => setIsNodeModalOpen(false)}
        theme={resolvedTheme ?? theme}
        // This component runs the account path itself (the hook above); the node
        // dialog stays node-only so the single-use callback has one reader.
        cloud={false}
      />
    </div>
  );
}

export default ConnectButtonAccount;
