// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MeroContext } from '../context';
import { enrolledDevice } from '../test-utils/enrolledDevice';
import { useJoinInvitation } from './useJoinInvitation';

const value = { mero: null, isDelegated: true, connectWithAccount: () => {} } as unknown as React.ContextType<typeof MeroContext>;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MeroContext.Provider value={value}>{children}</MeroContext.Provider>
);

describe('useJoinInvitation on an account', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => sessionStorage.clear());

  // An app puts these in its own effect dependencies. A new identity on every
  // render re-runs those effects on every render: "Maximum update depth".
  it('keeps the same callbacks across renders while the credential is unchanged', async () => {
    await enrolledDevice();
    const { result, rerender } = renderHook(() => useJoinInvitation(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current.invitationRedeemer).toBe(first.invitationRedeemer);
    expect(result.current.joinInvitation).toBe(first.joinInvitation);
    expect(result.current.memberships).toBe(first.memberships);
  });
});
