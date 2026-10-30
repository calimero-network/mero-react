import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorFrom, upgradeConsent, type CloudEvent } from '@calimero-network/mero-js';
import {
  useApp,
  useApps,
  useConsent,
  useCreateApp,
  useCreateInvite,
  useCreateTeam,
  useEphemeral,
  useExecute,
  useInviteRedemption,
  useOrg,
  useSubscription,
  useUploadBlob,
  useView,
} from '../hooks';
import { useMero } from '../context';
import { memorySessionStore } from '../storage';
import { fakeClient, passkey, SESSION, wrapper } from './fake';

describe('calls and views', () => {
  it('useApp reads the app and binds call / view to it', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useApp(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.app).toEqual({ appId: 'app-1', name: 'kv' }));
    await result.current.call('set', { key: 'a' });
    expect(client.call).toHaveBeenCalledWith('app-1', 'set', { key: 'a' }, undefined);
    await result.current.view('get', { key: 'a' }, { stale: true });
    expect(client.view).toHaveBeenCalledWith('app-1', 'get', { key: 'a' }, { stale: true });
  });

  it('useExecute resolves the result and passes an idempotency key', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useExecute('app-9'), { wrapper: wrapper(client) });
    let value: unknown;
    await act(async () => {
      value = await result.current.execute('set', { key: 'a' }, { idempotencyKey: 'k1' });
    });
    expect(value).toBe('ok');
    expect(client.call).toHaveBeenCalledWith('app-9', 'set', { key: 'a' }, 'k1');
  });

  it('useExecute answers a confirm method with the passkey', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useExecute(), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current.execute('clear', {}, { confirm: true });
    });
    expect(client.callConfirmed).toHaveBeenCalledWith('app-1', 'clear', {}, passkey, undefined);
  });

  it('useExecute surfaces the app error, typed', async () => {
    const refusal = errorFrom(422, { error: 'APP_ERROR', details: { code: 'Taken', fields: { key: 'a' } } });
    const client = fakeClient({ call: vi.fn(async () => Promise.reject(refusal)) });
    const { result } = renderHook(() => useExecute(), { wrapper: wrapper(client) });
    await act(async () => {
      expect(await result.current.execute('set')).toBeNull();
    });
    expect(result.current.error).toBeInstanceOf(AppError);
    expect(result.current.failure).toMatchObject({ kind: 'app', appCode: 'Taken', fields: { key: 'a' } });
  });

  it('useExecute rethrows with throwOnError', async () => {
    const client = fakeClient({ call: vi.fn(async () => Promise.reject(errorFrom(404, { error: 'NOT_FOUND' }))) });
    const { result } = renderHook(() => useExecute(undefined, { throwOnError: true }), { wrapper: wrapper(client) });
    await act(async () => {
      await expect(result.current.execute('x')).rejects.toMatchObject({ status: 404 });
    });
  });

  it('a refused refresh during a call signs the page out', async () => {
    const client = fakeClient({ call: vi.fn(async () => Promise.reject(errorFrom(401, { error: 'UNAUTHENTICATED' }))) });
    const { result } = renderHook(() => ({ exec: useExecute(), mero: useMero() }), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current.exec.execute('x');
    });
    expect(result.current.mero.isAuthenticated).toBe(false);
  });

  it('useView reads, and reads again when the arguments change', async () => {
    const client = fakeClient();
    const { result, rerender } = renderHook(({ key }) => useView<{ value: number }>('get', { key }), {
      wrapper: wrapper(client),
      initialProps: { key: 'a' },
    });
    await waitFor(() => expect(result.current.data).toEqual({ value: 1 }));
    expect(result.current.index).toBe(7);
    rerender({ key: 'b' });
    await waitFor(() => expect(client.view).toHaveBeenLastCalledWith('app-1', 'get', { key: 'b' }, { stale: undefined, minIndex: undefined }));
  });

  it('nothing reads while signed out', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useView('get'), { wrapper: wrapper(client, { store: memorySessionStore() }) });
    await new Promise((r) => setTimeout(r, 10));
    expect(client.view).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});

