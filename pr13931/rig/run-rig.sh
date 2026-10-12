#!/bin/bash
# usage: run-rig.sh <phase> <arm> [cli-arm]  -- real-stack scenario inside u24 on the private network (fresh DB per run)
P=$1; A=$2; C=${3:-$2}; R=/root/pr13931-rig; DB=rig_${P}_${A}
docker exec pr13931-db mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v Warning
rm -rf $R/rig/wsroot/$DB $R/rig/state/$DB.json
docker run --rm --init --name pr13931-rig-$P-$A --network pr13931net -v $R:$R -v /etc/machine-id:/etc/machine-id:ro \
  -e RIG_CLI_ARM=$C qwen-managed-e2e:u24 sh -c "cd $R/rig && node rig.mjs $P $A $DB" > $R/out/rig-$P-$A.log 2>&1
echo "[$P $A] rig exit=$?"
grep -E "PASS|FAIL|RESULT|PHASE ERROR" $R/out/rig-$P-$A.log | cut -c1-260
