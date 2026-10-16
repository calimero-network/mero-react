/**
 * Is this page running inside a Calimero Desktop (Tauri) window?
 *
 * The desktop opens every app in its own webview, already bound to the node it
 * runs, so the Cloud sign-in (wallet → relay, no node) is the wrong door there:
 * it would leave the desktop's own node behind, and the wallet redirect would
 * navigate the app window off to another origin.
 *
 * Two signals, either is enough:
 * - `__TAURI_INTERNALS__` with a callable `invoke`, which Tauri injects natively
 *   into every webview it creates, remote URLs included;
 * - `__TAURI_FETCH_PROXY_INJECTED__`, the marker the desktop's app-window
 *   init script sets, in case a future Tauri stops exposing the former there.
 *
 * Read at call time and SSR-safe: false whenever there is no `window`.
 */
export function isDesktopWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  // A real object with a callable `invoke`: an element with this id also shows up as the global.
  const internals = w.__TAURI_INTERNALS__ as { invoke?: unknown } | null | undefined;
  const tauri =
    typeof internals === 'object' &&
    internals !== null &&
    !(typeof Node !== 'undefined' && internals instanceof Node) &&
    typeof internals.invoke === 'function';
  return tauri || w.__TAURI_FETCH_PROXY_INJECTED__ === true;
}
