// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayClient } from '@calimero-network/mero-js';
import { foundDelegatedNamespace } from './create-context';
import { rememberRelay } from './session';

const ACCOUNT = 'aa'.repeat(32);
const EXECUTOR = '6a'.repeat(32);
const RELAY = 'https://relay.example';
const session = (extra: Record<string, unknown> = {}) =>
  ({ account: ACCOUNT, credential: 'cc', deviceSecret: '11'.repeat(32), relayUrl: RELAY, ...extra }) as never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let found: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let describe_: any;

beforeEach(() => {
  localStorage.clear();
  found = vi
    .spyOn(RelayClient.prototype, 'foundNamespace')
    .mockResolvedValue({ namespaceId: 'ab'.repeat(32), salt: 'cd'.repeat(32), teeEnabled: true } as never);
  describe_ = vi
    .spyOn(RelayClient.prototype, 'describeGovernance')
    .mockResolvedValue({ executorAccount: 'de'.repeat(32) } as never);
});
afterEach(() => vi.restoreAllMocks());

describe('foundDelegatedNamespace', () => {
  // A brand-new account is in nothing, so no namespace can tell it the relay's
  // account. When the app knows it (the cloud's machine page names it), the
  // account founds with it directly: the documented mero-js path, no join first.
  it('founds with the executor account the session names, without joining anything first', async () => {
    await expect(foundDelegatedNamespace(session({ executorAccount: EXECUTOR }))).resolves.toEqual({
      namespaceId: 'ab'.repeat(32),
      teeEnabled: true,
    });
    expect(found).toHaveBeenCalledWith(expect.objectContaining({ executorAccount: EXECUTOR }));
    expect(describe_).not.toHaveBeenCalled();
  });

  it('still learns the account from a namespace it is in, when the session names none', async () => {
    rememberRelay(ACCOUNT, RELAY, { namespaceId: 'ee'.repeat(32) });
    await foundDelegatedNamespace(session());
    expect(describe_).toHaveBeenCalledWith('ee'.repeat(32));
    expect(found).toHaveBeenCalledWith(expect.objectContaining({ executorAccount: 'de'.repeat(32) }));
  });

  it('tells a brand-new account with no known executor how to get one', async () => {
    await expect(foundDelegatedNamespace(session())).rejects.toThrow(/executor account/);
    expect(found).not.toHaveBeenCalled();
  });

  it('remembers the founded namespace on the relay', async () => {
    await foundDelegatedNamespace(session({ executorAccount: EXECUTOR }));
    const map = JSON.parse(localStorage.getItem(`calimero.delegated.relays.${ACCOUNT}`) ?? '{}');
    expect(map.namespaces['ab'.repeat(32)]).toBe(RELAY);
  });
});
