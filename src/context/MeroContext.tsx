/**
 * `MeroProvider`: one `CalimeroClient` (mero-js 27, Calimero 1.0) for the tree,
 * the passkey session it holds, and the app instance hooks default to.
 *
 * There is no redirect, no callback and no token in the URL any more. Signing
 * in is a WebAuthn ceremony against the node itself (`/auth/passkey/login`),
 * over a channel sealed to the node's attested key. The session it opens is a
 * 15-minute token plus a 30-day single-use refresh token; the client refreshes
 * on a `401` by itself (one refresh shared by every request waiting on it) and
 * moves to the next node on `421 WRONG_NODE`. The provider only keeps the
 * newest session in its store and drops it when a refresh is refused.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { browserPasskey, LoginRequired } from '@calimero-network/mero-js';
import type { CalimeroClient, CalimeroSession, PasskeyProvider } from '@calimero-network/mero-js';
import { resolvePolicy, SessionReportingClient } from '../client';
import { describeError, type Failure } from '../errors';
import {
  clearNodeUrl,
  getAppId,
  getNodeUrl,
  localStorageSessionStore,
  setAppId as storeAppId,
  clearAppId,
  setNodeUrl as storeNodeUrl,
} from '../storage';
import type { MeroContextValue, MeroProviderConfig } from '../types';

export const MeroContext = createContext<MeroContextValue | null>(null);

export interface MeroProviderProps extends MeroProviderConfig {
  children: React.ReactNode;
}

const isBrowser = typeof window !== 'undefined';

function trimUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function MeroProvider({
  children,
  nodeUrl: nodeUrlProp,
  nodes,
  policy,
  minReleaseVersion,
  allowMock = false,
  servedByNode = false,
  appId: appIdProp,
  sessionStore = localStorageSessionStore,
  passkey: passkeyProp,
  fetch: fetchProp,
  retry,
  client: injectedClient,
  onError,
}: MeroProviderProps) {
  const ownOrigin = servedByNode && isBrowser ? window.location.origin : null;

  const [chosenNode, setChosenNode] = useState<string | null>(() => {
    if (ownOrigin) return ownOrigin;
    if (nodeUrlProp) return trimUrl(nodeUrlProp);
    return getNodeUrl();
  });
  const nodeUrl = ownOrigin ?? chosenNode;

  const [session, setSession] = useState<CalimeroSession | null>(() => sessionStore.load());
  const [appId, setAppIdState] = useState<string | null>(() => appIdProp ?? getAppId());
  const [isLoading, setIsLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Bumped to throw the client away: it has no way to forget a credential.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (appIdProp) setAppIdState(appIdProp);
  }, [appIdProp]);

  const passkey = useMemo<PasskeyProvider>(() => passkeyProp ?? browserPasskey(), [passkeyProp]);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const storeRef = useRef(sessionStore);
  storeRef.current = sessionStore;

  const resolvedPolicy = useMemo(
    () => (injectedClient ? null : resolvePolicy({ policy, minReleaseVersion, allowMock })),
    // A policy object literal changes identity every render; its content does not.
    [injectedClient, JSON.stringify(policy ?? null), policy?.verifyQuote, minReleaseVersion, allowMock],
  );
  const nodesKey = JSON.stringify(nodes ?? []);
  const retryKey = JSON.stringify(retry ?? {});

  const client = useMemo<CalimeroClient | null>(() => {
    if (injectedClient) return injectedClient;
    if (!nodeUrl || !resolvedPolicy) return null;
    const built = new SessionReportingClient(
      {
        baseUrl: nodeUrl,
        nodes: JSON.parse(nodesKey) as string[],
        policy: resolvedPolicy,
        fetch: fetchProp,
        retry: JSON.parse(retryKey) as typeof retry,
      },
      (fresh) => {
        storeRef.current.save(fresh);
        setSession(fresh);
      },
    );
    const kept = storeRef.current.load();
    if (kept) built.restore(kept);
    return built;
  }, [injectedClient, nodeUrl, nodesKey, resolvedPolicy, fetchProp, retryKey, generation]);

  const endSession = useCallback(() => {
    storeRef.current.clear();
    setSession(null);
    setGeneration((g) => g + 1);
  }, []);

  const reportError = useCallback(
    (error: unknown) => {
      const described = describeError(error);
      if (error instanceof LoginRequired) {
        endSession();
        setFailure(described);
      }
      onErrorRef.current?.(described);
    },
    [endSession],
  );

  const ceremony = useCallback(
    async (run: (c: CalimeroClient) => Promise<CalimeroSession>): Promise<CalimeroSession | null> => {
      if (!client) {
        const described = describeError(new Error('No node to sign in to: call connectToNode first.'));
        setFailure(described);
        onErrorRef.current?.(described);
        return null;
      }
      setIsLoading(true);
      setFailure(null);
      try {
        const fresh = await run(client);
        // An injected client does not report; keep what it answered.
        storeRef.current.save(fresh);
        setSession(fresh);
        return fresh;
      } catch (error) {
        const described = describeError(error);
        setFailure(described);
        onErrorRef.current?.(described);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [client],
  );

  const signIn = useCallback(() => ceremony((c) => c.signIn(passkey)), [ceremony, passkey]);
  const signUp = useCallback((name: string) => ceremony((c) => c.signUp(passkey, name)), [ceremony, passkey]);

  const signOutWith = useCallback(
    async (everywhere: boolean) => {
      setIsLoading(true);
      try {
        if (client?.session) {
          // The node may be unreachable; the session ends here either way.
          await (everywhere ? client.signOutEverywhere() : client.signOut()).catch(() => undefined);
        }
      } finally {
        endSession();
        setFailure(null);
        setIsLoading(false);
      }
    },
    [client, endSession],
  );
  const signOut = useCallback(() => signOutWith(false), [signOutWith]);
  const signOutEverywhere = useCallback(() => signOutWith(true), [signOutWith]);
  const logout = useCallback(() => {
    void signOutWith(false);
  }, [signOutWith]);

  const connectToNode = useCallback(
    (url: string) => {
      if (ownOrigin) return;
      const next = trimUrl(url);
      if (next === chosenNode) return;
      storeNodeUrl(next);
      // A session belongs to the cluster that issued it.
      storeRef.current.clear();
      setSession(null);
      setChosenNode(next);
    },
    [ownOrigin, chosenNode],
  );

  const disconnect = useCallback(() => {
    void signOutWith(false);
    if (!ownOrigin) {
      clearNodeUrl();
      setChosenNode(null);
    }
  }, [ownOrigin, signOutWith]);

  const setAppId = useCallback((next: string | null) => {
    if (next) storeAppId(next);
    else clearAppId();
    setAppIdState(next);
  }, []);

  const value = useMemo<MeroContextValue>(
    () => ({
      client,
      mero: client,
      nodeUrl,
      connectToNode,
      disconnect,
      session,
      accountId: session?.accountId ?? null,
      isAuthenticated: !!client && !!session,
      isLoading,
      signIn,
      signUp,
      signOut,
      signOutEverywhere,
      logout,
      appId,
      setAppId,
      passkey,
      servedByNode,
      allowMock,
      failure,
      reportError,
    }),
    [
      client,
      nodeUrl,
      connectToNode,
      disconnect,
      session,
      isLoading,
      signIn,
      signUp,
      signOut,
      signOutEverywhere,
      logout,
      appId,
      setAppId,
      passkey,
      servedByNode,
      allowMock,
      failure,
      reportError,
    ],
  );

  return <MeroContext.Provider value={value}>{children}</MeroContext.Provider>;
}

/** The provider's client, session and actions. Throws outside a `MeroProvider`. */
export function useMero(): MeroContextValue {
  const value = useContext(MeroContext);
  if (!value) throw new Error('useMero must be used within a MeroProvider');
  return value;
}
