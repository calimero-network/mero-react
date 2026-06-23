/**
 * Trust decision for the node URL an OAuth callback wants us to authenticate
 * against.
 *
 * The auth flow redirects the browser to a node's auth UI and back to the app
 * with `access_token` / `refresh_token` / `node_url` in the callback URL. That
 * URL is attacker-influenceable, so a malicious `node_url` would otherwise make
 * the SDK send the freshly-minted tokens to an attacker's node (exfiltration).
 *
 * Defense: only authenticate against a node we can independently trust — the
 * node login was *initiated* with (saved before the redirect), or an
 * app-configured allowlist.
 */

/** True iff both URLs parse and share the same origin (scheme + host + port). */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export interface ResolveTrustedNodeParams {
  /** `node_url` from the OAuth callback (untrusted, attacker-influenceable). */
  candidate: string | null | undefined;
  /** Node URL login was initiated with, saved before the redirect (trusted). */
  initiated: string | null;
  /** Additional trusted origins, for direct-callback entry without an initiated node. */
  allowedNodeUrls?: string[];
}

export interface TrustedNodeResult {
  /** The node URL that is safe to authenticate against, or null. */
  url: string | null;
  /** A candidate node_url was present but failed validation (likely an attack). */
  rejected: boolean;
  /** Accepted without being able to validate (no initiated node and no allowlist). */
  unverified: boolean;
}

/**
 * Decide which node URL, if any, is safe to authenticate against.
 *
 * - No candidate → fall back to the initiated node.
 * - Candidate + initiated node → must share the initiated node's origin, else reject.
 * - Candidate + no initiated node + allowlist → must be in the allowlist, else reject.
 * - Candidate + no initiated node + no allowlist → accept, flagged `unverified`.
 */
export function resolveTrustedNodeUrl(params: ResolveTrustedNodeParams): TrustedNodeResult {
  const { candidate, initiated, allowedNodeUrls } = params;

  if (!candidate) {
    return { url: initiated ?? null, rejected: false, unverified: false };
  }

  if (initiated) {
    return sameOrigin(candidate, initiated)
      ? { url: candidate, rejected: false, unverified: false }
      : { url: null, rejected: true, unverified: false };
  }

  if (allowedNodeUrls && allowedNodeUrls.length > 0) {
    return allowedNodeUrls.some((u) => sameOrigin(candidate, u))
      ? { url: candidate, rejected: false, unverified: false }
      : { url: null, rejected: true, unverified: false };
  }

  return { url: candidate, rejected: false, unverified: true };
}
