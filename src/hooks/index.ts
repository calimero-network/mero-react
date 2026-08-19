import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { compareSemver } from '@calimero-network/mero-js';
import { useMero } from '../context';
import { base58ToHex } from '../utils/base58';
import type {
  Codec,
  EphemeralClient,
  Context,
  CreateContextRequest,
  CreateGroupInvitationRequest,
  CreateGroupInNamespaceRequest,
  CreateNamespaceInvitationRequest,
  CreateNamespaceInvitationResponseData,
  CreateNamespaceRequest,
  CreateRecursiveInvitationResponseData,
  DeleteGroupRequest,
  DeleteNamespaceRequest,
  DetachContextFromGroupRequest,
  GroupContextEntry,
  GroupInfo,
  GroupUpgradeStatusResponseData,
  MetadataRecord,
  JoinGroupRequest,
  JoinNamespaceRequest,
  ListGroupMembersResponseData,
  Namespace,
  NamespaceIdentity,
  NodeIdentity,
  ReparentGroupRequest,
  AddGroupMembersRequest,
  RemoveGroupMembersRequest,
  RetryGroupUpgradeRequest,
  SetDefaultCapabilitiesRequest,
  SetMetadataRequest,
  SetSubgroupVisibilityRequest,
  SetTeeAdmissionPolicyRequest,
  SubgroupEntry,
  SyncGroupRequest,
  SseEventData,
  UpdateMemberRoleRequest,
  UpgradeGroupRequest,
  ResyncContextRequest,
  MigrationStatus,
  MemberMigrationStatusEntry,
  MigrationStatusRollup,
  MigrateMyEntriesSummary,
  AppVersionChangedEvent,
  GroupMembershipEventData,
  GroupMigrationEventData,
} from '@calimero-network/mero-js';
import type {
  ApplicationContextRecord,
  ContextDiscoveryOptions,
  ContextDiscoveryState,
} from '../types';

export { useMero } from '../context';

/**
 * The presence types come straight from `mero-js` now — `Codec` and
 * `EphemeralEntry` are its own declarations, and `EphemeralClient` is the type
 * of the class behind `mero.ephemeral`, so a drift between what this hook
 * assumes and what the SDK does is a compile error rather than a runtime
 * surprise.
 *
 * Re-exported under the same names this package has always exported, so
 * consumers importing `Codec` / `EphemeralEntry` / `EphemeralClient` from
 * `@calimero-network/mero-react` keep compiling — they now simply get the
 * nominal `mero-js` types instead of structural copies of them.
 *
 * On `EphemeralEntry.ageMs`: it is ABSENT on a live delta and PRESENT on a
 * replayed seed entry, reporting how stale that entry already was (bounded by
 * the node's presence TTL). Absent and `0` are different — a `0` means "the
 * node replayed this and it is brand new", not "no age information". Read it
 * with `?? 0`, never with a truthiness check.
 */
export type { Codec, EphemeralEntry, EphemeralClient } from '@calimero-network/mero-js';

export interface UseEphemeralOptions<T> {
  /** Encoding for the presence slice. Defaults to JSON. */
  codec?: Codec<T>;
  /** Base value for the first `setPresence` merge. */
  initial?: T;
  /** Minimum ms between publishes. Trailing edge — the latest value wins. */
  throttleMs?: number;
  /** Include your own echoed presence in `peers`. Default false. */
  includeSelf?: boolean;
}

/** Shape returned by {@link useEphemeral}. */
export interface UseEphemeralResult<T> {
  peers: Map<string, T>;
  setPresence: (partial: Partial<T>) => void;
  ageOf: (author: string) => number | undefined;
  error: Error | null;
}

/**
 * Which asynchronous producer currently owns the latched error slot.
 *
 * Only genuinely ASYNCHRONOUS failures are latched — an event happened once,
 * in the past, and nothing about the current render can re-derive it. Anything
 * that is a standing property of the current props/client (notably "this
 * client has no `mero.ephemeral` surface") is NOT latched: it is recomputed
 * every render, so it can neither go stale nor be accidentally cleared.
 *
 * The slot is shared, so each producer only clears what it itself raised.
 */
type ErrorSource = 'identity' | 'publish';

/**
 * The latched async error, tagged with its producer AND with the context it
 * belongs to.
 *
 * `contextKey` is what makes cross-context leaks structurally impossible
 * rather than a matter of remembering to clear: a write whose key is no longer
 * the current context is dropped on the way in (a publish that was in flight
 * across a context switch), and a latch whose key no longer matches is not
 * read on the way out. Neither path depends on some other effect having run a
 * clear first.
 */
interface LatchedEphemeralError {
  contextKey: string | null;
  source: ErrorSource;
  error: Error;
}

const NO_EPHEMERAL_SURFACE_MESSAGE =
  'useEphemeral: this client has no `mero.ephemeral` surface. Ephemeral ' +
  'presence requires @calimero-network/mero-js >= 9.1.0; upgrade the ' +
  'installed @calimero-network/mero-js (and any lockfile pin) to use it.';

const COULD_NOT_RESOLVE_IDENTITY_MESSAGE =
  'useEphemeral: could not resolve a local context identity, so your own ' +
  'presence cannot be filtered out. Pass includeSelf: true to accept this.';

/**
 * How long after the last replayed entry (one carrying `ageMs`) the replay
 * window stays open before `peers` is reconciled down to what the replay
 * contained. Long enough to absorb a replay burst split across several SSE
 * frames/ticks, short enough that a swept peer does not linger.
 */
const REPLAY_RECONCILE_MS = 50;

/**
 * Observe and publish ephemeral presence (cursors, typing, online) for a
 * context.
 *
 * ONE read path: the subscription. When a client subscribes, the node replays
 * that context's current presence to that connection as ordinary entries
 * before the live deltas start, so seeding and updating share a single shape
 * ({@link EphemeralEntry}) and a reconnect — `SseClient` auto-reconnects and
 * re-subscribes — re-seeds itself. There is no snapshot fetch and no
 * client-side reconciliation pass.
 *
 * Freshness is computed entirely from local clock deltas: a replayed entry is
 * current as of `Date.now() - ageMs`, a live delta as of `Date.now()`. No
 * cross-machine clock comparison is ever performed.
 *
 * No client-side TTL or heartbeat: the node sweeps at 7s and emits removals,
 * and re-publishes on your behalf every 2.5s. A replay is treated as
 * AUTHORITATIVE — see the replay-reconcile pass in the read effect — so a peer
 * swept while the SSE connection was down does not survive the reconnect.
 *
 * `error` is derived, not accumulated: standing conditions (no `ephemeral`
 * surface) are recomputed every render, one-shot async failures are latched
 * keyed by the context they happened in, and whether a latched failure is even
 * relevant (an unresolved identity when `includeSelf` is true) is decided at
 * read time. Nothing survives a context switch.
 */
