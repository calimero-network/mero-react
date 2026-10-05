/**
 * ConnectButton - A button component for connecting to Calimero
 *
 * Shows connection status and provides login/logout functionality.
 * Includes built-in LoginModal with two tabs: **Node** (node discovery + URL,
 * the default) and **Cloud** (sign in with a Calimero account by enrolling at
 * the wallet — see `useAccountEnrolment`). `cloud={false}` removes the Cloud
 * tab and leaves the node dialog exactly as it was.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMero } from '../context';
import { LoginModal } from './LoginModal';
import { useAccountEnrolment } from '../delegated/useAccountEnrolment';
import { readDelegatedSession } from '@calimero-network/mero-js';
import { CalimeroLogo } from './CalimeroLogo';
import type { ConnectionType, CustomConnectionConfig } from '../types';
import { ConnectionType as ConnectionTypeEnum } from '../types';
import { resolveMeroTheme, themeToCssVars, type MeroTheme } from '../theme';

export interface ConnectButtonProps {
  /**
   * Connection behaviour. `Custom` (object form) connects straight to the
   * given URL, skipping the modal; every other value opens the LoginModal,
   * which always shows node discovery + manual URL entry.
   */
  connectionType?: ConnectionType | CustomConnectionConfig;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Theme overrides — accepts any subset of `MeroTheme` tokens */
  theme?: MeroTheme;
  /**
   * Render only the Calimero logo, no text. Produces a square 40×40 icon
   * button. The label is still announced to screen readers via `aria-label`.
   * Default: false.
   */
  logoOnly?: boolean;
  /**
   * Override the default labels per state. A bare string is shorthand for
   * `{ connect: '<string>' }`. The connected and reconnecting states keep
   * their defaults unless explicitly overridden.
   */
  label?:
    | string
    | { connect?: string; connected?: string; reconnecting?: string };
  /**
   * Offer the **Cloud** tab — sign in with a Calimero account — next to the
   * node dialog. Default true. With false the modal has no tabs, and this
   * button reads no enrolment callback, leaving it to whichever component does.
   */
  cloud?: boolean;
  /**
   * Overrides for the account path, for local development only.
   */
  accountDefaults?: {
    /**
     * Point enrolment at a wallet other than the hosted one — for working ON
     * the wallet, e.g. one served from `localhost:8090`.
     */
    walletUrl?: string;
  };
}

/** `abcdef…123456` — enough of a 64-hex account id to recognise it. */
function shortAccount(account: string): string {
  return account.length > 14 ? `${account.slice(0, 6)}…${account.slice(-6)}` : account;
}

/**
 * ConnectButton - Displays connection status and handles login/logout
 */
