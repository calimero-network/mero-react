/**
 * Types for mero-react
 */

import type { MeroJs } from '@calimero-network/mero-js';

/**
 * Application mode determines the permission scope
 */
export enum AppMode {
  /**
   * @deprecated since 2.1.0 — SingleContext is no longer supported and will
   * be removed in 3.0.0. Auth-frontend no longer drives
   * context/namespace/group selection; the auth callback returns only
   * `access_token`, `refresh_token`, `application_id`, and `node_url`.
   * Switch to {@link AppMode.MultiContext} and have your app manage
   * context selection itself.
   *
   * Migration: see `example/app/src/pages/context/SelectContext.tsx` for a
   * reference implementation. It uses `useContexts` /
   * `useNamespacesForApplication` for listing, then calls
   * `mero.admin.createNamespace` / `createGroupInNamespace` /
   * `createContext` directly (rather than the `useCreate*` hooks) so the
   * underlying server error surfaces to the user instead of being
   * swallowed by `useAsyncMutation`.
   */
  SingleContext = 'single-context',
  /** Multi-context: user can manage multiple contexts */
  MultiContext = 'multi-context',
  /** Admin: full administrative access */
  Admin = 'admin',
}

/**
 * Connection type for the login modal
 */
export enum ConnectionType {
  /** Show both local and remote options */
  RemoteAndLocal = 'remote-and-local',
  /** Show only remote option */
  Remote = 'remote',
  /** Show only local option */
  Local = 'local',
  /** Custom URL (skip modal) */
  Custom = 'custom',
}

/**
 * Custom connection configuration
 */
export interface CustomConnectionConfig {
  type: ConnectionType.Custom;
  url: string;
}

/**
 * Context for an application
 */
export interface AppContext {
  contextId: string;
  executorId: string;
  applicationId: string;
}

/**
 * Result of an RPC execution
 */
export interface ExecutionResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
}

export interface ApplicationContextRecord {
  contextId: string;
  applicationId: string;
}

export interface ContextDiscoveryOptions {
  applicationId: string;
  knownContextIds?: string[];
  targetAlias?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface ContextDiscoveryState {
  context: ApplicationContextRecord | null;
  loading: boolean;
  error: Error | null;
  discover: () => Promise<ApplicationContextRecord | null>;
  reset: () => void;
}

/**
 * Mero context value exposed by useMero hook
 */
export interface MeroContextValue {
  /** The MeroJs instance (null if not connected) */
  mero: MeroJs | null;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Whether the connection is online */
  isOnline: boolean;
  /** The current node URL */
  nodeUrl: string | null;
  /** The application ID */
  applicationId: string | null;
  /** The context ID (from auth flow) */
  contextId: string | null;
  /** The context identity / executor public key (from auth flow) */
  contextIdentity: string | null;
  /** Connect to a node URL and start auth flow */
  connectToNode: (url: string) => void;
  /** Logout and clear tokens */
  logout: () => void;
  /** Loading state */
  isLoading: boolean;
}

/**
 * MeroProvider configuration
 */
export interface MeroProviderConfig {
  /** Application mode */
  mode: AppMode;
  /** Package name (for registry-based apps) */
  packageName?: string;
  /** Package version (optional, defaults to latest) */
  packageVersion?: string;
  /** Registry URL (optional) */
  registryUrl?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}
