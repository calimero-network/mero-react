// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { mockBootstrap } = vi.hoisted(() => ({
  mockBootstrap: vi.fn(async () => ({ ok: false, step: 'admitters-lookup', reason: 'stub' })),
}));
vi.mock('@calimero-network/mero-js', async (importActual) => ({
  ...(await importActual<typeof import('@calimero-network/mero-js')>()),
  bootstrapFromInvitation: mockBootstrap,
}));

import { MeroContext } from '../context';
import { enrolledDevice } from '../test-utils/enrolledDevice';
import { useDelegatedBootstrap } from './useDelegatedBootstrap';

function wrapper(cloudBaseUrl?: string) {
  const value = { connectWithAccount: () => {}, cloudBaseUrl } as unknown as React.ContextType<typeof MeroContext>;
  return ({ children }: { children: React.ReactNode }) => (
    <MeroContext.Provider value={value}>{children}</MeroContext.Provider>
  );
}

describe('useDelegatedBootstrap cloud', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => sessionStorage.clear());

  it('asks the cloud the provider names', async () => {
    await enrolledDevice();
    const { result } = renderHook(() => useDelegatedBootstrap(), { wrapper: wrapper('http://127.0.0.1:4499') });
    await result.current.bootstrap({ namespaceId: 'ns', invitation: {} as never });
    expect(mockBootstrap).toHaveBeenCalledWith(expect.objectContaining({ cloudBaseUrl: 'http://127.0.0.1:4499' }));
  });
});
