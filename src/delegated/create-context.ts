/**
 * Create a context as an account, through the relay that serves the namespace.
 *
 * MOCK CONTRACT. Core does not have this route yet; delegated context creation
 * is being added there. This client speaks the shape agreed for it, and on the
 * local rig a stand-in service implements it (poc/local-relay-rig/
 * mock-context-create.py). When core ships the route, change what is signed and
 * where it is sent to match core, and delete the stand-in:
 *
 *   POST {relay}/admin-api/namespaces/{ns}/contexts
 *   { applicationId, initializationParams, author, credential, devicePublicKey,
 *     nonce, expiresAt, signature }            ->  { data: { contextId } }
 *
 * The request authorises itself, like a warrant on /intents: the device key
 * signs the domain string followed by the canonical JSON (sorted keys, no
 * whitespace) of {namespaceId, applicationId, initializationParams, author,
 * nonce, expiresAt}, and the certificate says the device belongs to the author.
 */
import { signerFromSecret } from '@calimero-network/mero-js';
import { readRelayMap, rememberRelay, type DelegatedSession } from './session';

export const CREATE_CONTEXT_DOMAIN = 'calimero.mock.create-context.v1\n';

/** How long a signed creation request stays valid. */
const LIFETIME_MS = 5 * 60 * 1000;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export interface CreateDelegatedContextRequest {
  readonly namespaceId: string;
  readonly applicationId: string;
  readonly initializationParams?: number[];
}

/** The signed fields, in sorted-key order so JSON.stringify is canonical. */
function signedFields(
  req: CreateDelegatedContextRequest,
  author: string,
  nonce: string,
  expiresAt: number,
) {
  return {
    applicationId: req.applicationId,
    author,
    expiresAt,
    initializationParams: req.initializationParams ?? [],
    namespaceId: req.namespaceId,
    nonce,
  };
}

export async function createDelegatedContext(
  s: DelegatedSession,
  req: CreateDelegatedContextRequest,
  deps: { fetch?: typeof fetch } = {},
): Promise<{ contextId: string }> {
  // The relay that serves this namespace: learned when the account joined it.
  const relayUrl = readRelayMap(s.account).namespaces[req.namespaceId] ?? s.relayUrl;
  if (!relayUrl) {
    throw new Error('no relay is known for this namespace, so there is nowhere to create a context');
  }
  const signer = await signerFromSecret(s.deviceSecret, 'deviceSecret');
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const expiresAt = Date.now() + LIFETIME_MS;
  const fields = signedFields(req, s.account, nonce, expiresAt);
  const message = new TextEncoder().encode(CREATE_CONTEXT_DOMAIN + JSON.stringify(fields));
  const signature = hex(await signer.sign(message));

  const url = `${relayUrl.replace(/\/+$/, '')}/admin-api/namespaces/${req.namespaceId}/contexts`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ...fields,
      credential: s.credential,
      devicePublicKey: signer.publicKey,
      signature,
    }),
  };
  const response = deps.fetch ? await deps.fetch(url, init) : await globalThis.fetch(url, init);
  const text = await response.text();
  let body: { data?: { contextId?: string } | null; error?: string } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* reported below */
  }
  const contextId = body.data?.contextId;
  if (!response.ok || !contextId) {
    throw new Error(`the relay did not create the context (HTTP ${response.status}): ${body.error ?? text}`);
  }
  rememberRelay(s.account, relayUrl, { namespaceId: req.namespaceId, contextId });
  return { contextId };
}
