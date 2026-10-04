#!/bin/bash
# Phase 1: stop at V35 (main's schema); phase 2: same jar, full migrate.
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:33356/upgrade_v36?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false"
export SPRING_DATASOURCE_USERNAME=root SPRING_DATASOURCE_PASSWORD=runtime-broker
J=/root/Install/jdk21/bin/java
docker exec my13355 mysql -uroot -pruntime-broker -e "DROP DATABASE IF EXISTS upgrade_v36" 2>/dev/null
for phase in "--spring.flyway.target=35" ""; do
  echo "=== phase ${phase:-full}"
  $J -jar /root/verify/pr13355/jars/merge36.jar --server.port=18358 $phase > upgrade-phase.log 2>&1 &
  pid=$!
  for i in $(seq 1 60); do grep -q "Started ManagedAgentServerApplication\|APPLICATION FAILED" upgrade-phase.log && break; sleep 1; done
  grep -E "Migrating schema|Successfully applied|Schema .* is up to date|Started|FAILED" upgrade-phase.log | sed 's/^.*INFO [0-9]* --- \[[^]]*\] \[ *main\] //' | tail -4
  kill $pid; wait $pid 2>/dev/null
done
docker exec my13355 mysql -uroot -pruntime-broker -N -e "SELECT version, description, success FROM upgrade_v36.flyway_schema_history WHERE version >= 34 ORDER BY installed_rank" 2>/dev/null
