#!/bin/bash
# usage: it.sh <src-arm> <m2-arm> <tag> <it.test>
SRC=$1; M2A=$2; TAG=$3; ITS=$4
RIG=/Users/wenshao/pr13918-rig
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN=/Users/wenshao/Install/maven/bin/mvn
L=$RIG/out/it-$TAG.log
cd $RIG/src-$SRC/packages/sdk-java/managed-agent-server
echo "=== $(date +%T) IT $TAG src=$SRC ($(git rev-parse --short HEAD)) its=$ITS" > $L
$MVN -B -ntp -Dmaven.repo.local=$RIG/m2-$M2A -Pmysql-integration -Dcheckstyle.skip=true -Dspotbugs.skip=true \
  test-compile failsafe:integration-test failsafe:verify -Dit.test="$ITS" -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23918/itbase?useSSL=false&allowPublicKeyRetrieval=true" -Dmysql.user=root -Dmysql.password= >> $L 2>&1
echo "[$TAG] EXIT=$?" >> $L
grep -E "Tests run:|FAIL|ERROR\]" $L | tail -15