describe('useSubscription', () => {
  it('delivers events and aborts the stream on unmount', async () => {
    let seen: AbortSignal | undefined;
    const client = fakeClient({
      events: vi.fn(async function* (_app: string, _from: number, signal: AbortSignal): AsyncGenerator<CloudEvent> {
        seen = signal;
        yield { id: '3:0', kind: 'Added', data: { k: 'a' } };
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      }),
    });
    const got: unknown[] = [];
    const { unmount } = renderHook(() => useSubscription('app-1', (e) => got.push(e)), { wrapper: wrapper(client) });
    await waitFor(() => expect(got).toHaveLength(1));
    expect(got[0]).toEqual({ appId: 'app-1', id: '3:0', index: 3, seq: 0, kind: 'Added', data: { k: 'a' } });
    expect((client.events.mock.calls[0] as unknown[])[1]).toBe(Number.MAX_SAFE_INTEGER);
    unmount();
    expect(seen?.aborted).toBe(true);
  });

  it('reopens from the last event and skips what it already delivered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let round = 0;
      const client = fakeClient({
        events: vi.fn(async function* (_app: string, _from: number, signal: AbortSignal): AsyncGenerator<CloudEvent> {
          round += 1;
          if (round === 1) {
            yield { id: '5:0', kind: 'A', data: 1 };
            yield { id: '5:1', kind: 'B', data: 2 };
            return; // the node closed the stream
          }
          yield { id: '5:0', kind: 'A', data: 1 };
          yield { id: '5:1', kind: 'B', data: 2 };
          yield { id: '6:0', kind: 'C', data: 3 };
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        }),
      });
      const kinds: string[] = [];
      const { unmount } = renderHook(() => useSubscription(['app-1'], (e) => kinds.push(e.kind), { from: 0 }), {
        wrapper: wrapper(client),
      });
      await waitFor(() => expect(kinds).toEqual(['A', 'B']));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      await waitFor(() => expect(kinds).toEqual(['A', 'B', 'C']));
      expect((client.events.mock.calls[0] as unknown[])[1]).toBe(0);
      expect((client.events.mock.calls[1] as unknown[])[1]).toBe(5);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops and signs out when the session is gone', async () => {
    const client = fakeClient({
      events: vi.fn(async function* (): AsyncGenerator<CloudEvent> {
        throw errorFrom(401, { error: 'UNAUTHENTICATED' });
      }),
    });
    const { result } = renderHook(
      () => {
        useSubscription('app-1', () => undefined);
        return useMero();
      },
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
  });
});

describe('apps, orgs, teams, invites', () => {
  it('lists and creates apps', async () => {
    const client = fakeClient({ listApps: vi.fn(async () => [{ appId: 'a' }]) });
    const { result } = renderHook(() => ({ list: useApps({ package: 'com.x' }), create: useCreateApp() }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.list.data).toEqual([{ appId: 'a' }]));
    expect(client.listApps).toHaveBeenCalledWith({ package: 'com.x', bundle: undefined });
    let id: string | null = null;
    await act(async () => {
      id = await result.current.create.create({ name: 'kv', bundle: { package: 'com.x' }, org: 'org-1' });
    });
    expect(id).toBe('app-new');
    expect(client.createApp).toHaveBeenCalledWith('kv', { package: 'com.x' }, { org: 'org-1' });
  });

  it('reads an org and creates a team', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => ({ org: useOrg('org-1'), team: useCreateTeam() }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.org.data?.newWorkStopped).toBeNull());
    await act(async () => {
      await result.current.team.create({ orgId: 'org-1', name: 'design' });
    });
    expect(client.createTeam).toHaveBeenCalledWith('org-1', 'design', 'invite', undefined);
  });

  it('mints an invite link that carries the token in the fragment', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useCreateInvite(), { wrapper: wrapper(client) });
    let made: { token: string; link: string } | null = null;
    await act(async () => {
      made = await result.current.create({ orgId: 'org-1', teams: ['t'], linkBase: 'https://app.test/join' });
    });
    expect(client.invite).toHaveBeenCalledWith('org-1', 'member', ['t'], { ttlSecs: undefined, uses: undefined });
    expect(made).toEqual({ token: 'tok-1', link: 'https://app.test/join#invite=tok-1' });
  });

  describe('useInviteRedemption', () => {
    beforeEach(() => {
      sessionStorage.clear();
      window.history.replaceState(null, '', '/page?x=1#invite=tok-9');
    });

    it('waits for sign-in, then redeems and cleans the address bar', async () => {
      const client = fakeClient();
      const { result } = renderHook(() => ({ inv: useInviteRedemption(), mero: useMero() }), {
        wrapper: wrapper(client, { store: memorySessionStore() }),
      });
      expect(result.current.inv.token).toBe('tok-9');
      await waitFor(() => expect(result.current.inv.status).toBe('waiting-for-sign-in'));
      expect(window.location.hash).toBe('');
      expect(window.location.search).toBe('?x=1');
      await act(async () => {
        await result.current.mero.signIn();
      });
      await waitFor(() => expect(result.current.inv.status).toBe('redeemed'));
      expect(client.redeemInvite).toHaveBeenCalledTimes(1);
      expect(client.redeemInvite).toHaveBeenCalledWith('tok-9');
      expect(sessionStorage.getItem('mero:pendingInvite')).toBeNull();
    });

    it('reports a refused invite', async () => {
      const client = fakeClient({ redeemInvite: vi.fn(async () => Promise.reject(errorFrom(404, { error: 'NOT_FOUND' }))) });
      const { result } = renderHook(() => useInviteRedemption(), { wrapper: wrapper(client) });
      await waitFor(() => expect(result.current.status).toBe('failed'));
      expect(result.current.failure?.kind).toBe('not-found');
    });
  });
});

