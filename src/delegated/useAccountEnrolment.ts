/**
 * useAccountEnrolment — the account sign-in flow, with no UI.
 *
 * Moved out of {@link ConnectButtonAccount} unchanged, so that `ConnectButton`'s
 * Cloud tab and `ConnectButtonAccount` share one copy of it: the device keys,
 * the redirect to the wallet, and the completion when the tab comes back.
 *
 * - `goToWallet` generates (or reuses) this tab's device keys, remembers a state
 *   parameter, and leaves for the wallet.
 * - On the way back, the callback is read ONCE during render, the state is
 *   checked against the one sent, the certificate is completed and saved, the
 *   account's relays are looked up, and `connectWithAccount` connects.
 * - `note` is what the person should be told about that — an error, or a
 *   connection with nowhere to write yet.
 * - `returning` is true when this page load carries an enrolment callback,
 *   success or error, so a caller can show the place the note appears.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloudClient,
  completeDeviceEnrolment,
  deviceEnrolmentUrl,
  readEnrolmentCallback,
  type CloudAccountRelay,
  type DeviceEnrolmentCallback,
} from '@calimero-network/mero-js';
import { useMero } from '../context';
import { saveDelegatedCredential } from './session';

/** Where this tab's device keypair lives. */
const DEVICE_KEY = 'calimero.device';
/** The state parameter this tab sent to the wallet, to check what comes back. */
const STATE_KEY = 'calimero.enrol.state';

/**
 * The hosted wallet, which is a property of the platform rather than of any app.
 *
 * A default here and not a required prop: every app that enrols an account
 * enrols it at the same wallet, so making each one name it would be asking a
 * question with one answer — and an app that got it wrong would send a device key
 * to the wrong origin.
 */
const HOSTED_WALLET = 'https://wallet.cloud.calimero.network/account-enroll';

const hex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

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
 */
function chooseRelay(relays: readonly CloudAccountRelay[]): {
  relayUrl: string | null;
  note: string | null;
} {
  const reachable = relays.filter(
    (r): r is CloudAccountRelay & { relayUrl: string } => typeof r.relayUrl === 'string' && r.relayUrl.length > 0,
  );
  const fresh = reachable.find((r) => r.fresh);
  if (fresh) return { relayUrl: fresh.relayUrl, note: null };
  if (reachable.length > 0) {
    return {
      relayUrl: reachable[0].relayUrl,
      note:
        'Connected through a relay whose last heartbeat has lapsed — it may not answer. It was ' +
        'the only one with an address.',
    };
  }
  if (relays.length > 0) {
    return {
      relayUrl: null,
      note:
        `Signed in. Your account has ${relays.length} relay${relays.length === 1 ? '' : 's'} ` +
        'assigned, but the cloud knows no address for any of them yet, so there is nowhere to ' +
        'write through for the moment. Reads and writes resume as soon as one reports in.',
    };
  }
  return {
    relayUrl: null,
    note:
      'Signed in, with nowhere to write yet: a new account is a member of nothing, so no node ' +
      'serves it. Redeeming an invitation admits this account to a namespace and gives it a ' +
      'relay — that is the normal first step, not an error.',
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
  /** Leave for the wallet to enrol this tab's device key. */
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
        const keys = await deviceKeys();

        // Nothing is carried across the redirect any more beyond the device keys
        // themselves. There used to be a `sessionStorage` record holding the
        // typed relay and context; both are now answered by the credential this
        // returns, so the record held nothing and the "they were lost, try
        // again" failure it guarded cannot happen.
        // The state we sent, not the one that came back. `expectState: back.state`
        // compared the returned value against itself and therefore always passed,
        // which left the parameter as decoration: any page able to drive this
        // origin's callback could have had a credential adopted here.
        const sent = (() => {
          try {
            return sessionStorage.getItem(STATE_KEY);
          } catch {
            return null;
          }
        })();
        try {
          sessionStorage.removeItem(STATE_KEY);
        } catch {
          /* single-use where storage allows it; the comparison below is the gate */
        }
        if (!sent) {
          // No record of having started this. Refused rather than adopted: this is
          // either a callback we did not initiate, or storage that lost the value
          // mid-flow, and neither justifies accepting a certificate.
          setNote(
            'This enrolment could not be verified as one this tab started, so it was not ' +
              'accepted. Start again from "Enrol with your account".',
          );
          return;
        }
        const enrolled = await completeDeviceEnrolment({
          ...back,
          devicePublicKey: keys.signPk,
          kemPublicKey: keys.kemPk,
          expectState: sent,
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
        // Saved BEFORE the relay lookup, and kept whatever that lookup answers.
        //
        // A first-time account is a member of nothing, so `getAccountRelays`
        // correctly answers `[]` and no connection is made below. That is not a
        // failed enrolment: the certificate is real, and it is the input that
        // resolves a relay from an INVITATION instead
        // (`useDelegatedBootstrap`). Discarding it here would make "no relay
        // yet" mean "enrol again", which mints a second device for an account
        // whose first one was fine.
        saveDelegatedCredential({
          account: enrolled.account,
          credential: enrolled.credential,
          deviceSecret: keys.signSk,
        });

        const cloud = new CloudClient({
          cloudBaseUrl,
          routingCredential: {
            credential: enrolled.credential,
            deviceSecret: keys.signSk,
          },
        });
        const chosen = chooseRelay(await cloud.getAccountRelays(enrolled.account));
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
  }, [connectWithAccount, cloudBaseUrl]);

  const goToWallet = useCallback(async () => {
    // No inputs to validate: there is nothing left to ask for.
    const keys = await deviceKeys();
    // Remembered before leaving, so what comes back can be checked against what
    // we sent. Without this the state parameter is decoration: comparing the
    // returned value to itself always passes, which is what it did here.
    const state = hex(crypto.getRandomValues(new Uint8Array(16)));
    try {
      sessionStorage.setItem(STATE_KEY, state);
    } catch {
      // Storage unavailable (private mode, blocked site data). The redirect
      // still works and the check below reports it as unverifiable rather than
      // silently passing.
    }
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

  return {
    goToWallet,
    note,
    returning: returningRef.current === true,
    walletUrl,
    customWallet: walletOverride !== undefined,
  };
}
