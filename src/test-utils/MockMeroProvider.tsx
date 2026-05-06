/**
 * MockMeroProvider — a non-functional MeroContext provider for stories,
 * tests, and visual prototyping. Supplies the same shape `useMero()` reads
 * from so any component that depends on context renders without spinning up
 * a real MeroJs instance, talking to a node, or touching localStorage.
 *
 * The action callbacks (`connectToNode`, `logout`) just log so you can see
 * what would have fired.
 */

import React from 'react';
import { MeroContext } from '../context';
import type { MeroContextValue } from '../types';

export interface MockMeroProviderProps {
  children?: React.ReactNode;
  isAuthenticated?: boolean;
  isOnline?: boolean;
  isLoading?: boolean;
  nodeUrl?: string | null;
  applicationId?: string | null;
  contextId?: string | null;
  contextIdentity?: string | null;
}

export function MockMeroProvider({
  children,
  isAuthenticated = false,
  isOnline = true,
  isLoading = false,
  nodeUrl = 'http://node1.127.0.0.1.nip.io',
  applicationId = 'mock-application-id',
  contextId = 'mock-context-id',
  contextIdentity = 'mock-context-identity',
}: MockMeroProviderProps) {
  const value: MeroContextValue = {
    mero: null,
    isAuthenticated,
    isOnline,
    isLoading,
    nodeUrl: isAuthenticated ? nodeUrl : null,
    applicationId: isAuthenticated ? applicationId : null,
    contextId: isAuthenticated ? contextId : null,
    contextIdentity: isAuthenticated ? contextIdentity : null,
    connectToNode: (url: string) => {
      console.info('[MockMeroProvider] connectToNode →', url);
    },
    logout: () => {
      console.info('[MockMeroProvider] logout');
    },
  };

  return <MeroContext.Provider value={value}>{children}</MeroContext.Provider>;
}

export default MockMeroProvider;