export function useEphemeral<T>(
  contextId: string | null,
  options: UseEphemeralOptions<T> = {},
): UseEphemeralResult<T> {
  const { includeSelf = false } = options;
  const { mero } = useMero();
  // Cast: the installed mero-js's `MeroJs` type predates `ephemeral` (see
  // `EphemeralClient` above), though it exists at runtime.
  const ephemeral = mero
    ? ((mero as unknown as { ephemeral?: EphemeralClient }).ephemeral ?? null)
    : null;

  const [peers, setPeers] = useState<Map<string, T>>(new Map());
  // The one latched async error (see `LatchedEphemeralError`). Not read
  // directly — `error` below derives what is actually reported from it.
  const [latchedError, setLatchedError] = useState<LatchedEphemeralError | null>(null);
  // The context the CURRENT render targets. Read by `setSourceError` so a
  // callback that resolves after a context switch can tell that its result is
  // no longer wanted without closing over anything but its own captured key.
  const contextKeyRef = useRef<string | null>(contextId);
  contextKeyRef.current = contextId;
  // `key` is the contextId captured when the failing operation was STARTED,
  // not when it settled. A late write from a context we have already left is
  // dropped here rather than being written and then hopefully cleared.
  const setSourceError = useCallback(
    (source: ErrorSource, err: Error, key: string | null) => {
      if (key !== contextKeyRef.current) return;
      setLatchedError({ contextKey: key, source, error: err });
    },
    [],
  );
  const clearSourceError = useCallback((source: ErrorSource, key: string | null) => {
    setLatchedError(prev =>
      prev && prev.source === source && prev.contextKey === key ? null : prev,
    );
  }, []);

  // DERIVED, never latched: "this client has no `mero.ephemeral` surface" is a
  // standing property of the current client, not an event. Recomputing it every
  // render is what makes it impossible to (a) leave it set after an upgraded
  // client arrives or (b) lose it to some other effect's clear — a context
  // switch, for instance, cannot hide a client that still has no surface.
  // Memoised only so the Error identity is stable while the condition holds.
  const surfaceError = useMemo(
    () => (mero && !ephemeral ? new Error(NO_EPHEMERAL_SURFACE_MESSAGE) : null),
    [mero, ephemeral],
  );

  // A latch is reported only if it belongs to the context being rendered, and
  // only if it is still MEANINGFUL: an unresolved local identity is an error
  // solely because self-filtering needs it, so opting into `includeSelf` makes
  // it a non-event — decided here, at read time, rather than by racing an
  // effect to clear it.
  const error =
    surfaceError ??
    (latchedError &&
    latchedError.contextKey === contextId &&
    !(latchedError.source === 'identity' && includeSelf)
      ? latchedError.error
      : null);
  // author -> local ms timestamp the entry is considered current as of.
  const receivedAtRef = useRef<Map<string, number>>(new Map());
  // `codec` and `initial` are held in refs, never in a dependency array:
  // `jsonCodec()` is a FACTORY, so `{ codec: jsonCodec() }` at the call site is
  // a fresh identity every render. As a dep it would tear down and re-create
  // the subscription on every render — and since every applied entry sets a
  // new Map (a new render), that is an unbounded resubscribe storm, each
  // resubscribe pulling a fresh presence replay. A codec swapped mid-flight is
  // not a real use case.
  const codecRef = useRef<Codec<T> | undefined>(options.codec);
  codecRef.current = options.codec;
  const initialRef = useRef<T | undefined>(options.initial);
  initialRef.current = options.initial;
  // This node's own context member key (device-level), resolved async. Never
  // compare this against an account id — that comparison silently never
  // matches, which is the classic self-echo bug.
  const selfRef = useRef<string | null>(null);
  const lastLocalRef = useRef<T | undefined>(options.initial);
  const pendingRef = useRef<T | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Seeded to the mount time (not 0) so an isolated call shortly after mount
  // is correctly treated as part of the initial "burst" and trailing-edge
  // throttled, rather than bypassing the throttle because it looks like it's
  // arriving long after a (nonexistent) previous publish.
  const lastSentAtRef = useRef<number>(Date.now());
  // Open replay window: the authors seen since a replayed entry (one carrying
  // `ageMs`) last arrived. Null when no replay is in progress.
  const replaySeenRef = useRef<Set<string> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ageOf = useCallback((author: string): number | undefined => {
    const at = receivedAtRef.current.get(author);
    return at === undefined ? undefined : Date.now() - at;
  }, []);

  // Clear ALL per-context state synchronously the instant the target context
  // changes. Read state, so a previous context's peers don't keep rendering
  // until the new context's replay arrives — and write state, because a
  // queued publish would otherwise fire into the PREVIOUS context (its
  // `setTimeout` closure captured the old `publish`), and `lastLocalRef` would
  // shallow-merge the old context's fields into the first slice published in
  // the new one. Presence is app-defined data (cursor position, typing target),
  // so both are genuine cross-context writes, not cosmetic leaks.
  //
  // The latched error is dropped here as well, but purely as housekeeping (it
  // is what makes A -> B -> A not resurrect A's old failure). Correctness does
  // not rest on it: the latch carries its own `contextKey`, so an error from a
  // context we have left is neither written nor read regardless of whether this
  // effect ran. The standing surface condition is untouched — it is derived, so
  // it re-reports itself on the very next render if it is still true.
  useEffect(() => {
    setPeers(new Map());
    receivedAtRef.current = new Map();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (replayTimerRef.current) {
      clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    replaySeenRef.current = null;
    pendingRef.current = undefined;
    lastLocalRef.current = initialRef.current;
    selfRef.current = null;
    setLatchedError(null);
  }, [contextId]);

  // Resolve THIS node's context member key — the same value the node stamps
  // as `author` on ephemeral entries.
  useEffect(() => {
    if (!mero || !contextId) return;
    // Captured at START. Everything this effect reports is tagged with it, so
    // a slow lookup that lands after a context switch cannot write into the
    // context we switched to.
    const key = contextId;
    let cancelled = false;
    mero.admin
      .getContextIdentitiesOwned(contextId)
      .then(res => {
        if (cancelled) return;
        const self = res.identities?.[0] ?? null;
        selfRef.current = self;
        if (!self) {
          // Latched unconditionally — `includeSelf` is NOT consulted here.
          // Whether an unresolved identity matters is a question about the
          // CURRENT props, so it is answered where `error` is derived; asking
          // it here is what previously left the error stranded when
          // `includeSelf` flipped to true while resolution still failed.
          setSourceError('identity', new Error(COULD_NOT_RESOLVE_IDENTITY_MESSAGE), key);
          return;
        }
        // A later run of this effect (contextId change, includeSelf toggle)
        // resolved a self identity where an earlier run didn't — clear the
        // "could not resolve" error this effect itself raised.
        clearSourceError('identity', key);
        // Ordering race: the identity lookup and the subscription's presence
        // replay land independently, so a self entry can already be seeded in
        // `peers`. Retroactively drop it now that we know who "self" is.
        if (!includeSelf) {
          receivedAtRef.current.delete(self);
          setPeers(prev => {
            if (!prev.has(self)) return prev;
            const next = new Map(prev);
            next.delete(self);
            return next;
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSourceError('identity', toError(err), key);
        }
      });
    return () => { cancelled = true; };
    // `mero` itself is a dep on purpose: a real MeroProvider memoizes its
    // context value, so `mero` only changes identity when the underlying
    // client is actually replaced (e.g. `allowedNodeUrls` changes) — and
    // that replacement is exactly when this effect must re-resolve the
    // local identity against the new client. Keying on presence alone
    // (`Boolean(mero)`) would silently keep resolving against a closed,
    // stale client instance.
  }, [mero, contextId, includeSelf, setSourceError, clearSourceError]);

  // The single read path. Subscribing makes the node replay this context's
  // current presence to this connection as ordinary entries, then stream live
  // deltas — so this one handler both seeds and updates, and an SSE reconnect
  // (which re-subscribes) re-seeds without any extra machinery.
  //
  // A REPLAY IS AUTHORITATIVE. The node replays exactly who is present right
  // now; anything we still hold that the replay does not mention is gone.
  // Without reconciling against it, a peer swept while the connection was down
  // is a permanent ghost: its removal event was delivered to nobody, and the
  // replay — which lists only survivors — will never mention it again. That
  // sweep happens inside `SseClient`'s auto-reconnect, so it does NOT re-run
  // this effect; reconciliation has to be driven by the entries themselves,
  // which is why it keys off `ageMs` (present only on replayed entries) rather
  // than off subscribe/unsubscribe. Clearing `peers` eagerly on subscribe would
  // also miss the reconnect case entirely — and would blank the UI on every
  // `includeSelf` toggle.
  //
  // The window closes `REPLAY_RECONCILE_MS` after the last replayed entry, and
  // live entries arriving while it is open count as present too, so a peer that
  // publishes mid-replay is never swept. A replayed entry that somehow arrives
  // after the window closed re-adds its author immediately — the failure mode
  // is a flicker, never a resurrected ghost or a permanent loss.
  useEffect(() => {
    if (!ephemeral || !contextId) return;

    const closeReplayWindow = () => {
      replayTimerRef.current = null;
      const seen = replaySeenRef.current;
      replaySeenRef.current = null;
      if (!seen) return;
      setPeers(prev => {
        let next: Map<string, T> | null = null;
        for (const author of prev.keys()) {
          if (seen.has(author)) continue;
          if (!next) next = new Map(prev);
          next.delete(author);
          receivedAtRef.current.delete(author);
        }
        return next ?? prev;
      });
    };

    const unsubscribe = ephemeral.subscribe<T>(
      contextId,
      entry => {
        const { author, state } = entry;
        if (entry.ageMs !== undefined) {
          // A replayed entry: (re)open the reconcile window and debounce its
          // close, so a replay burst split across frames counts as one replay.
          if (!replaySeenRef.current) replaySeenRef.current = new Set();
          if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
          replayTimerRef.current = setTimeout(closeReplayWindow, REPLAY_RECONCILE_MS);
        }
        if (entry.removed || state === undefined) {
          replaySeenRef.current?.delete(author);
          receivedAtRef.current.delete(author);
          setPeers(prev => {
            if (!prev.has(author)) return prev;
            const next = new Map(prev);
            next.delete(author);
            return next;
          });
          return;
        }
        if (!includeSelf && author === selfRef.current) return;
        replaySeenRef.current?.add(author);
        // `ageMs` is absent on a live delta (current as of now) and present on
        // a replayed entry (current as of `now - ageMs`). `?? 0` — never a
        // truthiness test: an `ageMs` of 0 is a real, meaningful value.
        receivedAtRef.current.set(author, Date.now() - (entry.ageMs ?? 0));
        setPeers(prev => new Map(prev).set(author, state));
      },
      codecRef.current,
    );

    return () => {
      if (replayTimerRef.current) {
        clearTimeout(replayTimerRef.current);
        replayTimerRef.current = null;
      }
      replaySeenRef.current = null;
      unsubscribe();
    };
    // `ephemeral` itself is a dep on purpose — see the identity-resolution
    // effect above. A replaced client must re-subscribe against the new
    // client, not keep reading/writing through the old (possibly closed)
    // one. `codec` is deliberately NOT a dep — see `codecRef`.
  }, [ephemeral, contextId, includeSelf]);

  const publish = useCallback((value: T) => {
    if (!ephemeral || !contextId) return;
    // Captured at START, like the identity lookup's `key`: `ephemeral.set` is
    // not cancellable, so a rejection can land long after a context switch.
    // Tagging the write with the context it was issued for is what keeps that
    // failure out of the new context's error slot.
    const key = contextId;
    lastSentAtRef.current = Date.now();
    void ephemeral.set<T>(key, value, codecRef.current).then(
      () => clearSourceError('publish', key),
      (err: unknown) => setSourceError('publish', toError(err), key),
    );
  }, [ephemeral, contextId, setSourceError, clearSourceError]);

  /**
   * Publish your own presence.
   *
   * SHALLOW merge over the last locally-set value (starting from `initial`):
   * presence is one slot per author, so fields are not independent channels
   * and a bare replace would silently drop whatever you did not mention.
   * Nested objects are replaced wholesale, not deep-merged —
   * `setPresence({ cursor: { x: 1 } })` DROPS `cursor.y` if it was set
   * separately.
   *
   * Throttled on the trailing edge: rapid calls collapse into one publish
   * carrying the newest value, never the oldest queued one.
   */
  const setPresence = useCallback((partial: Partial<T>) => {
    const next = { ...(lastLocalRef.current ?? ({} as T)), ...partial } as T;
    lastLocalRef.current = next;

    const throttleMs = options.throttleMs ?? 30;
    if (throttleMs <= 0) {
      publish(next);
      return;
    }

    pendingRef.current = next;
    if (timerRef.current) return;
    const elapsed = Date.now() - lastSentAtRef.current;
    const delay = Math.max(throttleMs - elapsed, 0);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const queued = pendingRef.current;
      pendingRef.current = undefined;
      if (queued !== undefined) publish(queued);
    }, delay);
  }, [publish, options.throttleMs]);

  // Cancel a queued publish on unmount.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { peers, setPresence, ageOf, error };
}

/**
 * Shape accepted by the metadata-setter hooks — re-exported from mero-js so
 * callers have one canonical type. A `set*Metadata` call **replaces the whole
 * record**: `data` defaults to `{}` and wholly replaces the stored map; omit
 * `name` to keep the current name.
 */
export type SetMetadataInput = SetMetadataRequest;

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function mapApplicationContexts(contexts: Context[]): ApplicationContextRecord[] {
  return contexts.map((context) => ({
    contextId: context.id,
    applicationId: context.applicationId,
  }));
}

function useMountedRef() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}

