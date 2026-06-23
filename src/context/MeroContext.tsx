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
import {
  getNodeUrl,
  setNodeUrl,
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

function getPermissionsForMode(mode: AppMode): string[] {
  switch (mode) {
    case AppMode.SingleContext:
      return ['context:execute'];
    case AppMode.MultiContext:
      return ['context:create', 'context:list', 'context:execute'];
    case AppMode.Admin:
      return ['admin'];
    default:
      throw new Error(`Unsupported application mode: ${mode}`);
  }
}

function parseJwtExpiry(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const payload: { exp?: number } = JSON.parse(atob(b64));
      if (payload.exp && payload.exp > 0) {
        return payload.exp * 1000;
      }
    }
  } catch {
    // fall through
  }
  return Date.now() + 3_600_000;
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

  const checkAuth = useCallback(async (instance: MeroJs): Promise<boolean> => {
    try {
      await instance.admin.getContexts();
      return true;
    } catch {
      return false;
    }
  }, []);

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
        // The callback URL is attacker-influenceable, so validate its node_url
        // BEFORE storing tokens or connecting — otherwise a malicious node_url
        // would receive the freshly-minted tokens (exfiltration).
        const { url, rejected } = resolveTrustedNodeUrl({
          candidate: callback.nodeUrl,
          initiated: getNodeUrl(),
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
          // Trusted node → safe to persist the callback's tokens and identifiers.
          tokenStore.setTokens({
            access_token: callback.accessToken,
            refresh_token: callback.refreshToken,
            expires_at: parseJwtExpiry(callback.accessToken),
          });

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
