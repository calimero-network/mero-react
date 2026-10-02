// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { mockBootstrap } = vi.hoisted(() => ({
  mockBootstrap: vi.fn(async () => ({ ok: false, step: 'admitters-lookup', reason: 'stub' })),
}));
vi.mock('./bootstrap-from-invitation', () => ({ bootstrapFromInvitation: mockBootstrap }));

import { MeroContext } from '../context';
import { saveDelegatedCredential } from './session';
import { useDelegatedBootstrap } from './useDelegatedBootstrap';

function wrapper(cloudBaseUrl?: string) {
  const value = { connectWithAccount: () => {}, cloudBaseUrl } as unknown as React.ContextType<typeof MeroContext>;
  return ({ children }: { children: React.ReactNode }) => (
    <MeroContext.Provider value={value}>{children}</MeroContext.Provider>
  );
}

describe('useDelegatedBootstrap cloud', () => {
  afterEach(() => sessionStorage.clear());

  it('asks the cloud the provider names', async () => {
    saveDelegatedCredential({ account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32) });
    const { result } = renderHook(() => useDelegatedBootstrap(), { wrapper: wrapper('http://127.0.0.1:4499') });
    await result.current.bootstrap({ namespaceId: 'ns', invitation: {} as never });
    expect(mockBootstrap).toHaveBeenCalledWith(expect.objectContaining({ cloudBaseUrl: 'http://127.0.0.1:4499' }));
  });
});