function useAsyncMutation() {
  const mountedRef = useMountedRef();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      try {
        return await action();
      } catch (err) {
        const errorValue = toError(err);
        if (mountedRef.current) {
          setError(errorValue);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [mountedRef],
  );

  return { loading, error, run, setError };
}

/**
 * Generic read resource: fetch + loading/error/data with a latest-request-wins
 * guard. `fetcher` is null when the read is disabled (missing args) — the
 * resource resets to `initialValue` and nothing is fetched. `deps` drive both
 * the refetch and a synchronous reset when they change, so a slow earlier
 * request can never overwrite a newer one. This is the staleness guard the read
 * hooks used to hand-roll (and mostly lacked), now in one place.
 */
function useAsyncResource<T>(
  fetcher: (() => Promise<T>) | null,
  initialValue: T,
  deps: readonly unknown[],
): { data: T; loading: boolean; error: Error | null; refetch: () => Promise<void> } {
  const mountedRef = useMountedRef();
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const reqRef = useRef(0);

  // fetcherRef is refreshed every render so refetch() always calls the latest
  // closure; initialRef captures the (per-hook constant) initial value once.
  // Neither is a dependency — adding them would break latest-request-wins.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const initialRef = useRef(initialValue);

  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    const fn = fetcherRef.current;
    if (!fn) {
      if (mountedRef.current && seq === reqRef.current) {
        setData(initialRef.current);
        setError(null);
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await fn();
      if (mountedRef.current && seq === reqRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current && seq === reqRef.current) setError(toError(err));
    } finally {
      if (mountedRef.current && seq === reqRef.current) setLoading(false);
    }
  }, deps);

  // Invalidate any in-flight request and drop the previous key's data DURING
  // RENDER, not in an effect. An effect leaves one render where `data` still
  // answers for the old inputs, and a consumer that persists what it sees
  // (a "this member already has a name" marker, say) makes that transient
  // staleness permanent.
  const prevDeps = useRef(deps);
  if (
    deps.length !== prevDeps.current.length ||
    deps.some((d, i) => !Object.is(d, prevDeps.current[i]))
  ) {
    prevDeps.current = deps;
    reqRef.current += 1;
    setData(initialRef.current);
    setError(null);
  }

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractAliasContextId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  if ('value' in value && typeof value.value === 'string') {
    return value.value;
  }

  if ('contextId' in value && typeof value.contextId === 'string') {
    return value.contextId;
  }

  return null;
}

