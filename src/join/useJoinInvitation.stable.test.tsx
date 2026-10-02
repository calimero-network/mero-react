// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MeroContext } from '../context';
import { saveDelegatedCredential } from '../delegated/session';
import { useJoinInvitation } from './useJoinInvitation';

const value = { mero: null, isDelegated: true, connectWithAccount: () => {} } as unknown as React.ContextType<typeof MeroContext>;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MeroContext.Provider value={value}>{children}</MeroContext.Provider>
);

describe('useJoinInvitation on an account', () => {
  afterEach(() => sessionStorage.clear());

  // An app puts these in its own effect dependencies. A new identity on every
  // render re-runs those effects on every render: "Maximum update depth".
  it('keeps the same callbacks across renders while the credential is unchanged', () => {
    saveDelegatedCredential({ account: 'aa'.repeat(32), credential: 'cc', deviceSecret: '11'.repeat(32) });
    const { result, rerender } = renderHook(() => useJoinInvitation(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current.invitationRedeemer).toBe(first.invitationRedeemer);
    expect(result.current.joinInvitation).toBe(first.joinInvitation);
    expect(result.current.memberships).toBe(first.memberships);
  });
});
