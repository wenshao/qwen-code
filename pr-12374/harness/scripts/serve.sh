#!/bin/bash
# serve.sh <arm> <scenario-dir> <port>  -> real `qwen serve` with debug file logging ON
set -eu; source /root/git/h12374-e2e/env.sh
ARM=$1; SC=$2; PORT=$3; CLI=${ARM_CLI[$ARM]}
cd $SC/ws/app
HOME=$SC/userhome QWEN_HOME=$SC/home QWEN_RUNTIME_DIR=$SC/runtime QWEN_DEBUG_LOG_FILE=1 \
OPENAI_API_KEY=mock-key OPENAI_BASE_URL=http://127.0.0.1:$MOCK_PORT/v1 OPENAI_MODEL=mock-model \
  node $CLI serve --port $PORT --token T0KEN12374 --workspace $SC/ws/app >> $SC/serve.log 2>&1 &
echo $! > $SC/serve.pid
for i in $(seq 1 120); do
  curl -fsS -m 2 -H "Authorization: Bearer T0KEN12374" http://127.0.0.1:$PORT/health >/dev/null 2>&1 && { echo "serve up pid $(cat $SC/serve.pid)"; exit 0; }
  sleep 0.5; done
echo "serve did NOT come up"; tail -20 $SC/serve.log; exit 1
