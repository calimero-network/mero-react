/**
 * ConnectButton - A button component for connecting to Calimero
 *
 * Shows connection status and provides login/logout functionality.
 * Includes built-in LoginModal for node selection.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMero } from '../context';
import { LoginModal } from './LoginModal';
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
}: ConnectButtonProps) {
  const { isAuthenticated, connectToNode, logout, nodeUrl, isOnline } = useMero();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    if (!isAuthenticated || !nodeUrl) return '#';
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
            <div className="mero-dropdown-info" title={nodeUrl || ''}>
              {nodeUrl}
            </div>
            <a
              href={dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mero-dropdown-item"
            >
              Dashboard
            </a>
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
      />
    </div>
  );
}

export default ConnectButton;
