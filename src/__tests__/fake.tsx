import React from 'react';
import { vi } from 'vitest';
import type {
  CalimeroClient,
  CalimeroSession,
  CloudEvent,
  OpenConsentOptions,
  PasskeyProvider,
} from '@calimero-network/mero-js';
import { MeroProvider } from '../context';
import { memorySessionStore, type SessionStore } from '../storage';

export const SESSION: CalimeroSession = {
  accountId: 'acct-1',
  sessionToken: 'v2.claims.sig',
  expiresAt: 2_000_000_000,
  refreshToken: 'rt_1',
};

export const passkey: PasskeyProvider = {
  create: vi.fn(async () => ({}) as never),
  get: vi.fn(async () => ({}) as never),
};

/** A stand-in for CalimeroClient: only what the hooks use, each a spy. */
export function fakeClient(overrides: Record<string, unknown> = {}) {
  const base = {
    nodeUrl: 'https://node.test',
    session: SESSION as CalimeroSession | undefined,
    signIn: vi.fn(async () => SESSION),
    signUp: vi.fn(async () => SESSION),
    signOut: vi.fn(async () => undefined),
    signOutEverywhere: vi.fn(async () => undefined),
    me: vi.fn(async () => ({ accountId: SESSION.accountId })),
    getApp: vi.fn(async (app: string) => ({ appId: app, name: 'kv' })),
    call: vi.fn(async () => ({ index: 7, result: 'ok', events: [] })),
    callConfirmed: vi.fn(async () => ({ index: 8, result: 'confirmed', events: [] })),
    view: vi.fn(async () => ({ index: 7, result: { value: 1 } })),
    appAbi: vi.fn(async () => ({})),
    events: vi.fn(async function* (): AsyncGenerator<CloudEvent> {}),
    listApps: vi.fn(async () => []),
    createApp: vi.fn(async () => 'app-new'),
    deleteApp: vi.fn(async () => undefined),
    upgradeApp: vi.fn(async () => ({ index: 1, status: 'ok', error: null })),
    getOrg: vi.fn(async () => ({ releaseApprovers: [], publishes: [], newWorkStopped: null })),
    createOrg: vi.fn(async () => 'org-1'),
    createTeam: vi.fn(async () => 'team-1'),
    invite: vi.fn(async () => 'tok-1'),
    setMember: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => ({})),
    setCapabilities: vi.fn(async () => undefined),
    setTeamMember: vi.fn(async () => undefined),
    removeTeamMember: vi.fn(async () => undefined),
    addPasskey: vi.fn(async () => 'cred-2'),
    removePasskey: vi.fn(async () => undefined),
    listApiKeys: vi.fn(async () => [{ keyId: 'k-1' }]),
    createApiKey: vi.fn(async () => ({ keyId: 'k-2', key: 'ak_secret' })),
    revokeApiKey: vi.fn(async () => undefined),
    redeemInvite: vi.fn(async () => ({ org: 'org-1' })),
    requestConsent: vi.fn(async () => ({
      requestId: 'req-1',
      url: 'https://node.test/consent/req-1',
      expiresAt: 9e9,
      code: 'ABC-123',
    })),
    openConsentPage: vi.fn(async (_req: unknown, how?: ((url: string) => void) | OpenConsentOptions) => {
      const started = { requestId: 'req-1', url: 'https://node.test/consent/req-1', expiresAt: 9e9, code: 'ABC-123' };
      const options = typeof how === 'function' ? { navigate: how } : (how ?? {});
      if (options.confirm && !(await options.confirm(started))) return started;
      options.navigate?.(started.url);
      return started;
    }),
    consentResult: vi.fn(async () => ({ requestId: 'req-1', kind: 'upgrade', status: 'approved', decidedAt: 1 })),
    waitForConsent: vi.fn(async () => ({ requestId: 'req-1', kind: 'upgrade', status: 'approved', decidedAt: 1 })),
    uploadBlob: vi.fn(async () => ({ blobId: 'b58', id: 'hex', size: 3 })),
    publishPresence: vi.fn(async () => undefined),
    presenceStream: vi.fn(async function* (): AsyncGenerator<CloudEvent> {}),
    ...overrides,
  };
  return base as typeof base & CalimeroClient;
}

export function wrapper(
  client: CalimeroClient,
  { store = memorySessionStore(SESSION), appId = 'app-1' }: { store?: SessionStore; appId?: string } = {},
) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MeroProvider client={client} sessionStore={store} appId={appId} passkey={passkey}>
        {children}
      </MeroProvider>
    );
  };
}
