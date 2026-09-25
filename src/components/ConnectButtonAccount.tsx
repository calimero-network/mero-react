/**
 * ConnectButtonAccount — ConnectButton, plus a second way in.
 *
 * A copy of {@link ConnectButton} rather than a change to it, deliberately:
 * the node-login path is load-bearing for every shipped app, and this is an
 * experiment. `ConnectButton` and `LoginModal` are untouched.
 *
 * Two ways to connect, and the difference is who runs the node:
 *
 * - **I run a node** — exactly today's behaviour. `LoginModal` discovers nodes
 *   or takes a URL, and `connectToNode` redirects into the node's auth flow.
 * - **I have an account** — no node. A wallet on another origin certifies this
 *   tab's device key, and a relay writes on the account's behalf under warrants
 *   signed here.
 *
 * ## One credential, two signatures over it
 *
 * The certificate the wallet mints is the whole of what this holds. The device
 * key it certifies signs two different things, and neither needs anything more:
 *
 * - a **warrant**, per intent, is what `rpc.execute` sends — an app's own logic,
 *   including a generated ABI client, runs on this alone;
 * - a **request proof** (`X-Calimero-Proof`), per request, authenticates the
 *   caller-scoped reads and the event stream. The node verifies the signature
 *   against the certificate with no store read and no prior relationship, so
 *   `getContexts` and `listNamespaces` answer this account's own and `/sse`
 *   delivers this account's contexts.
 *
 * ## The pane asks for nothing
 *
 * It used to have three fields, and not one of them was a question an end user
 * could answer. All three are gone:
 *
 * - the **relay** is discovered. The same certificate proves the cloud's
 *   account→relay lookup (`CloudClient.getAccountRelays`): the device signs an
 *   account-bound nonce and the cloud names the relays. No cloud session, no
 *   Google sign-in, no account root.
 * - the **wallet** is a platform constant, defaulted here, overridable only for
 *   working on the wallet itself.
 * - the **context** is chosen after connecting, not before. `MeroContext` derives
 *   this tab's `applicationId` from `admin.getContexts()` — caller-scoped by the
 *   request proof — so an app's own context picker has what it needs and the
 *   person picks from a list instead of pasting a 64-hex id.
 *
 * So the account path is one button.
 *
 * This pane used to ask for the relay node's signing key as well, to mint an
 * `account_proof` session with `login()`. Nothing needs it: the proof path was
 * measured serving the same reads and the same events without it, against a node
 * built from core `aecba573b`. A session remains the right shape where the device
 * key sits behind a boundary worth crossing once — a hardware key — which is not
 * this.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudClient,
  completeDeviceEnrolment,
  deviceEnrolmentUrl,
  readEnrolmentCallback,
  type CloudAccountRelay,
  type DeviceEnrolmentCallback,
} from '@calimero-network/mero-js';
import { useMero } from '../context';
import { LoginModal } from './LoginModal';
import { CalimeroLogo } from './CalimeroLogo';
import { resolveMeroTheme, themeToCssVars, type MeroTheme } from '../theme';

/** Where this tab's device keypair lives. */
const DEVICE_KEY = 'calimero.device';

/**
 * The hosted wallet, which is a property of the platform rather than of any app.
 *
 * A default here and not a required prop: every app that enrols an account
 * enrols it at the same wallet, so making each one name it would be asking a
 * question with one answer — and an app that got it wrong would send a device key
 * to the wrong origin.
 */
const HOSTED_WALLET = 'https://wallet.cloud.calimero.network/account-enroll';

export interface ConnectButtonAccountProps {
  className?: string;
  style?: React.CSSProperties;
  theme?: MeroTheme;
  /**
   * Overrides for local development. An app in production passes none of this,
   * and the pane asks the person for nothing at all.
   *
   * Nothing here is a value an end user could know, which is precisely why none
   * of it is a form field any more:
   *
   * - the **relay** is discovered — the certificate the enrolment returns proves
   *   the cloud's account→relay lookup, so there is nothing to type and a prefill
   *   would only be a staler second source of truth;
   * - the **context** is chosen after connecting, from the account's own contexts,
   *   which `admin.getContexts()` answers caller-scoped through the request proof.
   */
  defaults?: {
    /**
     * Point enrolment at a wallet other than the hosted one.
     *
     * Exists for working ON the wallet: a wallet served from `localhost:8090`
     * cannot be reached through the hosted URL, and without this the only way to
     * test a wallet change would be to deploy it.
     */
    walletUrl?: string;
  };
}

