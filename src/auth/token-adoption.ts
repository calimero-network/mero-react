/**
 * Decide whether the token bundle carried in an SSO callback hash may replace
 * the bundle already in the token store.
 *
 * Since core 0.11.0 (calimero-network/core#3083) refresh tokens are SINGLE-USE:
 * every `POST /auth/refresh` consumes the presented refresh token and returns a
 * new one. Re-presenting a consumed refresh token is treated as theft — the node
 * answers 401 `x-auth-error: token_reuse` and revokes the whole token family, so
 * *every* holder is hard-logged-out.
 *
 * That makes an unconditional `tokenStore.setTokens(callbackBundle)` on the SSO
 * callback path actively dangerous. A desktop host (or any SSO initiator) hands
 * the app a token bundle in the URL hash; if mero-js has already rotated the
 * stored refresh token, writing the hash bundle over it resurrects a *consumed*
 * refresh token. The next refresh presents it → `token_reuse` → family revoked.
 *
 * So the hash bundle is adopted only when it is safe:
 *   - there is no stored bundle (a genuinely fresh login), or
 *   - the node changed (the stored bundle belongs to a different node), or
 *   - the hash tokens are genuinely NEWER than what is stored, or
 *   - the stored bundle is missing a refresh token that the hash can supply.
 *
 * Anything else — a stale hash, or a hash replaying the access token we already
 * hold — is ignored, leaving the live (possibly rotated) bundle untouched.
 */

import type { TokenData } from '@calimero-network/mero-js';
import { sameOrigin } from './node-trust';

const HOUR_MS = 3_600_000;

interface JwtClaims {
  /** Issued-at (seconds). The authoritative rotation-order signal when present. */
  iat?: number;
  /** Expiry (seconds). */
  exp?: number;
}

/**
 * Decode a JWT's payload claims without verifying the signature.
 *
 * Verification is the node's job — we only need the ordering claims to decide
 * which of two bundles is newer, and both bundles are already node-trusted by
 * the time we get here (see `resolveTrustedNodeUrl`).
 *
 * Returns null for anything that is not a decodable three-part JWT (opaque
 * tokens, test fixtures, garbage).
 */
export function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload: unknown = JSON.parse(atob(b64));
    if (!payload || typeof payload !== 'object') return null;
    const { iat, exp } = payload as JwtClaims;
    return {
      iat: typeof iat === 'number' && iat > 0 ? iat : undefined,
      exp: typeof exp === 'number' && exp > 0 ? exp : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Absolute expiry (ms) of an access token, from its `exp` claim.
 *
 * Mirrors mero-js's internal `expiresAtFromJwt` (which it does not export —
 * checked against mero-js 6.1.0), including the "assume one hour" fallback for
 * tokens whose expiry we cannot read.
 */
export function expiresAtFromJwt(token: string, fallbackMs: number = Date.now() + HOUR_MS): number {
  const exp = decodeJwtClaims(token)?.exp;
  return exp ? exp * 1000 : fallbackMs;
}

/**
 * Is the callback's access token newer than the one we already hold?
 *
 * Prefers `iat` (issued-at) — the direct rotation-order signal — and falls back
 * to `exp`, then to the stored bundle's recorded `expires_at`. When the answer
 * cannot be established the token is NOT considered newer: refusing to adopt
 * costs a redundant login at worst, whereas adopting a stale bundle burns the
 * whole token family.
 */
function isCallbackNewer(callbackAccessToken: string, stored: TokenData): boolean {
  const incoming = decodeJwtClaims(callbackAccessToken);
  if (!incoming) return false;

  const current = decodeJwtClaims(stored.access_token);
  if (current) {
    if (incoming.iat !== undefined && current.iat !== undefined && incoming.iat !== current.iat) {
      return incoming.iat > current.iat;
    }
    if (incoming.exp !== undefined && current.exp !== undefined && incoming.exp !== current.exp) {
      return incoming.exp > current.exp;
    }
    // Same claims (a replay of the token we already hold), or nothing to compare
    // on — either way the callback brings nothing new.
    return false;
  }

  // Stored access token is not a decodable JWT — compare against the expiry the
  // store recorded for it.
  return incoming.exp !== undefined && incoming.exp * 1000 > stored.expires_at;
}

