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
  AccountNotLinkedError,
  CloudClient,
  memberAddedOp,
  RelayClient,
  subgroupCreation,
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
      // The id is derived from a fresh salt (core#4244); a node refuses any other.
      op: (await subgroupCreation({ parentId: req.namespaceId, restricted: true, admin: s.account })).op,
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
 * not exist yet, so it is the session's `executorAccount` when the app named
 * one, else learned from a namespace the account already has on that relay. A
 * brand-new account with neither is told how to get one.
 */
export async function foundDelegatedNamespace(
  s: DelegatedSession,
  req: {
    readonly defaultCapabilities?: number;
    /** The application the namespace runs; without one no context can be created in it. */
    readonly application?: { applicationId: string; package: string; version: string };
  } = {},
  deps: {
    fetch?: typeof fetch;
    /** The cloud to enable HA on; mero-js's default when unset. */
    cloudBaseUrl?: string;
  } = {},
): Promise<FoundedDelegatedNamespace> {
  const relays = knownRelays(s).map((u) => u.replace(/\/+$/, ''));
  const relay = relays[0];
  if (!relay) throw new Error('no relay is known for this account, so there is nowhere to found a namespace');
  const known = Object.entries(readRelayMap(s.account).namespaces).find(
    ([, url]) => url.replace(/\/+$/, '') === relay,
  )?.[0];
  // The session's relay may come with its account (the cloud names it), which
  // is all founding needs; otherwise it is learned from a namespace on it.
  const named = s.executorAccount && s.relayUrl && s.relayUrl.replace(/\/+$/, '') === relay ? s.executorAccount : null;
  if (!named && !known) {
    throw new Error(
      "the executor account of this relay is not known: join a namespace on it first, or connect with the relay's executor account (the cloud shows it beside the relay)",
    );
  }
  const executorAccount =
    named ?? (await client(s, relay, governanceNonce(relay, known!), deps.fetch).describeGovernance(known!)).executorAccount;
  // The founding warrant and, with a default mask, a second one are both spent
  // in the NEW namespace's window, which is empty: any rising pair will do.
  let next = BigInt(Date.now());
  const founded = await client(s, relay, { next: async () => next++ }, deps.fetch).foundNamespace({
    executorAccount,
    ...(req.defaultCapabilities !== undefined ? { defaultCapabilities: req.defaultCapabilities } : {}),
    ...(req.application ? { application: req.application } : {}),
  });
  try {
    localStorage.setItem(`calimero.governance-nonce.${relay}.${founded.namespaceId}`, String(next));
  } catch {
    /* unpersisted: the clock floor still keeps later warrants above these */
  }
  rememberRelay(s.account, relay, { namespaceId: founded.namespaceId });
  if (req.application && founded.applicationSet !== true) {
    // Founded, but no context can be created in it until it has its
    // application; the same choice can be retried (it is still the first).
    throw new Error(
      `founded ${founded.namespaceId} but could not give it its application: ${founded.applicationError ?? 'unknown reason'}`,
    );
  }
  // HA's fleet node is admitted by the founding relay, which can vouch for it
  // only once it attested itself as the namespace's first TEE (that also sets
  // the admission policy). Without that no fleet node is ever admitted, and the
  // request would hold the account's one pending slot in the cloud for good.
  const ha = founded.teeEnabled
    ? await enableHaBestEffort(s, founded.namespaceId, founded.salt, relay, deps)
    : {
        haEnabled: false,
        haError: `the relay did not attest the founding, so no fleet node could be admitted for HA${founded.teeError ? `: ${founded.teeError}` : ''}`,
      };
  return { namespaceId: founded.namespaceId, teeEnabled: founded.teeEnabled, ...ha };
}

/** What {@link foundDelegatedNamespace} returns. */
export interface FoundedDelegatedNamespace {
  namespaceId: string;
  teeEnabled: boolean;
  /** Whether the cloud agreed to host the namespace (HA) right after founding. */
  haEnabled: boolean;
  /** Why `haEnabled` is `false`, in words a person can act on. */
  haError?: string;
}

/** What an app can tell a person whose account the cloud cannot place. */
export const HA_ACCOUNT_NOT_LINKED_MESSAGE =
  'link this account to your cloud user in the wallet so invitees can find this namespace';

/**
 * Ask the cloud to host a namespace this account just founded, with no cloud
 * session: the account proves it is the founder (its id and the salt reproduce
 * the namespace id) and the cloud bills the user it is linked to.
 *
 * Best-effort: the namespace exists whatever the cloud answers, so a refusal is
 * reported, never thrown. Without HA nothing in the cloud knows the namespace,
 * so an invitee cannot find its relay; hence the not-linked case gets a
 * sentence that says what to do.
 */
async function enableHaBestEffort(
  s: DelegatedSession,
  namespaceId: string,
  salt: string,
  relayUrl: string,
  deps: { fetch?: typeof fetch; cloudBaseUrl?: string },
): Promise<{ haEnabled: boolean; haError?: string }> {
  try {
    await new CloudClient({ cloudBaseUrl: deps.cloudBaseUrl, fetch: deps.fetch }).enableHaAsAccount({
      namespaceId,
      salt,
      accountId: s.account,
      credential: s.credential,
      deviceSecret: s.deviceSecret,
      // The relay that founded it: the cloud hands it to the fleet node as its
      // admitter, so the node does not have to find it by discovery.
      relayUrl,
    });
    return { haEnabled: true };
  } catch (e) {
    if (e instanceof AccountNotLinkedError) return { haEnabled: false, haError: HA_ACCOUNT_NOT_LINKED_MESSAGE };
    return { haEnabled: false, haError: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The latest version of `pkg` the registry publishes. Used when the app names
 * its package but not a version.
 */
export async function latestPublishedVersion(
  registryUrl: string,
  pkg: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
  const url = `${registryUrl.replace(/\/+$/, '')}/api/v2/bundles?package=${encodeURIComponent(pkg)}`;
  const response = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`the registry has no ${pkg} (HTTP ${response.status})`);
  const bundles = (await response.json()) as Array<{ appVersion?: string }>;
  const newer = (a: string, b: string) => {
    const [x, y] = [a, b].map((v) => v.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0));
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    }
    return false;
  };
  const latest = bundles
    .map((b) => b.appVersion)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .reduce<string | undefined>((best, v) => (!best || newer(v, best) ? v : best), undefined);
  if (!latest) throw new Error(`the registry lists no version of ${pkg}`);
  return latest;
}
