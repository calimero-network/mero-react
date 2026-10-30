/**
 * The node's consent page (mero-js#317, core#4772).
 *
 * Approvals (a mero-tee release, an app upgrade) happen only on a page the
 * node serves on its own origin, never inside an app: a session opened on an
 * app's frontend cannot approve anything. An app asks for a consent request,
 * sends the person to its `url`, and learns the outcome from
 * `GET /consent/{id}/result`, either by polling while it stays open or, when
 * it navigated away, from the `returnTo` the page sends the person back to.
 *
 * Build requests with mero-js's `releaseConsent`, `withdrawConsent` and
 * `upgradeConsent`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { consentReturn } from '@calimero-network/mero-js';
import type { ConsentRequest, ConsentResult, ConsentStarted } from '@calimero-network/mero-js';
import { useClientAction, useSignedInClient, type MutationOptions } from './internal';

export interface WaitOptions {
  intervalMs?: number;
  /** Stop polling (the answer is then still `pending`). */
  signal?: AbortSignal;
}

/**
 * Request consent, open the page, wait for the decision.
 *
 * - `open(request)`: navigate this tab to the page (the default), or pass
 *   `navigate` to open it some other way (`window.open`, the system browser).
 * - `returned`: what the page put on this URL when it sent the person back
 *   (`?request_id=…&result=…`). A hint only: confirm it with `check`.
 */
export function useConsent(options?: MutationOptions) {
  const client = useSignedInClient();
  const { withClient, ...state } = useClientAction(options);
  const [started, setStarted] = useState<ConsentStarted | null>(null);
  const [result, setResult] = useState<ConsentResult | null>(null);
  const waiting = useRef<AbortController | null>(null);

  useEffect(() => () => waiting.current?.abort(), []);

  const returned = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      return consentReturn(window.location.href);
    } catch {
      return null;
    }
  }, []);

  const request = useCallback(
    (req: ConsentRequest) =>
      withClient(async (c) => {
        const answer = await c.requestConsent(req);
        setStarted(answer);
        setResult(null);
        return answer;
      }),
    [withClient],
  );

  const open = useCallback(
    (req: ConsentRequest, navigate?: (url: string) => void) =>
      withClient(async (c) => {
        const answer = await c.openConsentPage(req, navigate);
        setStarted(answer);
        setResult(null);
        return answer;
      }),
    [withClient],
  );

  const check = useCallback(
    (requestId: string) =>
      withClient(async (c) => {
        const answer = await c.consentResult(requestId);
        setResult(answer);
        return answer;
      }),
    [withClient],
  );

  const wait = useCallback(
    (requestId: string, waitOptions: WaitOptions = {}) => {
      waiting.current?.abort();
      const controller = new AbortController();
      waiting.current = controller;
      waitOptions.signal?.addEventListener('abort', () => controller.abort(), { once: true });
      return withClient(async (c) => {
        const answer = await c.waitForConsent(requestId, {
          intervalMs: waitOptions.intervalMs,
          signal: controller.signal,
          expiresAt: started?.requestId === requestId ? started.expiresAt : undefined,
        });
        setResult(answer);
        return answer;
      });
    },
    [withClient, started],
  );

  const cancel = useCallback(() => waiting.current?.abort(), []);

  return { request, open, check, wait, cancel, started, result, returned, ready: !!client, ...state };
}
