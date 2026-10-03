#!/bin/bash
# usage: run-e2e.sh <arm: head|base> <db> <cases> <outdir>
set -u
ARM=$1; DB=$2; CASES=$3; OUT=$4
W=/root/verify/pr13304/head
rm -rf $W/dist && cp -a /root/verify/pr13304/dist-$ARM $W/dist
export JAVA_HOME=/usr/local/jdk21 PATH=/usr/local/jdk21/bin:$PATH
cd $W/packages/sdk-java/managed-agent-server
mvn -B --no-transfer-progress -Dmaven.repo.local=/root/verify/pr13304/m2 -Dmaven.repo.local.tail=/root/.m2/repository \
  -Phosted-harness-mysql test-compile failsafe:integration-test failsafe:verify \
  -Dcheckstyle.skip=true -Dspotbugs.skip=true \
  -Dit.test=HostedVerify13304IT -Dnode.executable="$(command -v node)" \
  -Dqwen.cli.entry=$W/dist/cli.js \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:32770/$DB?allowPublicKeyRetrieval=true&useSSL=false" \
  -Dmysql.user=root -Dmysql.password=hosted-fixture \
  -Dverify.out=$OUT -Dverify.cases=$CASES
echo "EXIT=$?"
