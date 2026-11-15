import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalimeroClient, NodeVerificationState } from '@calimero-network/mero-js';
import type { AppCodeCheck } from './shieldView';

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;
const NODE_POLL_MS = 1_000; // how often to notice that the client failed over

/** An unreachable node is asked again after 2 s, 4 s, 8 s, up to 30 s. */
const retryDelay = (attempt: number) => Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);

/** The check's outcome, or `null` for a client that cannot be checked: it stays "checking" instead of taking the app down. */
async function check(client: CalimeroClient): Promise<NodeVerificationState | null> {
  try {
    return await client.verify();
  } catch {
    return null;
  }
}

function peek(client: CalimeroClient | null): NodeVerificationState {
  let known: NodeVerificationState | undefined;
  try {
    known = client?.verification();
  } catch {
    // A client that cannot say is still being checked.
  }
  return known ?? { status: 'checking', url: client?.nodeUrl ?? '' };
}

/** The check of the node in use, asked again after a failure to reach it, a failover, and whenever `refresh` is called. */
export function useNodeVerification(client: CalimeroClient | null): [NodeVerificationState, () => void] {
  const [state, setState] = useState(() => peek(client));
  const [round, setRound] = useState(0);
  const [url, setUrl] = useState(client?.nodeUrl);
  useEffect(() => {
    setUrl(client?.nodeUrl);
    if (!client) return;
    const poll = setInterval(() => setUrl(client.nodeUrl), NODE_POLL_MS);
    return () => clearInterval(poll);
  }, [client]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (attempt: number) => {
      const next = await check(client);
      if (!live || !next) return;
      setState(next);
      if (next.status === 'unreachable') timer = setTimeout(() => void run(attempt + 1), retryDelay(attempt));
    };
    setState(peek(client));
    void run(0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client, round, url]);
  // Never describe a node the client has moved on from: compared with the node in use now, not the last poll.
  const inUse = client?.nodeUrl;
  const shown: NodeVerificationState = inUse && state.url !== inUse ? { status: 'checking', url: inUse } : state;
  return [shown, useCallback(() => setRound((n) => n + 1), [])];
}

/** The app's code check of verified node `url`, asked when `url` is set and shown only while that node is still in use. */
export function useAppCode(
  client: CalimeroClient | null,
  appCode: (() => Promise<AppCodeCheck>) | undefined,
  url: string | null,
): AppCodeCheck | null {
  // Kept in a ref: an inline `appCode` is a new function every render and must not re-run the check.
  const latest = useRef(appCode);
  latest.current = appCode;
  const has = appCode !== undefined;
  const [result, setResult] = useState<{ client: CalimeroClient; url: string; code: AppCodeCheck } | null>(null);
  useEffect(() => {
    if (!client || !has || !url) return;
    let live = true;
    void Promise.resolve()
      .then(() => latest.current?.())
      .then(
        (code) => live && code && client.nodeUrl === url && setResult({ client, url, code }),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [client, has, url]);
  const current = result?.client === client && result?.url === url && client?.nodeUrl === url;
  return current ? result.code : null;
}
