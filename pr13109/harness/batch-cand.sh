#!/bin/bash
# batch-cand.sh <tree> <run-dir> <cand-cli> <old-cli>  -- regression of the candidate fix on the head rig (macOS)
TREE=$1; R=$2; CAND=$3; OLD=$4; ARM=candidate
S=$(cd "$(dirname "$0")/.." && pwd)
free() { node -e '
const c=require("crypto");const k=c.createHash("sha256").update("t-rig\u0000storage-"+process.argv[1]).digest("hex");
fetch(process.argv[2]+"/sql/query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sql:"SELECT holder_key FROM managed_workspace_execution_lease WHERE storage_key = ?",args:[k]})}).then(r=>r.json()).then(j=>process.exit(j.rows.some(r=>r.holder_key)?1:0))' "$1" "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/root/rig.json","utf8")).adminUrl)' $R)"; }
run() { local scen=$1 name=$2 ws=$3; shift 3; free $ws || { echo "$name: WORKSPACE_$ws_BUSY" >> $R/batch-cand.txt; return; }; env "$@" RIG_HARNESS_CLI=$CAND ARM=$ARM bash $S/rig/run.sh $TREE $R $scen $name > /dev/null 2>&1; }
( run r1-release.ts cand-r1-undelivered-1 6 R1_WS=6 R1_SERVERS=remote R1_FAULT=undelivered
  run r1-release.ts cand-r1-lostack-2 7 R1_WS=7 R1_SERVERS=remote,legacy R1_FAULT=lostack
  run r1-release.ts cand-r1-ownerundelivered-2 8 R1_WS=8 R1_SERVERS=remote,legacy R1_FAULT=ownerundelivered ) &
( run r1-release.ts cand-r1-undelivered-2 9 R1_WS=9 R1_SERVERS=remote,legacy R1_FAULT=undelivered
  run r1-release.ts cand-r1-none-3 3 R1_WS=3 R1_SERVERS=remote,legacy,local R1_FAULT=none
  run r3-upgrade.ts cand-r3-lostack 4 R3_WS=4 R3_MODE=lostack R3_OLD_CLI=$OLD ) &
( run r2-sticky.ts cand-r2-sticky-remote 10 R2_WS=10 R2_SERVERS=sticky,remote
  run r4-never-dispatched.ts cand-r4-503 12 R4_WS=12 R4_FAULT=503 ) &
wait
echo CAND_ALL_DONE >> $R/batch-cand.txt
