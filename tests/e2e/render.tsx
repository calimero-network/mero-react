/**
 * renderHook helper that provides a REAL authenticated MeroJs through
 * `MeroContext`, so the hooks under test hit live core. This bypasses the
 * provider's OAuth UI flow (not headless-drivable; covered by node-trust unit
 * tests) and exercises the hooks themselves — which is where the read-hook
 * stale-data and data-shape bugs live.
 */
import React from 'react';
import { renderHook } from '@testing-library/react';
import type { MeroJs } from '@calimero-network/mero-js';
import { MeroContext } from '../../src/context/MeroContext';
import type { MeroContextValue } from '../../src/types';

export function meroContextValue(mero: MeroJs): MeroContextValue {
  return {
    mero,
    isAuthenticated: true,
    isOnline: true,
    // Hooks read only `mero` from context; nodeUrl/ids are unused by them.
    nodeUrl: null,
    applicationId: null,
    contextId: null,
    contextIdentity: null,
    connectToNode: () => {},
    logout: () => {},
    isLoading: false,
  };
}

export function wrapperFor(mero: MeroJs): React.FC<{ children: React.ReactNode }> {
  const value = meroContextValue(mero);
  return function MeroTestProvider({ children }) {
    return <MeroContext.Provider value={value}>{children}</MeroContext.Provider>;
  };
}

/** renderHook with the live-MeroJs context already wired in. */
export function renderHookWithMero<TResult, TProps>(
  mero: MeroJs,
  cb: (props: TProps) => TResult,
  options?: { initialProps?: TProps },
) {
  return renderHook(cb, { wrapper: wrapperFor(mero), ...options });
}
