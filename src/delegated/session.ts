/**
 * The delegated half of connecting: an account, a certified device, and a relay
 * that writes on their behalf.
 *
 * Kept deliberately apart from the node-login path in `MeroContext`. That path
 * is a redirect flow with token adoption, single-use refresh tokens and node-URL
 * trust validation — none of which applies here, because there is no session
 * token at all. A delegated client authenticates every request from a warrant it
 * signs itself. Weaving the two together would put a token-rotation decision in
 * front of a flow that has no tokens.
 *
 * Per-tab on purpose. The record lives in `sessionStorage`, so two tabs can hold
 * two different connections — one a node you run, one a relay you do not — with
 * the same application code in both.
 */
import { createMeroClient, type MeroClient } from '@calimero-network/mero-js';

/** Where the per-tab record lives. */
const KEY = 'calimero.delegated.connection';

/**
 * What a delegated connection needs to be rebuilt after a reload.
 *
 * `deviceSecret` is here because the device key is what signs warrants, and a
 * reload that could not sign would be a dead session. It is a per-tab secret for
 * a certificate the account can revoke — not the account root, which never
 * leaves the wallet's origin.
 */
export interface DelegatedSession {
  /** The relay to write through — a node origin. */
  relayUrl: string;
  /**
   * No `contextId`, deliberately.
   *
   * Which context to talk to is a CHOICE, made after connecting and changeable
   * without reconnecting — a node routinely holds several and comparing two of
   * them is ordinary use. It lives where the node-login path already keeps it
   * (`setContextId` / `getContextId`), and `admin.getContexts()` on this very
   * client answers what the choices are, caller-scoped by the request proof. A
   * copy here would be a second source of truth that a context switch would
   * immediately make stale, and it would make connecting depend on a value
   * nobody could type.
   */
  /** The author's account id, hex. */
  account: string;
  /** The author's `AccountProof<DeviceCert>`, hex borsh. */
  credential: string;
  /** The certified device's ed25519 signing secret, hex. */
  deviceSecret: string;
}

export function readDelegatedSession(): DelegatedSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DelegatedSession) : null;
  } catch {
    // Private mode, blocked site data, or a half-written record. Treat all
    // three as "not connected" rather than throwing during render.
    return null;
  }
}

export function saveDelegatedSession(s: DelegatedSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Non-fatal: the client still works for this page view, it just will not
    // survive a reload. Better than refusing to connect.
  }
}

export function clearDelegatedSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

/**
 * A warrant nonce is spent on the node, so the counter must outlive the page.
 *
 * In `localStorage`, not session: a reload that restarted from zero would
 * replay a spent nonce and be refused. Keyed by relay and context because the
 * ledger the node keeps is per `(context, author device)`.
 *
 * This is the client-side half of core #4018. The node can answer "where does
 * my sequence stand" — `POST /contexts/{id}/warrant-nonce` with the caller's own
 * `authorProof` — but that route is mounted on the protected router, so a
 * delegated client on a relay cannot reach it. Until it moves, holding the
 * counter locally is the only option, and losing storage means burning refusals
 * until the counter catches up.
 */
function persistedNonces(relayUrl: string, contextId: string | null) {
  // `null` only before a context is chosen, when no intent can be presented
  // either — `rpc.execute` takes a context id, so nothing draws from this
  // ledger yet. Spelled out rather than left as `undefined` in the key, so a
  // later context's counter can never inherit whatever this one reached.
  const key = `calimero.nonce.${relayUrl}.${contextId ?? 'no-context'}`;
  return {
    next: async (): Promise<bigint> => {
      let n = 0n;
      try {
        n = BigInt(localStorage.getItem(key) ?? '0');
      } catch {
        n = 0n;
      }
      try {
        localStorage.setItem(key, String(n + 1n));
      } catch {
        /* unpersisted: this page view still advances in memory */
      }
      return n;
    },
  };
}

/**
 * Build the client a delegated session talks through.
 *
 * The result is a relay-transport `MeroClient`. Its `rpc.execute` takes the same
 * named arguments a node client's does, which is what lets a generated ABI
 * client — and every hook that only calls `execute` — work unchanged. What it
 * also has is `admin` and `events`, pointed at the relay and authenticated as
 * the account by the device certificate, so the caller-scoped reads answer this
 * account's own contexts and namespaces rather than the node's.
 */
export function buildDelegatedClient(
  s: DelegatedSession,
  contextId: string | null,
): MeroClient {
  return createMeroClient({
    transport: 'relay',
    relay: {
      relayUrl: s.relayUrl,
      authorAccount: s.account,
      authorProof: s.credential,
      deviceSecret: s.deviceSecret,
      // The active context, passed in rather than stored on the record: the
      // relay client holds ONE nonce source while `execute` takes a context per
      // call, so the ledger has to be re-keyed when the chosen context changes.
      nonces: persistedNonces(s.relayUrl, contextId),
    },
    // The certificate authenticates the requests too, not just the writes.
    //
    // This is the whole of what reads and events need: the device key signs each
    // request, and the node verifies it against the account's certificate with no
    // store read and no prior relationship. Measured against a node built from
    // core `aecba573b`: `listNamespaces` and `getContexts` answer `200` and are
    // caller-scoped, `/sse` answers `200`, and a real write arrives on the stream
    // as a `StateMutation` frame.
    //
    // What this replaces is a session minted by `login()` plus the relay node's
    // signing key learned out of band — two inputs, one of which the cloud does
    // not publish, for an answer the certificate already gives.
    proof: { credential: s.credential, deviceSecret: s.deviceSecret },
  });
}
