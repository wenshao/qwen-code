#!/bin/bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
S=<scratch>; JAR=$S/wt-pr/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
boot() { # db locations log [keep]
  [ "$4" = keep ] || docker exec pr12946-mysql mysql -uroot -prig12946 -e "drop database if exists $1; create database $1" 2>/dev/null
  $JAVA_HOME/bin/java -jar $JAR --server.port=0 "--spring.datasource.url=jdbc:mysql://127.0.0.1:13946/$1?useSSL=false&allowPublicKeyRetrieval=true" --spring.datasource.username=root --spring.datasource.password=rig12946 --qwen.managed-agent.session-store.enabled=true --qwen.managed-agent.harness.enabled=false "--spring.flyway.locations=$2" > $3 2>&1 &
  P=$!; for i in $(seq 1 90); do grep -qE "Started ManagedAgent|APPLICATION FAILED|FlywayException|Validate failed" $3 && break; sleep 1; done; kill $P 2>/dev/null; wait $P 2>/dev/null
  echo "--- $(basename $3): $(grep -m1 -oE 'Started ManagedAgentServerApplication|Found more than one migration with version [0-9]+|Detected resolved migration not applied to database: [0-9.]+|Validate failed[^.]*' $3)"
  docker exec pr12946-mysql mysql -uroot -prig12946 -N -e "select group_concat(version order by installed_rank) from $1.flyway_schema_history" 2>/dev/null
}
# A: this PR alone (main V19 is inside its jar)
boot fly9a classpath:db/migration $S/logs/r9/A-pr-alone.log
# B: this PR + #12894 V20-V22, fresh database
boot fly9b classpath:db/migration,filesystem:$S/fly-r9/pub $S/logs/r9/B-pr-plus-12894-fresh.log
# C: #12894 lands first: database already at V22 (B applied everything); nothing new
# D: this PR lands first (fly9a has 19,23), then #12894 V20-V22 arrive
boot fly9a classpath:db/migration,filesystem:$S/fly-r9/pub $S/logs/r9/D-pr-first-then-12894.log keep