/** Why the SSO hash bundle was (or was not) written to the token store. */
export type TokenAdoptionReason =
  /** No stored bundle — a genuinely fresh login. Seed from the hash. */
  | 'fresh-login'
  /** The stored bundle belongs to a different node. Re-seed from the hash. */
  | 'node-changed'
  /** The hash tokens are genuinely newer than the stored ones. */
  | 'newer'
  /** Same session, but the stored bundle has no refresh token and the hash does. */
  | 'fill-refresh'
  /** The hash tokens are stale, or replay the access token we already hold. */
  | 'stale';

export type TokenAdoptionDecision =
  | { adopt: true; tokens: TokenData; reason: Exclude<TokenAdoptionReason, 'stale'> }
  | { adopt: false; reason: 'stale' };

export interface ResolveTokenAdoptionParams {
  /** Access token from the callback hash. Always present (mero-js returns null otherwise). */
  callbackAccessToken: string;
  /**
   * Refresh token from the callback hash. `parseAuthCallback` yields `''` when the
   * hash carries no `refresh_token` — hosts are moving to access-only bundles
   * precisely so they cannot hand back a rotated-away refresh token.
   */
  callbackRefreshToken: string;
  /** Trusted node URL the callback resolved to (see `resolveTrustedNodeUrl`). */
  callbackNodeUrl: string;
  /** Bundle currently in the token store — mero-js may have rotated it already. */
  stored: TokenData | null;
  /** Node URL the stored bundle was issued by, i.e. the node URL before this callback. */
  storedNodeUrl: string | null;
}

/**
 * Decide what (if anything) to write to the token store for an SSO callback.
 *
 * Never returns a bundle with an empty `refresh_token` when a refresh token for
 * the same node is already stored: an access-only hash bundle is MERGED over the
 * stored one, so adopting a fresher access token cannot strip the session's
 * ability to refresh.
 */
export function resolveTokenAdoption(params: ResolveTokenAdoptionParams): TokenAdoptionDecision {
  const { callbackAccessToken, callbackRefreshToken, callbackNodeUrl, stored, storedNodeUrl } =
    params;

  const bundle = (refreshToken: string): TokenData => ({
    access_token: callbackAccessToken,
    refresh_token: refreshToken,
    expires_at: expiresAtFromJwt(callbackAccessToken),
  });

  // Fresh login — nothing to protect.
  if (!stored?.access_token) {
    return { adopt: true, tokens: bundle(callbackRefreshToken), reason: 'fresh-login' };
  }

  // Different node — the stored bundle is for someone else's token family, and
  // its refresh token is meaningless here, so it must NOT be carried over.
  const sameNode = !!storedNodeUrl && sameOrigin(callbackNodeUrl, storedNodeUrl);
  if (!sameNode) {
    return { adopt: true, tokens: bundle(callbackRefreshToken), reason: 'node-changed' };
  }

  // Same node, live bundle. Keep the stored refresh token unless the hash carries
  // one — the hash's refresh token may be a copy that mero-js has already rotated
  // away, but an *empty* one would strip refresh from the session entirely.
  const refreshToken = callbackRefreshToken || stored.refresh_token;

  if (isCallbackNewer(callbackAccessToken, stored)) {
    return { adopt: true, tokens: bundle(refreshToken), reason: 'newer' };
  }

  // The access token is not newer, but the stored bundle cannot refresh and the
  // hash can repair that. Keep the *stored* access token (it is at least as new).
  if (!stored.refresh_token && callbackRefreshToken) {
    return {
      adopt: true,
      tokens: { ...stored, refresh_token: callbackRefreshToken },
      reason: 'fill-refresh',
    };
  }

  // Stale (or a replay of the bundle we already hold). Writing it would resurrect
  // a consumed refresh token → `token_reuse` → the node revokes the whole family.
  return { adopt: false, reason: 'stale' };
}
