#!/bin/bash
# Start fake OSS (127.0.0.1:38443 + admin 38994) and the fault proxy (38095 -> 38094, control 38096).
R=$(cd $(dirname $0); pwd); NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd $R
if ! lsof -nP -iTCP:38994 -sTCP:LISTEN -t >/dev/null; then (nohup $NODE fake-oss.mjs > run/fake-oss.log 2>&1 & echo $! > run/fake-oss.pid); fi
if ! lsof -nP -iTCP:38096 -sTCP:LISTEN -t >/dev/null; then (nohup $NODE fault-proxy.mjs > run/fault-proxy.log 2>&1 & echo $! > run/fault-proxy.pid); fi
for i in $(seq 1 60); do curl -s http://127.0.0.1:38994/state >/dev/null && curl -s http://127.0.0.1:38096/rules >/dev/null && break; sleep 1; done
echo "fake-oss $(cat run/fake-oss.pid) $(curl -s http://127.0.0.1:38994/state | head -c 160)"; echo "fault-proxy $(cat run/fault-proxy.pid) rules=$(curl -s http://127.0.0.1:38096/rules)"