/**
 * Execute RPC methods against a context.
 * Tracks loading/error state. Unmount-safe.
 */
export function useExecute(contextId: string | null, executorId: string | null) {
  const { mero } = useMero();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const execute = useCallback(
    async <T = unknown>(method: string, params?: Record<string, unknown>): Promise<T | null> => {
      if (!mero || !contextId || !executorId) {
        if (mountedRef.current) setError(new Error('Not connected'));
        return null;
      }

      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await mero.rpc.execute<T>({
          contextId,
          method,
          argsJson: params,
          executorPublicKey: executorId,
        });
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(e);
        return null;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [mero, contextId, executorId],
  );

  return { execute, loading, error };
}

/** Event payload delivered to a `useSubscription` callback. */
export type SubscriptionEventData =
  | SseEventData
  | GroupMembershipEventData
  | GroupMigrationEventData;

/** Ids to subscribe to. Either can be omitted, but not both. */
export interface SubscriptionInput {
  contextIds?: string[];
  groupIds?: string[];
}

/**
 * Subscribe to SSE events for context and/or group IDs.
 * StrictMode-safe: tracks the SseClient instance in a ref to avoid
 * double-connect on mount/unmount/remount cycles.
 */
export function useSubscription(
  contextIds: string[],
  callback: (event: SubscriptionEventData) => void,
): void;
export function useSubscription(
  input: SubscriptionInput,
  callback: (event: SubscriptionEventData) => void,
): void;
export function useSubscription(
  input: string[] | SubscriptionInput,
  callback: (event: SubscriptionEventData) => void,
) {
  const { mero } = useMero();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const { contextIds = [], groupIds = [] } = Array.isArray(input)
    ? { contextIds: input, groupIds: [] as string[] }
    : input;

  const contextIdsKey = JSON.stringify(contextIds);
  const groupIdsKey = JSON.stringify(groupIds);

  useEffect(() => {
    if (!mero || (contextIds.length === 0 && groupIds.length === 0)) return;

    const sse = mero.events;

    const handler = (event: SubscriptionEventData) => {
      callbackRef.current(event);
    };

    sse.on('event', handler);
    sse.connect().catch(() => {});
    sse.subscribe({ contextIds, groupIds }).catch(() => {});

    return () => {
      sse.off('event', handler);
    };
  }, [mero, contextIdsKey, groupIdsKey]);
}

/**
 * Fetch contexts for the current node, optionally filtered by application ID.
 */
export function useContexts(applicationId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<ApplicationContextRecord[]>(
    mero
      ? async () => {
          const response = applicationId
            ? await mero.admin.getContextsForApplication(applicationId)
            : await mero.admin.getContexts();
          return mapApplicationContexts(response.contexts ?? []);
        }
      : null,
    [],
    [mero, applicationId],
  );
  return { contexts: data, loading, error, refetch };
}

export function useApplicationContexts(applicationId?: string | null) {
  return useContexts(applicationId);
}

export function useGroupMembers(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<ListGroupMembersResponseData | null>(
    mero && groupId ? () => mero.admin.listGroupMembers(groupId) : null,
    null,
    [mero, groupId],
  );
  // `members` is a guaranteed array on the wire; `?? []` guards mocks / drift.
  return {
    members: data?.members ?? [],
    loading,
    error,
    refetch,
  };
}

export function useGroupContexts(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<GroupContextEntry[]>(
    mero && groupId ? () => mero.admin.listGroupContexts(groupId) : null,
    [],
    [mero, groupId],
  );
  return { contexts: data, loading, error, refetch };
}

export function useGroupInvitations() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createInvitation = useCallback(
    async (groupId: string, request?: CreateGroupInvitationRequest) => {
      if (!mero) {
        return null;
      }
      return run(() => mero.admin.createGroupInvitation(groupId, request));
    },
    [mero, run],
  );

  return { createInvitation, loading, error };
}

export function useJoinGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const joinGroup = useCallback(
    async (request: JoinGroupRequest) => {
      if (!mero) {
        return null;
      }
      return run(() => mero.admin.joinGroup(request));
    },
    [mero, run],
  );

  return { joinGroup, loading, error };
}

/**
 * Takes the member's ACCOUNT (64 hex), as `useGroupMembers` rows are keyed by
 * and `useNodeIdentity().identity?.accountId` returns - NOT a signing key.
 * Both are 32-byte strings, so passing a key names nobody and raises nothing.
 */
export function useGroupCapabilities(groupId?: string | null, memberId?: string | null) {
  const { mero } = useMero();
  const [capabilities, setCapabilitiesState] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Read+write hybrid (setCapabilities shares this state), so it keeps the
  // inline latest-request-wins guard rather than useAsyncResource.
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!mero || !groupId || !memberId) {
      if (mountedRef.current && seq === reqRef.current) {
        setCapabilitiesState(null);
        setError(null);
        setLoading(false);
      }
      return null;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const response = await mero.admin.getMemberCapabilities(groupId, memberId);
      if (mountedRef.current && seq === reqRef.current) {
        setCapabilitiesState(response.capabilities);
      }
      return response.capabilities;
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
      return null;
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, memberId, mero, mountedRef]);

  useEffect(() => {
    reqRef.current += 1;
    setCapabilitiesState(null);
    setError(null);
  }, [groupId, memberId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setCapabilities = useCallback(
    async (nextCapabilities: number) => {
      if (!mero || !groupId || !memberId) {
        return null;
      }

      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      try {
        await mero.admin.setMemberCapabilities(groupId, memberId, { capabilities: nextCapabilities });
        if (mountedRef.current) {
          setCapabilitiesState(nextCapabilities);
        }
        return nextCapabilities;
      } catch (err) {
        const errorValue = toError(err);
        if (mountedRef.current) {
          setError(errorValue);
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [groupId, memberId, mero, mountedRef],
  );

  return { capabilities, loading, error, refetch, setCapabilities };
}

export function useContextDiscovery(options: ContextDiscoveryOptions): ContextDiscoveryState {
  const { mero } = useMero();
  const [context, setContext] = useState<ApplicationContextRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();

  const knownContextIdsKey = JSON.stringify(options.knownContextIds ?? []);

  const discover = useCallback(async () => {
    if (!mero) {
      const notConnectedError = new Error('Not connected');
      if (mountedRef.current) {
        setError(notConnectedError);
      }
      return null;
    }
    const knownContextIds = new Set(options.knownContextIds ?? []);
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const timeoutMs = options.timeoutMs ?? 30000;
    const deadline = Date.now() + timeoutMs;

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      while (Date.now() <= deadline) {
        if (options.targetAlias) {
          const aliasMatch = extractAliasContextId(
            await mero.admin.lookupContextAlias(options.targetAlias),
          );

          if (aliasMatch && !knownContextIds.has(aliasMatch)) {
            const discoveredFromAlias = {
              contextId: aliasMatch,
              applicationId: options.applicationId,
            };

            if (mountedRef.current) {
              setContext(discoveredFromAlias);
            }

            return discoveredFromAlias;
          }
        }

        const response = await mero.admin.getContextsForApplication(options.applicationId);
        const contexts = mapApplicationContexts(response.contexts ?? []);
        const discovered = contexts.find(
          (applicationContext) => !knownContextIds.has(applicationContext.contextId),
        );

        if (discovered) {
          if (mountedRef.current) {
            setContext(discovered);
          }
          return discovered;
        }

        if (Date.now() + pollIntervalMs > deadline) {
          break;
        }

        await sleep(pollIntervalMs);
      }

      const timeoutError = new Error(
        `Timed out discovering a context for application ${options.applicationId}`,
      );

      if (mountedRef.current) {
        setContext(null);
        setError(timeoutError);
      }

      return null;
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current) {
        setContext(null);
        setError(errorValue);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [
    knownContextIdsKey,
    mero,
    mountedRef,
    options.applicationId,
    options.knownContextIds,
    options.pollIntervalMs,
    options.targetAlias,
    options.timeoutMs,
  ]);

  const reset = useCallback(() => {
    if (mountedRef.current) {
      setContext(null);
      setError(null);
      setLoading(false);
    }
  }, [mountedRef]);

  return { context, loading, error, discover, reset };
}

// ---- Context CRUD Hooks ----

export function useCreateContext() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createContext = useCallback(
    async (request: CreateContextRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.createContext(request));
    },
    [mero, run],
  );

  return { createContext, loading, error };
}

export function useDeleteContext() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const deleteContext = useCallback(
    async (contextId: string) => {
      if (!mero) return null;
      return run(() => mero.admin.deleteContext(contextId));
    },
    [mero, run],
  );

  return { deleteContext, loading, error };
}

export function useJoinContext() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const joinContext = useCallback(
    async (contextId: string) => {
      if (!mero) return null;
      return run(() => mero.admin.joinContext(contextId));
    },
    [mero, run],
  );

  return { joinContext, loading, error };
}

export function useJoinSubgroupInheritance() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const joinSubgroupInheritance = useCallback(
    async (groupId: string) => {
      if (!mero) return null;
      return run(() => mero.admin.joinSubgroupInheritance(groupId));
    },
    [mero, run],
  );

  return { joinSubgroupInheritance, loading, error };
}

