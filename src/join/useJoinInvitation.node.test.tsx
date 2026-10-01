// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MeroContext } from '../context';
import { useJoinInvitation } from './useJoinInvitation';

function wrapperWith(admin: Record<string, unknown>) {
  const value = { mero: { admin }, isDelegated: false } as unknown as React.ContextType<typeof MeroContext>;
  return ({ children }: { children: React.ReactNode }) => (
    <MeroContext.Provider value={value}>{children}</MeroContext.Provider>
  );
}

describe('useJoinInvitation on a node', () => {
  it('joins the namespace alone when the invitation names no context', async () => {
    const admin = { joinNamespace: vi.fn(async () => ({})), joinContext: vi.fn(async () => ({})) };
    const { result } = renderHook(() => useJoinInvitation(), { wrapper: wrapperWith(admin) });
    const out = await result.current.joinInvitation({ namespaceId: 'ns-1', invitation: {} as never });
    expect(out).toEqual({ ok: true });
    expect(admin.joinNamespace).toHaveBeenCalledWith('ns-1', { invitation: {} });
    expect(admin.joinContext).not.toHaveBeenCalled();
  });

  it('still joins the named context when there is one', async () => {
    const admin = { joinNamespace: vi.fn(async () => ({})), joinContext: vi.fn(async () => ({})) };
    const { result } = renderHook(() => useJoinInvitation(), { wrapper: wrapperWith(admin) });
    await result.current.joinInvitation({ namespaceId: 'ns-1', contextId: 'ctx-1', invitation: {} as never });
    expect(admin.joinContext).toHaveBeenCalledWith('ctx-1');
  });
});
