import { describe, it, expect } from 'vitest';
import type { TokenData } from '@calimero-network/mero-js';
import { decodeJwtClaims, expiresAtFromJwt, resolveTokenAdoption } from './token-adoption';

const SEC = 1000;

/** Build an unsigned JWT carrying the given claims (only the payload is ever read). */
function jwt(claims: { iat?: number; exp?: number; sub?: string }): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

const NODE = 'https://node-a.example.com';
const OTHER_NODE = 'https://node-b.example.com';

/** Seconds-since-epoch helpers, kept far from `now` so nothing is flaky. */
const t = (offsetSec: number) => Math.floor(Date.now() / 1000) + offsetSec;

function storedBundle(over: Partial<TokenData> = {}): TokenData {
  const access = jwt({ iat: t(-60), exp: t(3540) });
  return {
    access_token: access,
    refresh_token: 'stored-refresh',
    expires_at: t(3540) * SEC,
    ...over,
  };
}

describe('decodeJwtClaims', () => {
  it('reads iat and exp from a well-formed JWT', () => {
    expect(decodeJwtClaims(jwt({ iat: 1000, exp: 2000 }))).toEqual({ iat: 1000, exp: 2000 });
  });

  it('returns null for a non-JWT / malformed token', () => {
    expect(decodeJwtClaims('opaque-token')).toBeNull();
    expect(decodeJwtClaims('a.b.c')).toBeNull();
    expect(decodeJwtClaims('')).toBeNull();
  });

  it('drops non-positive / non-numeric claims', () => {
    expect(decodeJwtClaims(jwt({ iat: 0, exp: -1 }))).toEqual({ iat: undefined, exp: undefined });
    expect(decodeJwtClaims(jwt({ sub: 'no-timestamps' }))).toEqual({
      iat: undefined,
      exp: undefined,
    });
  });
});

describe('expiresAtFromJwt', () => {
  it('converts the exp claim to epoch ms', () => {
    expect(expiresAtFromJwt(jwt({ exp: 2000 }))).toBe(2_000_000);
  });

  it('falls back when the token carries no readable expiry', () => {
    expect(expiresAtFromJwt('opaque-token', 12345)).toBe(12345);
  });
});

