/**
 * Theme tokens for mero-react components.
 *
 * Defaults match the green palette used across Calimero apps (admin-dashboard,
 * tauri-app, app-registry). Pass a partial `MeroTheme` to `ConnectButton` or
 * `LoginModal` to override any token.
 */

export interface MeroTheme {
  /** Primary accent / CTA color */
  primary?: string;
  /** Primary accent on hover */
  primaryHover?: string;
  /** Text color rendered on top of `primary` (e.g. inside the Connect button when connected) */
  primaryText?: string;
  /** Main surface color (modal background, button background) */
  background?: string;
  /** Secondary surface color (input fields, info chips) */
  backgroundSecondary?: string;
  /** Tertiary surface color (subtle elevation) */
  backgroundTertiary?: string;
  /** Border color */
  border?: string;
  /** Primary text color */
  text?: string;
  /** Muted / secondary text color */
  textSecondary?: string;
  /** Error / danger color */
  error?: string;
  /** Modal backdrop color */
  overlay?: string;
  /** Border radius (any CSS length) */
  radius?: string;
}

export type ResolvedMeroTheme = Required<MeroTheme>;

export const defaultMeroTheme: Readonly<ResolvedMeroTheme> = Object.freeze({
  primary: '#a5ff11',
  primaryHover: '#8ed40d',
  primaryText: '#0d1117',
  background: '#0d1117',
  backgroundSecondary: '#161b22',
  backgroundTertiary: '#1c2128',
  border: '#30363d',
  text: '#e6edf3',
  textSecondary: '#8b949e',
  error: '#ff6b6b',
  overlay: 'rgba(0, 0, 0, 0.75)',
  radius: '8px',
});

export function resolveMeroTheme(theme?: MeroTheme): ResolvedMeroTheme {
  if (!theme) return { ...defaultMeroTheme };
  // Drop null / undefined / empty-string overrides so they don't shadow defaults
  // and produce invisible elements. Note: we don't validate CSS syntax — any
  // non-empty string is forwarded as-is.
  const filtered = Object.fromEntries(
    Object.entries(theme).filter(
      ([, v]) => v !== undefined && v !== null && v !== '',
    ),
  ) as Partial<MeroTheme>;
  return { ...defaultMeroTheme, ...filtered };
}

/**
 * Build a `style` object that exposes a resolved theme as CSS variables, so
 * descendant CSS rules (e.g. those in `styles.css`) pick up the overrides.
 */
export function themeToCssVars(theme: ResolvedMeroTheme): React.CSSProperties {
  return {
    ['--mero-bg' as string]: theme.background,
    ['--mero-bg-secondary' as string]: theme.backgroundSecondary,
    ['--mero-bg-tertiary' as string]: theme.backgroundTertiary,
    ['--mero-text' as string]: theme.text,
    ['--mero-text-secondary' as string]: theme.textSecondary,
    ['--mero-accent' as string]: theme.primary,
    ['--mero-accent-hover' as string]: theme.primaryHover,
    ['--mero-on-primary' as string]: theme.primaryText,
    ['--mero-border' as string]: theme.border,
    ['--mero-input-bg' as string]: theme.backgroundSecondary,
    ['--mero-input-text' as string]: theme.text,
    ['--mero-error' as string]: theme.error,
    ['--mero-overlay' as string]: theme.overlay,
    ['--mero-radius' as string]: theme.radius,
  } as React.CSSProperties;
}
