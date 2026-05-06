/**
 * LoginModal - Modal for connecting to a Calimero node
 *
 * Allows users to select local or remote node connection.
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectionType, CustomConnectionConfig } from '../types';
import { ConnectionType as ConnectionTypeEnum } from '../types';
import {
  resolveMeroTheme,
  themeToCssVars,
  type MeroTheme,
  type ResolvedMeroTheme,
} from '../theme';

export interface LoginModalProps {
  /** Callback when user connects */
  onConnect: (url: string) => void;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Connection type determines what options to show */
  connectionType: ConnectionType | CustomConnectionConfig;
  /** Whether the modal is open */
  isOpen: boolean;
  /** Theme overrides — accepts any subset of `MeroTheme` tokens */
  theme?: MeroTheme;
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

/**
 * Mix a color with transparent using CSS `color-mix`. Works for any valid CSS
 * color value (hex of any length, rgb(), hsl(), named colors, var(...)) — not
 * just 6-digit hex.
 */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/**
 * Build the inline-style map from a resolved theme. Each value is emitted as
 * `var(--mero-*, fallback)` so a global `:root { --mero-* }` rule reaches the
 * portal-rendered modal; the fallback ensures the modal still renders correctly
 * if the consumer hasn't imported `styles.css`.
 */
function buildStyles(t: ResolvedMeroTheme) {
  const bg = `var(--mero-bg, ${t.background})`;
  const bgSecondary = `var(--mero-bg-secondary, ${t.backgroundSecondary})`;
  const text = `var(--mero-text, ${t.text})`;
  const textSecondary = `var(--mero-text-secondary, ${t.textSecondary})`;
  const accent = `var(--mero-accent, ${t.primary})`;
  const onPrimary = `var(--mero-on-primary, ${t.primaryText})`;
  const border = `var(--mero-border, ${t.border})`;
  const error = `var(--mero-error, ${t.error})`;
  const overlay = `var(--mero-overlay, ${t.overlay})`;
  const radius = `var(--mero-radius, ${t.radius})`;

  const errorBg = tint(error, 10);
  const errorBorder = tint(error, 30);
  const accentGlow = tint(accent, 15);

  return {
    overlay: {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: overlay,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '1rem',
      animation: 'meroFadeIn 0.2s ease-out',
    },
    content: {
      backgroundColor: bg,
      borderRadius: radius,
      padding: '2rem',
      maxWidth: '420px',
      width: '100%',
      position: 'relative' as const,
      border: `1px solid ${border}`,
      boxShadow: `0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px ${accentGlow}`,
      animation: 'meroSlideIn 0.25s ease-out',
      color: text,
    },
    closeButton: {
      position: 'absolute' as const,
      top: '0.75rem',
      right: '0.75rem',
      background: 'none',
      border: 'none',
      fontSize: '1.5rem',
      color: textSecondary,
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
      color: text,
      margin: 0,
    },
    info: {
      color: textSecondary,
      textAlign: 'center' as const,
      marginBottom: '1.5rem',
      fontSize: '0.875rem',
    },
    error: {
      color: error,
      backgroundColor: errorBg,
      border: `1px solid ${errorBorder}`,
      borderRadius: radius,
      padding: '0.75rem',
      marginBottom: '1rem',
      fontSize: '0.875rem',
      textAlign: 'center' as const,
    },
    radioGroup: {
      display: 'flex',
      gap: '0.75rem',
      marginBottom: '1rem',
      justifyContent: 'center',
    },
    radioLabel: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      color: text,
      cursor: 'pointer',
      padding: '0.5rem 1rem',
      borderRadius: radius,
      border: `1px solid ${border}`,
      backgroundColor: bgSecondary,
      transition: 'all 0.15s ease',
    },
    radioLabelActive: {
      borderColor: accent,
      backgroundColor: accentGlow,
      color: text,
    },
    input: {
      width: '100%',
      padding: '0.75rem 1rem',
      borderRadius: radius,
      border: `1px solid ${border}`,
      backgroundColor: bgSecondary,
      color: text,
      fontSize: '0.875rem',
      outline: 'none',
      marginBottom: '1rem',
      boxSizing: 'border-box' as const,
    },
    localInfo: {
      color: textSecondary,
      fontSize: '0.875rem',
      textAlign: 'center' as const,
      padding: '0.75rem',
      backgroundColor: bgSecondary,
      borderRadius: radius,
      marginBottom: '1rem',
      border: `1px solid ${border}`,
    },
    localInfoCode: {
      color: accent,
    },
    buttonGroup: {
      display: 'flex',
      justifyContent: 'center',
    },
    button: {
      padding: '0.75rem 2rem',
      borderRadius: radius,
      border: 'none',
      fontSize: '0.875rem',
      fontWeight: 600,
      cursor: 'pointer',
      backgroundColor: accent,
      color: onPrimary,
      transition: 'all 0.15s ease',
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
      color: textSecondary,
    },
    spinner: {
      width: '2rem',
      height: '2rem',
      border: `3px solid ${border}`,
      borderTopColor: accent,
      borderRadius: '50%',
      animation: 'meroSpin 1s linear infinite',
    },
  };
}

/**
 * LoginModal - Connection modal component
 */
export function LoginModal({
  onConnect,
  onClose,
  connectionType,
  isOpen,
  theme,
}: LoginModalProps) {
  const [nodeType, setNodeType] = useState<'local' | 'remote'>('local');
  const [nodeUrl, setNodeUrl] = useState<string>('');
  const [isValid, setIsValid] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const resolved = useMemo(() => resolveMeroTheme(theme), [theme]);
  const styles = useMemo(() => buildStyles(resolved), [resolved]);
  // Only emit inline `--mero-*` variables when a `theme` prop was actually
  // provided. Without a prop, we let global `:root { --mero-* }` rules cascade
  // through to the portal-rendered modal (with `var()` fallbacks in buildStyles
  // covering the case where no global rules are loaded).
  const themeVars = useMemo(
    () => (theme ? themeToCssVars(resolved) : undefined),
    [theme, resolved],
  );

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
      <style>{`
        @keyframes meroSpin { to { transform: rotate(360deg); } }
        @keyframes meroFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes meroSlideIn { from { transform: translateY(-12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div style={{ ...themeVars, ...styles.overlay }} onClick={onClose}>
        <div style={styles.content} onClick={(e) => e.stopPropagation()}>
          <button style={styles.closeButton} onClick={onClose}>
            &times;
          </button>

          <div style={styles.header}>
            <MeroLogo color={`var(--mero-accent, ${resolved.primary})`} />
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
                    Local
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
                    Remote
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
                    <code style={styles.localInfoCode}>http://node1.127.0.0.1.nip.io</code>
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

  return createPortal(modalContent, document.body);
}

/**
 * Simple Calimero logo
 */
function MeroLogo({ color }: { color: string }) {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
    </svg>
  );
}

export default LoginModal;
