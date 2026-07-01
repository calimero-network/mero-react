/**
 * Local-node discovery.
 *
 * Calimero dev/desktop nodes expose a public, unauthenticated health endpoint
 * at `GET {nodeUrl}/admin-api/health` that returns `{ "data": { "status":
 * "alive" } }`. The most common local layouts run on a small, well-known set of
 * ports, so instead of forcing the user to type a URL we probe those ports and
 * offer whatever is actually running.
 *
 * Port convention (core defaults; mirrored by merobox `base_rpc_port` /
 * `base_port`): the **HTTP / RPC server** — which serves `/admin-api/*` — is on
 * **2528** and a multi-node dev stack increments it per node (2528, 2529, …).
 * The **2428** range is the libp2p **P2P swarm** port and does NOT speak HTTP,
 * so it will not answer a health probe under a default setup. We lead with the
 * HTTP ports and keep a couple of swarm-range ports only for setups that
 * deliberately run the server there.
 */

/**
 * Default ports probed when discovering local nodes. HTTP/RPC ports first
 * (2528–2531 → up to four dev nodes), then the swarm-range ports for
 * back-compat with setups that run the server there.
 */
export const DEFAULT_LOCAL_NODE_PORTS = [
  2528, 2529, 2530, 2531, 2428, 2429,
] as const;

/** Host used to build local candidate URLs. */
const DEFAULT_LOCAL_HOST = 'localhost';

/** Per-probe timeout. A reachable local node answers almost instantly; a
 * closed port rejects fast, but a firewalled/black-holed one can hang, so we
 * cap each probe. */
const DEFAULT_PROBE_TIMEOUT_MS = 2000;

/** Max probes in flight at once, so a wider scan doesn't fire everything at
 * once. */
const DEFAULT_CONCURRENCY = 8;

export interface DiscoverLocalNodesOptions {
  /** Ports to probe. Defaults to {@link DEFAULT_LOCAL_NODE_PORTS}. */
  ports?: readonly number[];
  /** Host for the port-derived candidates. Defaults to `localhost`. */
  host?: string;
  /**
   * Extra full base URLs to probe alongside the port-derived candidates — e.g.
   * the last node the user connected to, or a non-standard host. Deduped
   * against the generated set.
   */
  extraUrls?: readonly string[];
  /** Max probes in flight at once. Defaults to 8. */
  concurrency?: number;
  /** Per-probe timeout in ms. Defaults to 2000. */
  timeoutMs?: number;
  /** Abort the whole discovery (e.g. when the modal closes). */
  signal?: AbortSignal;
}

/** Build the canonical base URL for a local node on the given port. */
export function localNodeUrl(port: number, host: string = DEFAULT_LOCAL_HOST): string {
  return `http://${host}:${port}`;
}

/** Trim a trailing slash so URLs compare/dedupe consistently. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Run `task` over `items` with at most `limit` running concurrently, returning
 * results in the original item order.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i], i);
    }
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker,
  );
  await Promise.all(workers);
  return results;
}

/**
 * Resolve an API `path` against a node `baseUrl`. Ensures the base ends with a
 * slash first, so a base that carries a path prefix (e.g. a `NODE_PATH_PREFIX`
 * deployment like `http://host/node1`) keeps that segment instead of having it
 * stripped by relative URL resolution.
 */
export function nodeEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path, base).toString();
}

/**
 * Probe a single node's health endpoint. Resolves `true` only when the node
 * answers with a 2xx and (when the body is JSON) reports a non-dead status.
 * Any network error, timeout, or non-ok response resolves `false` — never
 * throws (except on an external abort, which is swallowed as `false`).
 */
export async function probeNodeHealth(
  baseUrl: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, signal } = options;

  // Already cancelled before we start — don't fetch, and don't register a
  // timer or listener that would then need cleanup.
  if (signal?.aborted) return false;

  // Per-probe timeout, also linked to the caller's abort signal so closing the
  // modal cancels every in-flight probe. Track whether the listener was added
  // so cleanup stays symmetric with registration.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const listenerAdded = !!signal;
  if (listenerAdded) signal!.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = nodeEndpoint(baseUrl, 'admin-api/health');
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!res.ok) return false;

    // Health body is `{ data: { status: "alive" } }`, but tolerate plain
    // `{ status }` and non-JSON 2xx responses. A *missing* status is treated as
    // alive (the 2xx is enough); a status that is present but not "alive"
    // (including an explicit `null`) is treated as unhealthy.
    try {
      const body = (await res.json()) as
        | { data?: { status?: string | null }; status?: string | null }
        | undefined;
      const status =
        body?.data?.status !== undefined ? body?.data?.status : body?.status;
      if (status === undefined) return true;
      return typeof status === 'string' && status.toLowerCase() === 'alive';
    } catch {
      return true;
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    if (listenerAdded) signal!.removeEventListener('abort', onAbort);
  }
}

/**
 * Probe the candidate local nodes (concurrency-limited) and return the base
 * URLs that responded as healthy, in candidate order — port-derived candidates
 * first (in `ports` order), then any `extraUrls`. Duplicates are removed.
 * Returns an empty array when nothing local is running.
 */
export async function discoverLocalNodes(
  options: DiscoverLocalNodesOptions = {},
): Promise<string[]> {
  const {
    ports = DEFAULT_LOCAL_NODE_PORTS,
    host = DEFAULT_LOCAL_HOST,
    extraUrls = [],
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs,
    signal,
  } = options;

  const candidates = Array.from(
    new Set([
      ...ports.map((port) => localNodeUrl(port, host)),
      ...extraUrls.map(normalizeBaseUrl).filter(Boolean),
    ]),
  );

  const results = await mapWithConcurrency(candidates, concurrency, (url) =>
    probeNodeHealth(url, { timeoutMs, signal }).then((ok) => (ok ? url : null)),
  );

  return results.filter((url): url is string => url !== null);
}