export function useContextGroup(contextId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<string | null>(
    mero && contextId ? () => mero.admin.getContextGroup(contextId) : null,
    null,
    [mero, contextId],
  );
  return { groupId: data, loading, error, refetch };
}

// ---- Group Info / Management Hooks ----

export function useGroupInfo(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<GroupInfo | null>(
    mero && groupId ? () => mero.admin.getGroupInfo(groupId) : null,
    null,
    [mero, groupId],
  );
  return { groupInfo: data, loading, error, refetch };
}

export function useDeleteGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const deleteGroup = useCallback(
    async (groupId: string, request?: DeleteGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.deleteGroup(groupId, request));
    },
    [mero, run],
  );

  return { deleteGroup, loading, error };
}

export function useSyncGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const syncGroup = useCallback(
    async (groupId: string, request?: SyncGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.syncGroup(groupId, request));
    },
    [mero, run],
  );

  return { syncGroup, loading, error };
}

/**
 * Takes the invitee's signing KEY (bs58) - the one call on this resource that
 * does, because someone being added may have no account here yet. Every other
 * member call, including `useRemoveGroupMembers`, takes the ACCOUNT, so a value
 * round-tripped from an add is the wrong one to remove with.
 */
export function useAddGroupMembers() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const addGroupMembers = useCallback(
    async (groupId: string, request: AddGroupMembersRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.addGroupMembers(groupId, request));
    },
    [mero, run],
  );

  return { addGroupMembers, loading, error };
}

/**
 * Takes the member's ACCOUNT (64 hex), as `useGroupMembers` rows are keyed by
 * and `useNodeIdentity().identity?.accountId` returns - NOT a signing key.
 * Both are 32-byte strings, so passing a key names nobody and raises nothing.
 */
export function useRemoveGroupMembers() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const removeGroupMembers = useCallback(
    async (groupId: string, request: RemoveGroupMembersRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.removeGroupMembers(groupId, request));
    },
    [mero, run],
  );

  return { removeGroupMembers, loading, error };
}

// ---- Namespace Hooks ----

export function useNamespaces() {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<Namespace[]>(
    mero ? () => mero.admin.listNamespaces() : null,
    [],
    [mero],
  );
  return { namespaces: data, loading, error, refetch };
}

export function useNamespace(namespaceId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<Namespace | null>(
    mero && namespaceId ? () => mero.admin.getNamespace(namespaceId) : null,
    null,
    [mero, namespaceId],
  );
  return { namespace: data, loading, error, refetch };
}

/**
 * Who this node is: `accountId` is what member-addressing takes and what
 * `useGroupMembers` rows are keyed by — `publicKey` is the signing key and
 * addresses nobody. Both are 32-byte strings, so a swap fails silently.
 */
export function useNodeIdentity() {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<NodeIdentity | null>(
    mero ? () => mero.admin.getNodeIdentity() : null,
    null,
    [mero],
  );
  return { identity: data, loading, error, refetch };
}

/**
 * @deprecated Use {@link useNodeIdentity}. Identity is per-node, not
 * per-namespace, and this no longer gates on participation: it answers for a
 * namespace this node never joined, so `identity != null` is not "am I a
 * member?" — ask `useNamespaces` for that. Its `publicKey` is the signing key,
 * NOT the account member-addressing wants.
 */
export function useNamespaceIdentity(namespaceId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<NamespaceIdentity | null>(
    mero && namespaceId ? () => mero.admin.getNamespaceIdentity(namespaceId) : null,
    null,
    [mero, namespaceId],
  );
  return { identity: data, loading, error, refetch };
}

export function useNamespacesForApplication(applicationId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<Namespace[]>(
    mero && applicationId ? () => mero.admin.listNamespacesForApplication(applicationId) : null,
    [],
    [mero, applicationId],
  );
  return { namespaces: data, loading, error, refetch };
}

export function useCreateNamespace() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createNamespace = useCallback(
    async (request: CreateNamespaceRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.createNamespace(request));
    },
    [mero, run],
  );

  return { createNamespace, loading, error };
}

export function useDeleteNamespace() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const deleteNamespace = useCallback(
    async (namespaceId: string, request?: DeleteNamespaceRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.deleteNamespace(namespaceId, request));
    },
    [mero, run],
  );

  return { deleteNamespace, loading, error };
}

export function useCreateNamespaceInvitation() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createNamespaceInvitation = useCallback(
    async (
      namespaceId: string,
      request?: CreateNamespaceInvitationRequest,
    ): Promise<CreateNamespaceInvitationResponseData | CreateRecursiveInvitationResponseData | null> => {
      if (!mero) return null;
      return run(() => mero.admin.createNamespaceInvitation(namespaceId, request));
    },
    [mero, run],
  );

  return { createNamespaceInvitation, loading, error };
}

export function useJoinNamespace() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const joinNamespace = useCallback(
    async (namespaceId: string, request: JoinNamespaceRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.joinNamespace(namespaceId, request));
    },
    [mero, run],
  );

  return { joinNamespace, loading, error };
}

export function useCreateGroupInNamespace() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const createGroupInNamespace = useCallback(
    async (namespaceId: string, request?: CreateGroupInNamespaceRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.createGroupInNamespace(namespaceId, request));
    },
    [mero, run],
  );

  return { createGroupInNamespace, loading, error };
}

export function useNamespaceGroups(namespaceId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<SubgroupEntry[]>(
    mero && namespaceId ? () => mero.admin.listNamespaceGroups(namespaceId) : null,
    [],
    [mero, namespaceId],
  );
  return { groups: data, loading, error, refetch };
}

// ---- Group Settings & Role Management ----

/**
 * Takes the member's ACCOUNT (64 hex), as `useGroupMembers` rows are keyed by
 * and `useNodeIdentity().identity?.accountId` returns - NOT a signing key.
 * Both are 32-byte strings, so passing a key names nobody and raises nothing.
 */
export function useUpdateMemberRole() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const updateMemberRole = useCallback(
    async (groupId: string, identity: string, request: UpdateMemberRoleRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.updateMemberRole(groupId, identity, request));
    },
    [mero, run],
  );

  return { updateMemberRole, loading, error };
}

