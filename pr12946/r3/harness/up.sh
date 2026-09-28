#!/bin/bash
# Start the PR 12946 rig: MCP servers (HTTP, SSE), manifest, Spring + Broker.
#   up.sh <tree> <db-url> <run-dir>
set -euo pipefail
TREE=$1; DB=$2; RUN=$3
S=$(cd "$(dirname "$0")/.." && pwd)
NODE22=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
JAVA=/opt/homebrew/opt/openjdk@25/bin/java
export RIG_WS=${RIG_WS:-12}
export RIG_SDK=$TREE/node_modules/@modelcontextprotocol/sdk
mkdir -p "$RUN"
LEDGER=$RUN/ledger.jsonl; : > "$LEDGER"
# Worker wrapper: keep the worker's stderr (the Broker discards it).
cat > "$RUN/node-wrap.sh" <<EOF
#!/bin/bash
exec $NODE22 "\$@" 2>>"$RUN/worker-stderr.log"
EOF
chmod +x "$RUN/node-wrap.sh"
# HTTP-based MCP servers (one process each; they survive Spring restarts).
start_srv() { # name transport port [extra...]
  local name=$1 transport=$2 port=$3; shift 3
  $NODE22 "$S/rig/mcp-server.mjs" --transport "$transport" --port "$port" --name "$name" --ledger "$LEDGER" "$@" \
    > "$RUN/srv-$name.log" 2>&1 &
  echo $! > "$RUN/srv-$name.pid"
}
start_srv http http 18811 --token http-secret-token
start_srv sse sse 18812 --token sse-secret-token
start_srv http2 http 18813
digest() { printf '%s' "$1" | shasum -a 256 | cut -c1-64; }
# Manifest: 4 Workspaces x (stdio, http, sse) + extras on workspace-0/1.
node -e '
const [run, s, node, sdk] = process.argv.slice(1);
const crypto = require("crypto");
const d = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const servers = [];
for (let w = 0; w < Number(process.env.RIG_WS ?? 12); w++) {
  const ws = `workspace-${w}`;
  const stdio = { tenantId: "t-rig", workspaceId: ws, serverId: "local", serverRevision: 1, transport: "stdio",
    command: node, args: [`${s}/rig/mcp-server.mjs`, "--transport", "stdio", "--name", `stdio-${w}`, "--ledger", `${run}/ledger.jsonl`],
    env: { MCP_TOKEN: "stdio-secret-token", RIG_SDK: sdk } };
  const stdio2 = { ...stdio, serverRevision: 2, args: [...stdio.args.slice(0, 4), `stdio-${w}-r2`, ...stdio.args.slice(5)] };
  const many = { ...stdio, serverId: "many", args: [...stdio.args, "--many-tools", "60"] };
  const http = { tenantId: "t-rig", workspaceId: ws, serverId: "remote", serverRevision: 1, transport: "streamable-http",
    url: "http://127.0.0.1:18811/mcp", headers: { Authorization: "Bearer http-secret-token" } };
  const sse = { tenantId: "t-rig", workspaceId: ws, serverId: "legacy", serverRevision: 1, transport: "sse",
    url: "http://127.0.0.1:18812/sse", headers: { Authorization: "Bearer sse-secret-token" } };
  const plain = { tenantId: "t-rig", workspaceId: ws, serverId: "plain", serverRevision: 1, transport: "streamable-http",
    url: "http://127.0.0.1:18813/mcp" };
  const short = { ...plain, serverId: "short", timeoutMs: 5000 };
  for (const x of [stdio, stdio2, many, http, sse, plain, short]) servers.push({ ...x, definitionDigest: d(x) });
}
require("fs").writeFileSync(`${run}/manifest.json`, JSON.stringify({ version: 1, servers }, null, 1));
' "$RUN" "$S" "$NODE22" "$RIG_SDK"
SRV=$TREE/packages/sdk-java/managed-agent-server
QWEN_MANAGED_MCP_CONFIG=$RUN/manifest.json nohup $JAVA -Duser.timezone=UTC \
  -Drig.workspaces=${RIG_WS:-12} -Drig.root="$RUN/root" -Drig.db="$DB" -Drig.node="$RUN/node-wrap.sh" -Drig.cli="$TREE/dist/cli.js" \
  -Drig.port=${RIG_PORT:-18946} -Drig.brokerPort=${RIG_BROKER_PORT:-19946} -Drig.adminPort=${RIG_ADMIN_PORT:-17946} \
  -cp "$S/rig/java/out:$SRV/target/classes:$(cat "$S/cp.txt")" RigMain > "$RUN/spring.log" 2>&1 &
echo $! > "$RUN/spring.pid"
for i in $(seq 1 120); do
  grep -q RIG_READY "$RUN/spring.log" && break
  if ! kill -0 "$(cat "$RUN/spring.pid")" 2>/dev/null; then echo "SPRING_DIED"; tail -30 "$RUN/spring.log"; exit 1; fi
  sleep 1
done
grep RIG_READY "$RUN/spring.log"
