/**
 * LoginModal - Modal for connecting to a Calimero node
 *
 * When local connections are enabled, the modal probes a set of well-known
 * local ports (see `nodeDiscovery`) and offers whatever nodes are actually
 * running as radio choices, plus an always-available "enter URL manually"
 * option. When nothing local is found it falls straight through to manual URL
 * entry.
 */

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalimeroLogo } from './CalimeroLogo';
import type { ConnectionType, CustomConnectionConfig } from '../types';
import { ConnectionType as ConnectionTypeEnum } from '../types';
import {
  discoverLocalNodes,
  DEFAULT_LOCAL_NODE_PORTS,
} from '../utils/nodeDiscovery';
import {
  cssVar,
  resolveMeroTheme,
  themeToCssVars,
  type MeroTheme,
  type ResolvedMeroTheme,
} from '../theme';

/** Sentinel selection value for the manual "enter a URL" option. */
const CUSTOM_SELECTION = '__custom__';

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
  /**
   * Ports probed when discovering local nodes. Defaults to the well-known
   * Calimero dev ports (2428, 2429, 2528, 2529). Mostly an escape hatch for
   * non-standard setups and tests.
   */
  localNodePorts?: readonly number[];
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

/** Strip the scheme for a compact node label (e.g. `localhost:2428`). */
function displayNodeUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
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
  const bg = cssVar(t, 'background');
  const bgSecondary = cssVar(t, 'backgroundSecondary');
  const text = cssVar(t, 'text');
  const textSecondary = cssVar(t, 'textSecondary');
  const accent = cssVar(t, 'primary');
  const onPrimary = cssVar(t, 'primaryText');
  const border = cssVar(t, 'border');
  const error = cssVar(t, 'error');
  const overlay = cssVar(t, 'overlay');
  const radius = cssVar(t, 'radius');

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
    radioList: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '0.5rem',
      marginBottom: '1rem',
    },
    radioItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.625rem',
      color: text,
      cursor: 'pointer',
      padding: '0.75rem 1rem',
      borderRadius: radius,
      border: `1px solid ${border}`,
      backgroundColor: bgSecondary,
      transition: 'all 0.15s ease',
      fontSize: '0.875rem',
    },
    radioItemActive: {
      // Override the full `border` shorthand (not just borderColor) so React
      // never has to mix shorthand + longhand on the same element.
      border: `1px solid ${accent}`,
      backgroundColor: accentGlow,
      color: text,
    },
    radioIndicator: {
      flexShrink: 0,
      width: '1rem',
      height: '1rem',
      borderRadius: '50%',
      border: `2px solid ${border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioIndicatorActive: {
      border: `2px solid ${accent}`,
    },
    radioDot: {
      width: '0.5rem',
      height: '0.5rem',
      borderRadius: '50%',
      backgroundColor: accent,
    },
    nodeMeta: {
      marginLeft: 'auto',
      fontSize: '0.75rem',
      color: textSecondary,
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
    noNodeInfo: {
      color: textSecondary,
      fontSize: '0.875rem',
      textAlign: 'center' as const,
      padding: '0.75rem',
      backgroundColor: bgSecondary,
      borderRadius: radius,
      marginBottom: '1rem',
      border: `1px solid ${border}`,
    },
    toolbar: {
      display: 'flex',
      justifyContent: 'center',
      marginBottom: '1rem',
    },
    rescan: {
      background: 'none',
      border: 'none',
      color: accent,
      cursor: 'pointer',
      fontSize: '0.8125rem',
      padding: '0.25rem 0.5rem',
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
  localNodePorts = DEFAULT_LOCAL_NODE_PORTS,
}: LoginModalProps) {
  // `selected` is either a discovered node URL or CUSTOM_SELECTION.
  const [selected, setSelected] = useState<string>(CUSTOM_SELECTION);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [customUrl, setCustomUrl] = useState<string>('');
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

  // Load saved URL into the manual field
  useEffect(() => {
    const savedUrl = localStorage.getItem('mero:node_url');
    if (savedUrl) {
      setCustomUrl(savedUrl);
    }
  }, []);

  // Probe local ports whenever the modal opens (and local connections are
  // allowed). A bumpable counter lets the user trigger a re-scan.
  const [scanNonce, setScanNonce] = useState(0);
  const portsKey = useMemo(() => localNodePorts.join(','), [localNodePorts]);

  useEffect(() => {
    if (!isOpen || !shouldShowLocal) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    setDiscovering(true);
    setError(null);

    discoverLocalNodes({ ports: localNodePorts, signal: controller.signal })
      .then((nodes) => {
        if (!active) return;
        setDiscovered(nodes);
        // Default to the first discovered node, else fall through to manual.
        setSelected(nodes.length > 0 ? nodes[0] : CUSTOM_SELECTION);
      })
      .finally(() => {
        if (active) setDiscovering(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // portsKey captures localNodePorts content; scanNonce forces a re-scan.
  }, [isOpen, shouldShowLocal, portsKey, scanNonce]);

  // Remote-only: there is nothing to discover, manual entry is the only path.
  useEffect(() => {
    if (!shouldShowLocal) {
      setSelected(CUSTOM_SELECTION);
    }
  }, [shouldShowLocal]);

  const isCustom = selected === CUSTOM_SELECTION;
  const isValid = isCustom ? isValidUrl(customUrl) : true;

  // Keep a ref so the keydown handler always sees the latest validity.
  const canConnect = isValid && !loading;
  const canConnectRef = useRef(canConnect);
  canConnectRef.current = canConnect;

  const handleConnect = useCallback(async () => {
    const targetUrl = selected === CUSTOM_SELECTION ? customUrl : selected;
    const usingCustom = selected === CUSTOM_SELECTION;

    if (usingCustom && !isValidUrl(targetUrl)) return;

    const normalizedUrl = targetUrl.replace(/\/+$/, '');

    // Discovered nodes already answered a health check, so connect straight
    // away. For a manually entered URL, verify reachability first.
    if (!usingCustom) {
      onConnect(normalizedUrl);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        new URL('admin-api/is-authed', normalizedUrl).toString(),
      );

      if (response.ok || response.status === 401) {
        setLoading(false);
        onConnect(normalizedUrl);
      } else {
        throw new Error(`Connection failed: ${response.statusText}`);
      }
    } catch (err) {
      console.error('Connection failed:', err);
      setError('Failed to connect. Please check the URL and try again.');
      setLoading(false);
    }
  }, [selected, customUrl, onConnect]);

  if (!isOpen) {
    return null;
  }

  const hasDiscovered = discovered.length > 0;
  // The manual radio appears alongside discovered nodes; when local discovery
  // is off entirely (remote-only) the bare input is shown instead.
  const showRadioList = shouldShowLocal && hasDiscovered;
  const showManualInput = isCustom && shouldShowRemote;

  const infoText = discovering
    ? null
    : showRadioList
      ? 'Select a local node, or enter a node URL manually.'
      : shouldShowLocal && shouldShowRemote
        ? 'No local node found. Enter a node URL to continue.'
        : shouldShowLocal
          ? 'No local node found. Make sure your node is running, then rescan.'
          : 'Enter your remote Calimero node URL.';

  const renderRadio = (value: string, label: string, meta?: string) => {
    const active = selected === value;
    return (
      <label
        key={value}
        data-testid={`node-option-${value === CUSTOM_SELECTION ? 'custom' : displayNodeUrl(value)}`}
        style={{
          ...styles.radioItem,
          ...(active ? styles.radioItemActive : {}),
        }}
        onClick={() => setSelected(value)}
      >
        <input
          type="radio"
          name="mero-node"
          value={value}
          checked={active}
          onChange={() => setSelected(value)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
        />
        <span
          style={{
            ...styles.radioIndicator,
            ...(active ? styles.radioIndicatorActive : {}),
          }}
        >
          {active && <span style={styles.radioDot} />}
        </span>
        {label}
        {meta && <span style={styles.nodeMeta}>{meta}</span>}
      </label>
    );
  };

  const modalContent = (
    <>
      <style>{`
        @keyframes meroSpin { to { transform: rotate(360deg); } }
        @keyframes meroFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes meroSlideIn { from { transform: translateY(-12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      `}</style>
      <div style={{ ...themeVars, ...styles.overlay }} onClick={onClose}>
        <div style={styles.content} onClick={(e) => e.stopPropagation()}>
          <button style={styles.closeButton} onClick={onClose} aria-label="Close">
            &times;
          </button>

          <div style={styles.header}>
            <CalimeroLogo size={44} color={cssVar(resolved, 'primary')} />
            <h1 style={styles.title}>Connect to Calimero</h1>
          </div>

          {loading ? (
            <div style={styles.loading}>
              <p>Connecting to node...</p>
              <div style={styles.spinner} />
            </div>
          ) : discovering ? (
            <div style={styles.loading} data-testid="node-discovering">
              <p>Searching for local nodes...</p>
              <div style={styles.spinner} />
            </div>
          ) : (
            <>
              {infoText && <p style={styles.info}>{infoText}</p>}

              {error && <p style={styles.error}>{error}</p>}

              {showRadioList && (
                <div style={styles.radioList} role="radiogroup" aria-label="Available nodes">
                  {discovered.map((url) =>
                    renderRadio(url, displayNodeUrl(url), 'local'),
                  )}
                  {/* Manual entry is always offered alongside discovered nodes. */}
                  {shouldShowRemote &&
                    renderRadio(CUSTOM_SELECTION, 'Enter node URL manually')}
                </div>
              )}

              {showManualInput && (
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://your-node-url.calimero.network"
                  style={styles.input}
                  data-testid="node-url-input"
                  autoFocus={!showRadioList}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canConnectRef.current) {
                      handleConnect();
                    }
                  }}
                />
              )}

              {/* Local discovery turned up nothing and remote entry is not
                  allowed — offer a rescan so a freshly started node is found. */}
              {shouldShowLocal && !hasDiscovered && !shouldShowRemote && (
                <p style={styles.noNodeInfo} data-testid="no-node-found">
                  No local node detected on ports{' '}
                  <code>{localNodePorts.join(', ')}</code>.
                </p>
              )}

              {shouldShowLocal && (
                <div style={styles.toolbar}>
                  <button
                    style={styles.rescan}
                    onClick={() => setScanNonce((n) => n + 1)}
                    data-testid="rescan-button"
                  >
                    ↻ Rescan local nodes
                  </button>
                </div>
              )}

              <div style={styles.buttonGroup}>
                <button
                  onClick={handleConnect}
                  disabled={!canConnect}
                  style={{
                    ...styles.button,
                    ...(!canConnect ? styles.buttonDisabled : {}),
                  }}
                  data-testid="connect-button"
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

export default LoginModal;
