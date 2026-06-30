/**
 * Local-node discovery.
 *
 * Calimero dev/desktop nodes expose a public, unauthenticated health endpoint
 * at `GET {nodeUrl}/admin-api/health` that returns `{ "data": { "status":
 * "alive" } }`. The most common local layouts run on a small, well-known set of
 * ports, so instead of forcing the user to type a URL we probe those ports and
 * offer whatever is actually running.
 */

/**
 * Default ports probed when discovering local nodes. Covers the two-node dev
 * stacks used across the Calimero apps (RPC + alt ports for node1 / node2).
 */
export const DEFAULT_LOCAL_NODE_PORTS = [2428, 2429, 2528, 2529] as const;

/** Host used to build local candidate URLs. */
const LOCAL_HOST = 'localhost';

/** Per-probe timeout. A reachable local node answers almost instantly; a
 * closed port rejects fast, but a firewalled/black-holed one can hang, so we
 * cap each probe. */
const DEFAULT_PROBE_TIMEOUT_MS = 2000;

export interface DiscoverLocalNodesOptions {
  /** Ports to probe. Defaults to {@link DEFAULT_LOCAL_NODE_PORTS}. */
  ports?: readonly number[];
  /** Per-probe timeout in ms. Defaults to 2000. */
  timeoutMs?: number;
  /** Abort the whole discovery (e.g. when the modal closes). */
  signal?: AbortSignal;
}

/** Build the canonical base URL for a local node on the given port. */
export function localNodeUrl(port: number): string {
  return `http://${LOCAL_HOST}:${port}`;
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

  // Per-probe timeout, also linked to the caller's abort signal so closing the
  // modal cancels every in-flight probe.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL('admin-api/health', baseUrl).toString();
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!res.ok) return false;

    // Health body is `{ data: { status: "alive" } }`, but tolerate plain
    // `{ status }` and non-JSON 2xx responses (still treated as alive).
    try {
      const body = (await res.json()) as
        | { data?: { status?: string }; status?: string }
        | undefined;
      const status = body?.data?.status ?? body?.status;
      return status ? status.toLowerCase() === 'alive' : true;
    } catch {
      return true;
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Probe the configured local ports in parallel and return the base URLs that
 * responded as healthy, in ascending port order. Returns an empty array when
 * nothing local is running.
 */
export async function discoverLocalNodes(
  options: DiscoverLocalNodesOptions = {},
): Promise<string[]> {
  const { ports = DEFAULT_LOCAL_NODE_PORTS, timeoutMs, signal } = options;

  const results = await Promise.all(
    ports.map(async (port) => {
      const url = localNodeUrl(port);
      const ok = await probeNodeHealth(url, { timeoutMs, signal });
      return ok ? url : null;
    }),
  );

  return results.filter((url): url is string => url !== null);
}