describe('consent, blobs, presence', () => {
  it('opens the consent page and waits for the decision', async () => {
    const client = fakeClient();
    const navigate = vi.fn();
    const { result } = renderHook(() => useConsent(), { wrapper: wrapper(client) });
    const req = upgradeConsent('app-1', '1.2.0', 'https://app.test/back');
    await act(async () => {
      await result.current.open(req, navigate);
    });
    expect(navigate).toHaveBeenCalledWith('https://node.test/consent/req-1');
    expect(result.current.started?.requestId).toBe('req-1');
    await act(async () => {
      await result.current.wait('req-1', { intervalMs: 5 });
    });
    expect(client.waitForConsent).toHaveBeenCalledWith('req-1', expect.objectContaining({ intervalMs: 5, expiresAt: 9e9 }));
    expect(result.current.result?.status).toBe('approved');
  });

  it('uploads a Blob as bytes to the app', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useUploadBlob(), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current.upload(new Uint8Array([1, 2, 3]));
    });
    expect(client.uploadBlob).toHaveBeenCalledWith('app-1', new Uint8Array([1, 2, 3]));
  });

  it('presence: follows the snapshot and changes, publishes and retracts', async () => {
    const hex = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)), (b) => b.toString(16).padStart(2, '0')).join('');
    let push: ((e: CloudEvent) => void) | null = null;
    const client = fakeClient({
      presenceStream: vi.fn(async function* (_app: string, signal: AbortSignal): AsyncGenerator<CloudEvent> {
        yield {
          id: '',
          kind: 'snapshot',
          data: [
            { account: 'bob', device: 'd1', state: hex({ cursor: 1 }) },
            { account: SESSION.accountId, device: 'me', state: hex({ cursor: 0 }) },
          ],
        };
        const queue: CloudEvent[] = [];
        let wake: (() => void) | null = null;
        push = (e) => {
          queue.push(e);
          wake?.();
        };
        while (!signal.aborted) {
          if (queue.length) yield queue.shift() as CloudEvent;
          else await new Promise<void>((r) => (wake = r));
        }
      }),
    });
    const { result, unmount } = renderHook(() => useEphemeral<{ cursor: number }>('app-1', { throttleMs: 0 }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.peers.get('bob')).toEqual({ cursor: 1 }));
    expect(result.current.peers.has(SESSION.accountId)).toBe(false);
    act(() => push?.({ id: '', kind: 'presence', data: { account: 'bob', device: 'd1', state: null } }));
    await waitFor(() => expect(result.current.peers.size).toBe(0));

    act(() => result.current.setPresence({ cursor: 4 }));
    await waitFor(() => expect(client.publishPresence).toHaveBeenCalledTimes(1));
    const [app, , bytes] = client.publishPresence.mock.calls[0] as unknown as [string, number, Uint8Array];
    expect(app).toBe('app-1');
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ cursor: 4 });
    unmount();
    expect(client.publishPresence).toHaveBeenLastCalledWith('app-1', expect.any(Number), null);
  });
});
