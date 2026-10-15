/**
 * useAccountEnrolment — the account sign-in flow, with no UI.
 *
 * Moved out of {@link ConnectButtonAccount} unchanged, so that `ConnectButton`'s
 * Cloud tab and `ConnectButtonAccount` share one copy of it: the device keys,
 * the redirect to the wallet, and the completion when the tab comes back.
 *
 * - `goToWallet` has mero-js generate a fresh, unexportable device key pair
 *   under a new state, and leaves for the wallet.
 * - On the way back, the callback is read ONCE during render, mero-js completes
 *   it against the key pair its state names, the account's relays are looked
 *   up, and `connectWithAccount` connects.
 * - `note` is what the person should be told about that — an error, or a
 *   connection with nowhere to write yet.
 * - `returning` is true when this page load carries an enrolment callback,
 *   success or error, so a caller can show the place the note appears.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beginDeviceEnrolment,
  CloudClient,
  completeDeviceEnrolment,
  deviceEnrolmentUrl,
  readEnrolmentCallback,
  type CloudAccountRelay,
  type DeviceEnrolmentCallback,
} from '@calimero-network/mero-js';
import { useMero } from '../context';

/**
 * The hosted wallet, which is a property of the platform rather than of any app.
 *
 * A default here and not a required prop: every app that enrols an account
 * enrols it at the same wallet, so making each one name it would be asking a
 * question with one answer — and an app that got it wrong would send a device key
 * to the wrong origin.
 */
const HOSTED_WALLET = 'https://wallet.cloud.calimero.network/account-enroll';

/**
 * The relay's own account, as the cloud names it beside the relay — the
 * executor a founding warrant must name.
 *
 * It is what lets a brand-new account found a namespace on the relay the cloud
 * just assigned it, with nothing typed in: a namespace that does not exist yet
 * cannot be asked who its relay is, and the account is a member of nothing that
 * could tell it. A server that does not name one (older ones omit the field)
 * leaves it `null`, and founding falls back to learning it from a namespace the
 * account is already in, as before.
 *
 * Read defensively, so this builds against a mero-js whose `CloudAccountRelay`
 * does not declare the field yet; mero-js already drops anything that is not
 * 64 lowercase hex, and this re-checks it rather than trusting the type.
 */
