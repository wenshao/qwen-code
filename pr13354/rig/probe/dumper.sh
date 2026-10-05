#!/bin/bash
# VERIFICATION RIG ONLY (PR #13354): when the lock sampler sees an idle-in-transaction blocker, SIGQUIT Spring twice (10 s apart).
DB=$1; L=/Users/wenshao/pr13354-rig/results/$DB/locks.jsonl; P=$(cat /var/rig/run/$DB/spring.pid)
for i in $(seq 1 120); do
  if [ -f $L ] && tail -1 $L | grep -q '"trx_state":"RUNNING","age_s":[1-9][0-9]*,"trx_rows_locked":[0-9]*,"command":"Sleep"'; then
    echo "dump1 $(date -u +%T)"; kill -3 $P; sleep 10; echo "dump2 $(date -u +%T)"; kill -3 $P; exit 0; fi
  sleep 1
done; echo "no idle blocker seen"
