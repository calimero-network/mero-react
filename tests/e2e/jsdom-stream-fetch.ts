/**
 * Harness-only: make streaming `fetch` usable under vitest's jsdom environment.
 *
 * jsdom has no `fetch`, so the global `fetch` is Node's (undici) — but jsdom
 * DOES replace the global `AbortController`/`AbortSignal`. undici brand-checks
 * `init.signal` against its own realm's `AbortSignal` and throws
 *
 *   RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
 *
 * for anything jsdom made. `mero-js`'s `SseClient` creates its own
 * `AbortController` per connection and has no opt-out (unlike the per-request
 * timeout signal, which `timeoutMs: 0` disables — see tests/e2e/harness.ts), so
 * without this every SSE connect fails and no event ever arrives.
 *
 * This is purely a realm mismatch inside the test runner: in a real browser the
 * signal and `fetch` come from the same realm. Rather than change SDK code to
 * suit a test, this hands undici a request with no `signal` and re-attaches the
 * abort semantics on the response side — aborting cancels the body stream,
 * which is exactly what `SseClient.close()` needs to end its read loop.
 *
 * Import this for its side effect before any client is constructed.
 */

type FetchArgs = Parameters<typeof fetch>;

const realFetch: typeof fetch = globalThis.fetch;

if (typeof realFetch !== 'function') {
  throw new Error('e2e: no global fetch — Node 18+ is required to run the live-node suite');
}

const patched = async (input: FetchArgs[0], init?: FetchArgs[1]): Promise<Response> => {
  const signal = init?.signal;
  if (!signal) return realFetch(input, init);

  const { signal: _dropped, ...rest } = init as RequestInit;
  if (signal.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  const response = await realFetch(input, rest);
  // Re-attach abort: cancelling the body makes the consumer's `reader.read()`
  // settle, ending SseClient's read loop just as an aborted fetch would.
  const body = response.body;
  if (body) {
    signal.addEventListener('abort', () => void body.cancel().catch(() => undefined), {
      once: true,
    });
  }
  return response;
};

globalThis.fetch = patched as typeof fetch;