export function useSetDefaultCapabilities() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setDefaultCapabilities = useCallback(
    async (groupId: string, request: SetDefaultCapabilitiesRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setDefaultCapabilities(groupId, request));
    },
    [mero, run],
  );

  return { setDefaultCapabilities, loading, error };
}

export function useSetSubgroupVisibility() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setSubgroupVisibility = useCallback(
    async (groupId: string, request: SetSubgroupVisibilityRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setSubgroupVisibility(groupId, request));
    },
    [mero, run],
  );

  return { setSubgroupVisibility, loading, error };
}

export function useDefaultCapabilities(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<number | null>(
    mero && groupId ? () => mero.admin.getDefaultCapabilities(groupId) : null,
    null,
    [mero, groupId],
  );
  return { defaultCapabilities: data, loading, error, refetch };
}

export function useSubgroupVisibility(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<string | null>(
    mero && groupId ? () => mero.admin.getSubgroupVisibility(groupId) : null,
    null,
    [mero, groupId],
  );
  return { subgroupVisibility: data, loading, error, refetch };
}

export function useSetTeeAdmissionPolicy() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setTeeAdmissionPolicy = useCallback(
    async (groupId: string, request: SetTeeAdmissionPolicyRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.setTeeAdmissionPolicy(groupId, request));
    },
    [mero, run],
  );

  return { setTeeAdmissionPolicy, loading, error };
}

// ---- Metadata Hooks ----

export function useSetGroupMetadata() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setGroupMetadata = useCallback(
    async (groupId: string, request: SetMetadataInput) => {
      if (!mero) return null;
      return run(() => mero.admin.setGroupMetadata(groupId, request));
    },
    [mero, run],
  );

  return { setGroupMetadata, loading, error };
}

/**
 * Takes the member's ACCOUNT (64 hex), as `useGroupMembers` rows are keyed by
 * and `useNodeIdentity().identity?.accountId` returns - NOT a signing key.
 * Both are 32-byte strings, so passing a key names nobody and raises nothing.
 */
export function useSetMemberMetadata() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setMemberMetadata = useCallback(
    async (groupId: string, identity: string, request: SetMetadataInput) => {
      if (!mero) return null;
      return run(() => mero.admin.setMemberMetadata(groupId, identity, request));
    },
    [mero, run],
  );

  return { setMemberMetadata, loading, error };
}

export function useSetContextMetadata() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const setContextMetadata = useCallback(
    async (groupId: string, contextId: string, request: SetMetadataInput) => {
      if (!mero) return null;
      return run(() => mero.admin.setContextMetadata(groupId, contextId, request));
    },
    [mero, run],
  );

  return { setContextMetadata, loading, error };
}

export function useGroupMetadata(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<MetadataRecord | null>(
    mero && groupId ? () => mero.admin.getGroupMetadata(groupId) : null,
    null,
    [mero, groupId],
  );
  return { metadata: data, loading, error, refetch };
}

export function useMemberMetadata(groupId?: string | null, identity?: string | null) {
  const { mero } = useMero();
  const [metadata, setMetadata] = useState<MetadataRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Drop the previous (group, member)'s record DURING RENDER. Clearing in an
  // effect leaves one render where `metadata` answers for the pair that was
  // asked about last, and a consumer that persists what it sees turns that
  // transient staleness into a permanent wrong answer.
  const prevKey = useRef<string | null>(null);
  const key = `${groupId ?? ''}:${identity ?? ''}`;
  if (prevKey.current !== null && prevKey.current !== key) {
    setMetadata(null);
    setError(null);
  }
  prevKey.current = key;

  // Shared fetch logic for the auto-mount effect and the explicit
  // refetch callable. The per-invocation `signal.aborted` flag covers
  // the response-during-unmount race cleanly without the global
  // mountedRef gate that — under StrictMode-like fast unmount/remount
  // cycles — could leave the hook stuck on `metadata = null` when an
  // in-flight response landed during cleanup and the followup mount's
  // useCallback referential identity hadn't changed enough to re-fire
  // the effect.
  const run = useCallback(
    async (signal: { aborted: boolean }) => {
      if (!mero || !groupId || !identity) {
        if (!signal.aborted) {
          setMetadata(null);
          setError(null);
          setLoading(false);
        }
        return;
      }
      if (!signal.aborted) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await mero.admin.getMemberMetadata(groupId, identity);
        if (!signal.aborted) setMetadata(result);
      } catch (err) {
        if (!signal.aborted) setError(toError(err));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [mero, groupId, identity],
  );

  useEffect(() => {
    const signal = { aborted: false };
    void run(signal);
    return () => {
      signal.aborted = true;
    };
  }, [run]);

  // Explicit refetch — the caller's `await refetch()` resolves only
  // after state has been written (preserves the prior API contract;
  // call sites like `useMemberDisplayName.setName` rely on the new
  // value being readable from state after the await).
  const refetch = useCallback(async () => {
    const signal = { aborted: false };
    await run(signal);
  }, [run]);

  return { metadata, loading, error, refetch };
}

// ---- Group Signing Key, Upgrades & Hierarchy ----

export function useUpgradeGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const upgradeGroup = useCallback(
    async (groupId: string, request: UpgradeGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.upgradeGroup(groupId, request));
    },
    [mero, run],
  );

  return { upgradeGroup, loading, error };
}

/**
 * Install a registry package version onto the node — the discrete "Download"
 * step an Updates flow runs before an `upgradeGroup`. Resolves the installed
 * application id (`InstallApplicationResponseData`). Downloading does not by
 * itself change what any group runs; pair it with a subsequent upgrade.
 */
export function useInstallFromRegistry() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const installFromRegistry = useCallback(
    async (registryUrl: string, packageName: string, version: string) => {
      if (!mero) return null;
      return run(() => mero.admin.installFromRegistry(registryUrl, packageName, version));
    },
    [mero, run],
  );

  return { installFromRegistry, loading, error };
}

/**
 * Kick off a full state re-pull for a context — operator recovery for a
 * context stranded mid-sync. `force` re-pulls even when the node does not
 * flag the context as stranded.
 */
export function useResyncContext() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const resyncContext = useCallback(
    async (contextId: string, request: ResyncContextRequest = {}) => {
      if (!mero) return null;
      return run(() => mero.admin.resyncContext(contextId, request));
    },
    [mero, run],
  );

  return { resyncContext, loading, error };
}

export function useGroupUpgradeStatus(groupId?: string | null) {
  const { mero } = useMero();
  const [upgradeStatus, setUpgradeStatus] = useState<GroupUpgradeStatusResponseData>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Latest-request-wins token (see useMigrationStatus) so overlapping refetches
  // can't land out of order and overwrite fresher data.
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setUpgradeStatus(null);
        setError(null);
        setLoading(false);
      }
      return;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await mero.admin.getGroupUpgradeStatus(groupId);
      if (mountedRef.current && seq === reqRef.current) {
        setUpgradeStatus(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

  // Clear stale status synchronously when the target group changes (and
  // invalidate any in-flight refetch), mirroring useMigrationStatus.
  useEffect(() => {
    reqRef.current += 1;
    setUpgradeStatus(null);
    setError(null);
  }, [groupId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { upgradeStatus, loading, error, refetch };
}

export function useRetryGroupUpgrade() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const retryGroupUpgrade = useCallback(
    async (groupId: string, request?: RetryGroupUpgradeRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.retryGroupUpgrade(groupId, request));
    },
    [mero, run],
  );

  return { retryGroupUpgrade, loading, error };
}

/** Move `childGroupId` under a new parent. */
export function useReparentGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const reparentGroup = useCallback(
    async (childGroupId: string, request: ReparentGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.reparentGroup(childGroupId, request));
    },
    [mero, run],
  );

  return { reparentGroup, loading, error };
}

