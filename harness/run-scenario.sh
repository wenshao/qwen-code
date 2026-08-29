#!/bin/zsh
# usage: run-scenario.sh <arm-label: head|base> <scenario: full|noteam> [timeout-seconds]
set -u
ARM=$1
SCENARIO=${2:-full}
TMO=${3:-120}
TREE=/Users/wenshao/git/qwen-code-x3/tmp/pr10083/tree
HARNESS=/Users/wenshao/git/qwen-code-x3/tmp/pr10083/harness
BUNDLE=/Users/wenshao/git/qwen-code-x3/tmp/pr10083/bundles/$ARM
RUN=/private/tmp/pr10083/$ARM-$SCENARIO
rm -rf $RUN; mkdir -p $RUN/home $RUN/ws
LEDGER=$RUN/ledger.jsonl; : > $LEDGER
PORT_FILE=$RUN/port

LEDGER_PATH=$LEDGER PORT_FILE=$PORT_FILE node $HARNESS/fake-openai.mjs > $RUN/server.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do [[ -s $PORT_FILE ]] && break; sleep 0.2; done
PORT=$(cat $PORT_FILE)
BASE_URL="http://127.0.0.1:$PORT/v1"
echo "[$ARM/$SCENARIO] fake server on $BASE_URL (pid $SRV)"

if [[ $SCENARIO == noteam ]]; then
  PROMPT='QWEN-VERIFY-NOTEAM-10083 run the scripted verification.'
else
  PROMPT='QWEN-VERIFY-DRIVER-10083 run the scripted verification.'
fi

cd $RUN/ws
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=$RUN/home \
  QWEN_HOME=$RUN/home QWEN_RUNTIME_DIR=$RUN/home \
  QWEN_CODE_ENABLE_AGENT_TEAM=1 \
  OPENAI_API_KEY=fake-key OPENAI_BASE_URL=$BASE_URL \
  OPENAI_MODEL=fake-model QWEN_MODEL=fake-model \
  NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  TERM=xterm-256color \
  $(command -v node) $BUNDLE/cli.js -p "$PROMPT" \
    --auth-type openai --model fake-model \
    --openai-base-url "$BASE_URL" --openai-api-key fake-key \
    --approval-mode yolo > $RUN/cli.stdout 2> $RUN/cli.stderr &
CLI=$!
( sleep $TMO; kill -9 $CLI 2>/dev/null; echo "[watchdog] killed cli after ${TMO}s" >> $RUN/cli.stderr ) &
WD=$!
wait $CLI 2>/dev/null; RC=$?
kill $WD 2>/dev/null
kill $SRV 2>/dev/null
echo "[$ARM/$SCENARIO] cli exit=$RC ledger=$(wc -l < $LEDGER) requests"
echo "RUN=$RUN"
