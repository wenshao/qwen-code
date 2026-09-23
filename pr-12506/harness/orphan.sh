#!/bin/bash
# Provisioner (bash) spawns the worker, reads ready, then dies with SIGKILL.
ENTRY=$1; BOOT=$2
bash -c "node $ENTRY managed-runtime-worker < $BOOT > /tmp/claude-orphan-ready.txt 2>/dev/null & echo \$! > /tmp/claude-orphan-pid; sleep 3; kill -9 \$\$" 
sleep 1
P=$(cat /tmp/claude-orphan-pid)
echo "ready record: $(cat /tmp/claude-orphan-ready.txt)"
echo "provisioner killed; worker pid $P ppid=$(ps -o ppid= -p $P 2>/dev/null | tr -d ' ') alive=$(kill -0 $P 2>/dev/null && echo yes || echo no)"
sleep 20
echo "20s later: alive=$(kill -0 $P 2>/dev/null && echo yes || echo no); listening: $(ss -ltnp 2>/dev/null | grep "pid=$P," | awk '{print $4}')"
kill -TERM $P 2>/dev/null; sleep 1; echo "after SIGTERM alive=$(kill -0 $P 2>/dev/null && echo yes || echo no)"
