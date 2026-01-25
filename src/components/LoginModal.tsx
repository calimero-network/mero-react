/**
 * LoginModal - Modal for connecting to a Calimero node
 * 
 * Allows users to select local or remote node connection.
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectionType, CustomConnectionConfig } from '../types';
import { ConnectionType as ConnectionTypeEnum } from '../types';

export interface LoginModalProps {
  /** Callback when user connects */
  onConnect: (url: string) => void;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Connection type determines what options to show */
  connectionType: ConnectionType | CustomConnectionConfig;
  /** Whether the modal is open */
  isOpen: boolean;
}

/**
 * Validate URL format
 */
function isValidUrl(urlString: string): boolean {
  if (!urlString || urlString.trim() === '') {
    return false;
  }

  try {
    const urlToTest =
      urlString.startsWith('http://') || urlString.startsWith('https://')
        ? urlString
        : `https://${urlString}`;

    const url = new URL(urlToTest);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    if (!url.hostname) {
      return false;
    }

    const hostname = url.hostname;

    // Allow localhost
    if (hostname === 'localhost') {
      return true;
    }

    // Check for valid IP address
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(hostname)) {
      const octets = hostname.split('.').map(Number);
      return octets.every((octet) => octet >= 0 && octet <= 255);
    }

    // Check for valid domain name
    const domainRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return domainRegex.test(hostname);
  } catch {
    return false;
  }
}

// Inline styles for the modal
const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '1rem',
  },
  content: {
    backgroundColor: '#1f2937',
    borderRadius: '12px',
    padding: '2rem',
    maxWidth: '400px',
    width: '100%',
    position: 'relative' as const,
    border: '1px solid #374151',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  closeButton: {
    position: 'absolute' as const,
    top: '1rem',
    right: '1rem',
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '0.25rem',
    lineHeight: 1,
  },
  header: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '1.5rem',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#f3f4f6',
    margin: 0,
  },
  info: {
    color: '#9ca3af',
    textAlign: 'center' as const,
    marginBottom: '1.5rem',
    fontSize: '0.875rem',
  },
  error: {
    color: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '6px',
    padding: '0.75rem',
    marginBottom: '1rem',
    fontSize: '0.875rem',
    textAlign: 'center' as const,
  },
  radioGroup: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1rem',
    justifyContent: 'center',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#e5e7eb',
    cursor: 'pointer',
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    border: '1px solid #374151',
    backgroundColor: '#111827',
    transition: 'all 0.2s',
  },
  radioLabelActive: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  input: {
    width: '100%',
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    border: '1px solid #374151',
    backgroundColor: '#111827',
    color: '#f3f4f6',
    fontSize: '0.875rem',
    outline: 'none',
    marginBottom: '1rem',
    boxSizing: 'border-box' as const,
  },
  localInfo: {
    color: '#9ca3af',
    fontSize: '0.875rem',
    textAlign: 'center' as const,
    padding: '0.75rem',
    backgroundColor: '#111827',
    borderRadius: '6px',
    marginBottom: '1rem',
  },
  buttonGroup: {
    display: 'flex',
    justifyContent: 'center',
  },
  button: {
    padding: '0.75rem 2rem',
    borderRadius: '6px',
    border: 'none',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    backgroundColor: '#3b82f6',
    color: 'white',
    transition: 'all 0.2s',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '1rem',
    padding: '2rem',
    color: '#9ca3af',
  },
  spinner: {
    width: '2rem',
    height: '2rem',
    border: '3px solid #374151',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
};

/**
 * LoginModal - Connection modal component
 */
