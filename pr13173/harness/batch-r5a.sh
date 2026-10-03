#!/bin/bash
# macOS host, round 5 (#13173 @ b0e8b1e2): mutants, base reproduction and the rest of the head matrix (SQL-flip cancel).
RIG=/Users/wenshao/pr13083-rig; cd $RIG
load() { uptime | sed 's/.*load averages: //'; }
run() { # <tree> <workdir> <arm> <env...> -- <specs...>
  local tree=$1 wd=$2 arm=$3; shift 3; local envs=(); while [ "$1" != "--" ]; do envs+=(-e "$1"); shift; done; shift
  echo "=== $(date +%T) $arm ($tree) load: $(load)"
  ./dk.sh -e RIG_OUT=/rig/out/s2r5 -e RIG_WAIT_MS=90000 -e RIG_FILE_HISTORY=1 "${envs[@]}" qwen-g1-e2e:latest bash /rig/lin.sh $tree $wd bash /rig/s2-batch.sh $arm "$@"
}
run src-h9-M1 h9m1 h9M1 -- inflight:db-cancel-load-status-fail
run src-h9-M2 h9m2 h9M2 -- inflight:db-cancel-history-read-fail
run src-h9-M3 h9m3 h9M3 -- inflight:db-cancel-release-fail
run src-b9 b9 b9 -- inflight:db-cancel continuation:db-cancel
run src-h9 h9 h9 -- continuation:db-cancel inflight:db-cancel-drop-reply continuation:db-cancel-drop-reply continuation:db-cancel-release-fail
run src-h9 h9 h9d RIG_SECOND_TOOL=1 -- inflight:none continuation:none
echo "=== $(date +%T) BATCH-R5A-DONE"
