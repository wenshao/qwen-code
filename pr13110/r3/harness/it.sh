#!/bin/bash
# macOS host, JDK 21, private MySQL 8.4.7: the CI job's `-Phosted-harness-mysql ... verify` step narrowed to chosen IT classes.
# usage: it.sh <tree> <label> <it-filter> [extra mvn args...]     (cli entry = <tree>/dist/cli.js, so the driver and the bundle come from the same tree)
set -u
. /rig/rig.env
T=$RIG/$1; L=$2; F=$3; shift 3
export JAVA_HOME PATH=$JAVA_HOME/bin:$(dirname $NODE):$PATH TZ=UTC
O=$RIG/out/it-$L.log; DBN=it_$(echo $L | tr -c 'a-zA-Z0-9\n' '_')_$(date +%s)
cd $T/packages/sdk-java/managed-agent-server
mvn -B -ntp -Dmaven.repo.local=$RIG/${M2:-m2-head} -Phosted-harness-mysql -Dtest=NoSuchUnit -Dsurefire.failIfNoSpecifiedTests=false "-Dit.test=$F" -Dfailsafe.failIfNoSpecifiedTests=false \
  -Dnode.executable=$NODE -Dqwen.cli.entry=${CLI:-$T/dist/cli.js} \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:$DBPORT/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=$DBPASS -Dcheckstyle.skip=true "$@" verify > $O 2>&1; rc=$?
echo "[$L] exit=$rc db=$DBN $(date -u +%T)"
grep -a -E "Tests run:.*-- in |^\[(ERROR|INFO)\] Tests run: [0-9]+, F" $O | sed -E 's/^\[[A-Z]+\] //' | cut -c1-200
grep -a -E "<<< (FAILURE|ERROR)!" $O | grep -v "Tests run" | sed -E 's/^\[[A-Z]+\] //' | cut -c1-200
grep -a -E "^HOSTED_[A-Z_]+_OK|BUILD (SUCCESS|FAILURE)" $O | cut -c1-120
