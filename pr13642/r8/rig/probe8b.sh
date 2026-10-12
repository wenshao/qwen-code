#!/bin/bash
# Round 8: the standalone Broker schema initializer (e204088e) on a real engine, and its parity with Flyway V68.
# usage: probe8b.sh <mysql|maria>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; [ "$DB" = mysql ] && PORT=33642 || PORT=43642; P=QWEN_MANAGED_AGENT_RUNTIME
export SERVER_PORT=18742 BROKER_PORT=18743
M=/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql
Q() { $M -uroot -ppr13642 -h127.0.0.1 -P$PORT -N -e "$1" 2>/dev/null; }
CPM=$S/rig/probe8b/out:$S/rig/probe8b/main/BOOT-INF/lib/qwen-managed-runtime-broker-0.1.0-alpha.jar:$S/rig/probe8b/main/BOOT-INF/lib/mysql-connector-j-9.7.0.jar
CPN=$S/rig/probe8b/out:$S/rig/cp-r8/BOOT-INF/lib/qwen-managed-runtime-broker-0.1.0-alpha.jar:$S/rig/cp-r8/BOOT-INF/lib/mysql-connector-j-9.7.0.jar
init() { /Users/wenshao/Install/jdk21/bin/java -cp $1 StandaloneInit "jdbc:mysql://127.0.0.1:$PORT/$2?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" ${3:-init} 2>&1 | tail -2; }
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid 2>/dev/null; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
TABLES="SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='sp8_fresh_merge_$DB'"
shape() { # <schema> -> sorted column + index lines for the standalone tables
  Q "SELECT CONCAT('col ', TABLE_NAME, '.', COLUMN_NAME, ' ', COLUMN_TYPE, ' null=', IS_NULLABLE, ' default=', IFNULL(COLUMN_DEFAULT,'<none>')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$1' AND TABLE_NAME IN ($TABLES)
     UNION ALL SELECT CONCAT('idx ', TABLE_NAME, ' ', INDEX_NAME, ' unique=', 1-NON_UNIQUE, ' (', GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX), ')') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$1' AND TABLE_NAME IN ($TABLES) GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE" | sort; }
leaseidx() { Q "SELECT CONCAT(INDEX_NAME, ' (', GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX), ')') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$1' AND TABLE_NAME='managed_workspace_execution_lease' GROUP BY INDEX_NAME ORDER BY INDEX_NAME" | tr '\n' ' '; }
for d in sp8_up sp8_fresh_main sp8_fresh_merge fw8_main fw8_merge; do Q "DROP DATABASE IF EXISTS ${d}_$DB"; done
echo "## [$DB] $(Q 'SELECT VERSION()')"
echo "1. main's initializer creates a standalone schema:      $(init $CPM sp8_up_$DB)"
echo "   lease indexes: $(leaseidx sp8_up_$DB)"
echo "   $(init $CPM sp8_up_$DB lease)"
echo "2. PR initializer over the existing tables:             $(init $CPN sp8_up_$DB)"
echo "   lease indexes: $(leaseidx sp8_up_$DB)"
echo "   lease rows kept: $(Q "SELECT CONCAT(COUNT(*), ' (binding_id=', MAX(binding_id), ', runtime_generation=', MAX(runtime_generation), ')') FROM sp8_up_$DB.managed_workspace_execution_lease")"
echo "3. PR initializer again (idempotent):                   $(init $CPN sp8_up_$DB)"
init $CPM sp8_fresh_main_$DB >/dev/null; init $CPN sp8_fresh_merge_$DB >/dev/null
for pair in "main-r8-da224e61 fw8_main" "merge-r8-8b72c287 fw8_merge"; do set -- $pair
  R=$($S/rig/boot.sh $S/jars/$1.jar $DB ${2}_$DB p8b-$DB-$2 ${P}_BROKER_ENABLED=true); [ "${R%% *}" = STARTED ] || { echo "flyway boot $1: $R"; exit 1; }
  echo "4. Flyway via $1.jar: $(grep -o 'now at version v[0-9]*' $S/rig/logs/p8b-$DB-$2.log | tail -1)"; stop p8b-$DB-$2
done
mkdir -p $S/r8/schema-$DB
for d in sp8_up sp8_fresh_main sp8_fresh_merge fw8_main fw8_merge; do shape ${d}_$DB > $S/r8/schema-$DB/$d.txt; done
cd $S/r8/schema-$DB
echo "5. standalone tables compared: $(Q "$TABLES" | wc -l | tr -d ' '); lines per shape: $(wc -l < sp8_fresh_merge.txt | tr -d ' ')"
echo "   upgraded vs fresh PR standalone:        $(diff sp8_up.txt sp8_fresh_merge.txt > d-up.txt && echo identical || echo "$(grep -c '^[<>]' d-up.txt) differing lines")"
echo "   PR standalone vs PR Flyway (V68):       $(diff sp8_fresh_merge.txt fw8_merge.txt > d-merge.txt && echo identical || echo "$(grep -c '^[<>]' d-merge.txt) differing lines")"
echo "   main standalone vs main Flyway (V67):   $(diff sp8_fresh_main.txt fw8_main.txt > d-main.txt && echo identical || echo "$(grep -c '^[<>]' d-main.txt) differing lines")"
echo "   PR-only differences (merge diff minus main diff):"; comm -13 <(grep '^[<>]' d-main.txt | sort) <(grep '^[<>]' d-merge.txt | sort) | sed 's/^/     /' | head -20
grep -h 'idx managed_workspace_execution_lease idx_workspace_execution_binding' sp8_up.txt sp8_fresh_merge.txt fw8_merge.txt | sort | uniq -c | sed 's/^/   /'
echo "## [$DB] done"
