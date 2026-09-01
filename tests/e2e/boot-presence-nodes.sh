#!/usr/bin/env bash
# Boots the two peered merod nodes that tests/e2e/ephemeral.live.test.tsx needs,
# then builds the shared app/namespace/context fixture on them.
#
#   ./tests/e2e/boot-presence-nodes.sh ./merod
#
# Leaves both nodes RUNNING (the suite runs against them afterwards) and writes
# their pids to .presence-nodes.pids. Stop them with:
#
#   kill $(cat .presence-nodes.pids)
#
# Proxy auth mode is deliberate: the suite builds `new MeroJs({ baseUrl })` and
# never authenticates, so the admin API must not demand a token.
#
# NOTE: the suite SIGKILLs node 1 on purpose in its last phase — that is the
# only way to observe TTL eviction, since presence belongs to the node and not
# to a client socket. Re-run this script before running the suite again.
set -euo pipefail

MEROD="${1:-merod}"
command -v "$MEROD" >/dev/null 2>&1 || test -x "$MEROD" || {
  echo "no merod at '$MEROD' — pass the path as the first argument" >&2
  exit 1
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOME_DIR="${PRESENCE_NODE_HOME:-$ROOT/.presence-nodes}"
rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR"

# Two nodes on one host have to be told about each other.
#
# They used to find each other by mDNS, which merod enabled by default. core
# 0.11.0-rc.26 made that opt-in — "leave mDNS off unless asked for", core#3620 —
# and since this job always downloads the LATEST core release, the fixture
# started failing the moment rc.26 shipped, with nothing in this repository
# having changed. The failure surfaced three layers away from the cause:
#
#   node 2 joins namespace: gave up after 60000ms — HTTP 500
#
# because node 2 held a valid invitation, found no mesh peer within the 45s
# discovery deadline, fell back to gossip, and then timed out waiting 5s for a
# group key that only a peer could have sent. The 500 is core masking an untyped
# error; the real message is only in the node log.
#
# `--mdns` would restore the old behaviour, but mDNS between two merods on one
# host is unreliable — verified here, it does not fix this. Naming node 1
# explicitly as node 2's bootstrap peer does, and it is deterministic: no
# announce, no discovery window, no dependence on what the runner permits on the
# loopback interface. node 1's peer id is in its config.toml as soon as `init`
# returns, so this needs no log scraping and no ordering games.
init_node() {
  local name="$1" server="$2" swarm="$3"
  shift 3
  "$MEROD" --home "$HOME_DIR" --node "$name" init \
    --server-port "$server" --swarm-port "$swarm" --auth-mode proxy "$@" >/dev/null
}

peer_id_of() {
  awk -F'"' '/^peer_id/{print $2; exit}' "$HOME_DIR/$1/config.toml"
}

start_node() {
  local name="$1" server="$2" swarm="$3"
  "$MEROD" --home "$HOME_DIR" --node "$name" run > "$HOME_DIR/$name.log" 2>&1 &
  echo $! >> "$HOME_DIR/pids"
  echo "  $name  api :$server  swarm :$swarm"
}

echo "booting presence nodes under $HOME_DIR"
: > "$HOME_DIR/pids"

init_node presence-demo-node-1 8940 8840
NODE1_PEER=$(peer_id_of presence-demo-node-1)
[ -n "$NODE1_PEER" ] || {
  echo "could not read node 1's peer_id from its config.toml" >&2
  exit 1
}
echo "  node 1 peer id  $NODE1_PEER"
init_node presence-demo-node-2 8941 8841 \
  --boot-nodes "/ip4/127.0.0.1/tcp/8840/p2p/$NODE1_PEER"

start_node presence-demo-node-1 8940 8840
start_node presence-demo-node-2 8941 8841
cp "$HOME_DIR/pids" "$ROOT/.presence-nodes.pids"

for port in 8940 8941; do
  for _ in $(seq 1 45); do
    if curl -sf "http://localhost:$port/admin-api/health" >/dev/null 2>&1; then
      echo "  node on :$port healthy"
      break 1
    fi
    sleep 2
  done
  curl -sf "http://localhost:$port/admin-api/health" >/dev/null 2>&1 || {
    echo "node on :$port never became healthy; logs:" >&2
    tail -40 "$HOME_DIR"/*.log >&2
    exit 1
  }
done

echo "building the shared context fixture"
cd "$ROOT"
if ! node tests/e2e/presence-fixture.mjs; then
  # Without this the only thing CI showed was the fixture's own timeout message.
  # Every actual cause — no mesh peer, no group key, a rejected invitation — is
  # written to the node logs and nowhere else, and core deliberately returns a
  # bare 500 rather than leaking the reason over the API.
  echo >&2
  echo "fixture failed; last 60 lines of each node log:" >&2
  for log in "$HOME_DIR"/*.log; do
    echo >&2
    echo "----- $log" >&2
    tail -60 "$log" >&2
  done
  exit 1
fi
echo "presence nodes ready — run: pnpm test:e2e"
