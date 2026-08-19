# Live-node e2e

Tests in here run against a **real merod**, not a mock. They are excluded from
`npm test` and only run under `npm run test:e2e` (`vitest.e2e.config.ts`).

## `ephemeral.live.test.tsx` — the whole presence stack, unmocked

`useEphemeral` (this repo) → `mero-js` `EphemeralClient`/`SseClient` (the
**published** package) → two real gossiping `merod` nodes.

Everywhere else this feature is tested with the layer below stubbed: the unit
suite mocks `mero.ephemeral`, and `tsc` only proves the hook agrees with
mero-js's *type declarations*. Neither can catch the SDK's runtime behaviour
drifting from the node's actual wire — the types still line up, so both stay
green. This file is the only thing that catches it.

Presence is delivered over gossip **between** nodes, so it needs two of them.
The single node the other suites share cannot exercise it, which is why this
suite has its own fixture (`boot-presence-nodes.sh`) and its own CI job
(`e2e-presence`).

> Historical note: this suite used to require a locally-built sibling `mero-js`,
> aliased in by `vitest.e2e.config.ts`, because the pinned `^7.3.0` exported no
> `ephemeral` surface. That is gone — the package is now `^13.1.0`, which
> exports it, so the suite runs against exactly what consumers install and a
> local build can no longer mask a drift.

### Run it — two commands

Boot the two nodes and build the shared app/namespace/context fixture. Pass a
`merod` binary; a released one is fine (`gh release download` from
`calimero-network/core`), no `core` checkout or Rust build needed:

    ./tests/e2e/boot-presence-nodes.sh ./merod

Run the suite:

    pnpm test:e2e:presence

Tear the nodes down:

    kill $(cat .presence-nodes.pids)

The suite discovers the per-run context id and both member keys from the live
admin API, so nothing needs pasting. Override with `MERO_E2E_NODE1`,
`MERO_E2E_NODE2`, `MERO_E2E_CONTEXT`, `MERO_E2E_NODE1_NAME` if your nodes differ
from `http://localhost:8940` / `http://localhost:8941`.

Without `MERO_E2E_PRESENCE=1` (which `pnpm test:e2e:presence` sets) the suite
skips itself, so a plain `pnpm test:e2e` against the usual single node stays
green rather than failing on a fixture it does not have.

The last phase **SIGKILLs node 1** on purpose — the only way to observe TTL
eviction, since presence belongs to the node, not to a client socket. Re-run the
boot script before running the suite again.

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
