#!/bin/bash
# usage: tui-setup.sh <arm> <repo> <entry>   -> prints ROOT; starts fake model + TUI in tmux (-L p12747, session <arm>)
set -e
ARM=$1; REPO=$2; ENTRY=$3
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(mktemp -d /tmp/p12747-tui-$ARM-XXXX); ROOT=$(cd $ROOT && pwd -P)
mkdir -p $ROOT/home/.qwen $ROOT/ws $ROOT/runtime
: > $ROOT/mcp.log; : > $ROOT/fake.log; : > $ROOT/sv.jsonl
FAKE_LOG=$ROOT/fake.log FAKE_PORT_FILE=$ROOT/port nohup node $HERE/fake-openai.mjs > $ROOT/fake.out 2>&1 &
echo $! > $ROOT/fake.pid
for i in $(seq 1 100); do [ -s $ROOT/port ] && break; sleep 0.1; done
PORT=$(cat $ROOT/port)
NODE=$(command -v node)
cat > $ROOT/home/.qwen/settings.json <<JSON
{ "ui": { "enableFollowupSuggestions": false, "theme": "Default" },
  "security": { "auth": { "selectedType": "openai" }, "folderTrust": { "enabled": false } },
  "model": { "name": "fake-model" },
  "general": { "enableAutoUpdate": false }, "tools": { "approvalMode": "default" },
  "mcpServers": { "probe": { "command": "$NODE", "args": ["$HERE/mcp-id-server.mjs"], "env": { "MCP_LOG": "$ROOT/mcp.log", "MCP_SDK": "$REPO/node_modules/@modelcontextprotocol/sdk/dist/esm" }, "trust": true, "alwaysLoadTools": true } } }
JSON
cat > $ROOT/run.sh <<RUN
#!/bin/bash
cd $ROOT/ws
exec env -i PATH="$PATH" HOME=$ROOT/home QWEN_HOME=$ROOT/home/.qwen QWEN_RUNTIME_DIR=$ROOT/runtime TERM=xterm-256color LANG=en_US.UTF-8 \
  OPENAI_API_KEY=fake-key OPENAI_BASE_URL=http://127.0.0.1:$PORT/v1 OPENAI_MODEL=fake-model NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  SV_LOG=$ROOT/sv.jsonl $NODE $ENTRY
RUN
chmod +x $ROOT/run.sh
tmux -L p12747 new-session -d -s $ARM -x 160 -y 45 "$ROOT/run.sh; sleep 600"
echo $ROOT
