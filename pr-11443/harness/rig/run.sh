#!/usr/bin/env bash
# run.sh <tree: pr|base> <workspace-dir> <label> <prompt-file>
set -u
R=/root/git/pr11443-e2e
TREE=$1; WS=$2; LABEL=$3; PROMPT=$4
case $TREE in pr) CLI=/root/git/pr11443/dist/cli.js;; base) CLI=/root/git/pr11443-base/dist/cli.js;; esac
export HOME=$R/home-$TREE
mkdir -p $HOME/.qwen $R/out
cat > $HOME/.qwen/settings.json <<JSON
{ "security": { "auth": { "selectedType": "openai" } }, "model": { "name": "mock-lsp" } }
JSON
export OPENAI_API_KEY=mock OPENAI_BASE_URL=http://127.0.0.1:18443/v1 OPENAI_MODEL=mock-lsp
export QWEN_RUNTIME_DIR=$R/runtime-$TREE
export LSP_WIRE_LOG=$R/out/$LABEL.wire.jsonl FAKE_LOG=$R/out/$LABEL.fake.jsonl
rm -f $LSP_WIRE_LOG $FAKE_LOG
cd $WS
timeout 300 node $CLI --experimental-lsp --approval-mode yolo --output-format json -p "$(cat $PROMPT)" \
  > $R/out/$LABEL.json 2> $R/out/$LABEL.stderr
echo "exit=$? label=$LABEL"
