#!/bin/bash
# New head 18c8a418 + main aaf97b86 jar: stranded-shell probe and E2E on both engines
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
J=$S/jars/merge-r8c-758f0c77.jar
( for DB in mysql maria; do bash $S/rig/probe8c3.sh $DB $J newhead-$DB > $S/r8/probe8c-newhead-$DB.txt 2>&1; echo "probe newhead $DB exit=$?"; done ) &
( export BASEJAR=$S/jars/main-r8-da224e61.jar HEADJAR=$J CPDIR=cp-r8c SEEDOUT=out-r8c SETTLE_WAIT=150 SETTLE_WAIT2=60
  for DB in mysql maria; do [ $DB = mysql ] && P=33642 || P=43642
    /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P$P -e "DROP DATABASE IF EXISTS e2e_r8c_$DB" 2>/dev/null
    $S/rig/e2e8b.sh $DB e2e_r8c_$DB r8c-$DB > $S/r8/e2e-newhead-$DB.txt 2>&1; echo "e2e newhead $DB exit=$?"; done ) &
wait; echo R8C-JAR-DONE
