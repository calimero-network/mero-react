/**
 * ConnectButton - A button component for connecting to Calimero
 * 
 * Shows connection status and provides login/logout functionality.
 * Includes built-in LoginModal for node selection.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMero } from '../context';
import { LoginModal } from './LoginModal';
import type { ConnectionType, CustomConnectionConfig } from '../types';
import { ConnectionType as ConnectionTypeEnum } from '../types';

export interface ConnectButtonProps {
  /** Connection type for login modal */
  connectionType?: ConnectionType | CustomConnectionConfig;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: React.CSSProperties;
}

/**
 * ConnectButton - Displays connection status and handles login/logout
 */
export function ConnectButton({
  connectionType = ConnectionTypeEnum.RemoteAndLocal,
  className,
  style,
}: ConnectButtonProps) {
  const { isAuthenticated, connectToNode, logout, nodeUrl, isOnline } = useMero();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      <button
        className={`mero-connect-button mero-reconnecting ${className || ''}`}
        style={style}
        disabled
      >
        <MeroLogo />
        Reconnecting...
      </button>
    );
  }

  // Connected state
  if (isAuthenticated) {
    return (
      <div ref={dropdownRef} className="mero-connect-container" style={{ position: 'relative', display: 'inline-block' }}>
        <button
          className={`mero-connect-button mero-connected ${className || ''}`}
          style={style}
          onClick={() => setIsDropdownOpen((prev) => !prev)}
        >
          <MeroLogo />
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
    <>
      <button
        className={`mero-connect-button ${className || ''}`}
        style={style}
        onClick={handleConnect}
      >
        <MeroLogo />
        Connect
      </button>
      <LoginModal
        isOpen={isModalOpen}
        onConnect={handleModalConnect}
        onClose={() => setIsModalOpen(false)}
        connectionType={typeof connectionType === 'object' ? ConnectionTypeEnum.RemoteAndLocal : connectionType}
      />
    </>
  );
}

/**
 * Simple Calimero logo component
 */
function MeroLogo() {
  return (
    <svg
      className="mero-logo"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
    </svg>
  );
}

export default ConnectButton;
