/**
 * An account's governance through the relay that serves its namespace: create
 * a context, and the group ops a private context (a DM) needs.
 *
 * A thin layer over mero-js's `RelayClient.createContext` / `govern` (core's
 * `/admin-api/groups/{group}/context-intents` and `.../governance-intents`),
 * adding what only this package knows: which relay serves the namespace (the
 * relay map), and the nonce bookkeeping across page loads.
 *
 * Nodes check the AUTHOR's rights (CAN_CREATE_CONTEXT, CAN_CREATE_SUBGROUP,
 * MANAGE_MEMBERS…), never the relay's; the relay only needs standing to act.
 */
import {
  groupCreatedOp,
  memberAddedOp,
  RelayClient,
  type GovernanceOp,
  type NonceSource,
} from '@calimero-network/mero-js';
import { knownRelays, markContextNonceSpent, readRelayMap, rememberRelay, type DelegatedSession } from './session';

/**
 * A governance warrant's nonce, for one (relay, group): spent in a sliding
 * per-(group, device) window 64 wide, so it must never go backwards. A stored
 * counter, floored at the clock so a cleared storage resumes above anything
 * spent before rather than replaying it.
 */
function governanceNonce(relay: string, group: string): NonceSource {
  return { next: async () => nextGovernanceNonce(relay, group) };
}

function nextGovernanceNonce(relay: string, group: string): bigint {
  const key = `calimero.governance-nonce.${relay}.${group}`;
  let last = 0n;
  try {
    last = BigInt(localStorage.getItem(key) ?? '0');
  } catch {
    /* no storage: the clock floor alone */
  }
  const next = [last + 1n, BigInt(Date.now())].reduce((a, b) => (a > b ? a : b));
  try {
    localStorage.setItem(key, String(next));
  } catch {
    /* unpersisted */
  }
  return next;
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
/** A new subgroup's id: random, as core requires of every subgroup. */
const random32 = () => hex(crypto.getRandomValues(new Uint8Array(32)));

function relayFor(s: DelegatedSession, namespaceId: string): string {
  // The relay that serves this namespace: learned when the account joined it.
  const url = readRelayMap(s.account).namespaces[namespaceId] ?? s.relayUrl;
  if (!url) throw new Error('no relay is known for this namespace, so there is nowhere to send this');
  return url.replace(/\/+$/, '');
}

/** The `init` arguments as the JSON the route takes, from the bytes a caller may hold. */
function initArgsOf(params: number[] | undefined): unknown {
  if (!params || params.length === 0) return {};
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(params)));
}

export interface CreateDelegatedContextRequest {
  readonly namespaceId: string;
  /** The group to create it in; the namespace itself when omitted. */
  readonly groupId?: string;
  readonly applicationId: string;
  readonly initializationParams?: number[];
  readonly name?: string;
}

/** A relay client for these calls: the author's credential, whatever nonces the call needs. */
function client(s: DelegatedSession, relayUrl: string, nonces: NonceSource, fetch?: typeof globalThis.fetch) {
  return new RelayClient({
    relayUrl,
    authorAccount: s.account,
    authorProof: s.credential,
    deviceSecret: s.deviceSecret,
    nonces,
    fetch,
  });
}

export async function createDelegatedContext(
  s: DelegatedSession,
  req: CreateDelegatedContextRequest,
  deps: { fetch?: typeof fetch } = {},
): Promise<{ contextId: string }> {
  const relay = relayFor(s, req.namespaceId);
  // The creation warrant's nonce is spent in the NEW context's per-device
  // window — the one its writes draw from, empty until now — so the first
  // number is free, and the context's writes then start above it.
  const creationNonce = 0n;
  const created = await client(s, relay, { next: async () => creationNonce }, deps.fetch).createContext({
    groupId: req.groupId ?? req.namespaceId,
    applicationId: req.applicationId,
    initArgs: initArgsOf(req.initializationParams),
    name: req.name,
  });
  markContextNonceSpent(relay, created.contextId, creationNonce);
  rememberRelay(s.account, relay, { namespaceId: req.namespaceId, contextId: created.contextId });
  return { contextId: created.contextId };
}

