import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  MeroJs,
  LocalStorageTokenStore,
  parseAuthCallback,
  buildAuthLoginUrl,
  AuthRevokedError,
  HTTPError,
} from '@calimero-network/mero-js';
import { AppMode } from '../types';
import { CloudClient } from '@calimero-network/mero-js';
import type { AdminApiClient, AuthCallbackResult, MeroClient, TokenStore } from '@calimero-network/mero-js';
import { createNodeAdmin } from '../admin/node-admin';
import { createAccountAdmin } from '../delegated/account-admin';
import { joinAsAccount } from '../delegated/join-as-account';
import { foundDelegatedNamespace } from '../delegated/create-context';
import { resolveTrustedNodeUrl } from '../auth/node-trust';
import { resolveTokenAdoption } from '../auth/token-adoption';
import {
  getNodeUrl,
  setNodeUrl,
  getTokenNodeUrl,
  setTokenNodeUrl,
  getApplicationId,
  setApplicationId,
  getContextId,
  setContextId,
  getContextIdentity,
  setContextIdentity,
  clearAllStorage,
} from '../storage';
import type { MeroContextValue, MeroProviderConfig } from '../types';

import {
  buildDelegatedClient,
  clearDelegatedCredential,
  clearDelegatedSession,
  readDelegatedSession,
  listDelegatedContexts,
  readPinnedRelayNodeKey,
  relayForContext,
  resolveRelayNodeKey,
  saveDelegatedCredential,
  saveDelegatedSession,
  type DelegatedSession,
} from '../delegated/session';

const MeroContext = createContext<MeroContextValue | null>(null);

const isBrowser = typeof window !== 'undefined';

/**
 * Permission grants requested for the client token at login.
 *
 * Cores since 0.11.0-rc.9 default-deny admin-api routes the token holds no
 * scope for; cores >=0.11.0-rc.11 map the governance/blob/alias routes to the
 * client-grantable `namespace` / `group` / `blob` / `context:alias`
 * permissions, so app tokens must request them here or every workspace,
 * group, blob and context-alias call 403s.
 *
 * `context:list` is included even in single-context mode because every app
 * calls GET /admin-api/contexts/:id/identities-owned right after login, which
 * maps to a `context:list` requirement.
 *
 * `context:subscribe` is what `/sse`, `/sse/subscription` and `/ws` require
 * (core's `PermissionValidator`, `validator.rs`, maps all three to
 * `Context(Subscribe(Global))`). Without it every event stream an app opens is
 * refused `403` + `X-Auth-Error: permission_denied`, so the app renders, reads
 * and writes, and simply never receives a live update. Only `AppMode.Admin`
 * escaped, because `admin` covers every route.
 *
 * MEASURED against merod 0.11.0-rc.41 (build 88e323b): a client key minted with
 * the MultiContext list below minus `context:subscribe` gets `403` on
 * `GET /sse`; the same list with it gets `200`.
 *
 * `context:delete` is what `DELETE /admin-api/contexts/:id` requires
 * (`validator.rs`). An app that may create contexts may delete them, so
 * `useDeleteContext` works on a node instead of answering 403.
 *
 * Exported for tests.
 */
export function getPermissionsForMode(mode: AppMode): string[] {
  switch (mode) {
    case AppMode.SingleContext:
      return [
        'context:execute',
        'context:list',
        'context:subscribe',
        'application:list',
        'blob',
        'context:alias',
      ];
    case AppMode.MultiContext:
      return [
        'context:create',
        'context:delete',
        'context:list',
        'context:execute',
        'context:subscribe',
        'application:list',
        'namespace',
        'group',
        'blob',
        'context:alias',
      ];
    case AppMode.Admin:
      return ['admin'];
    default:
      throw new Error(`Unsupported application mode: ${mode}`);
  }
}

export interface MeroProviderProps extends MeroProviderConfig {
  children: React.ReactNode;
}

