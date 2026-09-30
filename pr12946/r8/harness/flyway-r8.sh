#!/bin/bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@25
S=<scratch>; JAR=$S/wt-pr/packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar
boot() { # db extra-dir log
  docker exec pr12946-mysql mysql -uroot -prig12946 -e "drop database if exists $1; create database $1" 2>/dev/null
  $JAVA_HOME/bin/java -jar $JAR --server.port=0 "--spring.datasource.url=jdbc:mysql://127.0.0.1:13946/$1?useSSL=false&allowPublicKeyRetrieval=true" --spring.datasource.username=root --spring.datasource.password=rig12946 --qwen.managed-agent.session-store.enabled=true --qwen.managed-agent.harness.enabled=false "--spring.flyway.locations=classpath:db/migration,filesystem:$2" > $3 2>&1 &
  P=$!; for i in $(seq 1 90); do grep -qE "Started ManagedAgent|APPLICATION FAILED|FlywayException|Validate failed" $3 && break; sleep 1; done; kill $P 2>/dev/null; wait $P 2>/dev/null
  echo "--- $(basename $3): $(grep -m1 -oE 'Started ManagedAgentServerApplication|Found more than one migration with version [0-9]+|Validate failed[^.]*\.' $3)"
  docker exec pr12946-mysql mysql -uroot -prig12946 -N -e "select group_concat(version order by installed_rank) from $1.flyway_schema_history" 2>/dev/null
}
boot fly8a $S/fly-r8/main $S/logs/r8/fly-pr-plus-main.log
boot fly8b $S/fly-r8/both $S/logs/r8/fly-pr-plus-main-plus-12894.log
