#!/bin/bash
# Start fake OSS (0.0.0.0:443 + admin 127.0.0.1:18994) and the fault proxy (18895 -> 18894, control 18896).
R=$(cd $(dirname $0); pwd); NODE=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
cd $R
if ! lsof -nP -iTCP:18994 -sTCP:LISTEN -t >/dev/null; then (nohup $NODE fake-oss.mjs > run/fake-oss.log 2>&1 & echo $! > run/fake-oss.pid); fi
if ! lsof -nP -iTCP:18896 -sTCP:LISTEN -t >/dev/null; then (nohup $NODE fault-proxy.mjs > run/fault-proxy.log 2>&1 & echo $! > run/fault-proxy.pid); fi
for i in $(seq 1 60); do curl -s http://127.0.0.1:18994/state >/dev/null && curl -s http://127.0.0.1:18896/rules >/dev/null && break; sleep 1; done
echo "fake-oss $(cat run/fake-oss.pid) $(curl -s http://127.0.0.1:18994/state | head -c 120)"; echo "fault-proxy $(cat run/fault-proxy.pid) rules=$(curl -s http://127.0.0.1:18896/rules)"