export function MeroProvider({
  children,
  mode,
  packageName,
  packageVersion,
  registryUrl,
  cloudBaseUrl,
  timeoutMs = 30000,
  allowedNodeUrls,
  tokenStore: tokenStoreProp,
}: MeroProviderProps) {
  const tokenStore = useMemo<TokenStore>(
    () => tokenStoreProp ?? new LocalStorageTokenStore(),
    [tokenStoreProp],
  );
  const [mero, setMero] = useState<MeroJs | MeroClient | null>(null);
  /**
   * The delegated record, or null for the node-login path.
   *
   * Read from storage in the initializer rather than an effect: a reload of a
   * delegated tab should render connected, not flash the connect button and
   * then replace it.
   */
  const [delegated, setDelegated] = useState<DelegatedSession | null>(() =>
    readDelegatedSession(),
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [nodeUrl, setNodeUrlState] = useState<string | null>(() => getNodeUrl());
  const [applicationId, setApplicationIdState] = useState<string | null>(
    () => getApplicationId() || null,
  );
  const [contextId, setContextIdState] = useState<string | null>(() => getContextId());
  const [contextIdentity, setContextIdentityState] = useState<string | null>(() => getContextIdentity());

  const meroRef = useRef<MeroJs | null>(null);
  // Guards the SSE 401 recovery below, so a burst of reconnect failures can't
  // stack concurrent validate/refresh attempts over one single-use refresh token.
  const recoveringRef = useRef(false);

  // Parse auth callback ONCE in a ref (StrictMode-safe: refs persist across unmount/remount)
  const callbackRef = useRef<AuthCallbackResult | null | undefined>(undefined);
  if (callbackRef.current === undefined && isBrowser) {
    callbackRef.current = parseAuthCallback(window.location.href);
  }

  const createMeroInstance = useCallback(
    (url: string): MeroJs => {
      if (meroRef.current) {
        meroRef.current.close();
      }
      const instance = new MeroJs({
        baseUrl: url,
        tokenStore,
        timeoutMs,
      });
      meroRef.current = instance;
      return instance;
    },
    [timeoutMs, tokenStore],
  );

  const checkAuth = useCallback(
    async (instance: MeroJs): Promise<boolean> => {
      // Validate the session via /auth/validate (signature, revocation, node
      // binding — no permission requirement) instead of probing
      // GET /admin-api/contexts. Since core 0.11.0-rc.9 the node enforces
      // token permission scopes, and /admin-api/contexts requires Global
      // `context:list` — which single-context tokens (execute-only) and
      // app-scoped tokens don't hold, so probing it 403'd valid sessions and
      // bounced every app straight back to the login page.
      const accessToken = tokenStore.getTokens()?.access_token;
      if (!accessToken) return false;

      const validate = async (token: string): Promise<boolean> => {
        try {
          const { valid } = await instance.auth.validateToken(token);
          return valid;
        } catch {
          return false;
        }
      };

      if (await validate(accessToken)) return true;

      // An expired access token does NOT mean the session is over: refresh
      // tokens last 30 days against core's 1-hour access TTL, so on any reload
      // more than an hour after login we land here holding a perfectly good
      // refresh token.
      //
      // `validateToken` has in fact already spent it. It pins the token under
      // test into an explicit `Authorization` header, and mero-js's init
      // headers override the transport's own token (mero-js
      // http-client/web-client.js `buildHeaders`). So the 401 + `x-auth-error:
      // token_expired` trips the transport's refresh hook — rotating the stored
      // bundle — and then the retry re-sends the SAME stale header, 401s again,
      // and reports `valid: false`. The session was silently renewed and thrown
      // away, and the app bounced to login; a second reload would then "fix"
      // itself, which is exactly how this reads as a random logout.
      //
      // So: re-read the store, and if the transport rotated it underneath us,
      // judge the session on the token we ACTUALLY hold now. We never call
      // /auth/refresh ourselves — doing so would race mero-js's single-flight
      // lock over a single-use refresh token and get the whole family revoked
      // (calimero-network/core#3083).
      const rotated = tokenStore.getTokens()?.access_token;
      if (!rotated || rotated === accessToken) return false;
      return validate(rotated);
    },
    [tokenStore],
  );

  const connectToNode = useCallback(
    (url: string) => {
      if (!isBrowser) return;
      setNodeUrl(url);
      setNodeUrlState(url);

      const callbackUrl = new URL(window.location.href);
      callbackUrl.hash = '';

      const loginUrl = buildAuthLoginUrl(url, {
        callbackUrl: callbackUrl.toString(),
        permissions: getPermissionsForMode(mode),
        mode,
        packageName,
        packageVersion,
        registryUrl,
      });

      window.location.href = loginUrl;
    },
    [mode, packageName, packageVersion, registryUrl],
  );

  /**
   * Adopt a delegated connection.
   *
   * No redirect and nothing to await: a delegated client carries its own
   * credential on every request, so it is usable the moment it is built. The
   * record is persisted first so a reload finds it.
   */
  const connectWithAccount = useCallback((session: DelegatedSession) => {
    saveDelegatedSession(session);
    // Kept as a credential too, so the identity outlives the connection. A relay
    // can be lost without the certificate being lost — the fleet row goes stale,
    // or the record is cleared — and re-enrolling to recover a key this tab still
    // holds would be a new device for no reason.
    const { account, credential, deviceSecret } = session;
    saveDelegatedCredential({ account, credential, deviceSecret });
    setDelegated(session);
  }, []);

  const logout = useCallback(() => {
    if (meroRef.current) {
      meroRef.current.clearToken();
      meroRef.current.close();
    }
    // Always clear the token store, even when not connected (meroRef is null) —
    // otherwise the access/refresh tokens persist in storage after logout.
    tokenStore.clear();
    clearAllStorage();
    clearDelegatedSession();
    // The certificate goes too. Logging out of an account and leaving its device
    // key in storage would leave the next visitor able to bootstrap as it from
    // any invitation they hold.
    clearDelegatedCredential();
    setDelegated(null);
    setMero(null);
    setIsAuthenticated(false);
    setNodeUrlState(null);
    setApplicationIdState(null);
    setContextIdState(null);
    setContextIdentityState(null);
    meroRef.current = null;
  }, [tokenStore]);

  /**
   * Install the relay client for a delegated record.
   *
   * Separate effect from the node-login initializer below, and the two are
   * mutually exclusive: a delegated connection has no token to adopt, no node
   * URL to validate and no callback to consume, so running that machinery for
   * it would only find nothing and log out.
   */
  useEffect(() => {
    if (!delegated) return;
    // Re-keys the warrant-nonce ledger when the chosen context changes, which is
    // why `contextId` is a dependency. The context itself is NOT set from here —
    // it comes from storage (the initializer above) or from whatever the app's
    // own picker selected, exactly as on the node-login path.
    // The open context's own relay: an account's namespaces may each be served
    // by a different one. Unknown (no context yet, or one not listed yet) →
    // the session's relay, which is the one that admitted it most recently.
    const relayUrl =
      (contextId ? relayForContext(delegated.account, contextId) : null) ?? delegated.relayUrl;
    const routed = { ...delegated, relayUrl };
    const client = buildDelegatedClient(routed, contextId);
    // A relay whose node key is not known yet: learn it before handing the app a
    // client. Published without it, the app's subscriptions open `/sse` on a
    // client with no session, which a hosted relay refuses with a 401 — the
    // client rebuilt a moment later reconnects, but the refusal is noise.
    const awaitingKey = Boolean(client && relayUrl && !readPinnedRelayNodeKey(relayUrl));
    // `null` when the account holds no relay yet, and the session is still
    // authenticated. Being signed in is how an account comes to be invited, so a
    // relay cannot be a precondition for it — and `mero: null` is what makes a
    // write say "there is no relay" instead of failing against a guessed node.
    if (!awaitingKey) setMero(client);
    setIsAuthenticated(true);
    setIsOnline(true);
    setNodeUrlState(relayUrl);
    setIsLoading(awaitingKey);

    /*
     * Which application this tab is for, asked rather than told.
     *
     * The node-login path is handed an `applicationId` by the auth callback. A
     * delegated tab has no callback, so it had none — and an app's context
     * picker that filters on it (correctly: "I cannot tell which are mine" and
     * "all of them are mine" are different answers) then had nothing to filter
     * with and stayed empty forever. That, not the relay, was the last reason
     * anyone had to type a context id in.
     *
     * `admin.getContexts()` on this client is caller-scoped through the request
     * proof — it answers this ACCOUNT's own contexts, each naming its
     * application — so the id is derivable from the credential already held.
     *
     * Not persisted with `setApplicationId`: it is derived from a cheap,
     * authoritative read, so caching it would only create a value to invalidate
     * when the account's contexts change.
     */
    let active = true;
    (async () => {
      // No relay, so no client and nothing to ask. A brand-new account is a
      // member of nothing — there are no contexts to derive an application from,
      // which is exactly the state an invitation changes.
      if (!client || !relayUrl) return;
      // Admin reads and events need a session the relay accepts, which needs
      // its node key. Pinned, or learned from the relay's attestation; learned
      // now, the client is rebuilt so its session and events use it too. With
      // neither, a hosted relay answers the proof-only path with 401: do not ask.
      if (awaitingKey) {
        const nodeKey = await resolveRelayNodeKey(relayUrl);
        if (!active) return;
        // Without a key the client still writes (intents carry their own
        // warrant); only admin reads and events need the session it enables.
        setMero(nodeKey ? (buildDelegatedClient(routed, contextId) ?? client) : client);
        setIsLoading(false);
        if (!nodeKey) return;
      }
      try {
        // Across every relay this account uses, each answering for itself.
        const contexts = await listDelegatedContexts(delegated);
        const apps = [
          ...new Set((contexts ?? []).map((c) => c.applicationId).filter(Boolean)),
        ];
        if (!active) return;
        if (apps.length === 1) {
          setApplicationIdState(apps[0]);
        }
        // More than one, and this stays null ON PURPOSE. A tab holds one
        // application's UI and nothing here says which — the account simply has
        // contexts for several. Picking the first would silently point the app at
        // another app's contract, which answers none of its methods; admitting
        // "I don't know" leaves the app's own "waiting for this session to report
        // which application" message honest, and a chooser is the follow-up.
        //
        // Zero contexts also stays null: there is no application to infer.
      } catch {
        // Left null, and deliberately not surfaced as a connection failure. The
        // writes work — every one carries its own warrant — and a read that did
        // not answer must not unwind a connection that did.
      }
    })();

    return () => {
      active = false;
      // `close` is a node-client concern; a relay client has nothing to tear
      // down, so do not reach for it.
    };
  }, [delegated, contextId]);

  // Initialization effect
  useEffect(() => {
    // A delegated tab is already connected by the effect above. This whole
    // path — callback parsing, token adoption, node-URL trust, /auth/validate —
    // describes a session the delegated client does not have.
    if (delegated) return;

    let active = true;

    const init = async () => {
      const callback = callbackRef.current;
      let nodeFromCallback: string | null = null;

      if (callback) {
        // Read BEFORE the callback overwrites either of them.
        //   - initiatedNodeUrl: the node login was initiated with — the trust anchor.
        //   - tokenNodeUrl: the node that minted the bundle currently in the store.
        // They differ exactly when the user is switching nodes: `connectToNode`
        // points NODE_URL at the *target* node before redirecting, while the store
        // still holds the *previous* node's bundle. Falling back to the initiated
        // node keeps sessions that predate TOKEN_NODE_URL working.
        const initiatedNodeUrl = getNodeUrl();
        const tokenNodeUrl = getTokenNodeUrl() ?? initiatedNodeUrl;

        // The callback URL is attacker-influenceable, so validate its node_url
        // BEFORE storing tokens or connecting — otherwise a malicious node_url
        // would receive the freshly-minted tokens (exfiltration).
        const { url, rejected } = resolveTrustedNodeUrl({
          candidate: callback.nodeUrl,
          initiated: initiatedNodeUrl,
          allowedNodeUrls,
        });

        // Always strip the callback params (tokens + node_url) from the address
        // bar and consume the parsed callback, whatever the trust outcome.
        if (isBrowser) {
          window.history.replaceState({}, '', window.location.pathname + window.location.search);
        }
        callbackRef.current = null;

        if (rejected) {
          // Untrusted node_url — likely a token-exfiltration attempt. Drop the
          // callback's tokens, but DON'T return: fall through to restore any
          // existing session from storage so a tampered callback can't log a
          // legitimately authenticated user out.
          console.error(
            '[MeroProvider] OAuth callback node_url is not trusted (it does not match the node ' +
              'login was initiated with, nor `allowedNodeUrls`). Ignoring the callback; no tokens stored.',
          );
        } else if (url) {
          // Trusted node → the callback's tokens MAY be persisted. Whether they
          // SHOULD be is a separate question: refresh tokens are single-use since
          // core 0.11.0 (calimero-network/core#3083), so blindly writing the hash
          // bundle over a bundle mero-js has already rotated resurrects a consumed
          // refresh token — the node reads that as theft (`x-auth-error:
          // token_reuse`) and revokes the entire token family, hard-logging out
          // every holder. Adopt only a fresh, newer, or different-node bundle, and
          // merge rather than replace so an access-only hash (hosts are dropping
          // `refresh_token` from the hash) can never strip a live refresh token.
          const decision = resolveTokenAdoption({
            callbackAccessToken: callback.accessToken,
            callbackRefreshToken: callback.refreshToken,
            callbackNodeUrl: url,
            stored: tokenStore.getTokens(),
            storedNodeUrl: tokenNodeUrl,
          });

          if (decision.adopt) {
            tokenStore.setTokens(decision.tokens);
            setTokenNodeUrl(url);
          } else {
            console.warn(
              '[MeroProvider] Ignoring the SSO callback token bundle: it is stale (not newer than ' +
                'the tokens already stored for this node). Adopting it would replay an already-rotated ' +
                'refresh token, which the node revokes the whole token family for.',
            );
          }

          if (callback.applicationId) {
            setApplicationId(callback.applicationId);
            if (active) setApplicationIdState(callback.applicationId);
          }
          if (callback.contextId) {
            setContextId(callback.contextId);
            if (active) setContextIdState(callback.contextId);
          }
          if (callback.contextIdentity) {
            setContextIdentity(callback.contextIdentity);
            if (active) setContextIdentityState(callback.contextIdentity);
          }

          setNodeUrl(url);
          if (active) setNodeUrlState(url);
          nodeFromCallback = url;
        }
        // url === null && !rejected → callback had no node to bind to; ignore it.
      }

      const savedUrl = nodeFromCallback || getNodeUrl();
      if (!savedUrl) {
        if (active) setIsLoading(false);
        return;
      }

      const instance = createMeroInstance(savedUrl);
      const authed = await checkAuth(instance);

      if (!active) return;

      if (authed) {
        setMero(instance);
        setIsAuthenticated(true);
        setIsOnline(true);
      } else if (nodeFromCallback) {
        setMero(instance);
      }

      setIsLoading(false);
    };

    init().catch((err) => {
      console.error('[MeroProvider] Initialization failed:', err);
      if (active) setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [createMeroInstance, checkAuth, allowedNodeUrls, tokenStore, delegated]);

  // SSE connection for online/offline detection — no polling.
  useEffect(() => {
    if (!isAuthenticated || !meroRef.current) return;

    let active = true;
    const sse = meroRef.current.events;

    const onConnect = () => { if (active) setIsOnline(true); };
    const onError = (err: Error) => {
      if (!active) return;
      setIsOnline(false);

      // A delegated stream has no token to renew. It is authenticated by a
      // request proof the device key signs for each connect, so a 401 here is
      // not an expiry the recovery below can fix — and that recovery ends in
      // `logout()`, which would tear down a connection whose credential is
      // still perfectly good. Report offline and let the client reconnect.
      if (delegated) return;

      // ── Which stream failures are worth acting on ──────────────────────────
      //
      // This used to be `if (!err.message.includes('401')) return;`, and the
      // comment under it explained that mero-js threw a bare
      // `SSE connection failed: <status>`, so nothing better was available.
      // That stopped being true in mero-js 19.14.1 (#166): the SSE path now
      // throws the same typed errors the request path does, carrying the
      // status and the `x-auth-error` header.
      //
      // Matching on '401' was not merely coarse, it was aimed at the wrong
      // number. Core answers a dead or under-scoped token on `/sse` with
      // **403**, not 401 — `token_expired` is the only 401 a stream sees. So
      // every failure that actually needed acting on was the one this gate
      // dropped, and the app sat at `isOnline = false` with no way back and no
      // prompt to log in again.
      //
      // Three cases now, because they need three different answers.

      // 1. The token family is gone (403 `token_revoked`, or a 401
      //    `token_reuse`). mero-js has already STOPPED reconnecting — every
      //    retry re-sends the same dead credential — so nothing will reopen
      //    this stream, and there is no refresh token left to spend either.
      if (err instanceof AuthRevokedError) {
        logout();
        return;
      }

      if (err instanceof HTTPError && err.status === 403) {
        // 2. The token is live but was minted without `context:subscribe`.
        //    Core requires that grant for `/sse`, `/sse/subscription` and
        //    `/ws`, and the grant set is baked in at MINT time — so a refresh
        //    re-issues the same unusable token and the stream 403s again,
        //    forever. mero-react 9.1.2 (#73) fixed what we ASK for; a client
        //    key minted before it can only be replaced by a fresh login.
        //    `checkAuth` would return true here and reconnect us into that
        //    loop, which is why this case must not go through it.
        if (err.headers?.get('x-auth-error') === 'permission_denied') {
          console.warn(
            '[MeroProvider] This session cannot open an event stream ' +
              '(403 permission_denied): its token predates the context:subscribe ' +
              'grant. Logging out — a fresh login mints a key that can subscribe.',
          );
          logout();
          return;
        }
        // 3. Any other 403 is core refusing this caller for a reason a new
        //    token would not change — "Forbidden: not the session owner". Not
        //    an auth-token problem, so do not spend the session on it.
        return;
      }

      // A 401 is NOT proof the session is over, and it used to be treated as
      // such: `logout()` wipes the token store, so an expired access token cost
      // the user their still-valid 30-day refresh token and forced a real
      // re-login.
      //
      // The stream authenticates only at connect time (an open stream survives
      // expiry), so this fires on the first reconnect after the access token
      // ages out — a sleep/wake, a network blip, a PWA resume, a node restart.
      // Routine events, all of them. Ask `checkAuth`, which recovers a
      // merely-expired token via the transport's refresh and returns false only
      // when the session is genuinely dead.
      //
      // The string check stays as a fallback: not every caller is on 19.14.1,
      // and an older mero-js still reports this as `SSE connection failed: 401`.
      const status = err instanceof HTTPError ? err.status : null;
      if (status !== 401 && !err.message.includes('401')) return;

      if (recoveringRef.current) return;
      recoveringRef.current = true;
      void (async () => {
        try {
          const instance = meroRef.current;
          if (!instance) return;
          if (await checkAuth(instance)) {
            // Renewed. mero-js's `onTokenRefresh` hook has already updated the
            // instance's in-memory token, so the SseClient's `getAuthToken`
            // hands the reconnect the new one.
            if (active) await instance.events.connect().catch(() => {});
            return;
          }
          if (active) logout();
        } finally {
          recoveringRef.current = false;
        }
      })();
    };

    sse.on('connect', onConnect);
    sse.on('error', onError);
    sse.connect().catch(() => { if (active) setIsOnline(false); });

    return () => {
      active = false;
      sse.off('connect', onConnect);
      sse.off('error', onError);
    };
    // `checkAuth` and `logout` are both useCallback-stable (they close over the
    // memoized `tokenStore`), so listing them does not re-subscribe the stream.
    // Not for a delegated client: this stream is opened from the node client's
    // own `events`, and a relay client observes only when it was given the
    // relay's node key — which `buildDelegatedClient` wires up itself.
  }, [isAuthenticated, mero, checkAuth, logout, delegated]);

  // The admin API an app writes against, whatever the session, with the same
  // calls and results on both: on a node, the node's client (installing the
  // app when a namespace needs it); on an account, the account admin, whose
  // reads go to the relay and whose writes go through it as delegated ops.
  // Never null for a signed-in account: one with no relay yet is a member of
  // nothing, and says so, rather than leaving the app to special-case it.
  const admin = useMemo<AdminApiClient | null>(() => {
    const app = { packageName, packageVersion, registryUrl };
    if (delegated !== null) {
      // No relay at all: the empty admin. A relay still being connected to (its
      // node key not learned yet) is loading, not empty — null until it is up.
      // `admin.joinNamespace` redeems for the account, relay or not: the join is
      // how it gets one, and the session moves onto that relay once it is in.
      const deps = {
        join: (namespaceId: string, invitation: Parameters<typeof joinAsAccount>[2]) =>
          joinAsAccount(delegated, namespaceId, invitation, { cloudBaseUrl, onJoined: connectWithAccount }),
        // Founding enables HA on the same cloud the joins resolve relays from.
        found: (session: Parameters<typeof foundDelegatedNamespace>[0], req: Parameters<typeof foundDelegatedNamespace>[1]) =>
          foundDelegatedNamespace(session, req, { cloudBaseUrl }),
        // Invitations are checked against the routing their claimants will use.
        routing: (namespaceId: string) =>
          new CloudClient({
            cloudBaseUrl,
            routingCredential: { credential: delegated.credential, deviceSecret: delegated.deviceSecret },
          }).getNamespaceRouting(namespaceId),
      };
      if (delegated.relayUrl === null) return createAccountAdmin({ session: delegated, read: null, app }, deps);
      if (!mero) return null;
      return createAccountAdmin(
        { session: delegated, read: (mero as unknown as { admin: AdminApiClient }).admin, app },
        deps,
      );
    }
    const nodeAdmin = (mero as { admin?: AdminApiClient } | null)?.admin;
    return nodeAdmin ? createNodeAdmin({ admin: nodeAdmin, app }) : null;
  }, [mero, delegated, packageName, packageVersion, registryUrl, cloudBaseUrl, connectWithAccount]);

  const contextValue = useMemo<MeroContextValue>(
    () => ({
      mero,
      isAuthenticated,
      isOnline,
      nodeUrl,
      applicationId,
      contextId,
      contextIdentity,
      connectToNode,
      connectWithAccount,
      isDelegated: delegated !== null,
      admin,
      can: delegated !== null
        // An account founds a namespace through its relay and gives it this
        // app's application (core#4269), possible only when the app names its
        // registry package, and signs its own invitations (mero-js #221). Only
        // upgrades stay a node's: just a group's first application choice can
        // go through a relay.
        ? { createNamespace: Boolean(packageName), createContext: true, invite: true, upgrade: false }
        : { createNamespace: true, createContext: true, invite: true, upgrade: true },
      app: { packageName, packageVersion, registryUrl },
      cloudBaseUrl,
      logout,
      isLoading,
    }),
    [mero, admin, isAuthenticated, isOnline, nodeUrl, applicationId, contextId, contextIdentity, connectToNode, connectWithAccount, delegated, logout, isLoading, packageName, packageVersion, registryUrl, cloudBaseUrl],
  );

  return (
    <MeroContext.Provider value={contextValue}>
      {children}
    </MeroContext.Provider>
  );
}

export function useMero(): MeroContextValue {
  const context = useContext(MeroContext);
  if (!context) {
    throw new Error('useMero must be used within a MeroProvider');
  }
  return context;
}

export { MeroContext };
