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
} from '@calimero-network/mero-js';
import { AppMode } from '../types';
import type { AuthCallbackResult, TokenStore } from '@calimero-network/mero-js';
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
 * Exported for tests.
 */
export function getPermissionsForMode(mode: AppMode): string[] {
  switch (mode) {
    case AppMode.SingleContext:
      return ['context:execute', 'context:list', 'application:list', 'blob', 'context:alias'];
    case AppMode.MultiContext:
      return [
        'context:create',
        'context:list',
        'context:execute',
        'application:list',
        // The update flow this package ships - `useInstallFromRegistry`, and the
        // Download that precedes every group upgrade - posts to
        // /admin-api/install-application, which requires `application:install`.
        // Without it the button 403s and no app can ever apply an update.
        'application:install',
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
  timeoutMs = 30000,
  allowedNodeUrls,
  tokenStore: tokenStoreProp,
}: MeroProviderProps) {
  const tokenStore = useMemo<TokenStore>(
    () => tokenStoreProp ?? new LocalStorageTokenStore(),
    [tokenStoreProp],
  );
  const [mero, setMero] = useState<MeroJs | null>(null);
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
      try {
        const { valid } = await instance.auth.validateToken(accessToken);
        return valid;
      } catch {
        return false;
      }
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

  const logout = useCallback(() => {
    if (meroRef.current) {
      meroRef.current.clearToken();
      meroRef.current.close();
    }
    // Always clear the token store, even when not connected (meroRef is null) —
    // otherwise the access/refresh tokens persist in storage after logout.
    tokenStore.clear();
    clearAllStorage();
    setMero(null);
    setIsAuthenticated(false);
    setNodeUrlState(null);
    setApplicationIdState(null);
    setContextIdState(null);
    setContextIdentityState(null);
    meroRef.current = null;
  }, [tokenStore]);

  // Initialization effect
  useEffect(() => {
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
  }, [createMeroInstance, checkAuth, allowedNodeUrls, tokenStore]);

  // SSE connection for online/offline detection — no polling.
  useEffect(() => {
    if (!isAuthenticated || !meroRef.current) return;

    let active = true;
    const sse = meroRef.current.events;

    const onConnect = () => { if (active) setIsOnline(true); };
    const onError = (err: Error) => {
      if (!active) return;
      setIsOnline(false);
      // TODO(mero-js#67): surface a revoked token family as an explicit forced
      // re-login rather than an opaque 401. Once a refresh token is replayed the
      // node revokes the family and answers 401 with `x-auth-error: token_reuse`
      // (or `token_revoked`) — a terminal state no retry can recover from, unlike
      // `token_expired`. mero-js#67 adds an `AuthRevokedError` for exactly this;
      // the mero-js pinned here (6.1.0) predates it — it neither exports that
      // error nor reads `x-auth-error` beyond `token_expired` — so there is
      // nothing to branch on yet. Bump mero-js past #67, then match on
      // `AuthRevokedError` here and expose a distinct `sessionRevoked` reason to
      // consumers instead of a silent logout.
      if (err.message.includes('401')) {
        logout();
      }
    };

    sse.on('connect', onConnect);
    sse.on('error', onError);
    sse.connect().catch(() => { if (active) setIsOnline(false); });

    return () => {
      active = false;
      sse.off('connect', onConnect);
      sse.off('error', onError);
    };
  }, [isAuthenticated, mero]);

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
      logout,
      isLoading,
    }),
    [mero, isAuthenticated, isOnline, nodeUrl, applicationId, contextId, contextIdentity, connectToNode, logout, isLoading],
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
