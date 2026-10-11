#!/bin/bash
# VERIFICATION RIG ONLY (PR #13682 R2): Flyway outcomes against main d35277c2 (its own V66). Store-role jar on a side
# port (18693, own pid file) so it can run next to r2.sh. usage: up4.sh
set -u
. /root/v13682/rig/rig.env
L=$RIG/out/up4.log; : > $L; XP=18693
M() { $MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS -N -B "$@" 2>/dev/null; }
[ "$(M -e 'SELECT 1')" = 1 ] || { echo "ABORT: rig MySQL on $DBPORT is not reachable" >> $L; exit 1; }
hist() { M $1 -e 'SELECT GROUP_CONCAT(CONCAT(version, ":", SUBSTRING_INDEX(description, " ", -2), IF(success, "", "!")) ORDER BY installed_rank SEPARATOR " | ") FROM flyway_schema_history WHERE version IS NOT NULL AND CAST(version AS UNSIGNED) >= 64'; }
start() {  # $1 jar, $2 db -> rc 0 when started
  local J=$1 DB=$2 RUN=$RIG/run/$2; mkdir -p $RUN; local LOG=$RUN/x-$J-$(date +%s).log
  setsid nohup env -i PATH=$JAVA_HOME/bin:/usr/bin:/bin TZ=UTC LANG=C HOME=$RUN $JAVA_HOME/bin/java -Xmx1g -jar $RIG/server/$J-server.jar \
    --server.address=127.0.0.1 --server.port=$XP \
    "--spring.datasource.url=jdbc:mysql://127.0.0.1:$DBPORT/$DB?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" \
    --spring.datasource.username=root --spring.datasource.password=$DBPASS \
    --qwen.managed-agent.session-store.enabled=true --qwen.managed-agent.session-store.base-url=http://127.0.0.1:$XP \
    --qwen.managed-agent.session-store.workspace-id=unused-global-workspace \
    --qwen.managed-agent.harness.enabled=false --qwen.managed-agent.runtime-broker.enabled=false > $LOG 2>&1 < /dev/null &
  local P=$!; local rc=1
  for i in $(seq 1 120); do grep -q "Started ManagedAgentServerApplication" $LOG && { rc=0; break; }; kill -0 $P 2>/dev/null || break; sleep 1; done
  echo "  [$J on $DB] $([ $rc = 0 ] && echo STARTED || echo REFUSED) log=$(basename $LOG)" >> $L
  grep -E "Successfully applied|Migrating schema .* to version|Found more than one migration|Validate failed|Migration checksum mismatch|Migration description mismatch|Detected applied migration not resolved|Detected resolved migration not applied" $LOG | sed -E 's/^.*(INFO|ERROR|WARN)[^:]*: //' | sort -u | head -6 | cut -c1-260 | sed 's/^/    /' >> $L
  kill $P 2>/dev/null; for i in $(seq 1 40); do kill -0 $P 2>/dev/null || break; sleep 0.25; done; kill -KILL $P 2>/dev/null
  return $rc
}
echo "UP4-START $(date -u +%T)" >> $L
for J in m4 h3 x4 x4r; do echo "jar $J: $(unzip -l $RIG/server/$J-server.jar | grep -o 'db/migration/V6[0-9]__[a-z_]*' | sed 's#db/migration/##' | sort -V | tr '\n' ' ')" >> $L; done
echo "## A. database migrated by current main d35277c2 (m4), then head 7105fb1e" >> $L
start m4 u4a; echo "  history: $(hist u4a)" >> $L
start h3 u4a; echo "  history: $(hist u4a)" >> $L
echo "## B. the PR merged into main as-is (x4: two V66 files), fresh database and the main database" >> $L
start x4 u4b; start x4 u4a
echo "## C. the merge with the PR migration renamed to V67 (x4r): main database, then a fresh database" >> $L
start x4r u4a; echo "  history: $(hist u4a)" >> $L
start x4r u4c; echo "  history: $(hist u4c)" >> $L
echo "## D. a database that ran this PR at V66 (h3), then the V67 merge (dev databases only)" >> $L
start h3 u4d; echo "  history: $(hist u4d)" >> $L
start x4r u4d; echo "  history: $(hist u4d)" >> $L
echo "UP4-DONE $(date -u +%T)" >> $L
