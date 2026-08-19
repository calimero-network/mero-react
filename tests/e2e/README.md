# Live-node e2e

Tests in here run against a **real merod**, not a mock. They are excluded from
`npm test` and only run under `npm run test:e2e` (`vitest.e2e.config.ts`).

## `ephemeral.live.test.tsx` — the whole presence stack, unmocked

`useEphemeral` (this repo) → `mero-js` `EphemeralClient`/`SseClient` (local
build) → two real gossiping `merod` nodes. Everywhere else this feature is
tested with the layer below stubbed: the unit suite mocks `mero.ephemeral`, and
`tsc` checks the hook against the **installed** `@calimero-network/mero-js@^7.3.0`,
which has no ephemeral surface at all — so the hook casts through structural
types it declares itself. If those declarations drift from what `mero-js`
actually does, the unit suite and typecheck both stay green. This file is the
only thing that catches it.

`vitest.e2e.config.ts` therefore aliases `@calimero-network/mero-js` to the
sibling checkout's `dist/index.mjs` **for the e2e run only** — no `package.json`
edit, no lockfile churn.

### Run it — one line each

Build the local mero-js (the alias target):

    (cd ../mero-js && npm run build)

Build the node binaries, from your `core` checkout on `feat/ephemeral-presence-rebased`:

    cargo build -p merod -p meroctl

Boot two nodes on a shared context and leave them running (also from `core`; needs `merobox` on PATH):

    PATH="$PWD/target/debug:$PATH" merobox bootstrap run tools/ephemeral-presence-demo/workflow.yml --binary-path "$PWD/target/debug/merod"

Run the suite (back in this repo):

    npm run test:e2e -- tests/e2e/ephemeral.live.test.tsx

Tear the nodes down:

    merobox nuke

The suite discovers the per-run context id and both member keys from the live
admin API, so nothing needs pasting. Override with `MERO_E2E_NODE1`,
`MERO_E2E_NODE2`, `MERO_E2E_CONTEXT`, `MERO_E2E_NODE1_NAME` if your nodes differ
from `http://localhost:8940` / `http://localhost:8941`.

### What it proves

| # | Property | How |
|---|---|---|
| 1 | Publish → remote observe | `setPresence` on a hook against node 1 shows up in `peers` on a hook against node 2, over real gossip |
| 2 | Seed-on-subscribe carries `ageMs` | A hook mounted against a context with existing presence is seeded immediately, and `ageOf` is back-dated by the node-reported age (a ~5s-old entry does not read as ~0) |
| 3 | Live delta has no age | A live upsert carries **no** `ageMs` on the wire (absent, not `0`) and `ageOf` reads near-zero |
| 4 | TTL eviction | SIGKILL the publishing node; the peer leaves `peers` within ~`PRESENCE_TTL_MS` (7s) + sweep granularity, with nothing sent on its behalf |
| 5 | Self-filter | Your own echoed presence is excluded by default and included with `includeSelf: true`, and the filtered key is confirmed to be exactly the `author` the node stamps |

### Two things that will bite you

**The last test KILLS node 1.** It is the only way to observe TTL eviction —
presence belongs to the *node*, not to a client socket, so unmounting a client
retracts nothing. Re-run the bootstrap command before running the suite again.

**jsdom vs. Node's `fetch`.** jsdom replaces the global `AbortController`, which
undici refuses (`Expected signal ... to be an instance of AbortSignal`). Two
harness-only workarounds, no SDK change: clients are built with `timeoutMs: 0`
(kills the per-request timeout signal, as `harness.ts` already does), and
`jsdom-stream-fetch.ts` re-attaches abort semantics on the response side so
`SseClient`'s own controller stops breaking the stream.
