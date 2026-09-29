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
import {
  createMeroClient,
  defaultAudience,
  login,
  type MeroClient,
} from '@calimero-network/mero-js';

/** Where the per-tab record lives. */
const KEY = 'calimero.delegated.connection';
/**
 * Where the enrolled credential lives when there is no relay for it yet.
 *
 * Separate from {@link KEY}, and deliberately not "a connection with a null
 * relay": a record under that key means a usable client can be built from it,
 * and every reader relies on that. An account that has just enrolled is a
 * member of nothing, so the cloud names no relay for it and there is nothing to
 * build — but the certificate is real and must survive, or the only way to
 * bootstrap from an invitation would be to enrol again.
 */
const CREDENTIAL_KEY = 'calimero.delegated.credential';

/**
 * What a delegated connection needs to be rebuilt after a reload.
 *
 * `deviceSecret` is here because the device key is what signs warrants, and a
 * reload that could not sign would be a dead session. It is a per-tab secret for
 * a certificate the account can revoke — not the account root, which never
 * leaves the wallet's origin.
 */
/**
 * What the wallet certified: an account, a device it trusts, and the key that
 * device signs with. Everything except somewhere to send the result.
 *
 * Split out of {@link DelegatedSession} because it is reachable one step
 * earlier. An account that has just enrolled holds exactly this and no relay —
 * it is a member of nothing, so the cloud has no relay to name — and this is the
 * input that resolves one from an invitation instead.
 */
export interface DelegatedCredential {
  /** The author's account id, hex. */
  account: string;
  /** The author's `AccountProof<DeviceCert>`, hex borsh. */
  credential: string;
  /** The certified device's ed25519 signing secret, hex. */
  deviceSecret: string;
}

export interface DelegatedSession extends DelegatedCredential {
  /**
   * The relay to write through — a node origin, or `null` for none yet.
   *
   * **`null` is a logged-in state, not a broken one.** A brand-new account is a
   * member of nothing, so the cloud names no relay for it — and that is the
   * normal condition of an account that has just been created, because being
   * signed in is how you come to be invited in the first place. Refusing to
   * connect without a relay locked a new account out of the only path that
   * would earn it one.
   *
   * What it does NOT mean is that writes quietly do nothing. There is no
   * client at all without a URL ({@link buildDelegatedClient} returns `null`),
   * so `mero` stays `null`, the session is authenticated, and anything reaching
   * for `rpc.execute` is told the relay is missing. A placeholder URL would be
   * the one unacceptable answer: it would look connected and refuse every
   * warrant.
   */
  relayUrl: string | null;
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
 * The enrolled credential, whether or not a relay was ever found for it.
 *
 * A connected session is authoritative: it carries the same three fields and a
 * relay, so it is read first and the standalone record is the fallback. Without
 * that order a stale record from an earlier enrolment could out-rank the account
 * actually connected.
 */
export function readDelegatedCredential(): DelegatedCredential | null {
  const session = readDelegatedSession();
  if (session) {
    const { account, credential, deviceSecret } = session;
    return { account, credential, deviceSecret };
  }
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CREDENTIAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DelegatedCredential>;
    // A half-written record is worse than none: it would be carried into a
    // signing call and fail as a malformed credential, somewhere that cannot say
    // where the bad value came from.
    if (!parsed.account || !parsed.credential || !parsed.deviceSecret) return null;
    return parsed as DelegatedCredential;
  } catch {
    return null;
  }
}

export function saveDelegatedCredential(c: DelegatedCredential): void {
  try {
    sessionStorage.setItem(CREDENTIAL_KEY, JSON.stringify(c));
  } catch {
    /* this page view still holds it; it just will not survive a reload */
  }
}

export function clearDelegatedCredential(): void {
  try {
    sessionStorage.removeItem(CREDENTIAL_KEY);
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

const RELAY_NODE_KEY_PREFIX = 'calimero.delegated.relay-node-key.';

function relayOrigin(relayUrl: string): string {
  return relayUrl.replace(/\/+$/, '');
}

/**
 * Pin a relay's device signing key, hex (32 bytes), learned out of band.
 *
 * `login()` binds the session to this key, and it must never be read from the
 * relay being logged in to — the answering party would choose what the device
 * signs about. Until the cloud publishes it (mdma#312), it comes from the
 * relay's operator.
 */
export function pinRelayNodeKey(relayUrl: string, nodeKey: string): void {
  localStorage.setItem(RELAY_NODE_KEY_PREFIX + relayOrigin(relayUrl), nodeKey.trim().toLowerCase());
}

/** The pinned key for a relay, or `null` if none was pinned. */
export function readPinnedRelayNodeKey(relayUrl: string): string | null {
  try {
    const v = localStorage.getItem(RELAY_NODE_KEY_PREFIX + relayOrigin(relayUrl));
    return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Milliseconds-since-epoch a JWT expires at, or `null` if unreadable. */
function jwtExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * A lazily minted `account_proof` session on the relay.
 *
 * A hosted relay's `/admin-api/` sits behind the node's forward-auth, which
 * knows no request proof — it answers a Bearer token or 401. Logging in with
 * the device certificate is how a keyholder gets that token. Minted on first
 * use and re-minted once it has expired. On failure it yields `undefined`, the
 * admin request then goes out unauthenticated and the node's 401 is what the
 * caller sees; the next call tries to log in again.
 */
function relaySession(s: DelegatedSession & { relayUrl: string }, nodeKey: string) {
  let token: string | null = null;
  let inflight: Promise<string | undefined> | null = null;
  return async (): Promise<string | undefined> => {
    const exp = token ? jwtExpiryMs(token) : null;
    if (token && (exp === null || exp - Date.now() > 30_000)) return token;
    if (!inflight) {
      inflight = login({
        nodeUrl: s.relayUrl,
        node: nodeKey,
        deviceSecret: s.deviceSecret,
        accountProof: s.credential,
        audience: defaultAudience(),
      })
        .then((minted) => {
          token = minted.accessToken;
          return token;
        })
        .catch((e: unknown) => {
          console.warn('[mero-react] relay login failed', e);
          token = null;
          return undefined;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
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
): MeroClient | null {
  // No relay, no client — and deliberately no placeholder either.
  //
  // A relay-transport client IS a URL plus a credential; with no URL there is
  // nothing to post an intent to. `null` propagates as "not connected for
  // writing" while the session stays authenticated, which is the honest shape
  // for a brand-new account: it exists, it has a certificate, and it has not
  // been invited anywhere yet. A stand-in URL would make every write fail as a
  // refused warrant against a node that was never chosen.
  if (!s.relayUrl) return null;
  const nodeKey = readPinnedRelayNodeKey(s.relayUrl);
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
    // A session, when this relay's node key is pinned. A hosted relay's
    // forward-auth accepts a Bearer token and not the proof above, so without
    // one every admin read there is a 401. Given a session the client uses it
    // for every admin call; a relay with no pinned key keeps the proof path.
    session: nodeKey ? relaySession({ ...s, relayUrl: s.relayUrl }, nodeKey) : undefined,
    // Events too. `/sse` on a relay sits behind the same forward-auth, so the
    // proof above gets a 401 there; with the node key the client observes
    // through its own device-certificate login instead.
    observe: nodeKey ? { nodeKey } : undefined,
  });
}
