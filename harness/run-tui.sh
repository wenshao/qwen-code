#!/bin/zsh
# usage: run-tui.sh <arm: head|base>
set -u
ARM=$1
BASE=/Users/wenshao/git/qwen-code-x3/tmp/pr10083
BUNDLE=$BASE/bundles/$ARM
HARNESS=$BASE/harness
RUN=/private/tmp/pr10083/tui-$ARM
SESS=pr10083-$ARM
rm -rf $RUN; mkdir -p $RUN/home $RUN/ws
LEDGER=$RUN/ledger.jsonl; : > $LEDGER
PORT_FILE=$RUN/port

tmux kill-session -t $SESS 2>/dev/null

LEDGER_PATH=$LEDGER PORT_FILE=$PORT_FILE node $HARNESS/fake-openai.mjs > $RUN/server.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do [[ -s $PORT_FILE ]] && break; sleep 0.2; done
PORT=$(cat $PORT_FILE)
URL="http://127.0.0.1:$PORT/v1"
echo "[tui-$ARM] fake server $URL"

NODE=$(command -v node)
tmux new-session -d -s $SESS -x 120 -y 42 -c $RUN/ws \
  "env HOME=$RUN/home QWEN_HOME=$RUN/home QWEN_RUNTIME_DIR=$RUN/home \
   QWEN_CODE_ENABLE_AGENT_TEAM=1 OPENAI_API_KEY=fake-key OPENAI_BASE_URL=$URL \
   OPENAI_MODEL=fake-model QWEN_MODEL=fake-model \
   NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost TERM=xterm-256color \
   $NODE $BUNDLE/cli.js --auth-type openai --model fake-model \
   --openai-base-url $URL --openai-api-key fake-key --approval-mode yolo"

tmux pipe-pane -t $SESS -o "cat >> $RUN/tui.log"
sleep 12
tmux send-keys -t $SESS 'QWEN-VERIFY-TUI-10083 run the scripted verification.' 
sleep 1
tmux send-keys -t $SESS Enter
sleep 30
tmux capture-pane -t $SESS -p -e > $RUN/pane.ansi
tmux capture-pane -t $SESS -p > $RUN/pane.txt
echo "--- pane (plain) ---"
cat $RUN/pane.txt
tmux kill-session -t $SESS 2>/dev/null
kill $SRV 2>/dev/null
echo "RUN=$RUN"