export function ConnectButton({
  connectionType = ConnectionTypeEnum.Remote,
  className,
  style,
  theme,
  logoOnly = false,
  label,
  cloud = true,
  accountDefaults,
}: ConnectButtonProps) {
  const { isAuthenticated, connectToNode, logout, nodeUrl, isOnline, isDelegated } = useMero();
  const enrolment = useAccountEnrolment({
    walletUrl: accountDefaults?.walletUrl,
    enabled: cloud,
  });
  // A tab coming back from the wallet opens straight onto the Cloud tab, so
  // whatever the completion has to say is where the person is looking. Once
  // `connectWithAccount` lands, the connected state below replaces it.
  const [isModalOpen, setIsModalOpen] = useState(() => cloud && enrolment.returning);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // The account an account session belongs to, for the dropdown. Read from the
  // stored session (the context exposes `isDelegated`, not the account).
  const account = useMemo(
    () => (isAuthenticated && isDelegated ? readDelegatedSession()?.account ?? null : null),
    [isAuthenticated, isDelegated],
  );

  // Resolve once. Inline CSS variables are only emitted when a theme prop is
  // provided — otherwise we leave the cascade alone so global `:root { --mero-* }`
  // overrides take effect.
  const resolvedTheme = useMemo(
    () => (theme ? resolveMeroTheme(theme) : null),
    [theme],
  );
  const themeVars = useMemo(
    () => (resolvedTheme ? themeToCssVars(resolvedTheme) : undefined),
    [resolvedTheme],
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const dashboardUrl = useMemo(() => {
    if (!isAuthenticated || !nodeUrl || isDelegated) return '#';
    return new URL('admin-dashboard/', nodeUrl).toString();
  }, [isAuthenticated, nodeUrl]);

  const labels = useMemo(() => {
    const overrides = typeof label === 'string' ? { connect: label } : label;
    return {
      connect: overrides?.connect ?? 'Connect',
      connected: overrides?.connected ?? 'Connected',
      reconnecting: overrides?.reconnecting ?? 'Reconnecting...',
    };
  }, [label]);

  const buttonClassName = logoOnly ? 'mero-logo-only' : '';

  const handleConnect = () => {
    // If Custom type with URL, connect directly
    if (
      typeof connectionType === 'object' &&
      connectionType.type === ConnectionTypeEnum.Custom
    ) {
      connectToNode(connectionType.url);
      return;
    }

    // Otherwise, open modal
    setIsModalOpen(true);
  };

  const handleModalConnect = (url: string) => {
    setIsModalOpen(false);
    connectToNode(url);
  };

  // Reconnecting state
  if (isAuthenticated && !isOnline) {
    return (
      <div
        className="mero-connect-container"
        style={{ ...themeVars, display: 'inline-block' }}
      >
        <button
          className={['mero-connect-button', 'mero-reconnecting', buttonClassName, className].filter(Boolean).join(' ')}
          style={style}
          disabled
          aria-label={labels.reconnecting}
          title={logoOnly ? labels.reconnecting : undefined}
        >
          <CalimeroLogo size={18} className="mero-logo" />
          {!logoOnly && labels.reconnecting}
        </button>
      </div>
    );
  }

  // Connected state
  if (isAuthenticated) {
    return (
      <div
        ref={dropdownRef}
        className="mero-connect-container"
        style={{ ...themeVars, position: 'relative', display: 'inline-block' }}
      >
        <button
          className={['mero-connect-button', 'mero-connected', buttonClassName, className].filter(Boolean).join(' ')}
          style={style}
          onClick={() => setIsDropdownOpen((prev) => !prev)}
          aria-label={labels.connected}
          title={logoOnly ? labels.connected : undefined}
        >
          <CalimeroLogo size={18} className="mero-logo" />
          {!logoOnly && labels.connected}
        </button>
        {isDropdownOpen && (
          <div className="mero-dropdown">
            {isDelegated && account && (
              <div className="mero-dropdown-info" title={account} data-testid="connected-account">
                Account {shortAccount(account)}
              </div>
            )}
            <div className="mero-dropdown-info" title={nodeUrl || ''}>
              {/* A delegated account with no relay is signed in and has no node
                  to name. Saying so beats an empty row that reads as a bug. */}
              {nodeUrl ?? (isDelegated ? 'no relay yet' : null)}
            </div>
            {isDelegated && enrolment.note && (
              <div className="mero-dropdown-info" data-testid="connected-note">
                {enrolment.note}
              </div>
            )}
            {/* No dashboard link on the delegated path: the admin dashboard is
                a node-operator surface, and a keyholder has no credential for
                it. Offering a link that 401s would be worse than omitting it. */}
            {!isDelegated && (
              <a
                href={dashboardUrl}
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

  // Disconnected state
  return (
    <div
      className="mero-connect-container"
      style={{ ...themeVars, display: 'inline-block' }}
    >
      <button
        className={['mero-connect-button', buttonClassName, className].filter(Boolean).join(' ')}
        style={style}
        onClick={handleConnect}
        aria-label={labels.connect}
        title={logoOnly ? labels.connect : undefined}
      >
        <CalimeroLogo size={18} className="mero-logo" />
        {!logoOnly && labels.connect}
      </button>
      <LoginModal
        isOpen={isModalOpen}
        onConnect={handleModalConnect}
        onClose={() => setIsModalOpen(false)}
        theme={resolvedTheme ?? theme}
        cloud={
          cloud
            ? {
                onEnrol: () => {
                  void enrolment.goToWallet();
                },
                note: enrolment.note,
                walletUrl: enrolment.walletUrl,
                customWallet: enrolment.customWallet,
              }
            : false
        }
        initialTab={cloud && enrolment.returning ? 'cloud' : 'node'}
      />
    </div>
  );
}

export default ConnectButton;
