#!/bin/bash
# usage: run-arm.sh <label> <repo> <tool> <times>  -> runs one headless session in an isolated home
set -u
LABEL=$1; REPO=$2; TOOL=$3; TIMES=$4
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$HERE/runs/$LABEL-$TOOL; rm -rf $ROOT; mkdir -p $ROOT/home/.qwen $ROOT/ws $ROOT/runtime
: > $ROOT/mcp.log; : > $ROOT/fake.log
NODE=$(command -v node)
FAKE_LOG=$ROOT/fake.log FAKE_PORT_FILE=$ROOT/port $NODE $HERE/fake-openai.mjs > $ROOT/fake.out 2>&1 &
FAKE=$!; echo $FAKE > $ROOT/fake.pid
for i in $(seq 1 100); do [ -s $ROOT/port ] && break; sleep 0.1; done
PORT=$(cat $ROOT/port)
cat > $ROOT/home/.qwen/settings.json <<JSON
{ "security": { "auth": { "selectedType": "openai" }, "folderTrust": { "enabled": false } },
  "model": { "name": "fake-model" }, "general": { "enableAutoUpdate": false },
  "mcpServers": { "probe": { "command": "$NODE", "args": ["$HERE/mcp-fail-id.mjs"],
    "env": { "MCP_LOG": "$ROOT/mcp.log", "MCP_SDK": "$REPO/node_modules/@modelcontextprotocol/sdk/dist/esm" }, "trust": true, "alwaysLoadTools": true } } }
JSON
cd $ROOT/ws
env -i PATH="$PATH" HOME=$ROOT/home QWEN_HOME=$ROOT/home/.qwen QWEN_RUNTIME_DIR=$ROOT/runtime LANG=en_US.UTF-8 NO_COLOR=1 \
  OPENAI_API_KEY=fake-key OPENAI_BASE_URL=http://127.0.0.1:$PORT/v1 OPENAI_MODEL=fake-model NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  QWEN_DEBUG_LOG_FILE=1 \
  perl -e 'alarm 240; exec @ARGV' $NODE $REPO/dist/cli.js -p "CALL $TOOL ARGS {\"count\":0} TIMES $TIMES" > $ROOT/stdout.txt 2> $ROOT/stderr.txt
echo "exit $?" > $ROOT/exit.txt
kill $FAKE 2>/dev/null
echo $ROOT
