#!/bin/bash
# macOS host, JDK 21: managed-agent-server tests.  usage: unit.sh <tree> <label> <unit|it-mysql> [test-filter]
set -u
RIG=/rig; T=$RIG/$1; L=$2; KIND=$3; F=${4:-}
export JAVA_HOME=/opt/jdk21; export PATH=$JAVA_HOME/bin:$(dirname $(grep ^NODE= $RIG/rig.env | cut -d= -f2)):$PATH TZ=UTC
R="-Dmaven.repo.local=$RIG/${M2:-m2-test}"; O=$RIG/out/test-$L.log
cd $T/packages/sdk-java/managed-agent-server
if [ "$KIND" = unit ]; then
  mvn -B -ntp $R ${F:+-Dtest=$F -Dsurefire.failIfNoSpecifiedTests=false} -Dcheckstyle.skip=true clean test > $O 2>&1; rc=$?
else
  DBN=it_$(date +%s)
  mvn -B -ntp $R -Phosted-harness-mysql ${F:+-Dit.test=$F -Dfailsafe.failIfNoSpecifiedTests=false} -DskipTests=false -Dsurefire.skip=true -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false \
    -Dnode.executable="$(grep ^NODE= $RIG/rig.env | cut -d= -f2)" -Dqwen.cli.entry=$RIG/dist/${CLI_DIST:-head}/cli.js \
    "-Dmysql.url=jdbc:mysql://127.0.0.1:33131/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=<rig-db-password> -Dcheckstyle.skip=true clean verify > $O 2>&1; rc=$?
fi
echo "[$L] exit=$rc"; grep -E "Tests run:.*(Fail|Err)" $O | tail -4; grep -E "<<< (FAILURE|ERROR)!|BUILD (SUCCESS|FAILURE)" $O | head -8
