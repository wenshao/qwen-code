#!/bin/bash
# helpers run inside pr12865-srv
cmd=$1; shift
case $cmd in
  session)
    curl -sS http://127.0.0.1:8080/v1/agents/sessions -H 'Content-Type: application/json' -H 'X-Qwen-Tenant-Id: demo' \
      -H "Idempotency-Key: $1" -d '{"agent_id":"qwen-code"}' ;;
  warm)
    curl -sS -w ' http=%{http_code} t=%{time_total}s' -X POST http://127.0.0.1:4182/internal/runtime-broker/v1/runtimes:warm \
      -H 'Authorization: Bearer broker-secret-pr12865' -H 'Content-Type: application/json' \
      -d "{\"protocolVersion\":1,\"requestId\":\"warm-$(date +%s%N)\",\"harnessSessionId\":\"$1\"}" ;;
  workers)
    ps -eo pid,ppid,stat,etimes,args | awk 'NR==1 || /managed-runtime-worker/ && !/awk/' ;;
  java)
    pgrep -f 'qwen-managed-agent-server-0.1.0-alpha.jar' ;;
  state)
    ls -la "$1"; for f in "$1"/*.json; do [ -f "$f" ] && { echo "--- $(basename $f | cut -c1-12)…json"; cat "$f"; echo; }; done ;;
esac
