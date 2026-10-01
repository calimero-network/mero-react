/**
 * Types for mero-react
 */

import type { MeroClient, MeroJs, TokenStore } from '@calimero-network/mero-js';
import type { DelegatedSession } from './delegated/session';

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
  /**
   * @deprecated The login modal no longer has Local/Remote tabs — it always
   * shows node discovery + manual URL entry. Behaves the same as `Remote`.
   */
  RemoteAndLocal = 'remote-and-local',
  /** Open the login modal (node discovery + manual URL entry) */
  Remote = 'remote',
  /**
   * @deprecated The hardcoded default-local-node view was removed. Behaves
   * the same as `Remote`.
   */
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
  /**
   * The connected client, or null.
   *
   * Two shapes, because there are two ways to connect: a node login yields a
   * `MeroJs`, an account + relay connection yields a relay-transport
   * `MeroClient`. Both expose `rpc` as an `ExecuteTransport`, which is what a
   * generated ABI client depends on — so application logic is identical across
   * the two and needs no branch.
   *
   * The union is deliberately not flattened behind a cast. A relay client has
   * no `admin`, so code reaching for one should not typecheck as though it
   * were there; narrow with {@link MeroContextValue.isDelegated} first.
   */
  mero: MeroJs | MeroClient | null;
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
  /**
   * Adopt a delegated connection: an account, a device that account certified,
   * and a relay that writes on its behalf.
   *
   * Installs the relay client immediately — there is no redirect and no token to
   * wait for, because every request carries its own warrant.
   */
  connectWithAccount: (session: DelegatedSession) => void;
  /**
   * Whether the connection is delegated (account + relay) rather than a node
   * login. True means `mero` is a relay-transport client, authenticated by the
   * account's device certificate: `rpc` writes under warrants, and `admin` and
   * `events` answer caller-scoped — this account's own contexts and namespaces,
   * and events only for contexts it is a member of.
   */
  isDelegated: boolean;
  /**
   * What this connection may do, so an app asks WHAT IS ALLOWED instead of
   * which transport it runs on. A node login can do everything; an account on
   * a relay can create contexts (delegated creation) but not namespaces or
   * invitations — those are a node's own operations today. A capability that
   * later becomes available to accounts turns true here with no app change.
   */
  can: MeroCapabilities;
  /**
   * The admin API to write against, whatever the session: the node's own admin
   * client on a node, the account admin (`createAccountAdmin`) on an account.
   * `null` until connected.
   */
  admin: import('@calimero-network/mero-js').AdminApiClient | null;
  /**
   * The app's registry identity, as the provider was given it. An account
   * founding a namespace names this application for it, since a namespace
   * founded through a relay starts with none.
   */
  app: { packageName?: string; packageVersion?: string; registryUrl?: string };
  /** The cloud an account asks for routing; the hosted one when unset. */
  cloudBaseUrl?: string;
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
  /**
   * The cloud an account asks which relay serves a namespace or an account.
   * Unset is the hosted cloud, which is right for every deployed app; this is
   * for a local or staging setup whose namespaces the hosted cloud never saw.
   */
  cloudBaseUrl?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /**
   * Origins the OAuth callback is allowed to authenticate against. Defends
   * against a malicious `node_url` in the callback URL (token exfiltration):
   * the node login was initiated with is always trusted, and this allowlist
   * additionally permits direct-callback entry to known nodes. When neither is
   * available (no initiated node and no allowlist) a callback node_url is
   * rejected and a security error is logged.
   */
  allowedNodeUrls?: string[];
  /**
   * Token store for access/refresh tokens. Defaults to a localStorage-backed
   * store that persists across reloads.
   *
   * SECURITY: localStorage tokens — including the refresh token — are readable
   * by any script on the page, so an XSS bug can exfiltrate them. For sensitive
   * deployments pass a `MemoryTokenStore` (session-only) or a store backed by an
   * HttpOnly cookie set by your auth service.
   */
  tokenStore?: TokenStore;
}

/** See {@link MeroContextValue.can}. */
export interface MeroCapabilities {
  /** Found a namespace. */
  readonly createNamespace: boolean;
  /** Create a context inside a namespace this connection belongs to. */
  readonly createContext: boolean;
  /** Mint an invitation to a namespace. */
  readonly invite: boolean;
  /** Upgrade a group's application. A node's only: a relay carries just the first choice. */
  readonly upgrade: boolean;
}
