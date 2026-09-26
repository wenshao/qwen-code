#!/bin/bash
# usage: run-wf.sh <label> <repo> -> headless session: the model runs one workflow with three agent({schema}) calls
set -u
LABEL=$1; REPO=$2
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$HERE/runs/wf-$LABEL; rm -rf $ROOT; mkdir -p $ROOT/home/.qwen $ROOT/ws $ROOT/runtime
: > $ROOT/fake.log
NODE=$(command -v node)
WF_SCRIPT=$HERE/wf-script.js FAKE_LOG=$ROOT/fake.log FAKE_PORT_FILE=$ROOT/port $NODE $HERE/fake-wf.mjs > $ROOT/fake.out 2>&1 &
FAKE=$!
for i in $(seq 1 100); do [ -s $ROOT/port ] && break; sleep 0.1; done
PORT=$(cat $ROOT/port)
cat > $ROOT/home/.qwen/settings.json <<JSON
{ "security": { "auth": { "selectedType": "openai" }, "folderTrust": { "enabled": false } },
  "model": { "name": "fake-model" }, "general": { "enableAutoUpdate": false }, "tools": { "workflowsEnabled": true } }
JSON
cd $ROOT/ws && git init -q . && git commit -q --allow-empty -m init 2>/dev/null
env -i PATH="$PATH" HOME=$ROOT/home QWEN_HOME=$ROOT/home/.qwen QWEN_RUNTIME_DIR=$ROOT/runtime LANG=en_US.UTF-8 NO_COLOR=1 \
  OPENAI_API_KEY=fake-key OPENAI_BASE_URL=http://127.0.0.1:$PORT/v1 OPENAI_MODEL=fake-model NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  QWEN_DEBUG_LOG_FILE=1 GIT_AUTHOR_NAME=p GIT_AUTHOR_EMAIL=p@p GIT_COMMITTER_NAME=p GIT_COMMITTER_EMAIL=p@p \
  perl -e 'alarm 300; exec @ARGV' $NODE $REPO/dist/cli.js --approval-mode yolo -p "WORKFLOW" > $ROOT/stdout.txt 2> $ROOT/stderr.txt
echo "exit $?" > $ROOT/exit.txt
kill $FAKE 2>/dev/null
echo $ROOT
