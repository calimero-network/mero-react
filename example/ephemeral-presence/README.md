# Ephemeral presence in a real browser — live cursors

A ~350-line Vite + React app that runs `useEphemeral` in Chromium against two
real `merod` nodes, plus a Playwright spec that drives it from two browser
contexts. Every layer is a local build: this repo's `src/`, the sibling
`mero-js` checkout's `dist/`, and a debug `merod`. Nothing is mocked.

What is on screen:

| Property | What you watch |
|---|---|
| **Live cursors** | Move the mouse in one window, the arrow moves in the other — two browsers, two nodes, over gossip |
| **Seed on subscribe** | A window opened late is handed the cursors that already exist, badged `SEED` with the node's own `ageMs`, before anybody moves |
| **TTL eviction** | Stop a *node* and its arrow vanishes within `PRESENCE_TTL_MS` (7 s). Closing the tab does not — presence belongs to the node |
| **No DAG growth** | `contextStateHash` in the header does not budge while the presence-event counter next to it climbs |

Presence is keyed by the **node's** context member key, so one author slot per
node per context: point each window at a **different** node or they overwrite
each other.

## How the local builds are wired in

`vite.config.ts` aliases `@calimero-network/mero-react` to `../../src` (TypeScript
source, no build step) and `@calimero-network/mero-js` to
`../../../mero-js/dist/index.mjs`. This is deliberately an alias and **not** a
dependency bump: mero-react's `@calimero-network/mero-js` dependency stays at
`^7.3.0`, which has no ephemeral surface, which is why the hook reaches
`mero.ephemeral` through a structural cast. `tsconfig.json` keeps *types* on that
installed `^7.3.0` for the same reason.

## Prerequisites

A `merod`/`meroctl` debug build in a `core` checkout on the ephemeral-presence
branch, plus `merobox` and the `collaborative-editor` WASM. From that checkout:

```
cargo build -p merod -p meroctl
```

```
cargo build -p collaborative-editor --target wasm32-unknown-unknown --profile app-release
```

## 1. Build the sibling mero-js (the alias target)

```
(cd ../../../mero-js && npm run build)
```

## 2. Boot two nodes and leave them running

Run this from the **core checkout**, and remember that directory — merobox
resolves native nodes relative to it.

```
PATH="$PWD/target/debug:$PATH" merobox bootstrap run tools/ephemeral-presence-demo/workflow.yml --binary-path "$PWD/target/debug/merod"
```

Nodes come up with RPC on `:8940` and `:8941` in Proxy auth mode (no bearer
token), and the ids land in `tools/ephemeral-presence-demo/.demo-env`.

## 3. Install this example's dependencies

```
pnpm install
```

```
npx playwright install chromium
```

## 4. Run the app

```
pnpm dev
```

Then open these two URLs — **different nodes**, one per window:

```
open "http://localhost:5273/?node=http://localhost:8940&label=node-1"
```

```
open "http://localhost:5273/?node=http://localhost:8941&label=node-2"
```

The context id is discovered from the node, so no id needs pasting; append
`&context=<id>` to pin a specific one.

## 5. Run the Playwright spec

`PRESENCE_CORE_DIR` must be the core checkout you booted the nodes from — the
TTL test shells out to `merobox stop`, which only finds native nodes when run
from there. It starts the dev server itself if one is not already up.

```
PRESENCE_CORE_DIR=/path/to/core pnpm test:e2e
```

The three tests share the nodes and run serially, and the last one **stops node
1 on purpose** (the only way to observe TTL eviction). Re-run step 2 before
running the spec again. A screenshot of two live cursors is written to
`artifacts/two-live-cursors.png`.

## 6. Tear down

```
merobox nuke
```

## Notes and gotchas

* **CORS is fine.** `merod` answers cross-origin requests with
  `access-control-allow-origin: *` and `access-control-allow-headers: *`,
  including on `/jsonrpc`, `/sse` and `/sse/subscription`. No dev-server proxy
  is used anywhere in this example — the browser talks to the node directly, so
  CORS is genuinely exercised.
* **Real streaming SSE is fine.** `SseClient`'s `fetch('/sse')` +
  `response.body.getReader()` works natively in Chromium. The
  `AbortController`/undici workaround that `tests/e2e/jsdom-stream-fetch.ts`
  needs under jsdom has no counterpart here.
* **`merobox stop` is CWD-sensitive** in binary mode: run from the wrong
  directory it reports `Node ... is not running` and exits non-zero while the
  node is plainly serving traffic. Hence `PRESENCE_CORE_DIR`.
* **`node_modules/.bin` shadowing.** npm/pnpm prepend a `node_modules/.bin` for
  every ancestor directory up to `/`, so a stray `~/node_modules/.bin/merobox`
  can shadow the real install inside a test run but not in your shell. The spec
  resolves `merobox` off a PATH with those entries stripped; override with
  `MEROBOX_BIN`.
* **Presence outlives the tab.** A node keeps heartbeating the last slice it was
  given for as long as it is alive, so reloading or closing a window retracts
  nothing and a fresh window may legitimately be *seeded* with a cursor whose
  browser is long gone.
