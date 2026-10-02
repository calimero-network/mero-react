/**
 * AccountSignInPanel — the Cloud tab of the connect dialog.
 *
 * Presentational only: the button, what pressing it does, and whatever the last
 * enrolment had to say. The flow itself is {@link useAccountEnrolment}; this
 * renders its outputs, so it can sit inside `LoginModal` without the modal
 * knowing anything about device keys or wallets.
 *
 * The copy is `ConnectButtonAccount`'s, unchanged.
 */

import { useMemo } from 'react';
import { cssVar, resolveMeroTheme, type MeroTheme } from '../theme';

export interface AccountSignInPanelProps {
  /** Start enrolment — normally `useAccountEnrolment().goToWallet`. */
  onEnrol: () => void;
  /** What the last enrolment had to say (an error, or "nowhere to write yet"). */
  note?: string | null;
  /** The wallet enrolment goes to. Shown only when `customWallet`. */
  walletUrl?: string;
  /** Whether `walletUrl` is an override rather than the hosted wallet. */
  customWallet?: boolean;
  /** Theme overrides — accepts any subset of `MeroTheme` tokens */
  theme?: MeroTheme;
}

export function AccountSignInPanel({
  onEnrol,
  note,
  walletUrl,
  customWallet = false,
  theme,
}: AccountSignInPanelProps) {
  // Same tokens as LoginModal: `var(--mero-*, fallback)`, so the panel follows
  // the modal's inline variables and any global `:root` overrides.
  const styles = useMemo(() => {
    const t = resolveMeroTheme(theme);
    const radius = cssVar(t, 'radius');
    const error = cssVar(t, 'error');
    return {
      root: { display: 'flex', flexDirection: 'column' as const, gap: '1rem' },
      info: {
        color: cssVar(t, 'textSecondary'),
        textAlign: 'center' as const,
        fontSize: '0.875rem',
        margin: 0,
      },
      hint: {
        color: cssVar(t, 'textSecondary'),
        textAlign: 'center' as const,
        fontSize: '0.8125rem',
        margin: 0,
        opacity: 0.8,
        wordBreak: 'break-all' as const,
      },
      note: {
        color: error,
        backgroundColor: `color-mix(in srgb, ${error} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${error} 30%, transparent)`,
        borderRadius: radius,
        padding: '0.75rem',
        fontSize: '0.875rem',
        textAlign: 'center' as const,
        margin: 0,
      },
      buttonGroup: { display: 'flex', justifyContent: 'center' },
      button: {
        padding: '0.75rem 2rem',
        borderRadius: radius,
        border: 'none',
        fontSize: '0.875rem',
        fontWeight: 600,
        cursor: 'pointer',
        backgroundColor: cssVar(t, 'primary'),
        color: cssVar(t, 'primaryText'),
        transition: 'all 0.15s ease',
      },
    };
  }, [theme]);

  return (
    <div style={styles.root} data-testid="account-sign-in-panel">
      {note && (
        <p style={styles.note} role="status" data-testid="account-note">
          {note}
        </p>
      )}
      <p style={styles.info}>
        You will approve a device key on the wallet&apos;s own page, then come
        back here. The relay never sees your account root — only the
        certificate it signed.
      </p>
      <p style={styles.info}>
        That one certificate is all of it: finding the relay that serves your
        account, writing through it, reading your own contexts and namespaces,
        and live events. Nothing to paste in.
      </p>
      <div style={styles.buttonGroup}>
        <button
          type="button"
          style={styles.button}
          onClick={onEnrol}
          data-testid="enrol-button"
        >
          Enrol with your account
        </button>
      </div>
      {customWallet && walletUrl && (
        /* Shown only when an app overrode it, so a local rig can see at a
           glance that it is not enrolling against the hosted wallet. */
        <p style={styles.hint}>
          Enrolling at <code>{walletUrl}</code>, not the hosted wallet.
        </p>
      )}
    </div>
  );
}

export default AccountSignInPanel;
