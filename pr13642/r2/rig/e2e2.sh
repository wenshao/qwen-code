#!/bin/bash
# Real-jar retention E2E. usage: e2e.sh <mysql|maria> <dbname> <tag>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; DBN=$2; T=$3; P=QWEN_MANAGED_AGENT_RUNTIME
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
counts() { $S/rig/seed.sh $DB $DBN snapshot 2>/dev/null | grep -E "^count" | awk '{printf "%s=%s ", $2, $3} END {print ""}' | sed 's/qwen_//g'; }
echo "## [$T] 1. main (base) jar creates the schema"
$S/rig/boot.sh $S/jars/base.jar $DB $DBN $T-1-base ${P}_BROKER_ENABLED=true > /dev/null
grep -o 'Successfully applied [0-9]* migrations.*now at version v[0-9]*' $S/rig/logs/$T-1-base.log; stop $T-1-base
echo "## [$T] 2. seed terminal history through the real Broker repositories"
$S/rig/seed.sh $DB $DBN seed 2>/dev/null > $S/rig/out/$T-2-seed.txt; counts
echo "## [$T] 3. head jar, retention disabled (default): V54 -> V55 upgrade"
$S/rig/boot.sh ${HEADJAR:-$S/jars/head.jar} $DB $DBN $T-3-head-off ${P}_BROKER_ENABLED=true > /dev/null
grep -o 'Successfully applied 1 migration.*now at version v55' $S/rig/logs/$T-3-head-off.log
echo "GET h-exec: $($S/rig/getexec.sh h-exec harness-h-lookup h-session | grep -o 'HTTP=[0-9]*')"
sleep 8; echo "retention log lines while disabled: $(grep -c runtime_retention $S/rig/logs/$T-3-head-off.log)"; counts; stop $T-3-head-off
echo "## [$T] 4. rollback: main jar boots on the V55 schema"
$S/rig/boot.sh $S/jars/base.jar $DB $DBN $T-4-base-on-v55 ${P}_BROKER_ENABLED=true
grep -o 'has a version (55) that is newer than the latest available migration (54)' $S/rig/logs/$T-4-base-on-v55.log; stop $T-4-base-on-v55
echo "## [$T] 5. head jar, retention enabled (30d / 100 / 3s); tenant-e-big placement domain held 25 s by another connection"
($S/rig/seed.sh $DB $DBN hold tenant-e-big 25 > $S/rig/out/$T-5-hold.txt 2>&1 &); sleep 2
$S/rig/boot.sh ${HEADJAR:-$S/jars/head.jar} $DB $DBN $T-5-head-on ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=30d ${P}_RETENTION_BATCH_SIZE=100 ${P}_RETENTION_SCAN_DELAY=3s > /dev/null
sleep 45
grep -h -E "HOLDING|RELEASED placement" $S/rig/out/$T-5-hold.txt | sed 's/ at 20[0-9-]*T/ at /'
grep -E "runtime_retention bindings|Runtime retention failed" $S/rig/logs/$T-5-head-on.log | sed -E 's/^[0-9-]+T([0-9:.]{12}).*(runtime_retention |Runtime retention failed)/\1 \2/' | head -8
grep -m1 -o 'Caused by: [^ ]*Exception: [^\r]*' $S/rig/logs/$T-5-head-on.log | cut -c1-120
counts
$S/rig/seed.sh $DB $DBN snapshot 2>/dev/null | grep -E "^(binding|kept)" > $S/rig/out/$T-5-after.txt; cat $S/rig/out/$T-5-after.txt
echo "GET h-exec (expired):              $($S/rig/getexec.sh h-exec harness-h-lookup h-session)"
echo "GET p-pub-sibling (unreferenced):  $($S/rig/getexec.sh p-pub-sibling harness-p-publication p-publication-s)"
echo "GET p-pub-referenced (COLLECTED):  $($S/rig/getexec.sh p-pub-referenced-%E9%9B%AA harness-p-publication p-publication-s | grep -o '"state":"[a-z]*"\|HTTP=[0-9]*' | tr '\n' ' ')"
lineage() { if [ "$DB" = mysql ]; then /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P33642 -N $DBN -e "$1" 2>/dev/null; else docker exec pr13642-mariadb mariadb -uroot -ppr13642 -N $DBN -e "$1"; fi; }
echo "lineage rows: sessions=$(lineage 'SELECT COUNT(*) FROM managed_agent_session') child_run projections=$(lineage "SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE domain='child_run'")"
echo "## [$T] 6. settle the parent's canonical child_run for c-pending while the real scheduler keeps running"
$S/rig/seed.sh $DB $DBN settle c-pending 2>/dev/null
sleep 8
grep -E "runtime_retention bindings" $S/rig/logs/$T-5-head-on.log | sed -E 's/^[0-9-]+T([0-9:.]{12}).*(runtime_retention )/\1 \2/' | tail -3
$S/rig/seed.sh $DB $DBN snapshot 2>/dev/null | grep -E "^binding c-" > $S/rig/out/$T-6-children.txt; echo "c-* bindings left:"; cat $S/rig/out/$T-6-children.txt
echo "lineage rows: sessions=$(lineage 'SELECT COUNT(*) FROM managed_agent_session') child_run projections=$(lineage "SELECT COUNT(*) FROM qwen_managed_session_extension_record WHERE domain='child_run'")"
stop $T-5-head-on
$S/rig/seed.sh $DB $DBN regen e-legacy 2>/dev/null
echo "## [$T] done"