const hex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Which of the account's relays to talk to, and whether to say anything about it.
 *
 * Three outcomes, kept apart because they need three different things from the
 * caller and collapsing them into "no relay" would hide the one that is
 * actionable:
 *
 * - a **fresh** relay with an address: use it, say nothing;
 * - only **stale** ones: use one anyway — the cloud reports `fresh` from a
 *   heartbeat, and a heartbeat that lapsed a minute ago is not the same claim as
 *   a node that is gone — but say so, because if the writes then fail this is
 *   why;
 * - **nothing usable**: no rows at all, or rows whose `relayUrl` is null. Either
 *   way there is nowhere to send an intent, and no typed value substitutes for
 *   one, so the connection is not made.
 */
function chooseRelay(
  relays: readonly CloudAccountRelay[],
): { relayUrl: string; stale: boolean } | { relayUrl: null; reason: string } {
  const reachable = relays.filter(
    (r): r is CloudAccountRelay & { relayUrl: string } => typeof r.relayUrl === 'string' && r.relayUrl.length > 0,
  );
  const fresh = reachable.find((r) => r.fresh);
  if (fresh) return { relayUrl: fresh.relayUrl, stale: false };
  if (reachable.length > 0) return { relayUrl: reachable[0].relayUrl, stale: true };
  if (relays.length > 0) {
    // Rows exist, so the account HAS relays assigned; the cloud just has no
    // address for any of them. A different problem from having none, and worth
    // naming separately — it is the shape a node reports before its first
    // heartbeat lands.
    return {
      relayUrl: null,
      reason:
        `Your account has ${relays.length} relay${relays.length === 1 ? '' : 's'} assigned, but the ` +
        'cloud knows no address for any of them yet. Nothing to connect to — try again shortly.',
    };
  }
  return {
    relayUrl: null,
    reason:
      'Your account has no relay assigned yet, so there is nowhere to write through. ' +
      'That is a plan or provisioning matter on the cloud side, not something to fix here.',
  };
}

interface DeviceKeys {
  /** Ed25519 public key — what the certificate names, and what signs. */
  signPk: string;
  /** Ed25519 secret, hex seed. Signs warrants and the login statement. */
  signSk: string;
  /** X25519 public key — where wrapped scope keys are delivered. */
  kemPk: string;
  /** X25519 secret. Without it, anything delivered to `kemPk` is unreadable. */
  kemSk: string;
}

/**
 * This tab's device keys, generated once.
 *
 * TWO keypairs, for two jobs the `DeviceCert` names separately: an Ed25519 pair
 * that signs, and an X25519 pair that receives. Both halves of both are kept —
 * a public key certified without its private half is a key nothing can ever use.
 *
 * In `localStorage`, not session: they have to survive the redirect to the
 * wallet and back. A key regenerated on the way home would not match the
 * certificate the wallet just minted, and `completeDeviceEnrolment` would
 * rightly refuse it.
 */
async function deviceKeys(): Promise<DeviceKeys> {
  const had = localStorage.getItem(DEVICE_KEY);
  if (had) {
    const parsed = JSON.parse(had) as Partial<DeviceKeys>;
    // Keys minted before the agreement pair was real carry 32 random bytes as
    // `kemPk` and no `kemSk`. They cannot receive a wrapped scope key, ever, so
    // they are discarded rather than carried forward — the cost is re-enrolling
    // this device, which is cheap; the cost of keeping them is a delivery that
    // silently cannot be decrypted.
    if (parsed.kemSk && parsed.signSk && parsed.signPk && parsed.kemPk) {
      return parsed as DeviceKeys;
    }
    localStorage.removeItem(DEVICE_KEY);
  }

  const sign = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  let agree: CryptoKeyPair;
  try {
    agree = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
  } catch {
    // Better to refuse than to certify a delivery key with no private half:
    // enrolment would appear to succeed and the failure would surface much
    // later, as an undecryptable scope key.
    throw new Error(
      'this browser cannot generate an X25519 key, so it cannot receive wrapped ' +
        'scope keys. Chrome 133+ and Safari 17+ support it; enrolling without one ' +
        'would certify a delivery key nothing holds the secret for.',
    );
  }

  // pkcs8 wraps the 32-byte seed behind a 16-byte header, for both curves.
  const keys: DeviceKeys = {
    signPk: hex(await crypto.subtle.exportKey('raw', sign.publicKey)),
    signSk: hex((await crypto.subtle.exportKey('pkcs8', sign.privateKey)).slice(16)),
    kemPk: hex(await crypto.subtle.exportKey('raw', agree.publicKey)),
    kemSk: hex((await crypto.subtle.exportKey('pkcs8', agree.privateKey)).slice(16)),
  };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(keys));
  return keys;
}

