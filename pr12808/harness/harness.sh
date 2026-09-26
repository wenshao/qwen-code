#!/bin/bash
# usage: harness.sh <worktree> <port> <name>
WT=$1; PORT=$2; NAME=$3; D=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4e2fef2a-1851-4d5c-9a46-2dd6291c0a8f/scratchpad/rig/run-$NAME; mkdir -p $D/home/.qwen $D/runtime $D/tmp $D/ws
cp /private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/4e2fef2a-1851-4d5c-9a46-2dd6291c0a8f/scratchpad/rig/home/.qwen/settings.json $D/home/.qwen/settings.json
cd $D/ws
exec env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$D/home USERPROFILE=$D/home QWEN_HOME=$D/home/.qwen QWEN_RUNTIME_DIR=$D/runtime \
  TMPDIR=$D/tmp OPENAI_API_KEY=fake-local-key OPENAI_BASE_URL=http://127.0.0.1:33809/v1 OPENAI_MODEL=rig-model QWEN_MODEL=rig-model \
  QWEN_SERVER_TOKEN=rig-harness-token QWEN_HOSTED_HARNESS_CAPABILITY_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  QWEN_CODE_SYSTEM_SETTINGS_PATH=$D/system-settings.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=$D/system-defaults.json QWEN_CODE_TRUSTED_FOLDERS_PATH=$D/trusted-folders.json \
  /Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin/node $WT/dist/cli.js serve --profile hosted-harness --http-bridge --port $PORT --hostname 127.0.0.1 --require-auth --no-web --workspace $D/ws
