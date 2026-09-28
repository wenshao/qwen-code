#!/bin/bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
rm -rf $SCRATCH/m2-ord; cp -Rc $SCRATCH/m2 $SCRATCH/m2-ord && rm -rf $SCRATCH/m2-ord/com/alibaba/qwen/qwen-managed-runtime-broker
M="mvn -q -B -Dgpg.skip -Dmaven.test.skip=true -Dmaven.repo.local=$SCRATCH/m2-ord"
T=$SCRATCH/wt-ord/packages/sdk-java
(cd $T/qwencode && $M install) && (cd $T/runtime-broker && $M clean install) && (cd $T/managed-agent-server && $M clean package) || { echo BUILD_FAILED; exit 1; }
PRJAR=$SCRATCH/wt-pr/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
MJAR=$T/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
boot() { # jar db log
  docker exec pr12946-mysql mysql -uroot -prig12946 -e "select 1" >/dev/null 2>&1
  $JAVA_HOME/bin/java -jar $1 --server.port=0 "--spring.datasource.url=jdbc:mysql://127.0.0.1:13946/$2?useSSL=false&allowPublicKeyRetrieval=true" --spring.datasource.username=root --spring.datasource.password=rig12946 --qwen.managed-agent.session-store.enabled=true --qwen.managed-agent.harness.enabled=false > $3 2>&1 &
  P=$!; for i in $(seq 1 60); do grep -qE "Started ManagedAgent|APPLICATION FAILED|FlywayException|Validate failed" $3 && break; sleep 1; done; kill $P 2>/dev/null; wait $P 2>/dev/null
  echo "--- $(basename $3): $(grep -m1 -oE 'Started ManagedAgentServerApplication|Validate failed[^.]*\.|Detected resolved migration not applied to database: [0-9.]+|Found more than one migration with version [0-9]+' $3)"
  grep -m2 -oE "Detected resolved migration not applied to database: [0-9.]+|To allow executing this migration, set -outOfOrder=true" $3
}
for db in ord1 ord2; do docker exec pr12946-mysql mysql -uroot -prig12946 -e "drop database if exists $db; create database $db" 2>/dev/null; done
boot $PRJAR ord1 $SCRATCH/logs/r3/ord-A1-pr-first.log
docker exec pr12946-mysql mysql -uroot -prig12946 -N -e "select version, description, success from ord1.flyway_schema_history order by installed_rank desc limit 2" 2>/dev/null
boot $MJAR ord1 $SCRATCH/logs/r3/ord-A2-merged-on-same-db.log
boot $MJAR ord2 $SCRATCH/logs/r3/ord-B-merged-fresh.log
docker exec pr12946-mysql mysql -uroot -prig12946 -N -e "select version from ord2.flyway_schema_history order by installed_rank desc limit 3" 2>/dev/null | tr '\n' ' '; echo
