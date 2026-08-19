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

boot() {
  local name="$1" server="$2" swarm="$3"
  "$MEROD" --home "$HOME_DIR" --node "$name" init \
    --server-port "$server" --swarm-port "$swarm" --auth-mode proxy >/dev/null
  "$MEROD" --home "$HOME_DIR" --node "$name" run > "$HOME_DIR/$name.log" 2>&1 &
  echo $! >> "$HOME_DIR/pids"
  echo "  $name  api :$server  swarm :$swarm"
}

echo "booting presence nodes under $HOME_DIR"
: > "$HOME_DIR/pids"
boot presence-demo-node-1 8940 8840
boot presence-demo-node-2 8941 8841
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
cd "$ROOT" && node tests/e2e/presence-fixture.mjs
echo "presence nodes ready — run: pnpm test:e2e"
