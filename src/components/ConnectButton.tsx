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
  /** Connection type for login modal */
  connectionType?: ConnectionType | CustomConnectionConfig;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Theme overrides — accepts any subset of `MeroTheme` tokens */
  theme?: MeroTheme;
}

/**
 * ConnectButton - Displays connection status and handles login/logout
 */
export function ConnectButton({
  connectionType = ConnectionTypeEnum.RemoteAndLocal,
  className,
  style,
  theme,
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
          className={`mero-connect-button mero-reconnecting ${className || ''}`}
          style={style}
          disabled
        >
          <CalimeroLogo size={18} className="mero-logo" />
          Reconnecting...
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
          className={`mero-connect-button mero-connected ${className || ''}`}
          style={style}
          onClick={() => setIsDropdownOpen((prev) => !prev)}
        >
          <CalimeroLogo size={18} className="mero-logo" />
          Connected
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
        className={`mero-connect-button ${className || ''}`}
        style={style}
        onClick={handleConnect}
      >
        <CalimeroLogo size={18} className="mero-logo" />
        Connect
      </button>
      <LoginModal
        isOpen={isModalOpen}
        onConnect={handleModalConnect}
        onClose={() => setIsModalOpen(false)}
        connectionType={typeof connectionType === 'object' ? ConnectionTypeEnum.RemoteAndLocal : connectionType}
        theme={resolvedTheme ?? theme}
      />
    </div>
  );
}

export default ConnectButton;