export function LoginModal({
  onConnect,
  onClose,
  connectionType,
  isOpen,
}: LoginModalProps) {
  const [nodeType, setNodeType] = useState<'local' | 'remote'>('local');
  const [nodeUrl, setNodeUrl] = useState<string>('');
  const [isValid, setIsValid] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Determine what to show
  const shouldShowLocal =
    connectionType === ConnectionTypeEnum.RemoteAndLocal ||
    connectionType === ConnectionTypeEnum.Local;
  const shouldShowRemote =
    connectionType === ConnectionTypeEnum.RemoteAndLocal ||
    connectionType === ConnectionTypeEnum.Remote;
  const shouldShowRadioGroup = shouldShowLocal && shouldShowRemote;

  // Load saved URL
  useEffect(() => {
    const savedUrl = localStorage.getItem('mero:node_url');
    if (savedUrl) {
      setNodeUrl(savedUrl);
    }
  }, []);

  // Set initial node type
  useEffect(() => {
    if (connectionType === ConnectionTypeEnum.Local) {
      setNodeType('local');
    } else if (connectionType === ConnectionTypeEnum.Remote) {
      setNodeType('remote');
    }
  }, [connectionType]);

  // Validate URL
  useEffect(() => {
    if (nodeType === 'remote') {
      setIsValid(isValidUrl(nodeUrl));
    } else {
      setIsValid(true);
    }
  }, [nodeUrl, nodeType]);

  const handleConnect = useCallback(async () => {
    if (!isValid) return;

    setLoading(true);
    setError(null);

    const baseUrl =
      nodeType === 'local' ? 'http://node1.127.0.0.1.nip.io' : nodeUrl;

    try {
      // Test connection
      const response = await fetch(
        new URL('admin-api/is-authed', baseUrl).toString()
      );

      if (response.ok || response.status === 401) {
        setLoading(false);
        const normalizedUrl = baseUrl.replace(/\/+$/, '');
        onConnect(normalizedUrl);
      } else {
        throw new Error(`Connection failed: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Connection failed:', err);
      setError('Failed to connect. Please check the URL and try again.');
      setLoading(false);
    }
  }, [isValid, nodeType, nodeUrl, onConnect]);

  if (!isOpen) {
    return null;
  }

  const modalContent = (
    <>
      {/* Inject keyframes for spinner */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={styles.overlay} onClick={onClose}>
        <div style={styles.content} onClick={(e) => e.stopPropagation()}>
          <button style={styles.closeButton} onClick={onClose}>
            &times;
          </button>

          <div style={styles.header}>
            <MeroLogo />
            <h1 style={styles.title}>Connect to Calimero</h1>
          </div>

          {loading ? (
            <div style={styles.loading}>
              <p>Connecting to node...</p>
              <div style={styles.spinner} />
            </div>
          ) : (
            <>
              <p style={styles.info}>
                {shouldShowRadioGroup
                  ? 'Select your Calimero node type to continue.'
                  : connectionType === ConnectionTypeEnum.Local
                    ? 'Connect to your local Calimero node.'
                    : 'Enter your remote Calimero node URL.'}
              </p>

              {error && <p style={styles.error}>{error}</p>}

              {shouldShowRadioGroup && (
                <div style={styles.radioGroup}>
                  <label
                    style={{
                      ...styles.radioLabel,
                      ...(nodeType === 'local' ? styles.radioLabelActive : {}),
                    }}
                    onClick={() => setNodeType('local')}
                  >
                    <input
                      type="radio"
                      value="local"
                      checked={nodeType === 'local'}
                      onChange={() => setNodeType('local')}
                      style={{ display: 'none' }}
                    />
                    🏠 Local
                  </label>
                  <label
                    style={{
                      ...styles.radioLabel,
                      ...(nodeType === 'remote' ? styles.radioLabelActive : {}),
                    }}
                    onClick={() => setNodeType('remote')}
                  >
                    <input
                      type="radio"
                      value="remote"
                      checked={nodeType === 'remote'}
                      onChange={() => setNodeType('remote')}
                      style={{ display: 'none' }}
                    />
                    🌐 Remote
                  </label>
                </div>
              )}

              <div>
                {shouldShowRemote && nodeType === 'remote' ? (
                  <input
                    type="text"
                    value={nodeUrl}
                    onChange={(e) => setNodeUrl(e.target.value)}
                    placeholder="https://your-node-url.calimero.network"
                    style={styles.input}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && isValid) {
                        handleConnect();
                      }
                    }}
                  />
                ) : shouldShowLocal ? (
                  <p style={styles.localInfo}>
                    Using default local node: <br />
                    <code style={{ color: '#60a5fa' }}>http://node1.127.0.0.1.nip.io</code>
                  </p>
                ) : null}
              </div>

              <div style={styles.buttonGroup}>
                <button
                  onClick={handleConnect}
                  disabled={!isValid || loading}
                  style={{
                    ...styles.button,
                    ...(!isValid || loading ? styles.buttonDisabled : {}),
                  }}
                >
                  Connect
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  // Use portal to render at document root, outside any container styling
  return createPortal(modalContent, document.body);
}

/**
 * Simple Calimero logo
 */
function MeroLogo() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="#3b82f6"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
    </svg>
  );
}

export default LoginModal;
