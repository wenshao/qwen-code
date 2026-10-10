#!/bin/bash
# Lock-timeout retry + scheduler coexistence on the trial-merge jar. usage: probe3.sh <mysql|maria> <dbname> <tag>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; DBN=$2; T=$3; P=QWEN_MANAGED_AGENT_RUNTIME; JAR=${JAR:-$S/jars/head.jar}
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
counts() { $S/rig/seed.sh $DB $DBN snapshot 2>/dev/null | grep -E "^count" | awk '{printf "%s=%s ", $2, $3} END {print ""}' | sed 's/qwen_//g'; }
echo "## [$T] 1. merge jar migrates an empty database (retention off)"
$S/rig/boot.sh $JAR $DB $DBN $T-1-migrate ${P}_BROKER_ENABLED=true > /dev/null
grep -o 'Successfully applied [0-9]* migrations.*now at version v[0-9]*' $S/rig/logs/$T-1-migrate.log; stop $T-1-migrate
echo "## [$T] 2. seed"
$S/rig/seed.sh $DB $DBN seed 2>/dev/null > /dev/null; counts
echo "## [$T] 3. hold tenant-e-big for 60 s, then boot with retention (3s) AND replay-floor (2s) enabled"
($S/rig/seed.sh $DB $DBN hold tenant-e-big 60 > $S/rig/out/$T-hold.txt 2>&1 &); sleep 2
$S/rig/boot.sh $JAR $DB $DBN $T-3-on ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=30d \
  ${P}_RETENTION_BATCH_SIZE=100 ${P}_RETENTION_SCAN_DELAY=3s QWEN_MANAGED_AGENT_REPLAY_FLOOR_ENABLED=true \
  QWEN_MANAGED_AGENT_REPLAY_FLOOR_INTERVAL=2s > /dev/null
PID=$(cat $S/rig/logs/$T-3-on.log.pid)
sleep 20
echo "threads while the lock is held:"; /Users/wenshao/Install/jdk21/bin/jstack $PID | grep -o '^"[^"]*"' | grep -v -E '^"(C[12] CompilerThread|GC |G1 |VM |Reference|Finalizer|Signal|Common-Cleaner|Notification|Attach|Service|Monitor|http-nio|Catalina|container|Druid|mysql-cj|Abandoned|ForkJoin|Thread-[0-9])' | sort | uniq -c
until grep -q RELEASED $S/rig/out/$T-hold.txt; do sleep 1; done; sleep 15
grep -h -E "HOLDING|RELEASED placement" $S/rig/out/$T-hold.txt | sed 's/ at 20[0-9-]*T/ at /'
grep -E "runtime_retention bindings|Runtime retention failed" $S/rig/logs/$T-3-on.log | sed -E 's/^[0-9-]+T([0-9:.]{12}).*(runtime_retention |Runtime retention failed)/\1 \2/' | head -8
grep -m1 -o 'Caused by: [^ ]*Exception: [^\r]*' $S/rig/logs/$T-3-on.log | cut -c1-140
echo "replay-floor log lines: $(grep -c -i 'replay floor' $S/rig/logs/$T-3-on.log)  ERROR lines: $(grep -c ' ERROR ' $S/rig/logs/$T-3-on.log)"
counts
stop $T-3-on
echo "## [$T] done"
