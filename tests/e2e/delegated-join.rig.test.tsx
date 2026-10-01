/**
 * LOCAL RIG ONLY (poc/local-relay-rig, run with RIG_DIR set). The real
 * MeroProvider + useJoinInvitation against a relay on the rig: an account with
 * no node redeems an invitation through mero-js's redeemInvitation, using the
 * hook's invitationRedeemer. The only fake is the production cloud's admitter
 * lookup, which cannot know the rig's relays; it answers with relay A.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as mero from '@calimero-network/mero-js';
import { MeroProvider, AppMode, useJoinInvitation } from '../../src';
import { saveDelegatedCredential } from '../../src/delegated/session';

const RIG = process.env.RIG_DIR;
const run = RIG ? describe : describe.skip;
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

async function enrol(): Promise<string> {
  // A fresh account, enrolled (credential only: no relay yet), as after the wallet.
  const root = await mero.generateAccountRoot();
  const sign = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const agree = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const device = await mero.mintDeviceId(root.accountId, crypto.getRandomValues(new Uint8Array(16)));
  const credential = await mero.signDeviceCert({ rootSecret: root.secret, device, deviceEpoch: 1,
    signPublicKey: hex(await crypto.subtle.exportKey('raw', sign.publicKey)),
    kemPublicKey: hex(await crypto.subtle.exportKey('raw', agree.publicKey)) });
  saveDelegatedCredential({ account: root.accountId, credential,
    deviceSecret: hex((await crypto.subtle.exportKey('pkcs8', sign.privateKey)).slice(16)) });
  return root.accountId;
}

run('useJoinInvitation on the rig (account, through a relay)', () => {
  it('joins, lists the membership, redeems again idempotently, and refuses a tampered invitation for good', async () => {
    const invite = JSON.parse(readFileSync(`${RIG}/invite-a.json`, 'utf8'));
    const env = Object.fromEntries(readFileSync(`${RIG}/rig2.env`, 'utf8').trim().split('\n').map((l) => l.split('=')));
    const RELAY = 'http://127.0.0.1:4480';

    // The production cloud's admitter lookup, answered for the rig.
    const real = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/cloud/namespaces/') && url.includes('/admitters')) {
        return new Response(JSON.stringify({
          namespace_id: invite.namespaceId, servable: true, writable: true,
          admitters: [{ peer_id: 'rig-relay-a', account: env.ACCOUNT_A, relay_url: RELAY,
            admit_url: `${RELAY}/admin-api/namespaces/${invite.namespaceId}/admit`, status: 'active', fresh: true,
            can_admit: true, authorship_ready: true, tee_role: 'RelayTee', can_execute: true }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // jsdom's AbortSignal is not undici's; the rig answers fast, so drop it.
      const { signal: _s, ...rest } = init ?? {};
      return real(input, rest);
    }) as typeof fetch;

    await enrol();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MeroProvider mode={AppMode.MultiContext} packageName="com.calimero.kv-store">{children}</MeroProvider>
    );
    const { result, unmount } = renderHook(() => useJoinInvitation(), { wrapper });
    const input = { namespaceId: invite.namespaceId, contextId: invite.contextId, invitation: invite.invitation };

    const first = await mero.redeemInvitation({ namespaceId: input.namespaceId, invitation: input.invitation },
      result.current.invitationRedeemer(input));
    expect(first.status).toBe('joined');

    await waitFor(async () => expect(await result.current.memberships()).toContain(invite.namespaceId), { timeout: 30000 });

    const again = await mero.redeemInvitation({ namespaceId: input.namespaceId, invitation: input.invitation },
      result.current.invitationRedeemer(input));
    expect(['joined', 'already-member']).toContain(again.status);

    // A signature that is not the inviter's, redeemed by an account not yet in:
    // the admitter refuses it, for good.
    // Switching accounts the way logout does: both records go.
    unmount();
    sessionStorage.clear();
    await enrol();
    expect(await renderHook(() => useJoinInvitation(), { wrapper }).result.current.memberships()).toEqual([]);
    const second = renderHook(() => useJoinInvitation(), { wrapper });
    const bad = structuredClone(invite.invitation);
    const sig: string = bad.inviter_signature;
    const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
    bad.inviter_signature = flipped;
    const badInput = { ...input, invitation: bad };
    const refused = await mero.redeemInvitation({ namespaceId: input.namespaceId, invitation: bad },
      second.result.current.invitationRedeemer(badInput));
    expect(refused.status).toBe('failed');
    if (refused.status === 'failed') expect(refused.retryable).toBe(false);
  });
});
