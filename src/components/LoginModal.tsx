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
 *
 * By default the modal has two tabs: **Node** (everything above, unchanged,
 * selected by default) and **Cloud** (sign in with a Calimero account — see
 * `AccountSignInPanel` / `useAccountEnrolment`). The Cloud tab is sourced from
 * `useAccountEnrolment` inside the modal, so an app that mounts `LoginModal`
 * itself gets account sign-in with no wiring; `cloud={false}` removes it, and
 * a `cloud` object (what `ConnectButton` passes) replaces it with the caller's.
 *
 * Because of that the modal reads `useMero()` and must sit inside a
 * `MeroProvider`, as every app's does.
 */

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalimeroLogo } from './CalimeroLogo';
import { AccountSignInPanel } from './AccountSignInPanel';
import { useAccountEnrolment } from '../delegated/useAccountEnrolment';
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
  /**
   * The second way in: a **Cloud** tab, signing in with a Calimero account by
   * enrolling this tab's device key at the wallet.
   *
   * - **Omitted** (the default): the tab is shown, sourced from
   *   `useAccountEnrolment()` inside the modal — enrolment starts from the tab,
   *   and a page coming back from the wallet is completed here, whether or not
   *   the modal is open. Nothing to wire; the modal must be inside a
   *   `MeroProvider`.
   * - **`false`**: no Cloud tab and no tabs at all — the node dialog as it was.
   *   The modal reads no enrolment callback, leaving it to whichever component
   *   does.
   * - **An object**: the caller's own enrolment, used verbatim; the modal reads
   *   none itself. The values are `useAccountEnrolment`'s, as `ConnectButton`
   *   passes them.
   */
  cloud?:
    | false
    | {
        /** Start enrolment — normally `useAccountEnrolment().goToWallet`. */
        onEnrol: () => void;
        /** What the last enrolment had to say, shown on the Cloud tab. */
        note?: string | null;
        /** The wallet enrolment goes to. Shown only when `customWallet`. */
        walletUrl?: string;
        /** Whether `walletUrl` is an override rather than the hosted wallet. */
        customWallet?: boolean;
      };
  /**
   * The tab selected when the modal opens. Ignored with `cloud={false}`.
   *
   * Default `'node'` — except that a modal sourcing its own Cloud tab opens on
   * `'cloud'` when the page is coming back from the wallet, so whatever the
   * completion has to say is where the person is looking. An explicit value
   * always wins.
   */
  initialTab?: LoginModalTab;
}

/** The two tabs of the connect dialog, when it has a Cloud tab. */
export type LoginModalTab = 'node' | 'cloud';

const TABS: readonly { id: LoginModalTab; label: string }[] = [
  { id: 'node', label: 'Node' },
  { id: 'cloud', label: 'Cloud' },
];

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
    tabList: {
      display: 'flex',
      gap: '0.25rem',
      padding: '0.25rem',
      marginBottom: '1.5rem',
      borderRadius: radius,
      border: `1px solid ${border}`,
      backgroundColor: bgSecondary,
    },
    tab: {
      flex: 1,
      padding: '0.5rem 1rem',
      borderRadius: radius,
      border: '1px solid transparent',
      backgroundColor: 'transparent',
      color: textSecondary,
      fontSize: '0.875rem',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    },
    tabActive: {
      border: `1px solid ${accent}`,
      backgroundColor: accentGlow,
      color: text,
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
  cloud,
  initialTab: initialTabProp,
}: LoginModalProps) {
  // The modal's own enrolment, for the default case only. A caller that passed
  // its own `cloud` already holds an enabled hook, and the callback it reads is
  // single-use: a second enabled reader here would find nothing, or — if it
  // rendered first — take the callback away from the caller. So this is on
  // exactly when nobody else is. Called before the `isOpen` early return, so a
  // tab coming back from the wallet is completed while the modal is closed too.
  const own = useAccountEnrolment({ enabled: cloud === undefined });
  const cloudTab = useMemo(
    () =>
      cloud === undefined
        ? {
            onEnrol: () => {
              void own.goToWallet();
            },
            note: own.note,
            walletUrl: own.walletUrl,
            customWallet: own.customWallet,
          }
        : cloud || null,
    [cloud, own.goToWallet, own.note, own.walletUrl, own.customWallet],
  );
  const initialTab: LoginModalTab =
    initialTabProp ?? (cloud === undefined && own.returning ? 'cloud' : 'node');

  const [tab, setTab] = useState<LoginModalTab>(initialTab);
  // Each opening starts on `initialTab`: the modal stays mounted while closed,
  // so without this a reopen would land on whatever tab was left selected.
  useEffect(() => {
    if (isOpen) setTab(initialTab);
  }, [isOpen, initialTab]);
  const tabRefs = useRef<Record<LoginModalTab, HTMLButtonElement | null>>({
    node: null,
    cloud: null,
  });
  const activeTab: LoginModalTab = cloudTab ? tab : 'node';

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

  // The node dialog's body, exactly as it was before there were tabs. With a
  // Cloud tab it is wrapped as the Node tabpanel; without one it is the whole
  // modal body, with no wrapper, so a direct LoginModal user sees no change.
  const renderNodeBody = () => {
    const body = loading ? (
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
    );
    if (!cloudTab) return body;
    return (
      <div
        role="tabpanel"
        id="mero-login-panel-node"
        aria-labelledby="mero-login-tab-node"
      >
        {body}
      </div>
    );
  };

  // WAI-ARIA tabs with automatic activation: the selected tab is the one tab
  // stop, and the arrow keys (plus Home/End) move selection and focus.
  const selectTab = (id: LoginModalTab) => {
    setTab(id);
    tabRefs.current[id]?.focus();
  };
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === activeTab);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectTab(TABS[next].id);
  };
  const renderTabs = () => (
    <div role="tablist" aria-label="How to connect" style={styles.tabList}>
      {TABS.map((t) => {
        const selected = activeTab === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`mero-login-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`mero-login-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKeyDown}
            style={{ ...styles.tab, ...(selected ? styles.tabActive : {}) }}
            data-testid={`login-tab-${t.id}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );

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

          {cloudTab && renderTabs()}

          {activeTab === 'cloud' && cloudTab ? (
            <div
              role="tabpanel"
              id="mero-login-panel-cloud"
              aria-labelledby="mero-login-tab-cloud"
              tabIndex={0}
            >
              <AccountSignInPanel
                onEnrol={cloudTab.onEnrol}
                note={cloudTab.note}
                walletUrl={cloudTab.walletUrl}
                customWallet={cloudTab.customWallet}
                theme={theme}
              />
            </div>
          ) : (
            renderNodeBody()
          )}
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}

export default LoginModal;
