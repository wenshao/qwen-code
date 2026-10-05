#!/bin/bash
# usage: run-2phase.sh <javaWorktree> <engine: my84|ma114> <runName> [obsA] [obsB]
# Phase 1 = boot A (real boot_id); phase 2 = boot B (private mount ns, fresh boot_id).
set -u
JW=$1; ENGINE=$2; NAME=$3; OBSA=${4:-30}; OBSB=${5:-90}
H=/root/verify/pr13289/head
R=/root/verify/pr13289/runs/$NAME
case $ENGINE in my84) PORT=33289; C=pr13289-my84; CLI=mysql;; ma114) PORT=33290; C=pr13289-ma114; CLI=mariadb;; esac
DB=v13289_$(echo $NAME | tr -c 'a-z0-9\n' '_')
rm -rf $R; mkdir -p $R/base $R/out; chmod 700 $R/base; mkdir -m 700 $R/base/runtime-state
docker exec $C $CLI -uroot -pverify-13289 -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v -i warning
cp $H/integration-tests/helpers/hosted-verify13289-driver.ts $R/base/driver-copy.ts
TENANT=verify13289-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')
export JAVA_HOME=/usr/local/jdk21 PATH=/usr/local/jdk21/bin:$PATH
MVN=(mvn -B --no-transfer-progress -Dmaven.repo.local=/root/verify/pr13289/m2 -Dmaven.repo.local.tail=/root/.m2/repository
  -Phosted-harness-mysql test-compile failsafe:integration-test failsafe:verify -Dcheckstyle.skip=true -Dspotbugs.skip=true
  -Dit.test=HostedVerify13289IT "-Dnode.executable=$(command -v node)" "-Dqwen.cli.entry=$H/dist/cli.js"
  "-Dmysql.url=jdbc:mysql://127.0.0.1:$PORT/$DB?allowPublicKeyRetrieval=true&useSSL=false"
  -Dmysql.user=root -Dmysql.password=verify-13289 "-Dverify.base=$R/base" "-Dverify.tenant=$TENANT")
cd $JW/packages/sdk-java/managed-agent-server
echo "== phase 1 (boot A, boot_id=$(cat /proc/sys/kernel/random/boot_id))"
"${MVN[@]}" -Dverify.phase=1 -Dverify.observeSeconds=$OBSA -Dverify.out=$R/out/phase1 > $R/out/mvn-phase1.log 2>&1
echo "PHASE1_EXIT=$?"
FAKE=$R/base/fake-boot-id; cat /proc/sys/kernel/random/uuid > $FAKE
echo "== phase 2 (boot B, boot_id=$(cat $FAKE))"
unshare -m --propagation private bash -c 'mount --bind "$0" /proc/sys/kernel/random/boot_id && exec "$@"' "$FAKE" "${MVN[@]}" -Dverify.phase=2 -Dverify.observeSeconds=$OBSB "-Dverify.out=$R/out/phase2" > $R/out/mvn-phase2.log 2>&1
echo "PHASE2_EXIT=$?"
# leftover workers of this run (durable workers outlive the JVM)
for p in $(ps -eo pid=,args= | grep -F "$R/base/verify13289-worker.mjs" | grep -v grep | awk '{print $1}'); do kill -9 $p 2>/dev/null; done
