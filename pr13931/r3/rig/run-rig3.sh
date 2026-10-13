#!/bin/bash
# usage: run-rig3.sh <phase> <arm> <tag> [KEY=VAL ...]  -- round-3 rig run with extra RIG_* env (fresh DB per run)
P=$1; A=$2; TAG=$3; shift 3; R=/root/pr13931-rig; DB=rig_${P}${TAG}_${A}
docker exec pr13931-db mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v Warning
rm -rf $R/rig/wsroot/$DB $R/rig/state/$DB.json
EV=(); for kv in "$@"; do EV+=(-e "$kv"); done
docker run --rm --init --name pr13931-rig-$P$TAG-$A --network pr13931net -v $R:$R -v /etc/machine-id:/etc/machine-id:ro \
  -e RIG_CLI_ARM=$A "${EV[@]}" qwen-managed-e2e:u24 sh -c "cd $R/rig && node rig.mjs $P $A $DB" > $R/out/rig-$P$TAG-$A.log 2>&1
echo "[$P$TAG $A] rig exit=$?"
grep -E "PASS|FAIL|RESULT|PHASE ERROR" $R/out/rig-$P$TAG-$A.log | cut -c1-300