describe('resolveTokenAdoption', () => {
  it('seeds from the hash on a fresh login (nothing stored)', () => {
    const access = jwt({ iat: t(0), exp: t(3600) });

    const d = resolveTokenAdoption({
      callbackAccessToken: access,
      callbackRefreshToken: 'r1',
      callbackNodeUrl: NODE,
      stored: null,
      storedNodeUrl: null,
    });

    expect(d).toEqual({
      adopt: true,
      reason: 'fresh-login',
      tokens: { access_token: access, refresh_token: 'r1', expires_at: t(3600) * SEC },
    });
  });

  it('does NOT overwrite a newer stored bundle with a stale hash bundle', () => {
    // The regression this whole module exists for: mero-js has already rotated
    // the stored bundle, and the SSO hash still carries the pre-rotation copy.
    // Adopting it would replay a consumed refresh token → token_reuse → the node
    // revokes the entire family and every holder is hard-logged-out.
    const stale = jwt({ iat: t(-600), exp: t(3000) });
    const stored = storedBundle({
      access_token: jwt({ iat: t(-60), exp: t(3540) }),
      refresh_token: 'rotated-refresh',
    });

    const d = resolveTokenAdoption({
      callbackAccessToken: stale,
      callbackRefreshToken: 'consumed-refresh',
      callbackNodeUrl: NODE,
      stored,
      storedNodeUrl: NODE,
    });

    expect(d).toEqual({ adopt: false, reason: 'stale' });
  });

  it('does NOT re-adopt a hash bundle that merely replays the stored access token', () => {
    // Same tokens, e.g. a reload of the callback URL. Nothing is newer, so the
    // rotated refresh token in the store must survive untouched.
    const stored = storedBundle({ refresh_token: 'rotated-refresh' });

    const d = resolveTokenAdoption({
      callbackAccessToken: stored.access_token,
      callbackRefreshToken: 'original-refresh',
      callbackNodeUrl: NODE,
      stored,
      storedNodeUrl: NODE,
    });

    expect(d).toEqual({ adopt: false, reason: 'stale' });
  });

  it('adopts a genuinely newer hash bundle (later iat)', () => {
    const fresh = jwt({ iat: t(60), exp: t(3660) });
    const stored = storedBundle();

    const d = resolveTokenAdoption({
      callbackAccessToken: fresh,
      callbackRefreshToken: 'r2',
      callbackNodeUrl: NODE,
      stored,
      storedNodeUrl: NODE,
    });

    expect(d).toEqual({
      adopt: true,
      reason: 'newer',
      tokens: { access_token: fresh, refresh_token: 'r2', expires_at: t(3660) * SEC },
    });
  });

  it('re-seeds when the node changed, without carrying the old node\'s refresh token over', () => {
    const access = jwt({ iat: t(-600), exp: t(3000) }); // older than stored — node change still wins
    const stored = storedBundle({ refresh_token: 'node-a-refresh' });

    const d = resolveTokenAdoption({
      callbackAccessToken: access,
      callbackRefreshToken: 'node-b-refresh',
      callbackNodeUrl: OTHER_NODE,
      stored,
      storedNodeUrl: NODE,
    });

    expect(d).toEqual({
      adopt: true,
      reason: 'node-changed',
      tokens: { access_token: access, refresh_token: 'node-b-refresh', expires_at: t(3000) * SEC },
    });
  });

  it('treats a same-origin callback URL with a different path as the same node', () => {
    const stale = jwt({ iat: t(-600), exp: t(3000) });

    const d = resolveTokenAdoption({
      callbackAccessToken: stale,
      callbackRefreshToken: 'consumed-refresh',
      callbackNodeUrl: `${NODE}/auth/callback`,
      stored: storedBundle(),
      storedNodeUrl: NODE,
    });

    expect(d).toEqual({ adopt: false, reason: 'stale' });
  });

  it('keeps the stored refresh token when an access-only hash bundle is adopted', () => {
    // Hosts are dropping `refresh_token` from the SSO hash (parseAuthCallback then
    // yields ''). Adopting the newer access token must MERGE, never replace — a
    // blank refresh_token would strip the session's ability to refresh at all.
    const fresh = jwt({ iat: t(60), exp: t(3660) });
    const stored = storedBundle({ refresh_token: 'rotated-refresh' });

    const d = resolveTokenAdoption({
      callbackAccessToken: fresh,
      callbackRefreshToken: '', // access-only hash bundle
      callbackNodeUrl: NODE,
      stored,
      storedNodeUrl: NODE,
    });

    expect(d).toEqual({
      adopt: true,
      reason: 'newer',
      tokens: {
        access_token: fresh,
        refresh_token: 'rotated-refresh', // preserved, NOT wiped
        expires_at: t(3660) * SEC,
      },
    });
  });

  it('seeds an access-only hash bundle on a fresh login (nothing to preserve)', () => {
    const access = jwt({ iat: t(0), exp: t(3600) });

    const d = resolveTokenAdoption({
      callbackAccessToken: access,
      callbackRefreshToken: '',
      callbackNodeUrl: NODE,
      stored: null,
      storedNodeUrl: null,
    });

    expect(d).toEqual({
      adopt: true,
      reason: 'fresh-login',
      tokens: { access_token: access, refresh_token: '', expires_at: t(3600) * SEC },
    });
  });

  it('fills in a missing refresh token from the hash without downgrading the access token', () => {
    const stored = storedBundle({ refresh_token: '' });

    const d = resolveTokenAdoption({
      callbackAccessToken: jwt({ iat: t(-600), exp: t(3000) }), // older
      callbackRefreshToken: 'r1',
      callbackNodeUrl: NODE,
      stored,
      storedNodeUrl: NODE,
    });

    expect(d).toEqual({
      adopt: true,
      reason: 'fill-refresh',
      tokens: { ...stored, refresh_token: 'r1' },
    });
  });

  it('falls back to the stored expires_at when the stored access token is opaque', () => {
    const stored: TokenData = {
      access_token: 'opaque',
      refresh_token: 'rotated-refresh',
      expires_at: t(3540) * SEC,
    };

    // Older than the stored expiry → stale.
    expect(
      resolveTokenAdoption({
        callbackAccessToken: jwt({ exp: t(3000) }),
        callbackRefreshToken: 'consumed-refresh',
        callbackNodeUrl: NODE,
        stored,
        storedNodeUrl: NODE,
      }),
    ).toEqual({ adopt: false, reason: 'stale' });

    // Newer than the stored expiry → adopt.
    const fresh = jwt({ exp: t(7200) });
    expect(
      resolveTokenAdoption({
        callbackAccessToken: fresh,
        callbackRefreshToken: '',
        callbackNodeUrl: NODE,
        stored,
        storedNodeUrl: NODE,
      }),
    ).toEqual({
      adopt: true,
      reason: 'newer',
      tokens: { access_token: fresh, refresh_token: 'rotated-refresh', expires_at: t(7200) * SEC },
    });
  });

  it('refuses to adopt an undecodable hash access token over a live bundle', () => {
    // Cannot establish ordering → refuse. A redundant login beats burning the family.
    const d = resolveTokenAdoption({
      callbackAccessToken: 'opaque-callback-token',
      callbackRefreshToken: 'consumed-refresh',
      callbackNodeUrl: NODE,
      stored: storedBundle(),
      storedNodeUrl: NODE,
    });

    expect(d).toEqual({ adopt: false, reason: 'stale' });
  });
});