export function useSubgroups(groupId?: string | null) {
  const { mero } = useMero();
  const { data, loading, error, refetch } = useAsyncResource<SubgroupEntry[]>(
    mero && groupId ? () => mero.admin.listSubgroups(groupId) : null,
    [],
    [mero, groupId],
  );
  return { subgroups: data, loading, error, refetch };
}

// ---- Context-Group Relationship ----

export function useDetachContextFromGroup() {
  const { mero } = useMero();
  const { loading, error, run } = useAsyncMutation();

  const detachContextFromGroup = useCallback(
    async (groupId: string, contextId: string, request?: DetachContextFromGroupRequest) => {
      if (!mero) return null;
      return run(() => mero.admin.detachContextFromGroup(groupId, contextId, request));
    },
    [mero, run],
  );

  return { detachContextFromGroup, loading, error };
}

/**
 * Subscribe to a namespace's `GroupMigration` events, invoking `onEvent` per
 * frame and unsubscribing on unmount.
 *
 * A non-admin subscriber never sees `CascadeProgress`; core delivers that to
 * namespace admins only, so a UI must not wait on it to decide progress.
 */
/**
 * Fallback poll cadence for `useMigrationStatus` when the SSE stream is
 * unavailable (no token, a proxy that buffers, an older node) and the caller
 * named no interval of its own. Chosen to match the heartbeat cadence that
 * migration facts actually arrive on; an explicit `pollIntervalMs` overrides it.
 */
export const DEFAULT_MIGRATION_POLL_INTERVAL_MS = 5000;

export function useMigrationEvents(
  namespaceId: string | null | undefined,
  onEvent: (event: GroupMigrationEventData) => void,
): boolean {
  const { mero } = useMero();
  const mountedRef = useMountedRef();
  // Whether the stream is actually carrying frames. Callers use it to decide
  // whether they still need a fallback poll, so it must reflect the subscribe
  // ACTUALLY succeeding - not merely that we asked.
  const [live, setLive] = useState(false);
  // Held in a ref so a caller passing an inline arrow does not resubscribe on
  // every render - the subscription's lifetime is the namespace's, not the
  // callback identity's.
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!mero || !namespaceId) return;
    const sse = mero.events;
    const unsubscribe = sse.onMigrationEvent((event) => handlerRef.current(event));
    // Sequential, and the result is recorded: connecting but failing to
    // subscribe is still a dead stream, and both used to be swallowed, which
    // left a caller unable to tell a live stream from a silent one.
    let cancelled = false;
    void (async () => {
      try {
        await sse.connect();
        await sse.subscribe({ groupIds: [namespaceId] });
        if (!cancelled && mountedRef.current) setLive(true);
      } catch {
        if (!cancelled && mountedRef.current) setLive(false);
      }
    })();
    return () => {
      cancelled = true;
      if (mountedRef.current) setLive(false);
      unsubscribe();
    };
  }, [mero, namespaceId, mountedRef]);

  return live;
}

/**
 * Migration-status rollup for a namespace (skew #3).
 *
 * Live: subscribes to the `GroupMigration` event family and re-reads on each
 * frame. It re-READS rather than folding the event's counters in, because the
 * rollup is recomputed from raw member rows and is the authoritative answer.
 * `pollIntervalMs` stays as the fallback when SSE is unavailable, and when the
 * caller names none it defaults to `DEFAULT_MIGRATION_POLL_INTERVAL_MS` for
 * exactly as long as the stream is down - so the panel can never sit silently
 * frozen with neither transport.
 * Derived counters are null-safe before the first load.
 */
export function useMigrationStatus(
  namespaceId?: string | null,
  options?: { pollIntervalMs?: number },
) {
  const { mero } = useMero();
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Monotonic request token: only the latest in-flight request applies its
  // result, so an overlapping poll or a fast namespace change can't let a
  // stale response overwrite fresher data.
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mero || !namespaceId) {
      if (mountedRef.current) {
        setStatus(null);
        setError(null);
        setLoading(false);
      }
      return;
    }

    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await mero.admin.getMigrationStatus(namespaceId);
      if (mountedRef.current && seq === reqRef.current) {
        setStatus(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [namespaceId, mero, mountedRef]);

  // Clear stale state the instant the namespace changes, so the panel shows a
  // loading state rather than the previous namespace's data during the refetch.
  useEffect(() => {
    setStatus(null);
    setError(null);
  }, [namespaceId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Live updates. The frame is a signal, not the answer: it says something
  // moved, and the re-read is what stays authoritative. This runs BEFORE the
  // poll below because whether the stream is genuinely live is what decides
  // if a caller who named no interval needs a fallback poll at all.
  const sseLive = useMigrationEvents(namespaceId, () => void refetch());

  // An explicit interval always wins - a caller that asked to poll keeps
  // polling. When none was named, poll only while the stream is NOT live:
  // migration facts arrive by heartbeat gossip with no push transport of their
  // own, so with neither SSE nor an interval the panel loads once and then
  // silently never updates again, with no error to show for it.
  const pollIntervalMs =
    options?.pollIntervalMs ??
    (sseLive ? undefined : DEFAULT_MIGRATION_POLL_INTERVAL_MS);
  useEffect(() => {
    if (!pollIntervalMs || !mero || !namespaceId) return;
    const handle = setInterval(() => void refetch(), pollIntervalMs);
    return () => clearInterval(handle);
  }, [pollIntervalMs, mero, namespaceId, refetch]);

  const rollup: MigrationStatusRollup | null = status?.rollup ?? null;
  const members: MemberMigrationStatusEntry[] = status?.members ?? [];

  return {
    status,
    rollup,
    members,
    allMigrated: rollup?.allMigrated ?? false,
    /**
     * When this node watched the fleet converge, or `null`. Durable, unlike
     * `allMigrated`, which is recomputed from in-TTL heartbeats and lapses back
     * to false when a member simply goes quiet.
     */
    fleetCompletedAt: status?.fleetCompletedAt ?? null,
    membersPendingSignature: rollup?.membersPendingSignature ?? 0,
    /** Members whose migrate aborted (migration-check failed or apply errored). */
    failed: rollup?.failed ?? 0,
    loading,
    error,
    refetch,
  };
}

/**
 * Bundle-version skew (#2): reads the context's installed `applicationVersion`
 * (semver) and compares it to the app-declared `expected` build constant. Any
 * mismatch (either direction) is `isStale` → "reload to update". Subscribes to
 * `AppVersionChanged` so a live flip updates `appVersion` without a refetch.
 */
export function useAppVersion(contextId?: string | null, expected?: string) {
  const { mero } = useMero();
  const [appVersion, setAppVersion] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Latest-request-wins token (see useMigrationStatus).
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mero || !contextId) {
      if (mountedRef.current) {
        setAppVersion(undefined);
        setError(null);
        setLoading(false);
      }
      return;
    }

    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const context = await mero.admin.getContext(contextId);
      if (mountedRef.current && seq === reqRef.current) {
        setAppVersion(context.applicationVersion);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [contextId, mero, mountedRef]);

  // Reset on context change so a stale version isn't shown during the refetch.
  useEffect(() => {
    setAppVersion(undefined);
    setError(null);
  }, [contextId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!mero?.events || !contextId) return;
    const off = mero.events.onAppVersionChanged((event: AppVersionChangedEvent) => {
      if (event.contextId !== contextId) return;
      if (mountedRef.current && event.toVersion) {
        // Invalidate any in-flight refetch so its (older) result can't clobber
        // this live update.
        reqRef.current += 1;
        setAppVersion(event.toVersion);
      }
    });
    return off;
  }, [mero, contextId, mountedRef]);

  const isStale = appVersion != null && expected != null && appVersion !== expected;

  return { appVersion, expected, isStale, loading, error, refetch };
}

