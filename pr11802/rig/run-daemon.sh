#!/bin/bash
# usage: run-daemon.sh <arm> <wt-dir> <daemon-port> <fake-port> <token>
set -u
ARM=$1; WT=$2; PORT=$3; FAKE=$4; TOK=$5
SCR=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/45462301-d8d9-4c6c-9415-3e65177a390f/scratchpad
ENVD=$SCR/env-$ARM
rm -rf "$ENVD"; mkdir -p "$ENVD/home" "$ENVD/qwen-home" "$ENVD/runtime" "$ENVD/ws"
cat > "$ENVD/qwen-home/settings.json" <<JSON
{"security":{"auth":{"selectedType":"openai"}},"general":{"enableAutoUpdate":false,"disableUpdateNag":true},"model":{"name":"fake-model"}}
JSON
echo "# probe workspace for PR 11802 ($ARM)" > "$ENVD/ws/README.md"
NODE_BIN=$(dirname "$(which node)")
cd "$ENVD/ws" || exit 1
exec env -i HOME="$ENVD/home" PATH="$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
  QWEN_HOME="$ENVD/qwen-home" QWEN_RUNTIME_DIR="$ENVD/runtime" \
  OPENAI_API_KEY=dummy OPENAI_BASE_URL="http://127.0.0.1:$FAKE/v1" OPENAI_MODEL=fake-model \
  QWEN_CODE_NO_RELAUNCH=true NO_COLOR=1 \
  node "$WT/dist/cli.js" serve --port "$PORT" --token "$TOK" --workspace "$ENVD/ws" \
  > "$SCR/daemon-$ARM.log" 2>&1