/** Publish one delegable governance op through the namespace's relay. */
export async function delegatedGovernance(
  s: DelegatedSession,
  req: { namespaceId: string; group: string; op: GovernanceOp },
  deps: { fetch?: typeof fetch } = {},
): Promise<{ groupId: string }> {
  const relay = relayFor(s, req.namespaceId);
  return client(s, relay, governanceNonce(relay, req.group), deps.fetch).govern({ groupId: req.group, op: req.op });
}

/**
 * A context only the author and `members` are in (a DM, a small room): a
 * restricted subgroup of the namespace (a root op, posted to the namespace),
 * each member added to it directly — they are in the namespace already, so
 * nobody is invited — and the context created inside it. The relay that
 * creates the subgroup is seated in it with CAN_AUTHOR_ON_BEHALF by core.
 */
export async function createDelegatedPrivateContext(
  s: DelegatedSession,
  req: CreateDelegatedContextRequest & { readonly members: readonly string[] },
  deps: { fetch?: typeof fetch } = {},
): Promise<{ contextId: string; groupId: string }> {
  const { groupId } = await delegatedGovernance(
    s,
    {
      namespaceId: req.namespaceId,
      group: req.namespaceId,
      op: groupCreatedOp({ groupId: random32(), parentId: req.namespaceId, restricted: true, admin: s.account }),
    },
    deps,
  );
  for (const member of req.members) {
    await delegatedGovernance(s, { namespaceId: req.namespaceId, group: groupId, op: memberAddedOp(member, 'Member') }, deps);
  }
  const { contextId } = await createDelegatedContext(s, { ...req, groupId }, deps);
  return { contextId, groupId };
}

/**
 * Found a namespace as the account, through a relay it already uses. The
 * account becomes founder, owner and admin; the relay is seated in it (and a
 * TEE relay admits itself as its first TEE), so contexts can be created in it
 * through the same relay straight away.
 *
 * The relay's executor account cannot be asked about a namespace that does
 * not exist yet, so it is learned from one the account already has on that
 * relay. A brand-new account, in nothing yet, is told to join one first.
 */
export async function foundDelegatedNamespace(
  s: DelegatedSession,
  req: { readonly defaultCapabilities?: number } = {},
  deps: { fetch?: typeof fetch } = {},
): Promise<{ namespaceId: string; teeEnabled: boolean }> {
  const relays = knownRelays(s).map((u) => u.replace(/\/+$/, ''));
  const relay = relays[0];
  if (!relay) throw new Error('no relay is known for this account, so there is nowhere to found a namespace');
  const known = Object.entries(readRelayMap(s.account).namespaces).find(
    ([, url]) => url.replace(/\/+$/, '') === relay,
  )?.[0];
  if (!known) {
    throw new Error("join a namespace on this relay first: its executor account is learned from one you are in");
  }
  const { executorAccount } = await client(s, relay, governanceNonce(relay, known), deps.fetch).describeGovernance(known);
  // The founding warrant and, with a default mask, a second one are both spent
  // in the NEW namespace's window, which is empty: any rising pair will do.
  let next = BigInt(Date.now());
  const founded = await client(s, relay, { next: async () => next++ }, deps.fetch).foundNamespace({
    executorAccount,
    ...(req.defaultCapabilities !== undefined ? { defaultCapabilities: req.defaultCapabilities } : {}),
  });
  try {
    localStorage.setItem(`calimero.governance-nonce.${relay}.${founded.namespaceId}`, String(next));
  } catch {
    /* unpersisted: the clock floor still keeps later warrants above these */
  }
  rememberRelay(s.account, relay, { namespaceId: founded.namespaceId });
  return { namespaceId: founded.namespaceId, teeEnabled: founded.teeEnabled };
}
