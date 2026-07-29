/**
 * LoginModal - Modal for connecting to a Calimero node
 *
 * A single section: the modal auto-discovers nodes on the well-known local
 * ports (see `nodeDiscovery`) and offers whatever is running as radio choices,
 * plus an always-available "enter URL manually" option. With nothing found it
 * falls straight through to manual URL entry.
 *
 * The old Local/Remote tabs are gone — the "Local" tab pointed at a hardcoded
 * default node (`node1.127.0.0.1.nip.io`) that doesn't resolve in most setups;
 * discovery + manual entry covers both cases properly.
 */

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalimeroLogo } from './CalimeroLogo';
import type { ConnectionType, CustomConnectionConfig } from '../types';
import {
  discoverLocalNodes,
  nodeEndpoint,
  DEFAULT_LOCAL_NODE_PORTS,
} from '@calimero-network/mero-js';
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
  /**
   * @deprecated Ignored. The modal always shows node discovery + manual URL
   * entry; the old hardcoded-default "Local" view was removed. Kept so
   * existing call sites keep compiling.
   */
  connectionType?: ConnectionType | CustomConnectionConfig;
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
    discovering: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      gap: '0.75rem',
      padding: '1rem',
      color: textSecondary,
      fontSize: '0.875rem',
    },
    spinner: {
      width: '2rem',
      height: '2rem',
      border: `3px solid ${border}`,
      borderTopColor: accent,
      borderRadius: '50%',
      animation: 'meroSpin 1s linear infinite',
    },
    spinnerSmall: {
      width: '1.5rem',
      height: '1.5rem',
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
  isOpen,
  theme,
  localNodePorts = DEFAULT_LOCAL_NODE_PORTS,
}: LoginModalProps) {
  // `selected` is a discovered node URL or CUSTOM.
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

  // Load saved URL into the manual field
  useEffect(() => {
    const savedUrl = localStorage.getItem('mero:node_url');
    if (savedUrl) {
      setCustomUrl(savedUrl);
    }
  }, []);

  // Probe local ports whenever the modal is open; a bumpable nonce lets the
  // user trigger a re-scan.
  const [scanNonce, setScanNonce] = useState(0);
  const portsKey = useMemo(() => localNodePorts.join(','), [localNodePorts]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    setDiscovering(true);
    // Clear any prior results so a re-scan never shows stale nodes.
    setDiscovered([]);
    setError(null);

    discoverLocalNodes({ ports: localNodePorts, signal: controller.signal })
      .then((nodes) => {
        if (!active) return;
        setDiscovered(nodes);
        // Default to the first discovered node, else fall through to manual.
        setSelected(nodes.length > 0 ? nodes[0] : CUSTOM_SELECTION);
      })
      // discoverLocalNodes is designed never to reject; the catch is purely
      // defensive so a future change can't surface an unhandled rejection.
      .catch(() => {
        if (active) setSelected(CUSTOM_SELECTION);
      })
      .finally(() => {
        if (active) setDiscovering(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // portsKey captures localNodePorts content; scanNonce forces a re-scan.
  }, [isOpen, portsKey, scanNonce]);

  const isCustom = selected === CUSTOM_SELECTION;
  const hasDiscovered = discovered.length > 0;

  // Whether the connect button can fire in the current state.
  const canConnect =
    !loading && !discovering && (isCustom ? isValidUrl(customUrl) : true);

  // Keep a ref so the input's keydown handler always sees current validity.
  const canConnectRef = useRef(canConnect);
  canConnectRef.current = canConnect;

  const handleConnect = useCallback(async () => {
    const usingDiscovered = selected !== CUSTOM_SELECTION;
    const targetUrl = usingDiscovered ? selected : customUrl;

    // Manual URLs must look valid before we try them.
    if (!usingDiscovered && !isValidUrl(targetUrl)) {
      return;
    }

    const normalizedUrl = targetUrl.replace(/\/+$/, '');

    // A discovered node already answered a health check — connect straight away.
    if (usingDiscovered) {
      onConnect(normalizedUrl);
      return;
    }

    // Manually entered URLs are verified via is-authed.
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        nodeEndpoint(normalizedUrl, 'admin-api/is-authed'),
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

  const showManualInput = isCustom;
  const renderRadio = (value: string, label: string, meta?: string) => {
    const active = selected === value;
    return (
      // Selection is driven solely by the radio input's `onChange` — clicking
      // anywhere on the wrapping label forwards to the input, and keyboard
      // users can tab to / arrow through the (visually hidden but focusable)
      // input. A label `onClick` here would double-fire `setSelected`.
      <label
        key={value}
        data-testid={`node-option-${value === CUSTOM_SELECTION ? 'custom' : displayNodeUrl(value)}`}
        style={{
          ...styles.radioItem,
          ...(active ? styles.radioItemActive : {}),
        }}
      >
        <input
          type="radio"
          name="mero-node"
          value={value}
          checked={active}
          onChange={() => setSelected(value)}
          style={{ position: 'absolute', opacity: 0 }}
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

  const renderNodeSection = () => {
    if (discovering) {
      return (
        <div style={styles.discovering} data-testid="node-discovering">
          <div style={styles.spinnerSmall} />
          <p>Searching for local nodes...</p>
        </div>
      );
    }

    return (
      <>
        <p style={styles.info}>
          {hasDiscovered
            ? 'Select your Calimero node to continue.'
            : 'No local node found. Enter a node URL to continue.'}
        </p>

        {hasDiscovered && (
          <div
            style={styles.radioList}
            role="radiogroup"
            aria-label="Available nodes"
          >
            {discovered.map((url) =>
              renderRadio(url, displayNodeUrl(url), 'local'),
            )}
            {/* Manual entry is always offered alongside discovered nodes. */}
            {renderRadio(CUSTOM_SELECTION, 'Enter node URL manually')}
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
            autoFocus={!hasDiscovered}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConnectRef.current) {
                handleConnect();
              }
            }}
          />
        )}

        <div style={styles.toolbar}>
          <button
            type="button"
            style={styles.rescan}
            onClick={() => setScanNonce((n) => n + 1)}
            data-testid="rescan-button"
          >
            ↻ Rescan local nodes
          </button>
        </div>
      </>
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
          ) : (
            <>
              {error && <p style={styles.error}>{error}</p>}

              {renderNodeSection()}

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