/**
 * "Is a newer version available?" for an Updates view. Reads a package's
 * published versions from the registry and compares the newest to the running
 * `currentVersion` (e.g. a context's `applicationVersion`). `updateAvailable`
 * is true only when the registry's newest is strictly greater. This is the
 * registry-side check the admin acts on; gate rendering on admin status at the
 * call site. Pure read — fetching nothing until both `registryUrl` and
 * `packageName` are provided.
 */
export function useLatestVersion(
  registryUrl?: string | null,
  packageName?: string | null,
  currentVersion?: string | null,
) {
  const { mero } = useMero();
  const [versions, setVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Latest-request-wins token (see useMigrationStatus).
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!mero || !registryUrl || !packageName) {
      // Invalidate any in-flight request so a late response can't repopulate
      // stale versions for the previous package after the inputs were cleared.
      reqRef.current += 1;
      if (mountedRef.current) {
        setVersions([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    const seq = ++reqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const result = await mero.admin.getRegistryVersions(registryUrl, packageName);
      if (mountedRef.current && seq === reqRef.current) {
        setVersions(result);
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [mero, registryUrl, packageName, mountedRef]);

  // Clear stale versions the instant the package/registry changes.
  useEffect(() => {
    setVersions([]);
    setError(null);
  }, [registryUrl, packageName]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // getRegistryVersions returns newest-first, so [0] is the latest published.
  const latestVersion = versions[0] ?? null;
  const updateAvailable =
    latestVersion != null &&
    currentVersion != null &&
    compareSemver(latestVersion, currentVersion) > 0;

  return { versions, latestVersion, currentVersion, updateAvailable, loading, error, refetch };
}

interface GroupAppVersion {
  /** Semver of the application the group currently targets (`null` until loaded). */
  version: string | null;
  /** The group's `targetApplicationId`. */
  applicationId: string | null;
  /** The installed blob differs from the one the group targets (see hook doc). */
  pendingApply: boolean;
  /** Only populated via the group-info path; `null` in the namespace path. */
  activeUpgrade: GroupUpgradeStatusResponseData;
}

const EMPTY_GROUP_APP_VERSION: GroupAppVersion = {
  version: null,
  applicationId: null,
  pendingApply: false,
  activeUpgrade: null,
};

/** An appKey carries no "pending" signal when it is absent or all-zero. */
function isZeroAppKey(appKey?: string): boolean {
  return !appKey || /^0+$/.test(appKey);
}

/**
 * What app version does this group run, and is there a downloaded-but-not-yet-
 * applied update? Replaces the appKey-vs-installed-blob comparison apps
 * otherwise hand-roll: `pendingApply` is true when the group's `appKey` (the
 * blob it targets) is present, non-zero, and differs from the blob actually
 * installed for its `targetApplicationId`. Deciding whether to render or gate on
 * that status (admin-only actions, etc.) is the call site's job.
 *
 * Resolution stays cheap: the group's record comes from `listNamespaces()` when
 * the id is a namespace, else from `getGroupInfo()`; `getApplication()` then
 * reads the installed version and blob. `activeUpgrade` is returned only when it
 * arrives for free on the group-info path (it is not fetched separately).
 * Subscribes to `AppVersionChanged` and refetches, since any version flip in the
 * workspace can make the rollup stale.
 */
export function useGroupAppVersion(groupId?: string) {
  const { mero } = useMero();
  const [data, setData] = useState<GroupAppVersion>(EMPTY_GROUP_APP_VERSION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useMountedRef();
  // Latest-request-wins token (see useMigrationStatus).
  const reqRef = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++reqRef.current;
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setData(EMPTY_GROUP_APP_VERSION);
        setError(null);
        setLoading(false);
      }
      return;
    }

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      // Namespace-first resolution: a top-level group is a namespace; only
      // subgroups need the getGroupInfo fallback (which also carries
      // activeUpgrade, so we surface it without a third call).
      const namespaces = await mero.admin.listNamespaces();
      const namespace = namespaces.find((entry) => entry.namespaceId === groupId);

      let appKey: string | undefined;
      let applicationId: string | null;
      let activeUpgrade: GroupUpgradeStatusResponseData = null;

      if (namespace) {
        appKey = namespace.appKey;
        applicationId = namespace.targetApplicationId;
      } else {
        const info = await mero.admin.getGroupInfo(groupId);
        appKey = info.appKey;
        applicationId = info.targetApplicationId;
        activeUpgrade = info.activeUpgrade ?? null;
      }

      let version: string | null = null;
      let pendingApply = false;
      if (applicationId) {
        const { application } = await mero.admin.getApplication(applicationId);
        version = application?.version ?? null;
        if (application && !isZeroAppKey(appKey)) {
          const installedHex = base58ToHex(application.blob.bytecode).toLowerCase();
          pendingApply = appKey!.toLowerCase() !== installedHex;
        }
      }

      if (mountedRef.current && seq === reqRef.current) {
        setData({ version, applicationId, pendingApply, activeUpgrade });
      }
    } catch (err) {
      const errorValue = toError(err);
      if (mountedRef.current && seq === reqRef.current) {
        setError(errorValue);
      }
    } finally {
      if (mountedRef.current && seq === reqRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero, mountedRef]);

  // Clear stale state synchronously when the target group changes (and
  // invalidate any in-flight refetch). Mirrors useGroupUpgradeStatus.
  useEffect(() => {
    reqRef.current += 1;
    setData(EMPTY_GROUP_APP_VERSION);
    setError(null);
  }, [groupId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!mero?.events || !groupId) return;
    const off = mero.events.onAppVersionChanged(() => {
      if (mountedRef.current) void refetch();
    });
    return off;
  }, [mero, groupId, refetch, mountedRef]);

  return { ...data, loading, error, refetch };
}

/**
 * The caller's own identity-gated entries pending re-signature (skew #1).
 * `pending` is `pendingCount > 0` (from `count_my_pending`); `authorize()` runs
 * the one-tap `migrate_my_entries` convert and folds the resulting `remaining`
 * back into the count.
 */
export function useMyAuthoredMigration(contextId?: string | null) {
  const { mero } = useMero();
  const [summary, setSummary] = useState<MigrateMyEntriesSummary | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const mountedRef = useMountedRef();
  const { loading, error, run } = useAsyncMutation();
  // Latest-request-wins token (see useMigrationStatus).
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!mero || !contextId) {
      if (mountedRef.current) setPendingCount(0);
      return;
    }
    const seq = ++reqRef.current;
    try {
      const count = await mero.rpc.countMyPending(contextId);
      if (mountedRef.current && seq === reqRef.current) setPendingCount(count);
    } catch {
      // best-effort count; leave the previous value on a transient failure
    }
  }, [mero, contextId, mountedRef]);

  // Clear stale per-context state synchronously when the target changes (and
  // invalidate any in-flight refresh), so the banner doesn't flash the previous
  // context's count until the new count resolves. Mirrors useMigrationStatus.
  useEffect(() => {
    reqRef.current += 1;
    setPendingCount(0);
    setSummary(null);
  }, [contextId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const authorize = useCallback(async () => {
    if (!mero || !contextId) return null;
    const result = await run(() => mero.rpc.migrateMyEntries(contextId));
    if (result && mountedRef.current) {
      // Invalidate any in-flight refresh so a stale count can't overwrite the
      // authoritative post-convert remaining.
      reqRef.current += 1;
      setSummary(result);
      setPendingCount(result.remaining);
    }
    return result;
  }, [mero, contextId, run, mountedRef]);

  return {
    summary,
    pendingCount,
    pending: pendingCount > 0,
    authorize,
    loading,
    error,
    refresh,
  };
}
