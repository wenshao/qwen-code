#!/bin/bash
# usage: unit.sh <lane> <arm> <tag> <surefire -Dtest selector>   (surefire only, no MySQL)
L=$1; A=$2; TAG=$3; T=$4; R=/root/pr14131-rig
case $L in a) C=0-3;; b) C=4-7;; esac
echo "=== $(date -u +%FT%TZ) UNIT lane=$L arm=$A tag=$TAG test=$T"
start=$(date +%s)
docker run --rm --init --name pr14131-unit-$A-$TAG --network pr14131net --cpuset-cpus $C --memory ${MEM:-3g} --memory-swap ${MEM:-3g} \
  -v $R:$R -v /etc/machine-id:/etc/machine-id:ro qwen-managed-e2e:u24 bash -c "
  cd $R/src-$A && mvn --batch-mode --no-transfer-progress -s $R/settings.xml -Dmaven.repo.local=$R/m2 \
    -f packages/sdk-java/managed-agent-server/pom.xml -Dcheckstyle.skip=true -Dspotbugs.skip=true '-Dtest=$T' clean test" > $R/out/unit-$A-$TAG.log 2>&1
echo "[$A $TAG] unit exit=$? wall=$(( $(date +%s) - start ))s"
grep -E "Tests run: [0-9]+, Fail.*Skipped: [0-9]+$|<<< (FAIL|ERR)|expected|but was|BUILD (SUCCESS|FAILURE)" $R/out/unit-$A-$TAG.log | cut -c1-220 | head -12