function executorOf(relay: CloudAccountRelay): string | null {
  const value = (relay as { executorAccount?: unknown }).executorAccount;
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

/**
 * Which of the account's relays to talk to, and what to say about it.
 *
 * Four outcomes, and the connection is made in ALL of them — what differs is
 * whether there is somewhere to write yet, and what the person is told:
 *
 * - a **fresh** relay with an address: use it, say nothing;
 * - only **stale** ones: use one anyway — the cloud reports `fresh` from a
 *   heartbeat, and a heartbeat that lapsed a minute ago is not the same claim as
 *   a node that is gone — but say so, because if the writes then fail this is
 *   why;
 * - **rows with no address**: relays are assigned and the cloud has no URL for
 *   any of them yet, which is the shape a node reports before its first
 *   heartbeat lands. A wait.
 * - **no rows at all**: the normal state of a brand-new account. It is a member
 *   of nothing, so nothing serves it.
 *
 * ## Why the last two connect instead of refusing
 *
 * This used to return "not connected" for both, and that was wrong in the case
 * it mattered most: you get invited *because* you are signed in, and accepting
 * an invitation is what earns a relay. Refusing to log the account in until it
 * had one locked a new account out of the only path that would give it one.
 *
 * Nothing is faked to achieve it. The session carries `relayUrl: null`, so no
 * client is built, `mero` stays `null`, and a write is told the relay is
 * missing rather than being sent to a guess.
 *
 * A current cloud assigns a relay to an account that has none on this very
 * read, so "no rows at all" is now mostly an older server's answer. The chosen
 * relay's `executorAccount` comes back with it, so the session can found a
 * namespace there straight away.
 */
function chooseRelay(relays: readonly CloudAccountRelay[]): {
  relayUrl: string | null;
  executorAccount: string | null;
  note: string | null;
} {
  const reachable = relays.filter(
    (r): r is CloudAccountRelay & { relayUrl: string } => typeof r.relayUrl === 'string' && r.relayUrl.length > 0,
  );
  const fresh = reachable.find((r) => r.fresh);
  if (fresh) return { relayUrl: fresh.relayUrl, executorAccount: executorOf(fresh), note: null };
  if (reachable.length > 0) {
    return {
      relayUrl: reachable[0].relayUrl,
      executorAccount: executorOf(reachable[0]),
      note:
        'Connected through a relay whose last heartbeat has lapsed — it may not answer. It was ' +
        'the only one with an address.',
    };
  }
  if (relays.length > 0) {
    return {
      relayUrl: null,
      executorAccount: null,
      note:
        `Signed in. Your account has ${relays.length} relay${relays.length === 1 ? '' : 's'} ` +
        'assigned, but the cloud knows no address for any of them yet, so there is nowhere to ' +
        'write through for the moment. Reads and writes resume as soon as one reports in.',
    };
  }
  return {
    relayUrl: null,
    executorAccount: null,
    note:
      'Signed in, with nowhere to write yet: a new account is a member of nothing, so no node ' +
      'serves it. Redeeming an invitation admits this account to a namespace and gives it a ' +
      'relay — that is the normal first step, not an error.',
  };
}

/**
 * Whether this page load is the one coming back from the wallet — a completed
 * enrolment or a declined one — WITHOUT consuming it.
 *
 * `useAccountEnrolment` reads the callback once and strips it from the address
 * bar, so a second reader finds nothing. That makes `returning` from the hook
 * unusable for the one decision that has to be taken before the hook runs: a
 * component that owns `LoginModal`'s `isOpen` and wants the dialog open on the
 * way back. This is the answer for it, as a `useState` initialiser:
 *
 * ```tsx
 * const [open, setOpen] = useState(isReturningFromWallet);
 * <LoginModal isOpen={open} ... />  // sources its own Cloud tab, lands on it
 * ```
 *
 * The parent's initialiser runs before the modal's hook reads the fragment, so
 * the two agree. `ConnectButton` needs none of this: it owns both.
 */
export function isReturningFromWallet(
  location: { hash: string } | undefined = typeof window === 'undefined' ? undefined : window.location,
): boolean {
  if (!location) return false;
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (params.get('error')) return true;
  return Boolean(params.get('credential') && params.get('account') && params.get('device'));
}

export interface UseAccountEnrolmentOptions {
  /**
   * Point enrolment at a wallet other than the hosted one.
   *
   * Exists for working ON the wallet: a wallet served from `localhost:8090`
   * cannot be reached through the hosted URL, and without this the only way to
   * test a wallet change would be to deploy it.
   */
  walletUrl?: string;
  /**
   * When false, the hook reads no callback and completes nothing, so a
   * component that has the account path switched off leaves the fragment for
   * whichever component does handle it. Default true.
   */
  enabled?: boolean;
}

export interface AccountEnrolment {
  /** Leave for the wallet to enrol a new device key for this browser. */
  goToWallet: () => Promise<void>;
  /** What to tell the person about the last enrolment, or null. */
  note: string | null;
  /** Whether this page load carries an enrolment callback (success or error). */
  returning: boolean;
  /** The wallet enrolment goes to: the override, else the hosted one. */
  walletUrl: string;
  /** Whether `walletUrl` is an override rather than the hosted wallet. */
  customWallet: boolean;
}

export function useAccountEnrolment({
  walletUrl: walletOverride,
  enabled = true,
}: UseAccountEnrolmentOptions = {}): AccountEnrolment {
  const { connectWithAccount, cloudBaseUrl } = useMero();
  const [note, setNote] = useState<string | null>(null);

  const walletUrl = walletOverride ?? HOSTED_WALLET;

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
  if (enabled && callbackRef.current === undefined && typeof window !== 'undefined') {
    try {
      callbackRef.current = readEnrolmentCallback();
    } catch (e) {
      callbackRef.current = null;
      callbackErrorRef.current = e instanceof Error ? e.message : String(e);
    }
  }
  /**
   * Whether this load came back from the wallet. Fixed at the first read: the
   * effect below clears the error ref once it has reported it.
   */
  const returningRef = useRef<boolean | null>(null);
  if (returningRef.current === null && callbackRef.current !== undefined) {
    returningRef.current = callbackRef.current !== null || callbackErrorRef.current !== null;
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
        // Refused unless the state names a key pair this browser generated,
        // which also covers a callback this tab never started.
        const enrolled = await completeDeviceEnrolment(back);

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
          cloudBaseUrl,
          routingCredential: {
            credential: enrolled.credential,
            signer: enrolled.signer,
          },
        });
        // A lookup that fails still connects: the device is certified either way,
        // and with no relay the session is signed in with nowhere to write.
        const chosen = await cloud.getAccountRelays(enrolled.account).then(chooseRelay, (e: unknown) => ({
          relayUrl: null,
          executorAccount: null,
          note: `Signed in, but the cloud could not say which relay serves this account: ${e instanceof Error ? e.message : String(e)}`,
        }));
        // Connected either way — see `chooseRelay`. A null relay is an
        // authenticated account with nowhere to write yet, and the note says
        // what changes that.
        if (chosen.note) setNote(chosen.note);

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
        // The relay's executor rides along when the cloud named one, so a
        // brand-new account can found a namespace on it with no join first.
        // Left off entirely otherwise, so an older server's session is the
        // same record it always was.
        connectWithAccount({
          relayUrl: chosen.relayUrl,
          account: enrolled.account,
          credential: enrolled.credential,
          signer: enrolled.signer,
          ...(chosen.executorAccount ? { executorAccount: chosen.executorAccount } : {}),
        });
      } catch (e) {
        if (!cancelled) setNote(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectWithAccount, cloudBaseUrl]);

  const goToWallet = useCallback(async () => {
    // A device key this browser cannot make (no X25519, blocked storage) is
    // reported in the note, where the person is looking.
    let begun;
    try {
      begun = await beginDeviceEnrolment();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      return;
    }
    window.location.assign(
      deviceEnrolmentUrl({
        walletUrl,
        returnTo: window.location.origin + window.location.pathname,
        ...begun,
      }),
    );
  }, [walletUrl]);

  return {
    goToWallet,
    note,
    returning: returningRef.current === true,
    walletUrl,
    customWallet: walletOverride !== undefined,
  };
}
