#!/bin/bash
# macOS host, round 5 (#13173): base rerun, settled in-flight variant (R1-1 on the real Broker),
# public cancel since #13112 on main and on the test merge, the PR's own runner, and a long lease watch.
RIG=/Users/wenshao/pr13083-rig; cd $RIG
load() { uptime | sed 's/.*load averages: //'; }
run() { # <tree> <workdir> <arm> <env...> -- <specs...>
  local tree=$1 wd=$2 arm=$3; shift 3; local envs=(); while [ "$1" != "--" ]; do envs+=(-e "$1"); shift; done; shift
  echo "=== $(date +%T) $arm ($tree) load: $(load)"
  ./dk.sh -e RIG_OUT=/rig/out/s2r5 -e RIG_WAIT_MS=90000 -e RIG_FILE_HISTORY=1 -e RIG_WRITER_LEASE=3s "${envs[@]}" qwen-g1-e2e:latest bash /rig/lin.sh $tree $wd bash /rig/s2-batch.sh $arm "$@"
}
run src-b9 b9 b9w3 -- inflight:db-cancel
run src-h9 h9 h9set RIG_INFLIGHT_SETTLED=1 -- inflight:db-cancel inflight:db-cancel-load-status-fail
run src-h9-M1 h9m1 h9M1set RIG_INFLIGHT_SETTLED=1 -- inflight:db-cancel-load-status-fail
run src-b9 b9 b9set RIG_INFLIGHT_SETTLED=1 -- inflight:db-cancel
run src-m9 m9 m9pub RIG_CANCEL=public -- inflight:db-cancel continuation:db-cancel
run src-x9 x9 x9pub RIG_CANCEL=public -- inflight:db-cancel continuation:db-cancel inflight:db-cancel-drop-reply continuation:db-cancel-drop-reply inflight:db-cancel-terminal-write-fail inflight:db-cancel-release-fail
echo "=== $(date +%T) runner on the test merge load: $(load)"
./dk.sh qwen-g1-e2e:latest bash /rig/lin.sh src-x9 x9run bash -c 'bash /rig/e2e-once.sh --inflight-failover x9-inflight 3; bash /rig/e2e-once.sh --continuation-failover x9-continuation 3; bash /rig/e2e-once.sh --session-failover x9-session 2'
run src-h9-C1 h9c1 h9C1 -- inflight:db-cancel-release-fail continuation:db-cancel-release-fail
run src-h9 h9 h9long RIG_LEASE_WATCH_S=900 -- inflight:db-cancel-release-fail
echo "=== $(date +%T) BATCH-R5B-DONE"
