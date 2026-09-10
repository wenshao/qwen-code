#!/bin/bash
set -euo pipefail
source /root/git/h11576/env.sh
if curl -s -m 2 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
  echo "mock already up on $PORT"; exit 0
fi
cd "$H"
H=$H PORT=$PORT setsid node mock-model.mjs > out/mock.log 2>&1 < /dev/null &
for i in $(seq 1 40); do
  sleep 0.25
  if curl -s -m 2 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
    echo "mock up on $PORT"; exit 0
  fi
done
echo "mock failed to start"; cat out/mock.log; exit 1
