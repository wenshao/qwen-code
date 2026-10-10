#!/bin/bash
# usage (in container): Lclose0.sh <db> <tag> — repeat: fg delegation, close (immediately / after 10 s), child fate
DB=$1; T=$2; . /rig/llib.sh
for n in 1 2 3; do for w in 0 10; do
  P=$(newp "PARENT::fg::${T}r${n}w${w}::reply close timing."); t=$(waitterm $P 60); sleep $w
  pre=$(sq "SELECT CONCAT(IFNULL(l.state,'-'),'/',IFNULL(r.delivery_state,'-')) FROM qwen_managed_session_extension_record r LEFT JOIN qwen_managed_child_result_relay l ON l.parent_session_id=r.session_id AND l.child_run_id=r.record_id WHERE r.session_id='$P' AND r.domain='child_run'")
  node lclient.mjs $DB close $P > /dev/null; for i in $(seq 30); do [ "$(sst $P)" = CLOSED ] && break; sleep 1; done; sleep 8
  post=$(sq "SELECT CONCAT(IFNULL(l.state,'-'),' | ',IFNULL(LEFT(l.last_error,40),'-')) FROM qwen_managed_session_extension_record r LEFT JOIN qwen_managed_child_result_relay l ON l.parent_session_id=r.session_id AND l.child_run_id=r.record_id WHERE r.session_id='$P' AND r.domain='child_run'")
  echo "   run $n wait=${w}s turn=$t relay-before-close=$pre parent=$(sst $P) child=$(sq "SELECT status FROM managed_agent_session WHERE parent_session_id='$P'") relay-after=$post"
done; done
