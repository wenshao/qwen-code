#!/bin/bash
# usage: run-resume.sh <db-of-previous-l4-run> <prev-arm> <jar-arm>  -- reuse the stuck database (no drop)
D=$1; PA=$2; A=$3; R=/root/pr13931-rig
cp $R/rig/state/$D.json $R/rig/state/$D.json.bak-$(date +%s)
docker run --rm --init --name pr13931-rig-resume-$A --network pr13931net -v $R:$R -v /etc/machine-id:/etc/machine-id:ro \
  -e RIG_CLI_ARM=$A -e RIG_PREV=$R/rig/runs/$D-l4-$PA/results.json qwen-managed-e2e:u24 sh -c "cd $R/rig && node rig.mjs resume $A $D" > $R/out/rig-resume-$A.log 2>&1
echo "[resume $D on $A] rig exit=$?"
grep -E "PASS|FAIL|RESULT|PHASE ERROR" $R/out/rig-resume-$A.log | cut -c1-260
