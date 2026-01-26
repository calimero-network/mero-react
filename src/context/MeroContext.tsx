/**
 * MeroContext - React Context for MeroJs
 * 
 * Provides MeroJs instance management, authentication state,
 * and connection handling through React Context.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { MeroJs } from '@calimero-network/mero-js';
import {
  localStorageTokenStorage,
  getNodeUrl,
  setNodeUrl,
  getApplicationId,
  setApplicationId,
  getContextId,
  setContextId,
  clearAllStorage,
} from '../storage';
import type {
  MeroContextValue,
  MeroProviderConfig,
  AppMode,
} from '../types';
import { AppMode as AppModeEnum } from '../types';

// Default context value
const defaultContextValue: MeroContextValue = {
  mero: null,
  isAuthenticated: false,
  isOnline: true,
  nodeUrl: null,
  applicationId: null,
  contextId: null,
  connectToNode: () => {},
  logout: () => {},
  isLoading: true,
};

// Create context
const MeroContext = createContext<MeroContextValue>(defaultContextValue);

/**
 * Get permissions based on app mode
 */
function getPermissionsForMode(mode: AppMode): string[] {
  switch (mode) {
    case AppModeEnum.SingleContext:
      return ['context:execute'];
    case AppModeEnum.MultiContext:
      return ['context:create', 'context:list', 'context:execute'];
    case AppModeEnum.Admin:
      return ['admin'];
    default:
      throw new Error(`Unsupported application mode: ${mode}`);
  }
}

/**
 * Redirect to auth login
 */
function redirectToAuthLogin(params: {
  nodeUrl: string;
  callbackUrl: string;
  permissions: string[];
  mode: AppMode;
  packageName?: string;
  packageVersion?: string;
  registryUrl?: string;
  applicationId?: string;
  applicationPath?: string;
}): void {
  const authParams = new URLSearchParams();
  authParams.append('callback-url', params.callbackUrl);
  authParams.append('permissions', params.permissions.join(','));
  authParams.append('mode', params.mode);

  if (params.packageName) {
    authParams.append('package-name', params.packageName);
    if (params.packageVersion) {
      authParams.append('package-version', params.packageVersion);
    }
    if (params.registryUrl) {
      authParams.append('registry-url', params.registryUrl);
    }
  } else if (params.applicationId) {
    authParams.append('application-id', params.applicationId);
  }

  if (params.applicationPath) {
    authParams.append('application-path', params.applicationPath);
  }

  // Store node URL for callback
  authParams.append('app-url', params.nodeUrl);

  window.location.href = `${params.nodeUrl}/auth/login?${authParams.toString()}`;
}

/**
 * MeroProvider Props
 */
export interface MeroProviderProps extends MeroProviderConfig {
  children: React.ReactNode;
}

/**
 * MeroProvider - Provides MeroJs instance and auth state to the app
 */
