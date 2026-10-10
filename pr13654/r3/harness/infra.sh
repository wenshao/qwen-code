#!/bin/bash
# Start fake OSS (0.0.0.0:443 + admin 127.0.0.1:18657) and the fault proxy (18655 -> 18654, control 18656).
R=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad/rig; NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd $R
if ! lsof -nP -iTCP:18657 -sTCP:LISTEN -t >/dev/null; then (nohup $NODE fake-oss.mjs > run/fake-oss.log 2>&1 & echo $! > run/fake-oss.pid); fi
if ! lsof -nP -iTCP:18656 -sTCP:LISTEN -t >/dev/null; then (nohup $NODE fault-proxy.mjs > run/fault-proxy.log 2>&1 & echo $! > run/fault-proxy.pid); fi
for i in $(seq 1 60); do curl -s http://127.0.0.1:18657/state >/dev/null && curl -s http://127.0.0.1:18656/rules >/dev/null && break; sleep 1; done
echo "fake-oss $(cat run/fake-oss.pid) $(curl -s http://127.0.0.1:18657/state | head -c 160)"; echo "fault-proxy $(cat run/fault-proxy.pid) rules=$(curl -s http://127.0.0.1:18656/rules)"