export function ConnectButtonAccount({
  className,
  style,
  theme,
  defaults = {},
}: ConnectButtonAccountProps) {
  const { isAuthenticated, isOnline, nodeUrl, isDelegated, connectToNode, connectWithAccount, logout } =
    useMero();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isNodeModalOpen, setIsNodeModalOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const walletUrl = defaults.walletUrl ?? HOSTED_WALLET;

  const resolvedTheme = useMemo(() => (theme ? resolveMeroTheme(theme) : null), [theme]);
  const themeVars = useMemo(
    () => (resolvedTheme ? themeToCssVars(resolvedTheme) : undefined),
    [resolvedTheme],
  );

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  /**
   * Read the enrolment callback ONCE, during render.
   *
   * `readEnrolmentCallback` consumes the fragment — it strips it from the
   * address bar so a reload cannot replay the credential. That makes it unsafe
   * to call from an effect: React's StrictMode double-invokes effects in dev,
   * so the first run would swallow the credential and then abort through its
   * own cleanup, and the second would find nothing and silently show the
   * connect prompt again. `MeroContext` reads its auth callback this way for
   * the same reason.
   *
   * The throw case (`error=cancelled`) is captured rather than propagated: a
   * declined approval is an ordinary outcome to report, not a render failure.
   */
  const callbackRef = useRef<DeviceEnrolmentCallback | null | undefined>(undefined);
  const callbackErrorRef = useRef<string | null>(null);
  if (callbackRef.current === undefined && typeof window !== 'undefined') {
    try {
      callbackRef.current = readEnrolmentCallback();
    } catch (e) {
      callbackRef.current = null;
      callbackErrorRef.current = e instanceof Error ? e.message : String(e);
    }
  }
  /** One completion per callback, however many times the effect runs. */
  const completingRef = useRef(false);

  /**
   * Finish an enrolment we are returning from.
   *
   * Runs before the button paints anything, so a tab coming back from the
   * wallet lands connected rather than showing the connect prompt again.
   */
  useEffect(() => {
    if (callbackErrorRef.current) {
      setNote(callbackErrorRef.current);
      callbackErrorRef.current = null;
      return;
    }
    const back = callbackRef.current;
    if (!back || completingRef.current) return;
    completingRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const keys = await deviceKeys();

        // Nothing is carried across the redirect any more beyond the device keys
        // themselves. There used to be a `sessionStorage` record holding the
        // typed relay and context; both are now answered by the credential this
        // returns, so the record held nothing and the "they were lost, try
        // again" failure it guarded cannot happen.
        const enrolled = await completeDeviceEnrolment({
          ...back,
          devicePublicKey: keys.signPk,
          kemPublicKey: keys.kemPk,
          expectState: back.state,
        });

        /*
         * Where to write: asked, not typed.
         *
         * The certificate that just came back is the only input this needs. The
         * cloud mints an account-bound nonce, the device key signs it, and the
         * relay list comes back attributed to this account — no cloud session,
         * no Google sign-in, no account root. Which is why this can run here, on
         * the way home from the wallet, for a person who has none of those.
         *
         * `CloudClient`'s default base URL is the prod manager
         * (`manager.cloud.calimero.network`), which is the right default for a
         * hosted account and the only deployment that answers this route today.
         */
        const cloud = new CloudClient({
          routingCredential: {
            credential: enrolled.credential,
            deviceSecret: keys.signSk,
          },
        });
        const chosen = chooseRelay(await cloud.getAccountRelays(enrolled.account));
        if (chosen.relayUrl === null) {
          // Not connected, rather than connected to a typed guess. A relay URL
          // that nothing assigned is a node that will refuse every warrant, and
          // a half-connected session fails later and further away.
          setNote(chosen.reason);
          return;
        }
        if (chosen.stale) {
          setNote(
            'Connected through a relay whose last heartbeat has lapsed — it may not answer. ' +
              'It was the only one with an address.',
          );
        }

        // Nothing else to obtain. The certificate this enrolment just returned
        // authenticates the reads and the event stream as well as the writes —
        // the device key signs each request and the node verifies it against the
        // certificate. There used to be a `login()` here, minting a session
        // against the relay node's signing key; that key had to be learned out of
        // band and the hosted case has never published one, so the picker was
        // dark on exactly the deployment it was written for.

        // Deliberately NOT gated on `cancelled`: the fragment has already been
        // consumed, so abandoning here would strand a credential that cannot be
        // read again. The context outlives this component, so installing the
        // connection after a StrictMode teardown is correct.
        connectWithAccount({
          relayUrl: chosen.relayUrl,
          account: enrolled.account,
          credential: enrolled.credential,
          deviceSecret: keys.signSk,
        });
      } catch (e) {
        if (!cancelled) setNote(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectWithAccount]);

  const goToWallet = useCallback(async () => {
    // No inputs to validate: there is nothing left to ask for.
    const keys = await deviceKeys();
    const state = hex(crypto.getRandomValues(new Uint8Array(16)));
    window.location.assign(
      deviceEnrolmentUrl({
        walletUrl,
        devicePublicKey: keys.signPk,
        kemPublicKey: keys.kemPk,
        returnTo: window.location.origin + window.location.pathname,
        state,
      }),
    );
  }, [walletUrl]);

  if (isAuthenticated && !isOnline) {
    return (
      <div className="mero-connect-container" style={{ ...themeVars, display: 'inline-block' }}>
        <button
          className={['mero-connect-button', 'mero-reconnecting', className].filter(Boolean).join(' ')}
          style={style}
          disabled
          aria-label="Reconnecting..."
        >
          <CalimeroLogo size={18} className="mero-logo" />
          Reconnecting...
        </button>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div
        ref={dropdownRef}
        className="mero-connect-container"
        style={{ ...themeVars, position: 'relative', display: 'inline-block' }}
      >
        <button
          className={['mero-connect-button', 'mero-connected', className].filter(Boolean).join(' ')}
          style={style}
          onClick={() => setIsDropdownOpen((p) => !p)}
          aria-label="Connected"
        >
          <CalimeroLogo size={18} className="mero-logo" />
          {isDelegated ? 'Connected (account)' : 'Connected'}
        </button>
        {isDropdownOpen && (
          <div className="mero-dropdown">
            <div className="mero-dropdown-info" title={nodeUrl || ''}>
              {nodeUrl}
            </div>
            {/* No dashboard link on the delegated path: the admin dashboard is
                a node-operator surface, and a keyholder has no credential for
                it. Offering a link that 401s would be worse than omitting it. */}
            {!isDelegated && nodeUrl && (
              <a
                href={new URL('admin-dashboard/', nodeUrl).toString()}
                target="_blank"
                rel="noopener noreferrer"
                className="mero-dropdown-item"
              >
                Dashboard
              </a>
            )}
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

  return (
    <div className="mero-connect-container" style={{ ...themeVars, display: 'inline-block' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className={['mero-connect-button', className].filter(Boolean).join(' ')}
          style={style}
          onClick={() => setIsNodeModalOpen(true)}
        >
          <CalimeroLogo size={18} className="mero-logo" />
          I run a node
        </button>
        <button
          className={['mero-connect-button', className].filter(Boolean).join(' ')}
          style={style}
          onClick={() => setIsAccountOpen((p) => !p)}
        >
          I have an account
        </button>
      </div>

      {isAccountOpen && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            border: '1px solid rgba(127,127,127,.35)',
            borderRadius: 8,
            display: 'grid',
            gap: 8,
            maxWidth: 520,
            textAlign: 'left',
            font: '13px system-ui, sans-serif',
          }}
        >
          {/* No form fields. Every one this pane used to have asked for
              something only an operator could know, and all three are now
              answered by the certificate: the wallet is the platform's, the relay
              is looked up, and the context is chosen afterwards from the
              account's own. What is left is a button and an explanation of what
              pressing it does. */}
          <button className="mero-connect-button" onClick={goToWallet}>
            Enrol with your account
          </button>
          <p style={{ margin: 0, opacity: 0.75 }}>
            You will approve a device key on the wallet&apos;s own page, then come
            back here. The relay never sees your account root — only the
            certificate it signed.
          </p>
          <p style={{ margin: 0, opacity: 0.75 }}>
            That one certificate is all of it: finding the relay that serves your
            account, writing through it, reading your own contexts and namespaces,
            and live events. Nothing to paste in.
          </p>
          {defaults.walletUrl && (
            /* Shown only when an app overrode it, so a local rig can see at a
               glance that it is not enrolling against the hosted wallet. */
            <p style={{ margin: 0, opacity: 0.6 }}>
              Enrolling at <code>{walletUrl}</code>, not the hosted wallet.
            </p>
          )}
        </div>
      )}

      {note && (
        <p style={{ font: '13px system-ui, sans-serif', color: '#b3261e' }}>{note}</p>
      )}

      <LoginModal
        isOpen={isNodeModalOpen}
        onConnect={(url) => {
          setIsNodeModalOpen(false);
          connectToNode(url);
        }}
        onClose={() => setIsNodeModalOpen(false)}
        theme={resolvedTheme ?? theme}
      />
    </div>
  );
}

export default ConnectButtonAccount;