export function MeroProvider({
  children,
  mode,
  packageName,
  packageVersion,
  registryUrl,
  applicationId: propApplicationId,
  applicationPath,
  timeoutMs = 30000,
}: MeroProviderProps) {
  // State
  const [mero, setMero] = useState<MeroJs | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [nodeUrl, setNodeUrlState] = useState<string | null>(() => getNodeUrl());
  const [applicationId, setApplicationIdState] = useState<string | null>(
    () => getApplicationId() || propApplicationId || null
  );
  const [contextId, setContextIdState] = useState<string | null>(() => getContextId());

  // Refs
  const meroRef = useRef<MeroJs | null>(null);

  /**
   * Create or update MeroJs instance
   */
  const createMeroInstance = useCallback(
    (url: string): MeroJs => {
      const instance = new MeroJs({
        baseUrl: url,
        tokenStorage: localStorageTokenStorage,
        timeoutMs,
      });
      meroRef.current = instance;
      return instance;
    },
    [timeoutMs]
  );

  /**
   * Check if authenticated by making a test API call
   */
  const checkAuth = useCallback(async (instance: MeroJs): Promise<boolean> => {
    try {
      await instance.admin.contexts.listContexts();
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Process auth callback from URL hash
   */
  const processAuthCallback = useCallback(() => {
    const url = new URL(window.location.href);
    const rawHash = url.hash;
    const hash = rawHash.slice(1); // Remove leading #
    
    console.log('========== AUTH CALLBACK DEBUG ==========');
    console.log('Raw URL:', window.location.href);
    console.log('Raw hash:', rawHash);
    console.log('Hash (without #):', hash);
    
    if (!hash) {
      console.log('No hash found, skipping auth callback');
      console.log('==========================================');
      return false;
    }

    const params = new URLSearchParams(hash);
    
    // Log ALL params received
    console.log('All hash params:');
    for (const [key, value] of params.entries()) {
      console.log(`  ${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`);
    }
    console.log('==========================================');
    
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    // Try multiple parameter names for application ID
    const appId = params.get('application_id') || params.get('applicationId') || params.get('app_id');
    // Try multiple parameter names for context ID  
    const ctxId = params.get('context_id') || params.get('contextId') || params.get('context');
    const expiresIn = params.get('expires_in');
    // Try multiple parameter names for node URL (for SSO from Tauri app)
    const nodeUrlParam = params.get('node_url') || params.get('nodeUrl') || params.get('node');

    if (!accessToken || !refreshToken) return false;

    // If node_url is provided, save it (SSO flow from Tauri)
    if (nodeUrlParam) {
      const decodedNodeUrl = decodeURIComponent(nodeUrlParam);
      setNodeUrl(decodedNodeUrl);
      setNodeUrlState(decodedNodeUrl);
      console.log('[mero-react] SSO: Node URL from hash params:', decodedNodeUrl);
    }

    try {
      // Decode tokens
      const decodedAccess = decodeURIComponent(accessToken);
      const decodedRefresh = decodeURIComponent(refreshToken);

      // Calculate expiry - try to extract from JWT or use provided expires_in
      let expiresAt = Date.now() + 3600000; // 1 hour default
      
      if (expiresIn) {
        // If expires_in is provided in callback, use it
        expiresAt = Date.now() + parseInt(expiresIn, 10) * 1000;
      } else {
        // Try to extract exp from JWT payload
        try {
          const parts = decodedAccess.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            if (payload.exp) {
              expiresAt = payload.exp * 1000; // JWT exp is in seconds
            }
          }
        } catch {
          // JWT parsing failed, use default
        }
      }

      // Store tokens via TokenStorage
      localStorageTokenStorage.set({
        access_token: decodedAccess,
        refresh_token: decodedRefresh,
        expires_at: expiresAt,
      });

      // Store application ID if provided
      if (appId) {
        setApplicationId(appId);
        setApplicationIdState(appId);
      }

      // Store context ID if provided
      if (ctxId) {
        setContextId(ctxId);
        setContextIdState(ctxId);
      }

      // Clean URL - remove all auth params (handle various naming conventions)
      params.delete('access_token');
      params.delete('refresh_token');
      params.delete('application_id');
      params.delete('applicationId');
      params.delete('app_id');
      params.delete('context_id');
      params.delete('contextId');
      params.delete('context');
      params.delete('expires_in');
      params.delete('node_url');
      params.delete('nodeUrl');
      params.delete('node');
      const newHash = params.toString();
      url.hash = newHash ? `#${newHash}` : '';
      window.history.replaceState({}, document.title, url.toString());
      
      console.log('[mero-react] Stored contextId:', ctxId, 'applicationId:', appId);

      return true;
    } catch (e) {
      console.error('[mero-react] Failed to process auth callback:', e);
      return false;
    }
  }, []);

  /**
   * Connect to a node and start the auth flow
   */
  const connectToNode = useCallback(
    (url: string) => {
      // Save node URL
      setNodeUrl(url);
      setNodeUrlState(url);

      // Build callback URL (strip existing auth params)
      const callbackUrl = new URL(window.location.href);
      if (callbackUrl.hash) {
        const hashParams = new URLSearchParams(callbackUrl.hash.substring(1));
        hashParams.delete('access_token');
        hashParams.delete('refresh_token');
        hashParams.delete('application_id');
        callbackUrl.hash = hashParams.toString() ? `#${hashParams.toString()}` : '';
      }

      const permissions = getPermissionsForMode(mode);

      redirectToAuthLogin({
        nodeUrl: url,
        callbackUrl: callbackUrl.toString(),
        permissions,
        mode,
        packageName,
        packageVersion,
        registryUrl,
        applicationId: propApplicationId,
        applicationPath,
      });
    },
    [mode, packageName, packageVersion, registryUrl, propApplicationId, applicationPath]
  );

  /**
   * Logout function
   */
  const logout = useCallback(async () => {
    // Clear MeroJs tokens
    if (meroRef.current) {
      await meroRef.current.clearToken();
    }

    // Clear all storage
    clearAllStorage();

    // Reset state
    setMero(null);
    setIsAuthenticated(false);
    setNodeUrlState(null);
    setApplicationIdState(null);
    setContextIdState(null);
    meroRef.current = null;
  }, []);

  /**
   * Initialize on mount
   */
  useEffect(() => {
    const init = async () => {
      console.log('[mero-react] Init starting...');
      console.log('[mero-react] Current URL:', window.location.href);
      console.log('[mero-react] Stored nodeUrl:', getNodeUrl());
      console.log('[mero-react] Stored contextId:', getContextId());
      console.log('[mero-react] Stored applicationId:', getApplicationId());
      
      // Check for auth callback first
      const hasCallback = processAuthCallback();
      console.log('[mero-react] hasCallback:', hasCallback);

      const savedUrl = getNodeUrl();
      if (!savedUrl) {
        setIsLoading(false);
        return;
      }

      // Create MeroJs instance
      const instance = createMeroInstance(savedUrl);
      await instance.init();

      // Check if authenticated
      const authed = await checkAuth(instance);
      if (authed) {
        setMero(instance);
        setIsAuthenticated(true);
        setIsOnline(true);
      } else if (hasCallback) {
        // Had callback but auth failed - maybe token expired
        setMero(instance);
        setIsAuthenticated(false);
      }

      setIsLoading(false);
    };

    init();
  }, [createMeroInstance, checkAuth, processAuthCallback]);

  /**
   * Periodic health check
   */
  useEffect(() => {
    if (!isAuthenticated || !meroRef.current) return;

    const interval = setInterval(async () => {
      const instance = meroRef.current;
      if (!instance) return;

      const healthy = await checkAuth(instance);
      if (!healthy && isOnline) {
        setIsOnline(false);
      } else if (healthy && !isOnline) {
        setIsOnline(true);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isAuthenticated, isOnline, checkAuth]);

  /**
   * Sync applicationId from props
   */
  useEffect(() => {
    if (propApplicationId && !applicationId) {
      setApplicationIdState(propApplicationId);
    }
  }, [propApplicationId, applicationId]);

  // Context value
  const contextValue = useMemo<MeroContextValue>(
    () => ({
      mero,
      isAuthenticated,
      isOnline,
      nodeUrl,
      applicationId,
      contextId,
      connectToNode,
      logout,
      isLoading,
    }),
    [mero, isAuthenticated, isOnline, nodeUrl, applicationId, contextId, connectToNode, logout, isLoading]
  );

  return (
    <MeroContext.Provider value={contextValue}>
      {children}
    </MeroContext.Provider>
  );
}

/**
 * useMero hook - Access MeroJs and auth state
 */
export function useMero(): MeroContextValue {
  const context = useContext(MeroContext);
  if (context === undefined) {
    throw new Error('useMero must be used within a MeroProvider');
  }
  return context;
}

export { MeroContext };
