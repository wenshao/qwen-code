#!/bin/bash
# usage: after-verify.sh <arm> <tag>  -- the CI job's steps around/after "Verify Hosted ...", verbatim commands,
# run sequentially in one u24 container (lane b cpus) on the rig's private network; every service binds 127.0.0.1.
A=$1; TAG=$2; R=/root/pr14131-rig; LOG=$R/out/after-$A-$TAG.log
TMP=$R/tmp-after-$A-$TAG; rm -rf $TMP; mkdir -p $TMP; chmod 1777 $TMP
echo "=== $(date -u +%FT%TZ) after-verify arm=$A tag=$TAG" | tee $LOG
cat > $R/out/after-inner-$A-$TAG.sh <<INNER
cd $R/src-$A
step() { local name=\$1 limit=\$2; shift 2; local t0=\$(date +%s); echo "### STEP \$name start \$(date -u +%T)";
  timeout \$limit bash -c "\$*"; local rc=\$?; echo "### STEP \$name rc=\$rc wall=\$(( \$(date +%s)-t0 ))s"; }
step relay-headers 600 'cd integration-tests && npx vitest run helpers/hosted-relay-headers.test.ts'
step check-failsafe-hosted 120 'node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server'
step latency 600 'test -s packages/sdk-java/managed-agent-server/target/hosted-latency-baseline.json && cd integration-tests && npx vitest run cli/hosted-latency-baseline.test.ts'
step broker-fault-gates 600 'mvn --batch-mode --no-transfer-progress -s /root/pr14131-rig/settings.xml -Dmaven.repo.local=$R/m2 -f packages/sdk-java/runtime-broker/pom.xml -Pfault-gates -Dqwen.cli.entry=$R/src-$A/dist/cli.js test'
for s in managed-session-failover managed-inflight-failover managed-continuation-failover managed-big-output managed-harness-restart-failover managed-harness-restart-inflight-failover managed-harness-restart-continuation-failover managed-continuation-frozen-owner-failover; do
  step e2e:\$s 600 "npm run test:e2e:\$s"
done
INNER
docker run --rm --init --name pr14131-after-$A-$TAG --network pr14131net --cpuset-cpus 4-7 --memory ${MEM:-6g} --memory-swap ${MEM:-6g} \
  -e QWEN_E2E_REGISTER_STORAGE=1 -e CI=true -v $R:$R -v $TMP:/tmp -v /etc/machine-id:/etc/machine-id:ro \
  qwen-managed-e2e:u24 bash $R/out/after-inner-$A-$TAG.sh >> $LOG 2>&1
echo "=== $(date -u +%FT%TZ) after-verify container exit=$?" >> $LOG
grep -E "^### STEP .* rc=" $LOG
