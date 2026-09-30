#!/bin/bash
# up-lx.sh <arm-classes> <cli-arm> <db> <run-dir>
set -euo pipefail
CLS=$1; CLI=$2; DB=$3; RUN=$4
mkdir -p "$RUN"; : > "$RUN/ledger.jsonl"
[ -s /etc/machine-id ] || echo 6a7c4b8a14b0d66d11808bc2e4892b13 > /etc/machine-id
printf '#!/bin/bash\nexec /usr/local/bin/node "$@" 2>>%s/worker-stderr.log\n' "$RUN" > "$RUN/node-wrap.sh"; chmod +x "$RUN/node-wrap.sh"
nohup node /rig/mcp-server.mjs --transport http --port 18811 --name http --ledger "$RUN/ledger.jsonl" --token http-secret-token > "$RUN/srv-http.log" 2>&1 &
echo $! > "$RUN/srv-http.pid"
nohup node /rig/mcp-server.mjs --transport http --port 18813 --name http2 --ledger "$RUN/ledger.jsonl" > "$RUN/srv-http2.log" 2>&1 &
echo $! > "$RUN/srv-http2.pid"
node /rig/manifest-lx.mjs "$RUN" 6
bash /rig/spring-lx.sh "$CLS" "$CLI" "$DB" "$RUN" false
